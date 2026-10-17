import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { migrationStatements } from "./test-helpers/migration-sql-statements.js"
import {
  STYLE_PUBLISHED_PORTRAITS_SQL,
  attachStylePublishedPortraits,
  styleCardBlots,
} from "./iconoplasm/style-published-portraits.js"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const MIGRATION = "0130_style_published_portraits.sql"
const require = createRequire(import.meta.url)

// The production schema just before 0130, with every trigger it carries.
function schemaBefore0130() {
  const db = new DatabaseSync(":memory:")
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql") && parseInt(n) < 130)
    .sort())
    db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
  return db
    .prepare(
      "SELECT sql, type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid",
    )
    .all()
}

// What the table must always equal: every gene's current portrait, filed under
// the style number after the dash of its emulsion code.
const TRUTH = `SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) AS style_slot,
    ps.gene_symbol, ps.current_asset_sha256 AS asset_sha256
  FROM icono_publish_state ps
  JOIN icono_portrait_assets pa ON pa.gene_symbol = ps.gene_symbol AND pa.asset_sha256 = ps.current_asset_sha256
  WHERE COALESCE(ps.current_asset_sha256, '') <> ''
    AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0
  ORDER BY style_slot, ps.gene_symbol`

async function assertExact(db, label) {
  const truth = (await db.prepare(TRUTH).all()).results
  const stored = (
    await db
      .prepare(
        "SELECT style_slot, gene_symbol, asset_sha256 FROM icono_style_published_portraits ORDER BY style_slot, gene_symbol",
      )
      .all()
  ).results
  assert.deepEqual(stored, truth, label)
}

const sha = (n) => `printf('%064x', ${n})`

test("a style's published portraits stay exact through every write that moves a portrait, at a measured price", async () => {
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare")
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('local')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
  try {
    const db = await runtime.getD1Database("DB")
    const definitions = schemaBefore0130()
    const structure = definitions.filter((x) => x.type !== "trigger")
    for (let i = 0; i < structure.length; i += 20)
      await db.batch(structure.slice(i, i + 20).map((x) => db.prepare(x.sql)))

    // Production's shape (2026-10-17 copy): 19,384 published genes, 19,379 of
    // them under a style number; 89% legacy `0-N` codes, the rest factory
    // codes, a few edited `-e` codes and five assets with no code. Two
    // drawings per gene, so a gene's other drawing is a real switch target.
    await db
      .prepare(
        `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<19384)
         INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id)
         SELECT 'G'||x, printf('%064x', x), 'full', 'thumb',
           CASE WHEN x <= 5 THEN NULL
                WHEN x % 9 = 0 THEN 'C9-' || (x % 13000 + 1)
                WHEN x % 97 = 0 THEN '0-' || (x % 13000 + 1) || '-e'
                ELSE '0-' || (x % 13000 + 1) END
         FROM n`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id)
         SELECT gene_symbol, printf('%064x', 100000 + CAST(substr(gene_symbol, 2) AS INTEGER)), 'full', 'thumb', 'A9-255'
         FROM icono_portrait_assets`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_publish_state(gene_symbol, current_asset_sha256)
         SELECT gene_symbol, asset_sha256 FROM icono_portrait_assets WHERE rowid <= 19384`,
      )
      .run()

    // Production's triggers (0128's counts among them) go in before 0130 runs,
    // the order a deploy applies it in.
    const triggers = definitions.filter((x) => x.type === "trigger")
    for (let i = 0; i < triggers.length; i += 20)
      await db.batch(triggers.slice(i, i + 20).map((x) => db.prepare(x.sql)))

    // The same two writes on production's schema before 0130, so the test can
    // say exactly what 0130's triggers add to them.
    const switchBefore = await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(100000 + 3000)} WHERE gene_symbol = 'G3000'`,
      )
      .run()
    const drawnBefore = await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G6001', ${sha(900005)}, 'f', 't', 'C9-255')`,
      )
      .run()

    // The migration's price, statement by statement, as D1 reports it.
    const applied = await db.batch(
      migrationStatements(MIGRATIONS, MIGRATION).map((sql) => db.prepare(sql)),
    )
    const price = applied.reduce(
      (sum, result) => ({
        rows_read: sum.rows_read + (result.meta.rows_read || 0),
        rows_written: sum.rows_written + (result.meta.rows_written || 0),
      }),
      { rows_read: 0, rows_written: 0 },
    )
    await assertExact(db, "backfill")
    const backfilled = await db
      .prepare("SELECT COUNT(*) blots FROM icono_style_published_portraits")
      .first()
    assert.equal(backfilled.blots, 19379)
    // The plan's prediction (cloudflare/operation-cost-migration-plan.json)
    // must cover what D1 measures here; the deploy admits it at twice that.
    const plan = JSON.parse(
      readFileSync(new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url)),
    )
    const prediction = plan.migrations[`iconoplasm/${MIGRATION}`]?.prediction
    if (prediction) {
      assert.ok(price.rows_read <= prediction.rows_read, `backfill read ${price.rows_read}`)
      assert.ok(
        price.rows_written <= prediction.rows_written,
        `backfill wrote ${price.rows_written}`,
      )
    }

    // A caretaker picks another drawing: the gene leaves its style for 255.
    const switched = await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(100000 + 4000)} WHERE gene_symbol = 'G4000'`,
      )
      .run()
    await assertExact(db, "publish switch")
    // Back to the first drawing, then onto a drawing of the same style number:
    // the gene's row in 255 must be replaced, not doubled.
    await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(4000)} WHERE gene_symbol = 'G4000'`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G4000', ${sha(800001)}, 'f', 't', '0-255')`,
      )
      .run()
    await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(100000 + 4000)} WHERE gene_symbol = 'G4000'`,
      )
      .run()
    await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(800001)} WHERE gene_symbol = 'G4000'`,
      )
      .run()
    await assertExact(db, "switch within one style number")

    // A gene published for the first time, and one whose portrait is cleared.
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('NEW1', ${sha(900001)}, 'f', 't', 'H9-31261')`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_publish_state(gene_symbol, current_asset_sha256) VALUES ('NEW1', ${sha(900001)})`,
      )
      .run()
    await assertExact(db, "first publish")
    await db.prepare("DELETE FROM icono_publish_state WHERE gene_symbol = 'G4001'").run()
    await assertExact(db, "publish row deleted")
    await db
      .prepare(
        "UPDATE icono_publish_state SET current_asset_sha256 = '' WHERE gene_symbol = 'G4002'",
      )
      .run()
    await assertExact(db, "portrait cleared")

    // The publish row can land before the asset row it names.
    await db
      .prepare(
        `INSERT INTO icono_publish_state(gene_symbol, current_asset_sha256) VALUES ('NEW2', ${sha(900002)})`,
      )
      .run()
    await assertExact(db, "publish before asset")
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('NEW2', ${sha(900002)}, 'f', 't', '0-30593')`,
      )
      .run()
    await assertExact(db, "asset after publish")

    // The asset upsert's COALESCE fills a code that was missing, and an
    // account erasure rewrites a published asset's code.
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G1', ${sha(1)}, 'f', 't', 'C9-343')
         ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET emulsion_id = COALESCE(excluded.emulsion_id, icono_portrait_assets.emulsion_id)`,
      )
      .run()
    await assertExact(db, "upsert fills a missing code")
    await db
      .prepare(
        `UPDATE icono_portrait_assets SET emulsion_id = emulsion_id WHERE gene_symbol = 'G5000'`,
      )
      .run()
    await assertExact(db, "rewrite to the same code")
    await db
      .prepare(
        `UPDATE icono_portrait_assets SET emulsion_id = '0-1' WHERE gene_symbol = 'G5001' AND asset_sha256 = ${sha(5001)}`,
      )
      .run()
    await assertExact(db, "erasure rewrites the code")
    await db
      .prepare(
        `DELETE FROM icono_portrait_assets WHERE gene_symbol = 'NEW1' AND asset_sha256 = ${sha(900001)}`,
      )
      .run()
    await assertExact(db, "published asset deleted")
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('NEW1', ${sha(900004)}, 'f', 't', 'C9-77')`,
      )
      .run()
    await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(900004)} WHERE gene_symbol = 'NEW1'`,
      )
      .run()
    await assertExact(db, "republish after the asset vanished")

    // A drawing nobody publishes costs the table nothing.
    const drawn = await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G6000', ${sha(900003)}, 'f', 't', 'C9-255')`,
      )
      .run()
    await assertExact(db, "unpublished drawing")

    // Votes order a card's pictures. Style 255 holds every gene's second
    // drawing that got published above; give three of its blots upvotes.
    await db
      .prepare(
        `INSERT INTO icono_vote_asset_summary(gene_symbol, asset_sha256, candidate_ref, upvotes)
         VALUES ('G4000', ${sha(800001)}, 'c1', 9), ('NEW2', ${sha(900002)}, 'c2', 4), ('G1', ${sha(1)}, 'c3', 7)`,
      )
      .run()
    const blotsOf = async (slot) =>
      styleCardBlots(
        (
          await db
            .prepare(STYLE_PUBLISHED_PORTRAITS_SQL)
            .bind(JSON.stringify([slot]))
            .all()
        ).results,
      )
    assert.equal((await blotsOf(255)).shown[0].gene_symbol, "G4000", "most upvoted first")
    assert.equal((await blotsOf(30593)).shown[0].gene_symbol, "NEW2")
    const style343 = await blotsOf(343)
    assert.ok(style343.shown.length <= 4, "at most four pictures")
    assert.equal(
      style343.count,
      (await db.prepare(`SELECT COUNT(*) n FROM (${TRUTH}) WHERE style_slot = 343`).first()).n,
      "the count is the style's whole set, not the four shown",
    )

    // The worker's attach: one card per style number, count and pictures from
    // the same rows, a style with no blots gets none.
    const cards = await attachStylePublishedPortraits(
      db,
      [
        { emulsion_family_id: "0-255" },
        { emulsion_family_id: "C9-255" },
        { emulsion_family_id: "0-30593" },
        { emulsion_family_id: "0-99999" },
      ],
      (asset) => `https://portraits.test/${asset}/medium.webp`,
    )
    assert.equal(cards.length, 3, "a style shows once")
    assert.equal(cards[0].preview_assets.length, Math.min(4, cards[0].canonical_count))
    assert.ok(cards[0].canonical_count > 0)
    assert.equal(cards[0].preview_assets[0].gene_symbol, "G4000")
    assert.match(cards[0].preview_assets[0].medium_url, /^https:\/\/portraits\.test\/0+c3501/)
    assert.equal(cards[2].canonical_count, 0)
    assert.deepEqual(cards[2].preview_assets, [])

    // The picker's read (the worker's own statement) for a page of 60 styles:
    // one json_each value per style, then one row and one vote seek per blot.
    const slots = Array.from({ length: 60 }, (_, i) => i * 211 + 1)
    const blotsOnPage = (
      await db
        .prepare(
          `SELECT COUNT(*) n FROM icono_style_published_portraits WHERE style_slot IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(slots))
        .first()
    ).n
    const page = await db.prepare(STYLE_PUBLISHED_PORTRAITS_SQL).bind(JSON.stringify(slots)).all()
    assert.ok(
      page.meta.rows_read <= slots.length + 2 * blotsOnPage,
      `page read ${page.meta.rows_read} rows for ${blotsOnPage} blots`,
    )
    // 0130 adds two rows to a caretaker's switch (the old portrait's row out,
    // the new one's in) and nothing to a drawing nobody publishes.
    assert.equal(
      switched.meta.rows_written - switchBefore.meta.rows_written,
      2,
      `switch wrote ${switched.meta.rows_written}, ${switchBefore.meta.rows_written} before 0130`,
    )
    assert.equal(drawn.meta.rows_written, drawnBefore.meta.rows_written, "drawing")

    console.log(
      "style published portraits receipts",
      JSON.stringify({
        migration: price,
        switch: [switchBefore.meta.rows_written, switched.meta.rows_written],
        drawn: [drawnBefore.meta.rows_written, drawn.meta.rows_written],
        page: page.meta,
        blotsOnPage,
      }),
    )
  } finally {
    await runtime.dispose()
  }
})
