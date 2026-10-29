// The style picker's pages are read by signed-in readers as they scroll "All
// styles" or search for a number, so their price is paid per reader. Each page
// must read the style rollup by index, its own size plus a constant, at any
// depth and at any catalogue size; a page that reached for the raw portrait or
// vision tables, or sorted the whole rollup, would read rows in proportion to
// the catalogue. Production on the 2026-10-28 copy: 20,577 styles, 96% with no
// votes, so a deep page sits inside one large tie group. This runs the real SQL
// on the fully migrated schema and counts the rows from D1's own receipts.
//
// Ways this can fail, written before the code:
//  1. a deep page reads more rows at 20,000 styles than at 2,000;
//  2. a page reads more than about three rows a style plus a small constant:
//     its size plus one from the rollup, and two a style for its stored card
//     (D1 counts the json_each row and the card); more means one seek scanned a
//     whole tie group;
//  3. following the cursor skips or repeats a style;
//  4. a search reads the whole rollup: a number that is not a style slot, or
//     any text, reads its two prefix ranges, each by index and bounded (one
//     statement that ORed them read all 20,577 styles on production's copy).
import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"

import { listGenerationRequestVisionOptionsPage } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./test-helpers/d1-row-meter.js"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const require = createRequire(import.meta.url)
const ORIGIN = "https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options"

// The production schema, with every index and trigger the migrations leave.
function productionSchema() {
  const db = new DatabaseSync(":memory:")
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
  return db
    .prepare(
      "SELECT sql, type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid",
    )
    .all()
}

// Production's shape: almost every style has no votes, and the rest of the
// sort key repeats, so most styles share a tie group with hundreds of others.
// Two in three styles have a stored card (13,091 cards for 20,577 styles).
async function seedStyles(db, count) {
  const styles = []
  const cards = []
  for (let i = 1; i <= count; i += 1) {
    const h = i % 100 === 0 ? 2 : i % 25 === 0 ? 1 : 0
    styles.push(`('anima-v1-${i}', '0-${i}', ${1 + (i % 4)}, ${i % 6}, ${i % 3}, ${h}, '[]', 3)`)
    if (i % 3) cards.push(`(${i}, ${1 + (i % 4)}, '[["TP53","${"a".repeat(64)}",${i % 3}]]')`)
  }
  for (let i = 0; i < styles.length; i += 500)
    await db
      .prepare(
        `INSERT INTO icono_generation_request_vision_option_rollup
           (vision_id, emulsion_id, image_count, live_count, score, vote_h_index,
            preview_assets_json, builder_version)
         VALUES ${styles.slice(i, i + 500).join(", ")}`,
      )
      .run()
  for (let i = 0; i < cards.length; i += 500)
    await db
      .prepare(
        `INSERT INTO icono_style_cards (style_slot, blot_count, portraits_json)
         VALUES ${cards.slice(i, i + 500).join(", ")}`,
      )
      .run()
}

async function priced(db, query) {
  const meter = createOperationCostD1Meter(db)
  const url = new URL(ORIGIN)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const page = await listGenerationRequestVisionOptionsPage({ ICONOPLASM_DB: meter.db }, url)
  return { page, cost: meter.finish() }
}

test("a picker page reads about three rows a style it shows, at any depth and catalogue size", async () => {
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare")
  const definitions = productionSchema()
  const measured = {}
  for (const styles of [2000, 20000]) {
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
      for (const type of ["structure", "trigger"]) {
        const batch = definitions.filter((x) => (x.type === "trigger") === (type === "trigger"))
        for (let i = 0; i < batch.length; i += 20)
          await db.batch(batch.slice(i, i + 20).map((x) => db.prepare(x.sql)))
      }
      await seedStyles(db, styles)

      const first = await priced(db, {})
      const pages = [first.cost.rows_read]
      const seen = new Set(first.page.options.map((option) => option.vision_id))
      let cursor = first.page.nextCursor
      // Six pages on from the first, then a page from the middle of the list,
      // inside the largest tie group (no votes).
      for (let depth = 0; depth < 6; depth += 1) {
        const next = await priced(db, { after: cursor })
        pages.push(next.cost.rows_read)
        for (const option of next.page.options) {
          assert.ok(!seen.has(option.vision_id), `${styles}: ${option.vision_id} repeated`)
          seen.add(option.vision_id)
        }
        cursor = next.page.nextCursor
      }
      assert.equal(seen.size, 120 + 6 * 60, `${styles}: the cursor skipped styles`)
      const middle = Math.floor(styles / 2) + 1
      const deep = await priced(db, {
        after: JSON.stringify([0, middle % 6, middle % 3, 1 + (middle % 4), `anima-v1-${middle}`]),
      })
      assert.equal(deep.page.options.length, 60, `${styles}: the deep page is not full`)
      const search = await priced(db, { query: String(middle) })
      const text = await priced(db, { query: "anim" })
      assert.equal(text.page.options.length > 0, true, `${styles}: "anim" found no style`)

      measured[styles] = {
        pages,
        deep: deep.cost.rows_read,
        search: search.cost.rows_read,
        text: text.cost.rows_read,
      }
      assert.ok(first.cost.rows_read <= 121 + 2 * 120 + 30, JSON.stringify(measured[styles]))
      for (const reads of [...pages.slice(1), deep.cost.rows_read])
        assert.ok(reads <= 61 + 2 * 60 + 30, JSON.stringify(measured[styles]))
      for (const reads of [search.cost.rows_read, text.cost.rows_read])
        assert.ok(reads <= 2 * 240 + 2 * 120 + 30, JSON.stringify(measured[styles]))
    } finally {
      await runtime.dispose()
    }
  }
  console.log(JSON.stringify(measured))
  // Ten times the catalogue costs a reader nothing more on any page.
  assert.ok(measured[20000].deep <= measured[2000].deep + 5, JSON.stringify(measured))
  assert.ok(measured[20000].text <= measured[2000].text + 5, JSON.stringify(measured))
  for (const [i, reads] of measured[20000].pages.entries())
    assert.ok(reads <= measured[2000].pages[i] + 5, JSON.stringify(measured))
})
