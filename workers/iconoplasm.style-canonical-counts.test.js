import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { applyMigrationFile } from "./test-helpers/migration-sql-statements.js"
import { STYLE_CANONICAL_COUNTS_SQL } from "./iconoplasm/style-canonical-counts.js"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const require = createRequire(import.meta.url)

// The production schema just before 0128, with every trigger it carries.
function schemaBefore0128() {
  const db = new DatabaseSync(":memory:")
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql") && parseInt(n) < 128)
    .sort())
    db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
  return db
    .prepare(
      "SELECT sql, type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid",
    )
    .all()
}

// What the table must always equal: every gene's current portrait, counted
// under the style number after the dash of its emulsion code.
const TRUTH = `SELECT CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) AS style_slot, COUNT(*) AS canonical
  FROM icono_publish_state ps
  JOIN icono_portrait_assets pa ON pa.gene_symbol = ps.gene_symbol AND pa.asset_sha256 = ps.current_asset_sha256
  WHERE COALESCE(ps.current_asset_sha256, '') <> ''
  GROUP BY style_slot HAVING style_slot > 0 ORDER BY style_slot`

async function assertExact(db, label) {
  const truth = (await db.prepare(TRUTH).all()).results
  const stored = (
    await db
      .prepare(
        "SELECT style_slot, canonical FROM icono_style_canonical_counts WHERE canonical > 0 ORDER BY style_slot",
      )
      .all()
  ).results
  assert.deepEqual(stored, truth, label)
  const negative = await db
    .prepare("SELECT COUNT(*) n FROM icono_style_canonical_counts WHERE canonical < 0")
    .first()
  assert.equal(negative.n, 0, `${label}: no style goes below zero`)
}

const sha = (n) => `printf('%064x', ${n})`

test("canonical blots per style stay exact through every write that moves a portrait", async () => {
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
    const definitions = schemaBefore0128()
    const structure = definitions.filter((x) => x.type !== "trigger")
    for (let i = 0; i < structure.length; i += 20)
      await db.batch(structure.slice(i, i + 20).map((x) => db.prepare(x.sql)))

    // Production's shape (2026-10-14 copy): 19,380 genes, each with a current
    // portrait; 89% legacy `0-N` codes, the rest factory codes, a few edited
    // `-e` codes and five assets with no code. Two drawings per gene, so a
    // gene's other drawing is a real switch target.
    await db
      .prepare(
        `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<19380)
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
         SELECT gene_symbol, asset_sha256 FROM icono_portrait_assets WHERE rowid <= 19380`,
      )
      .run()

    // Production's triggers go in before 0128 runs, so its own triggers are
    // installed beside them, the order a deploy applies it in.
    const triggers = definitions.filter((x) => x.type === "trigger")
    for (let i = 0; i < triggers.length; i += 20)
      await db.batch(triggers.slice(i, i + 20).map((x) => db.prepare(x.sql)))

    await applyMigrationFile(db, MIGRATIONS, "0128_style_canonical_counts.sql")
    await assertExact(db, "backfill")
    const backfilled = await db
      .prepare("SELECT COUNT(*) styles, SUM(canonical) blots FROM icono_style_canonical_counts")
      .first()
    assert.equal(backfilled.blots, 19375)
    // The backfill's price on D1's meters: its SELECT's reads, one write per style.
    const backfillRead = await db
      .prepare(`SELECT COUNT(*) FROM (${TRUTH.replace(" ORDER BY style_slot", "")})`)
      .run()

    // A caretaker picks another drawing: the gene leaves its style for 255.
    const switched = await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(100000 + 4000)} WHERE gene_symbol = 'G4000'`,
      )
      .run()
    await assertExact(db, "publish switch")

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

    // Assets seeded above predate production's eligibility triggers, so the
    // asset deleted below is one drawn after them, as every real asset is.
    // The asset upsert's COALESCE rewrites a code that was missing, and an
    // account erasure rewrites a canonical asset's code.
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G1', ${sha(1)}, 'f', 't', 'C9-343')
         ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET emulsion_id = COALESCE(excluded.emulsion_id, icono_portrait_assets.emulsion_id)`,
      )
      .run()
    await assertExact(db, "upsert fills a missing code")
    const unchanged = await db
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
    await assertExact(db, "canonical asset deleted")
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

    // A drawing nobody publishes costs the counts nothing.
    const drawn = await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G6000', ${sha(900003)}, 'f', 't', 'C9-255')`,
      )
      .run()
    await assertExact(db, "unpublished drawing")

    // The picker's read (the worker's own statement): two rows per style on
    // the page, one json_each value and one primary-key seek; 120 for a page
    // of 60. An IN (SELECT ...) costs three.
    const slots = Array.from({ length: 60 }, (_, i) => i * 211 + 1)
    const page = await db.prepare(STYLE_CANONICAL_COUNTS_SQL).bind(JSON.stringify(slots)).all()
    assert.equal(page.results.length, 60)
    assert.ok(page.meta.rows_read <= 2 * slots.length, `page read ${page.meta.rows_read} rows`)
    // A caretaker's switch writes the publish row and the two counts.
    assert.ok(switched.meta.rows_written <= 3, `switch wrote ${switched.meta.rows_written}`)

    console.log(
      "style canonical count receipts",
      JSON.stringify({
        styles: backfilled.styles,
        backfillRowsRead: backfillRead.meta.rows_read,
        switch: switched.meta,
        unchanged: unchanged.meta,
        drawn: drawn.meta,
        page: page.meta,
      }),
    )
  } finally {
    await runtime.dispose()
  }
})
