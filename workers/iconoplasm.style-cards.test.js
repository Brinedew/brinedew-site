import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { migrationStatements } from "./test-helpers/migration-sql-statements.js"
import {
  STYLE_CARDS_SQL,
  attachStylePublishedPortraits,
  styleCardBlots,
} from "./iconoplasm/style-published-portraits.js"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const MIGRATION = "0144_style_cards.sql"
const require = createRequire(import.meta.url)

// The production schema just before 0144, with every trigger it carries.
function schemaBefore0144() {
  const db = new DatabaseSync(":memory:")
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql") && parseInt(n) < 144)
    .sort())
    db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
  return db
    .prepare(
      "SELECT sql, type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid",
    )
    .all()
}

// What every card must equal: the style's whole set of blots, and its four
// most upvoted, worked out from scratch the way the worker did before 0144.
async function truth(db) {
  const rows = (
    await db
      .prepare(
        `SELECT m.style_slot, m.gene_symbol, m.asset_sha256, COALESCE(v.upvotes, 0) AS upvotes
         FROM icono_style_published_portraits m
         LEFT JOIN icono_vote_asset_summary v
           ON v.gene_symbol = m.gene_symbol AND v.asset_sha256 = m.asset_sha256`,
      )
      .all()
  ).results
  const bySlot = new Map()
  for (const row of rows) {
    if (!bySlot.has(row.style_slot)) bySlot.set(row.style_slot, [])
    bySlot.get(row.style_slot).push(row)
  }
  const cards = new Map()
  for (const [slot, blots] of bySlot) {
    const shown = [...blots]
      .sort(
        (a, b) =>
          b.upvotes - a.upvotes ||
          (a.asset_sha256 < b.asset_sha256 ? -1 : a.asset_sha256 > b.asset_sha256 ? 1 : 0),
      )
      .slice(0, 4)
      .map(({ gene_symbol, asset_sha256, upvotes }) => ({ gene_symbol, asset_sha256, upvotes }))
    cards.set(slot, { count: blots.length, shown })
  }
  return cards
}

// A style that lost its last blot keeps a card of count 0, which reads the
// same as no card.
async function assertCards(db, label, { ignoreVotes = false } = {}) {
  const expected = await truth(db)
  const stored = (
    await db.prepare("SELECT style_slot, blot_count, portraits_json FROM icono_style_cards").all()
  ).results
  const seen = new Set()
  for (const row of stored) {
    const card = styleCardBlots(row)
    const want = expected.get(row.style_slot) || { count: 0, shown: [] }
    seen.add(row.style_slot)
    assert.equal(card.count, want.count, `${label}: style ${row.style_slot} count`)
    if (ignoreVotes) continue
    assert.deepEqual(card.shown, want.shown, `${label}: style ${row.style_slot} pictures`)
  }
  for (const slot of expected.keys())
    assert.ok(seen.has(slot), `${label}: style ${slot} has no card`)
}

const sha = (n) => `printf('%064x', ${n})`

function priceOf(results) {
  return results.reduce(
    (sum, result) => ({
      rows_read: sum.rows_read + (result.meta.rows_read || 0),
      rows_written: sum.rows_written + (result.meta.rows_written || 0),
    }),
    { rows_read: 0, rows_written: 0 },
  )
}

test("stored style cards equal their blots through every write that moves a portrait, at a measured price", async () => {
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
    const definitions = schemaBefore0144()
    const structure = definitions.filter((x) => x.type !== "trigger")
    for (let i = 0; i < structure.length; i += 20)
      await db.batch(structure.slice(i, i + 20).map((x) => db.prepare(x.sql)))
    const triggers = definitions.filter((x) => x.type === "trigger")
    for (let i = 0; i < triggers.length; i += 20)
      await db.batch(triggers.slice(i, i + 20).map((x) => db.prepare(x.sql)))

    // Production's shape (2026-10-26 copy): 19,380 published portraits in
    // 13,084 styles, at most 42 blots in one style, 59,023 vote summaries.
    // Two drawings per gene, so a gene's other drawing is a real switch
    // target, and style 777 holds 42 blots, the largest style's size.
    await db
      .prepare(
        `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<19340)
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
        `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<40)
         INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id)
         SELECT 'BIG'||x, printf('%064x', 700000 + x), 'full', 'thumb', '0-777' FROM n`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id)
         SELECT gene_symbol, printf('%064x', 100000 + rowid), 'full', 'thumb', 'A9-255'
         FROM icono_portrait_assets`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_publish_state(gene_symbol, current_asset_sha256)
         SELECT gene_symbol, asset_sha256 FROM icono_portrait_assets WHERE rowid <= 19380`,
      )
      .run()
    // Three vote summaries per published portrait's gene, as on production.
    await db
      .prepare(
        `INSERT INTO icono_vote_asset_summary(gene_symbol, asset_sha256, candidate_ref, upvotes)
         SELECT gene_symbol, asset_sha256, 'c' || rowid, abs(random()) % 9
         FROM icono_portrait_assets`,
      )
      .run()
    await db
      .prepare(
        `UPDATE icono_vote_asset_summary SET upvotes = 0 WHERE gene_symbol = 'BIG40' AND asset_sha256 = ${sha(700040)}`,
      )
      .run()

    // The same caretaker switch on production's schema before 0144, so the
    // test can say exactly what 0144's triggers add to it.
    const switchBefore = await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = (SELECT asset_sha256 FROM icono_portrait_assets WHERE gene_symbol = 'G3000' AND emulsion_id = 'A9-255') WHERE gene_symbol = 'G3000'`,
      )
      .run()

    const applied = await db.batch(
      migrationStatements(MIGRATIONS, MIGRATION).map((sql) => db.prepare(sql)),
    )
    const price = priceOf(applied)
    await assertCards(db, "backfill")
    const blots = await db
      .prepare(
        "SELECT COUNT(*) n, COUNT(DISTINCT style_slot) styles FROM icono_style_published_portraits",
      )
      .first()
    const largest = await db
      .prepare(
        "SELECT MAX(n) n FROM (SELECT COUNT(*) n FROM icono_style_published_portraits WHERE style_slot <> 255 GROUP BY style_slot)",
      )
      .first()
    assert.equal(largest.n, 42)
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
        `UPDATE icono_publish_state SET current_asset_sha256 = (SELECT asset_sha256 FROM icono_portrait_assets WHERE gene_symbol = 'G4000' AND emulsion_id = 'A9-255') WHERE gene_symbol = 'G4000'`,
      )
      .run()
    await assertCards(db, "publish switch")
    // The largest style loses a blot and gets it back.
    const bigLeaves = await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = (SELECT asset_sha256 FROM icono_portrait_assets WHERE gene_symbol = 'BIG7' AND emulsion_id = 'A9-255') WHERE gene_symbol = 'BIG7'`,
      )
      .run()
    await assertCards(db, "largest style loses a blot")
    await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = ${sha(700007)} WHERE gene_symbol = 'BIG7'`,
      )
      .run()
    await assertCards(db, "largest style gets it back")

    // A gene published for the first time, one whose publish row goes, one
    // whose portrait is cleared, and a style emptied to nothing.
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
    await assertCards(db, "first publish, a new style")
    await db.prepare("DELETE FROM icono_publish_state WHERE gene_symbol = 'G4001'").run()
    await assertCards(db, "publish row deleted")
    await db
      .prepare(
        "UPDATE icono_publish_state SET current_asset_sha256 = '' WHERE gene_symbol = 'G4002'",
      )
      .run()
    await assertCards(db, "portrait cleared")
    await db.prepare("DELETE FROM icono_publish_state WHERE gene_symbol = 'NEW1'").run()
    await assertCards(db, "a style emptied")
    assert.equal(
      (
        await db
          .prepare("SELECT blot_count FROM icono_style_cards WHERE style_slot = 31261")
          .first()
      ).blot_count,
      (await truth(db)).get(31261)?.count || 0,
    )

    // The publish row can land before the asset row it names, and an account
    // erasure or an upsert can rewrite a published asset's code.
    await db
      .prepare(
        `INSERT INTO icono_publish_state(gene_symbol, current_asset_sha256) VALUES ('NEW2', ${sha(900002)})`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('NEW2', ${sha(900002)}, 'f', 't', '0-777')`,
      )
      .run()
    await assertCards(db, "asset after publish")
    await db
      .prepare(
        `UPDATE icono_portrait_assets SET emulsion_id = '0-1' WHERE gene_symbol = 'BIG9' AND asset_sha256 = ${sha(700009)}`,
      )
      .run()
    await assertCards(db, "erasure rewrites the code")
    await db
      .prepare(
        `DELETE FROM icono_portrait_assets WHERE gene_symbol = 'BIG10' AND asset_sha256 = ${sha(700010)}`,
      )
      .run()
    await assertCards(db, "published asset deleted")
    // A drawing nobody publishes touches no card.
    const cardsBefore = await db
      .prepare("SELECT * FROM icono_style_cards WHERE style_slot = 777")
      .first()
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, emulsion_id) VALUES ('G6000', ${sha(900003)}, 'f', 't', '0-777')`,
      )
      .run()
    assert.deepEqual(
      await db.prepare("SELECT * FROM icono_style_cards WHERE style_slot = 777").first(),
      cardsBefore,
    )

    // Votes alone leave cards as they were (0144 says why): the count holds,
    // the pictures keep their old ranking until the style next changes.
    await db
      .prepare(
        `UPDATE icono_vote_asset_summary SET upvotes = 1000 WHERE gene_symbol = 'BIG40' AND asset_sha256 = ${sha(700040)}`,
      )
      .run()
    await assertCards(db, "after a vote", { ignoreVotes: true })
    const beforeChange = styleCardBlots(
      await db.prepare("SELECT * FROM icono_style_cards WHERE style_slot = 777").first(),
    )
    assert.notEqual(beforeChange.shown[0].gene_symbol, "BIG40", "a vote alone re-ranks nothing")
    await db
      .prepare(
        `UPDATE icono_publish_state SET current_asset_sha256 = (SELECT asset_sha256 FROM icono_portrait_assets WHERE gene_symbol = 'BIG11' AND emulsion_id = 'A9-255') WHERE gene_symbol = 'BIG11'`,
      )
      .run()
    await assertCards(db, "the style's next change takes the votes in")
    const afterChange = styleCardBlots(
      await db.prepare("SELECT * FROM icono_style_cards WHERE style_slot = 777").first(),
    )
    assert.equal(afterChange.shown[0].gene_symbol, "BIG40")

    // The worker's attach: one card per style number, a style with no blots
    // gets none, and the pictures carry their portrait URLs.
    const cards = await attachStylePublishedPortraits(
      db,
      [
        { emulsion_family_id: "0-777" },
        { emulsion_family_id: "C9-777" },
        { emulsion_family_id: "0-31261" },
        { emulsion_family_id: "0-99999" },
      ],
      (asset) => `https://portraits.test/${asset}/medium.webp`,
    )
    assert.equal(cards.length, 3, "a style shows once")
    assert.equal(cards[0].canonical_count, (await truth(db)).get(777).count)
    assert.equal(cards[0].preview_assets.length, 4)
    assert.equal(cards[0].preview_assets[0].gene_symbol, "BIG40")
    assert.equal(cards[0].preview_assets[0].is_current, true)
    assert.ok(
      cards[0].preview_assets[0].medium_url.endsWith(`${(700040).toString(16)}/medium.webp`),
    )
    assert.equal(cards[1].canonical_count, 0)
    assert.deepEqual(cards[1].preview_assets, [])
    assert.equal(cards[2].canonical_count, 0)

    // The picker job's read for its 120 styles and a reader's 26 favourites:
    // one json_each value and one card per style, whatever the styles' size.
    const slots = [777, ...Array.from({ length: 119 }, (_, i) => i * 109 + 1)]
    const page = await db.prepare(STYLE_CARDS_SQL).bind(JSON.stringify(slots)).all()
    assert.ok(page.meta.rows_read <= 2 * slots.length, `page read ${page.meta.rows_read} rows`)
    const favorites = await db
      .prepare(STYLE_CARDS_SQL)
      .bind(JSON.stringify(slots.slice(0, 26)))
      .all()
    assert.ok(favorites.meta.rows_read <= 52, `favourites read ${favorites.meta.rows_read} rows`)

    // 0144 adds the two cards a switch touches (the style it leaves and the
    // style it joins), and reads at most about two rows per blot of each.
    assert.equal(
      switched.meta.rows_written - switchBefore.meta.rows_written,
      2,
      `switch wrote ${switched.meta.rows_written}, ${switchBefore.meta.rows_written} before 0144`,
    )

    console.log(
      "style cards receipts",
      JSON.stringify({
        migration: price,
        blots,
        switch: [switchBefore.meta, switched.meta],
        bigLeaves: bigLeaves.meta,
        page: page.meta,
        favorites: favorites.meta,
      }),
    )
  } finally {
    await runtime.dispose()
  }
})
