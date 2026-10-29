import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"

const TOKEN = "admin-token-0000000000000000000000000001"

// B-1188: the admin home's gene counts (migration 0147) against the tables
// that are true, on every production migration. Failure modes, written first:
// 1. A count is taken from a copy instead of the catalogue, the portraits and
//    icono_publish_state, and drifts from them (0095's counts were exact sums
//    of icono_admin_gene_rollup: 610 genes "with no candidate" that had one).
// 2. A change moves a gene between buckets (none, one, two to five, six or
//    more) and the counts miss it: a portrait added, deleted, rejected, taken
//    off auto-pick; a gene added
//    to, removed from or renamed in the catalogue.
// 3. A card breaks or heals and the count misses it: a card set to a portrait
//    that is not stored, the portrait arriving, the portrait deleted, the card
//    cleared, a gene leaving the catalogue with a broken card.
// 4. A gene outside the catalogue is counted.
// 5. A rolled-back change leaves its counts behind.
// 6. Everyday writes pay for the counts: a reader's vote rewrites the card to
//    the one it already is; an election moves it to another stored portrait; a
//    new portrait keeps its gene in the same bucket.

const eligible = (p) =>
  Number(p.autopick_eligible ?? 1) === 1 && (p.status ?? "draft") !== "rejected" && p.asset_sha256

async function truth(db) {
  const all = async (sql) => (await db.prepare(sql).all()).results
  const catalogue = await all("SELECT gene_symbol FROM icono_gene_catalog")
  const portraits = await all("SELECT * FROM icono_portrait_assets")
  const cards = new Map(
    (await all("SELECT * FROM icono_publish_state")).map((row) => [
      row.gene_symbol,
      row.current_asset_sha256 || "",
    ]),
  )
  const stored = new Set(portraits.map((p) => `${p.gene_symbol}|${p.asset_sha256}`))
  const counts = catalogue.map(
    ({ gene_symbol }) =>
      portraits.filter((p) => p.gene_symbol === gene_symbol && eligible(p)).length,
  )
  const broken = catalogue.filter(({ gene_symbol }) => {
    const card = cards.get(gene_symbol) || ""
    return card !== "" && !stored.has(`${gene_symbol}|${card}`)
  }).length
  const count = (test) => counts.filter(test).length
  return {
    genes: catalogue.length,
    drift: broken,
    current_asset_missing: broken,
    missing: count((n) => n === 0),
    zero_candidates: count((n) => n === 0),
    one_candidate: count((n) => n === 1),
    two_to_five_candidates: count((n) => n >= 2 && n <= 5),
    six_plus_candidates: count((n) => n >= 6),
  }
}

async function summary(db) {
  return db
    .prepare("SELECT * FROM icono_admin_dashboard_summary WHERE summary_key = 'default'")
    .first()
}

async function assertTrue(db, label) {
  const stored = await summary(db)
  for (const [key, value] of Object.entries(await truth(db)))
    assert.equal(stored[key], value, `${label}: ${key}`)
}

const portrait = (gene, sha, status = "draft") =>
  `INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, status)
   VALUES ('${gene}', '${sha}', '', '', '${status}')`
const gene = (symbol) =>
  `INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('${symbol}', '${symbol}')`
const card = (symbol, sha) =>
  `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256) VALUES ('${symbol}', '${sha}')`

test("the admin home's gene counts follow every change to the true tables", async () => {
  const db = iconoplasmDatabase()
  const run = (sql) => db.prepare(sql).run()
  for (const symbol of ["A", "B", "C", "D"]) await run(gene(symbol))
  await assertTrue(db, "four genes, no portraits")

  for (const [label, sql] of [
    ["A's first candidate", portrait("A", "a1")],
    ["A's second", portrait("A", "a2")],
    ["A's third", portrait("A", "a3")],
    ["A's fourth", portrait("A", "a4")],
    ["A's fifth", portrait("A", "a5")],
    ["A's sixth", portrait("A", "a6")],
    ["A's seventh", portrait("A", "a7")],
    [
      "A's a1 rejected",
      "UPDATE icono_portrait_assets SET status = 'rejected' WHERE asset_sha256 = 'a1'",
    ],
    [
      "A's a2 off auto-pick",
      "UPDATE icono_portrait_assets SET autopick_eligible = 0 WHERE asset_sha256 = 'a2'",
    ],
    [
      "A's a2 back on",
      "UPDATE icono_portrait_assets SET autopick_eligible = 1 WHERE asset_sha256 = 'a2'",
    ],
    [
      "approval keeps A's a4 eligible",
      "UPDATE icono_portrait_assets SET status = 'approved' WHERE asset_sha256 = 'a4'",
    ],
    ["a rejected portrait arrives for C", portrait("C", "c0", "rejected")],
    ["B's card names a portrait not stored", card("B", "bx")],
    ["the portrait arrives", portrait("B", "bx")],
    ["the portrait is deleted", "DELETE FROM icono_portrait_assets WHERE asset_sha256 = 'bx'"],
    [
      "B's card is cleared",
      "UPDATE icono_publish_state SET current_asset_sha256 = '' WHERE gene_symbol = 'B'",
    ],
    [
      "B's card names another missing portrait",
      "UPDATE icono_publish_state SET current_asset_sha256 = 'by' WHERE gene_symbol = 'B'",
    ],
    [
      "B leaves the catalogue with a broken card",
      "DELETE FROM icono_gene_catalog WHERE gene_symbol = 'B'",
    ],
    ["a gene outside the catalogue gets a portrait", portrait("Z", "z1")],
    ["and a broken card", card("Z", "zx")],
    ["Z joins the catalogue", gene("Z")],
    ["B comes back", gene("B")],
    ["C is renamed E", "UPDATE icono_gene_catalog SET gene_symbol = 'E' WHERE gene_symbol = 'C'"],
    ["Z's card is deleted", "DELETE FROM icono_publish_state WHERE gene_symbol = 'Z'"],
    [
      "D gets ten portraits in one statement",
      `INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb)
       SELECT 'D', 'd' || value, '', '' FROM json_each('[1,2,3,4,5,6,7,8,9,10]')`,
    ],
    ["A loses every portrait", "DELETE FROM icono_portrait_assets WHERE gene_symbol = 'A'"],
  ]) {
    await run(sql)
    await assertTrue(db, label)
  }

  // 5. The last statement fails, so the batch rolls back with its counts.
  const before = await summary(db)
  await assert.rejects(
    db.batch([
      db.prepare("DELETE FROM icono_portrait_assets"),
      db.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol = 'D'"),
      db.prepare(gene("E")),
    ]),
  )
  assert.deepEqual(await summary(db), before)
  await assertTrue(db, "after a rollback")
})

test("a vote, an election and a portrait that keeps its bucket do not write the counts", async () => {
  const db = iconoplasmDatabase()
  const run = (sql) => db.prepare(sql).run()
  await run(gene("TP53"))
  for (const sha of ["t1", "t2"]) await run(portrait("TP53", sha))
  await run(card("TP53", "t1"))
  // Whether `sql` wrote the counts row: a marker it would overwrite.
  const writes = async (sql) => {
    await run("UPDATE icono_admin_dashboard_summary SET updated_at = 'marker'")
    await run(sql)
    return (await summary(db)).updated_at === "marker" ? 0 : 1
  }
  const vote =
    "UPDATE icono_publish_state SET current_asset_sha256 = 't1' WHERE gene_symbol = 'TP53'"
  assert.equal(await writes(vote), 0, "a vote that keeps the card")
  const election =
    "UPDATE icono_publish_state SET current_asset_sha256 = 't2' WHERE gene_symbol = 'TP53'"
  assert.equal(await writes(election), 0, "an election to a stored portrait")
  assert.equal(await writes(portrait("TP53", "t3")), 0, "a third candidate")
  for (const sha of ["t4", "t5"]) await run(portrait("TP53", sha))
  assert.equal(await writes(portrait("TP53", "t6")), 1, "the sixth crosses into six or more")
  await assertTrue(db, "TP53 with six")
})

// The admin home reads these counts and lists the genes behind them, worst
// first: a broken card, then no candidate, then stale portraits, then a pin.
test("the admin home shows the true counts and the genes that need the owner", async () => {
  const db = iconoplasmDatabase()
  const run = (sql) => db.prepare(sql).run()
  for (const symbol of ["BROKEN", "BARE", "STALE", "PINNED", "FINE"]) await run(gene(symbol))
  for (const [symbol, sha] of [
    ["BROKEN", "b1"],
    ["STALE", "s1"],
    ["STALE", "s2"],
    ["PINNED", "p1"],
    ["FINE", "f1"],
    ["GONE", "g1"],
  ])
    await run(portrait(symbol, sha))
  await run(portrait("BARE", "x1", "rejected"))
  await run("UPDATE icono_portrait_assets SET is_stale = 1 WHERE asset_sha256 IN ('s2', 'g1')")
  for (const [symbol, sha] of [
    ["BROKEN", "not-stored"],
    ["STALE", "s1"],
    ["PINNED", "p1"],
    ["FINE", "f1"],
    ["GONE", "also-not-stored"],
  ])
    await run(card(symbol, sha))
  await run("UPDATE icono_publish_state SET admin_override = 1 WHERE gene_symbol = 'PINNED'")

  const response = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/overview?event_limit=0", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
    { ICONOPLASM_DB: db, ICONOPLASM_ADMIN_TOKEN: TOKEN },
    {},
  )
  assert.equal(response.status, 200)
  const { summary, attention, recent_events } = await response.json()
  // GONE is not in the catalogue: its broken card and stale portrait are not
  // the readers' problem, so the home neither counts nor lists it.
  assert.deepEqual(
    [summary.genes, summary.drift, summary.missing, summary.with_live, summary.overrides],
    [5, 1, 1, 4, 1],
  )
  assert.deepEqual(
    attention.map((item) => [item.symbol, item.kind, item.stale_assets]),
    [
      ["BROKEN", "drift", 0],
      ["BARE", "missing", 0],
      ["STALE", "stale", 1],
      ["PINNED", "override", 0],
    ],
  )
  assert.deepEqual(recent_events, [])
})

// Production on the day 0147 runs: counts that 0095 summed from a drifting
// copy. The migration replaces them with the truth.
test("the migration seeds the counts from the true tables, not the copy", async () => {
  const database = new DatabaseSync(":memory:")
  const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))
  const at = names.findIndex((name) => name.startsWith("0147_"))
  for (const name of names.slice(0, at))
    database.exec(readFileSync(new URL(name, directory), "utf8"))
  database.exec(`
    ${gene("ONE")}; ${gene("FRESH")}; ${gene("BROKEN")};
    ${portrait("ONE", "o1")}; ${portrait("FRESH", "f1")}; ${portrait("FRESH", "f2")};
    ${card("ONE", "o1")}; ${card("BROKEN", "gone")};
    INSERT INTO icono_admin_gene_rollup (gene_symbol, candidate_count, current_asset_sha256)
      VALUES ('ONE', 0, ''), ('RETIRED', 4, 'r1');
  `)
  database.exec(readFileSync(new URL(names[at], directory), "utf8"))
  const db = {
    prepare: (sql) => ({
      all: async () => ({ results: database.prepare(sql).all() }),
      first: async () => database.prepare(sql).get(),
    }),
  }
  await assertTrue(db, "seeded")
  assert.deepEqual(
    [(await summary(db)).genes, (await summary(db)).drift, (await summary(db)).one_candidate],
    [3, 1, 1],
  )
})
