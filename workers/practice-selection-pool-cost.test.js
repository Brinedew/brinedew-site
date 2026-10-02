// The GeneGuessr practice selection pool is stored, not rescanned.
//
// A practice start reads one stored row and a few point lookups; it never scans
// the protein table, however many isolates there are or however large the catalog.
//
// Everything here runs against a real local D1 built from the real GeneGuessr
// migrations and seeded with the production shape measured on 2026-10-02:
// 19,110 proteins, 17,513 practice-eligible (7,201 of them AlphaFold-only) in
// 6,049 surname families. One scan of that catalog costs 19,110 rows read.
//
// "A cold isolate" is a fresh import of protein-store.js: the module holds no
// pool state, so every simulated isolate starts as empty as a real one.
//
// Failure modes this file proves, each written before the code that fixes it:
//   P1  a practice start reads the pool in O(pool) instead of O(1)
//   P2  a catalog write leaves a stale pool; unrelated writes churn it
//   P3  a write between a rebuild's version read, scan and persist leaves it stale
//   P4  practice gets less random or less playable than before
//   P5  a failed structure is offered, or a family with only failed members is drawn
//   P6  a table the pool needs is missing on first use
//   P7  a D1 error on read, schema or persist takes practice down
//   P8  a corrupt stored row is thrown instead of rebuilt
//   P9  simultaneous requests in one isolate each pay a rebuild
//   P10 the practice SQL gains a column the triggers do not watch
//   P11 end to end: a real bootstrap on the Worker reads a constant number of rows
//       and still moves to another family when the first pick is unreachable
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import * as proteinStore from "./lib/protein-store.js"
import {
  PRODUCTION_SHAPE,
  dropPoolSchema,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const { DAILY_SELECTION_POOL_SOURCE_COLUMNS, PRACTICE_SELECTION_POOL_SOURCE_SQL } = proteinStore

const SCAN_READS = 19110
const CANDIDATES = 10

let db
let dispose
let isolates = 0

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
})
after(async () => {
  await dispose()
})

// A cold isolate: a module instance nothing has touched yet.
const coldIsolate = () => import(`./lib/protein-store.js?isolate=${++isolates}`)

async function freshCatalog(options) {
  await dropPoolSchema(db)
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS structure_failures(uniprot TEXT PRIMARY KEY, failed_at TEXT)",
    )
    .run()
  await db.prepare("DELETE FROM structure_failures").run()
  await db.prepare("DELETE FROM protein_synonyms").run()
  await seedCatalog(db, productionShapedCatalogRows(options))
}

const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim()
const isPracticeScan = (sql) => oneLine(sql) === oneLine(PRACTICE_SELECTION_POOL_SOURCE_SQL)

// A deterministic random source, so a run is repeatable.
function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

// ---- The practice picker as it ran before the pool was stored ----------------
//
// Copied from the previous protein-store.js: the two statements, the grouping by
// raw surname (surnames sorted, members in table order), and the pick (one
// random number for the surname, one for the member).
const OLD_SURNAME_SCAN = `SELECT p.uniprot, p.gene_surname
  FROM proteins p
  LEFT JOIN structure_failures sf ON sf.uniprot = p.uniprot
  WHERE p.structure_source IS NOT NULL
    AND p.gene_summary IS NOT NULL
    AND sf.uniprot IS NULL
    AND p.gene_surname IS NOT NULL`

const OLD_ID_SCAN = `SELECT p.uniprot
  FROM proteins p
  LEFT JOIN structure_failures sf ON sf.uniprot = p.uniprot
  WHERE p.structure_source IS NOT NULL
     AND p.gene_summary IS NOT NULL
     AND sf.uniprot IS NULL`

async function oldPracticePool() {
  const { results } = await db.prepare(OLD_SURNAME_SCAN).all()
  const byName = new Map()
  for (const row of results) {
    if (!byName.has(row.gene_surname)) byName.set(row.gene_surname, [])
    byName.get(row.gene_surname).push(row.uniprot)
  }
  return { surnames: Array.from(byName.keys()).sort(), byName }
}

function oldPick(pool, familyDraw, memberDraw) {
  const surname = pool.surnames[Math.floor(familyDraw * pool.surnames.length)]
  const members = pool.byName.get(surname)
  return { surname, members, uniprot: members[Math.floor(memberDraw * members.length)] }
}

async function storedPracticeFamilies() {
  const row = await db
    .prepare("SELECT families_json FROM practice_selection_pool WHERE id = 1")
    .first()
  return row ? JSON.parse(row.families_json) : null
}

// The stored practice row counts as fresh only while it was built at the daily
// row's current catalog version.
async function practiceRowIsFresh() {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS fresh
       FROM practice_selection_pool p
       JOIN daily_selection_pool d ON d.id = 1 AND d.catalog_version = p.catalog_version`,
    )
    .first()
  return row.fresh === 1
}

async function surnameOf(uniprot) {
  const row = await db
    .prepare("SELECT gene_surname FROM proteins WHERE uniprot = ?")
    .bind(uniprot)
    .first()
  return row?.gene_surname ?? null
}

// ---- P1 -------------------------------------------------------------------

test("P1: the first caller pays one scan, then every cold isolate reads a constant number of rows", async (t) => {
  await freshCatalog()
  const builder = meteredDb(db)
  const first = await (await coldIsolate()).pickPracticeCandidateIds(builder)
  assert.equal(first.length, CANDIDATES)
  assert.ok(
    builder.totalRead() >= SCAN_READS && builder.totalRead() <= SCAN_READS + 20,
    `the build reads one scan, got ${builder.totalRead()}`,
  )
  // The daily table, its row and three triggers, the practice table and its row.
  assert.ok(
    builder.totalWritten() <= 12,
    `the build writes a few rows, got ${builder.totalWritten()}`,
  )

  const perIsolate = []
  for (let index = 0; index < 25; index += 1) {
    const metered = meteredDb(db)
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(metered)
    assert.equal(ids.length, CANDIDATES)
    assert.ok(
      metered.receipts.every((receipt) => !isPracticeScan(receipt.sql)),
      "no request runs the pool scan",
    )
    perIsolate.push(metered.totalRead())
  }
  t.diagnostic(
    `cold-isolate pickPracticeCandidateIds rows read: ${[...new Set(perIsolate)].join(",")}`,
  )
  assert.ok(Math.max(...perIsolate) <= 4, `got ${Math.max(...perIsolate)}`)
})

test("P1: with production's 26 structure failures a cold practice pick still reads a handful of rows", async (t) => {
  await freshCatalog()
  await db
    .prepare(
      "INSERT INTO structure_failures (uniprot) SELECT uniprot FROM proteins WHERE id % 700 = 3 LIMIT 26",
    )
    .run()
  await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
  const reads = []
  for (let index = 0; index < 30; index += 1) {
    const metered = meteredDb(db)
    await (
      await coldIsolate()
    ).pickPracticeCandidateIds(metered, { random: seededRandom(index + 1) })
    reads.push(metered.totalRead())
  }
  t.diagnostic(`rows read per cold pick, 30 picks: max ${Math.max(...reads)}`)
  assert.ok(Math.max(...reads) <= 8, `got ${Math.max(...reads)}`)
})

test("P1: replaying the two old scans on this catalog costs what production paid", async () => {
  await freshCatalog()
  await db
    .prepare(
      "INSERT INTO structure_failures (uniprot) SELECT uniprot FROM proteins WHERE id % 700 = 3 LIMIT 26",
    )
    .run()
  const surnames = await db.prepare(OLD_SURNAME_SCAN).all()
  const ids = await db.prepare(OLD_ID_SCAN).all()
  // Production: 19,134 per run for each statement, 2 x 19,134 for a cold start.
  assert.ok(surnames.meta.rows_read >= SCAN_READS, `surname scan read ${surnames.meta.rows_read}`)
  assert.ok(ids.meta.rows_read >= SCAN_READS, `id scan read ${ids.meta.rows_read}`)
})

test("the practice pick still resolves to a protein row for the benchmark worker", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  const metered = meteredDb(db)
  const protein = await store.pickRandomPracticeProtein(metered)
  assert.ok(protein?.uniprot, "a protein row comes back")
  assert.ok(protein.gene_summary, "and it has a summary")
  const settled = meteredDb(db)
  await (await coldIsolate()).pickRandomPracticeProtein(settled)
  assert.ok(settled.totalRead() <= 6, `read ${settled.totalRead()} rows`)
})

// ---- P2 -------------------------------------------------------------------

const WRITES_THAT_CHANGE_THE_POOL = {
  insert:
    "INSERT INTO proteins (id, uniprot, gene, gene_surname, structure_source, gene_summary) VALUES (100001, 'Q100001', 'NEWG', 'NEWFAM', 'alphafold', 'summary')",
  delete: "DELETE FROM proteins WHERE uniprot = 'Q00002'",
  structure_source: "UPDATE proteins SET structure_source = NULL WHERE uniprot = 'Q00002'",
  gene_surname: "UPDATE proteins SET gene_surname = 'MOVEDFAM' WHERE uniprot = 'Q00002'",
  gene_summary: "UPDATE proteins SET gene_summary = NULL WHERE uniprot = 'Q00002'",
  uniprot: "UPDATE proteins SET uniprot = 'Q777777' WHERE uniprot = 'Q00002'",
}

async function assertStoredPoolMatchesTheOldScan() {
  const old = await oldPracticePool()
  const stored = await storedPracticeFamilies()
  assert.deepEqual(
    stored.map(([surname]) => surname),
    old.surnames,
  )
  for (const [surname, members] of stored) {
    assert.deepEqual(members.slice().sort(), old.byName.get(surname).slice().sort(), surname)
  }
}

for (const [kind, sql] of Object.entries(WRITES_THAT_CHANGE_THE_POOL)) {
  test(`P2: a ${kind} write makes the stored pool stale and the next reader rebuilds it exactly`, async () => {
    await freshCatalog()
    await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
    assert.ok(await practiceRowIsFresh(), "the pool is stored and fresh")

    await db.prepare(sql).run()
    assert.equal(await practiceRowIsFresh(), false, "the write made the stored pool stale")

    const rebuilding = meteredDb(db)
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(rebuilding)
    assert.ok(ids.length > 0)
    assert.ok(rebuilding.totalRead() >= SCAN_READS, "the next reader rescans once")
    assert.ok(await practiceRowIsFresh(), "and stores the new pool")
    await assertStoredPoolMatchesTheOldScan()

    const settled = meteredDb(db)
    await (await coldIsolate()).pickPracticeCandidateIds(settled)
    assert.ok(settled.totalRead() <= 4, `then it is read again for ${settled.totalRead()} rows`)
  })
}

const WRITES_THAT_LEAVE_THE_POOL_ALONE = {
  "a length, name or synonym edit":
    "UPDATE proteins SET length = 1234, full_name = 'Renamed', synonyms = '[\"X\"]' WHERE uniprot = 'Q00002'",
  "an assignment that changes nothing":
    "UPDATE proteins SET structure_source = structure_source, gene_surname = gene_surname, uniprot = uniprot, gene_summary = gene_summary WHERE id <= 500",
  "a structure failure": "INSERT INTO structure_failures (uniprot) VALUES ('Q00002')",
  "a structure failure that is cleared again":
    "INSERT INTO structure_failures (uniprot) VALUES ('Q00003'); DELETE FROM structure_failures WHERE uniprot = 'Q00003'",
  "a synonym row":
    "INSERT INTO protein_synonyms (protein_id, synonym, normalized) VALUES (2, 'Z', 'Z')",
}

for (const [name, sql] of Object.entries(WRITES_THAT_LEAVE_THE_POOL_ALONE)) {
  test(`P2: ${name} does not churn the stored pool`, async () => {
    await freshCatalog()
    await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
    const before = await storedPracticeFamilies()
    for (const statement of sql.split(";")) await db.prepare(statement).run()
    const metered = meteredDb(db)
    await (await coldIsolate()).pickPracticeCandidateIds(metered)
    assert.ok(metered.totalRead() <= 6, `read ${metered.totalRead()} rows`)
    assert.ok(metered.receipts.every((receipt) => !isPracticeScan(receipt.sql)))
    assert.deepEqual(await storedPracticeFamilies(), before)
  })
}

// ---- P3 -------------------------------------------------------------------

for (const when of [
  "after the scan, before the persist",
  "after the version is read, before the scan",
]) {
  test(`P3: a catalog write ${when} is never hidden behind a stored pool`, async () => {
    await freshCatalog()
    let injected = false
    const racing = meteredDb(db, {
      [when.startsWith("after the scan") ? "after" : "before"]: async (sql) => {
        if (injected || !isPracticeScan(sql)) return
        injected = true
        await db
          .prepare("UPDATE proteins SET structure_source = NULL WHERE uniprot = 'Q00002'")
          .run()
      },
    })
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(racing)
    assert.ok(injected, "the write landed inside the rebuild")
    assert.ok(ids.length > 0, "the caller still gets candidates")
    assert.equal(await practiceRowIsFresh(), false, "but nothing stale was stored")

    const next = meteredDb(db)
    await (await coldIsolate()).pickPracticeCandidateIds(next)
    assert.ok(next.totalRead() >= SCAN_READS, "the next reader rebuilds")
    assert.ok(await practiceRowIsFresh(), "and that one is stored")
    await assertStoredPoolMatchesTheOldScan()
  })
}

// ---- P4 -------------------------------------------------------------------

test("P4: the stored pool has exactly the families and members the old scan grouped", async (t) => {
  await freshCatalog()
  await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
  await assertStoredPoolMatchesTheOldScan()
  const stored = await storedPracticeFamilies()
  const members = stored.flatMap(([, ids]) => ids)
  assert.equal(stored.length, PRODUCTION_SHAPE.practiceFamilies)
  assert.equal(members.length, PRODUCTION_SHAPE.practiceEligible)
  const alphafold = await db
    .prepare(
      "SELECT uniprot FROM proteins WHERE structure_source = 'alphafold' AND gene_summary IS NOT NULL",
    )
    .all()
  const stor = new Set(members)
  assert.equal(
    alphafold.results.filter((row) => stor.has(row.uniprot)).length,
    PRODUCTION_SHAPE.alphafoldEligible,
    "AlphaFold-only proteins stay in practice",
  )
  const excluded = await db
    .prepare("SELECT uniprot FROM proteins WHERE structure_source IS NULL OR gene_summary IS NULL")
    .all()
  assert.ok(
    excluded.results.every((row) => !stor.has(row.uniprot)),
    "no protein without a structure or a summary",
  )
  const { bytes } = await db
    .prepare(
      "SELECT LENGTH(CAST(families_json AS BLOB)) AS bytes FROM practice_selection_pool WHERE id = 1",
    )
    .first()
  t.diagnostic(`stored practice pool: ${bytes} bytes`)
  assert.ok(bytes < 400_000, `stored pool is ${bytes} bytes; D1's row limit is 2 MB`)
})

test("P4: every family keeps exactly its old chance, member for member", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  await store.pickPracticeCandidateIds(meteredDb(db))
  const old = await oldPracticePool()
  const families = (await storedPracticeFamilies()).map(([surname, members]) => ({
    surname,
    members,
  }))
  assert.equal(families.length, old.surnames.length)
  // Sweep the old picker's first random number across every family and its
  // second across every member of that family: each (family, member) pair is
  // reached exactly once. The new picker, given the same two numbers, must land
  // in the same family and on a member of it, and reach every member once.
  for (let familyIndex = 0; familyIndex < old.surnames.length; familyIndex += 1) {
    const familyDraw = (familyIndex + 0.5) / old.surnames.length
    const surname = old.surnames[familyIndex]
    const size = old.byName.get(surname).length
    const visited = new Set()
    for (let memberIndex = 0; memberIndex < size; memberIndex += 1) {
      const memberDraw = (memberIndex + 0.5) / size
      assert.equal(oldPick(old, familyDraw, memberDraw).surname, surname)
      const draws = [familyDraw, memberDraw]
      const [first] = store.drawPracticeCandidateIds(families, () => draws.shift() ?? 0.5)
      assert.ok(old.byName.get(surname).includes(first), `${first} is not in ${surname}`)
      visited.add(first)
    }
    assert.equal(visited.size, size, `${surname}: every member is reachable, once`)
  }
})

test("P4: each pick takes one random number for the family and one for the member, as before", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  await store.pickPracticeCandidateIds(meteredDb(db))
  const old = await oldPracticePool()
  const draws = []
  const recording = () => {
    const value = (draws.length * 0.6180339887 + 0.137) % 1
    draws.push(value)
    return value
  }
  const [first] = await store.pickPracticeCandidateIds(meteredDb(db), { random: recording })
  assert.equal(await surnameOf(first), oldPick(old, draws[0], draws[1]).surname)
})

test("P4: a pick is ten candidates from ten different families, the first being the primary pick", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  await store.pickPracticeCandidateIds(meteredDb(db))
  const families = (await storedPracticeFamilies()).map(([surname, members]) => ({
    surname,
    members,
  }))
  const surnameByMember = new Map(
    families.flatMap(({ surname, members }) => members.map((id) => [id, surname])),
  )
  for (let seed = 1; seed <= 2000; seed += 1) {
    const ids = store.drawPracticeCandidateIds(families, seededRandom(seed))
    assert.equal(ids.length, CANDIDATES)
    const surnames = ids.map((id) => surnameByMember.get(id))
    assert.equal(new Set(surnames).size, CANDIDATES, `seed ${seed}: two candidates share a family`)
  }
  // And through the database.
  const ids = await store.pickPracticeCandidateIds(meteredDb(db), { random: seededRandom(5) })
  assert.deepEqual(ids, store.drawPracticeCandidateIds(families, seededRandom(5)))
})

test("P4: a pool smaller than ten families gives one candidate per family", async () => {
  const store = await coldIsolate()
  const ids = store.drawPracticeCandidateIds(
    [
      { surname: "A", members: ["A1", "A2"] },
      { surname: "B", members: ["B1"] },
      { surname: "C", members: ["C1", "C2", "C3"] },
    ],
    seededRandom(3),
  )
  assert.equal(ids.length, 3)
  assert.deepEqual(ids.map((id) => id[0]).sort(), ["A", "B", "C"])
})

test("P4: AlphaFold-only families are drawn about as often as their share of the families", async (t) => {
  await freshCatalog()
  const store = await coldIsolate()
  await store.pickPracticeCandidateIds(meteredDb(db))
  const source = new Map(
    (await db.prepare("SELECT uniprot, structure_source FROM proteins").all()).results.map(
      (row) => [row.uniprot, row.structure_source],
    ),
  )
  const families = (await storedPracticeFamilies()).map(([surname, members]) => ({
    surname,
    members,
  }))
  const alphafoldOnly = families.filter(({ members }) =>
    members.every((id) => source.get(id) === "alphafold"),
  )
  assert.equal(alphafoldOnly.length, PRODUCTION_SHAPE.practiceFamilies - PRODUCTION_SHAPE.families)
  const surnames = new Set(alphafoldOnly.map(({ surname }) => surname))
  const surnameByMember = new Map(
    families.flatMap(({ surname, members }) => members.map((id) => [id, surname])),
  )
  const random = seededRandom(7)
  const draws = 20000
  let hits = 0
  for (let index = 0; index < draws; index += 1) {
    const [first] = store.drawPracticeCandidateIds(families, random)
    if (surnames.has(surnameByMember.get(first))) hits += 1
  }
  const share = alphafoldOnly.length / PRODUCTION_SHAPE.practiceFamilies
  t.diagnostic(
    `AlphaFold-only family share ${share.toFixed(3)}, drawn ${(hits / draws).toFixed(3)}`,
  )
  assert.ok(Math.abs(hits / draws - share) < 0.02)
})

test("P4: a surname the old grouping kept apart by case or padding joins its family; a missing surname stays out", async () => {
  await freshCatalog({ quirks: true })
  const store = await coldIsolate()
  const ids = await store.pickPracticeCandidateIds(meteredDb(db))
  assert.equal(ids.length, CANDIDATES)
  const stored = await storedPracticeFamilies()
  const members = new Set(stored.flatMap(([, list]) => list))
  assert.equal(members.has("Q90004"), false, "no surname: not offered, as before")
  assert.ok(members.has("Q90001"), "padded surname: offered")
  assert.ok(members.has("Q90003"), "empty surname: offered as a family of one")
  assert.ok(members.has("Q90005"), "lower-case accession: offered, upper-cased")
  const fam7 = stored.find(([name]) => name === "FAM0007")
  assert.ok(fam7[1].includes("Q90001"), "' fam0007 ' is in FAM0007")
})

// ---- P5 -------------------------------------------------------------------

test("P5: a failed structure is never offered, and no family without a live member is drawn", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  await store.pickPracticeCandidateIds(meteredDb(db))
  const stored = await storedPracticeFamilies()
  const [wholeFamily] = stored.filter(([, ids]) => ids.length >= 3 && ids.length <= 6)
  const scattered = stored.flatMap(([, ids]) => ids).filter((_, index) => index % 40 === 0)
  const failed = new Set([...wholeFamily[1], ...scattered])
  await db
    .prepare("INSERT OR IGNORE INTO structure_failures (uniprot) SELECT value FROM json_each(?)")
    .bind(JSON.stringify([...failed]))
    .run()

  const old = await oldPracticePool()
  assert.equal(old.byName.has(wholeFamily[0]), false, "the old pool lost the whole family")
  const oldMembers = new Set(Array.from(old.byName.values()).flat())
  const random = seededRandom(11)
  for (let index = 0; index < 60; index += 1) {
    const ids = await store.pickPracticeCandidateIds(meteredDb(db), { random })
    assert.ok(ids.length > 0)
    for (const id of ids) {
      assert.equal(failed.has(id), false, `${id} failed and was offered`)
      assert.ok(oldMembers.has(id), `${id} is not in the old pool`)
    }
  }
  // Failures never touched the stored pool.
  assert.ok(await practiceRowIsFresh())
})

test("P5: when every candidate in a round has failed another round is drawn; when nothing is left there is no pick", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  await store.pickPracticeCandidateIds(meteredDb(db))
  // Fail three quarters of the catalog: whole rounds of ten fail often.
  await db
    .prepare(
      "INSERT OR IGNORE INTO structure_failures (uniprot) SELECT uniprot FROM proteins WHERE id % 4 <> 0",
    )
    .run()
  let empty = 0
  for (let seed = 1; seed <= 40; seed += 1) {
    const ids = await store.pickPracticeCandidateIds(meteredDb(db), { random: seededRandom(seed) })
    if (!ids.length) empty += 1
  }
  assert.ok(empty <= 1, `${empty} of 40 picks came back empty`)

  await db
    .prepare("INSERT OR IGNORE INTO structure_failures (uniprot) SELECT uniprot FROM proteins")
    .run()
  assert.deepEqual(await store.pickPracticeCandidateIds(meteredDb(db)), [])
})

// ---- P6 -------------------------------------------------------------------

test("P6: after the daily pool is live, the first practice pick creates only its own table and leaves the daily pool alone", async () => {
  await freshCatalog()
  const daily = await (await coldIsolate()).planDailyTarget(meteredDb(db), "salt", "2026-10-02")
  assert.ok(daily.candidateIds.length > 0)
  const dailyBefore = await db
    .prepare(
      "SELECT catalog_version, fingerprint, families_json, built_at FROM daily_selection_pool WHERE id = 1",
    )
    .first()
  assert.ok(dailyBefore.families_json)
  assert.equal(
    (
      await db
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'practice_selection_pool'")
        .all()
    ).results.length,
    0,
    "this is the database as #422 leaves it",
  )

  const first = meteredDb(db)
  const ids = await (await coldIsolate()).pickPracticeCandidateIds(first)
  assert.equal(ids.length, CANDIDATES)
  const dailyAfter = await db
    .prepare(
      "SELECT catalog_version, fingerprint, families_json, built_at FROM daily_selection_pool WHERE id = 1",
    )
    .first()
  assert.deepEqual(dailyAfter, dailyBefore, "the stored daily pool is untouched")
  assert.ok(await practiceRowIsFresh())

  const later = meteredDb(db)
  await (await coldIsolate()).pickPracticeCandidateIds(later)
  assert.ok(later.receipts.every((receipt) => !/^(CREATE|DROP|ALTER)\b/i.test(receipt.sql)))
  assert.ok(later.totalRead() <= 4)
})

test("P6: a database that has never run the pool code gets the daily table, its triggers and the practice table", async () => {
  await freshCatalog()
  const names = async () =>
    (
      await db
        .prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%_selection_pool%' ORDER BY name")
        .all()
    ).results.map((row) => row.name)
  assert.deepEqual(await names(), [])
  const ids = await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
  assert.equal(ids.length, CANDIDATES)
  assert.equal((await names()).length, 5, "two tables and three triggers")
  // The daily pool still builds on top of what practice created.
  const daily = await (await coldIsolate()).planDailyTarget(meteredDb(db), "salt", "2026-10-02")
  assert.equal(daily.candidateIds.length, PRODUCTION_SHAPE.families)
})

test("P6: a missing pool row is recreated, and a missing structure_failures table reads as no failures", async () => {
  await freshCatalog()
  await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
  await db.prepare("DELETE FROM daily_selection_pool").run()
  assert.equal(
    (await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))).length,
    CANDIDATES,
  )
  assert.ok(await practiceRowIsFresh())

  await db.prepare("DROP TABLE structure_failures").run()
  try {
    const metered = meteredDb(db)
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(metered)
    assert.equal(ids.length, CANDIDATES)
    assert.ok(
      metered.receipts.every((receipt) => !/^CREATE\b/i.test(receipt.sql)),
      "a pick does not create the failures table",
    )
  } finally {
    await db
      .prepare("CREATE TABLE structure_failures(uniprot TEXT PRIMARY KEY, failed_at TEXT)")
      .run()
  }
})

// ---- P7 -------------------------------------------------------------------

test("P7: a D1 outage on the pool read yields no pick, never an exception", async () => {
  await freshCatalog()
  mock.method(console, "warn", () => {})
  try {
    const down = meteredDb(db, {
      before: async () => {
        throw new Error("D1_ERROR: simulated outage")
      },
    })
    const store = await coldIsolate()
    assert.deepEqual(await store.pickPracticeCandidateIds(down), [])
    assert.equal(await store.pickRandomPracticeProtein(down), null)
  } finally {
    mock.restoreAll()
  }
})

test("P7: a failed persist still answers the caller and stores nothing", async () => {
  await freshCatalog()
  mock.method(console, "warn", () => {})
  try {
    const failing = meteredDb(db, {
      before: async (sql) => {
        if (/^INSERT INTO practice_selection_pool/.test(oneLine(sql)))
          throw new Error("D1_ERROR: row too big")
      },
    })
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(failing)
    assert.equal(ids.length, CANDIDATES)
    assert.equal(await practiceRowIsFresh(), false)
  } finally {
    mock.restoreAll()
  }
})

test("P7: a database that refuses the schema still picks, from the scan, and says so", async () => {
  await freshCatalog()
  const warnings = []
  mock.method(console, "warn", (...args) => warnings.push(args.join(" ")))
  try {
    const refusing = meteredDb(db, {
      before: async (sql) => {
        if (/^CREATE (TABLE|TRIGGER)/.test(oneLine(sql)))
          throw new Error("D1_ERROR: not authorized")
      },
    })
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(refusing)
    assert.equal(ids.length, CANDIDATES)
    assert.ok(warnings.some((line) => /stored practice selection pool is unavailable/.test(line)))
  } finally {
    mock.restoreAll()
  }
})

test("P7: a failure lookup that errors does not stop the pick", async () => {
  await freshCatalog()
  await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
  mock.method(console, "warn", () => {})
  try {
    const flaky = meteredDb(db, {
      before: async (sql) => {
        if (/FROM structure_failures/.test(sql)) throw new Error("D1_ERROR: simulated")
      },
    })
    assert.equal((await (await coldIsolate()).pickPracticeCandidateIds(flaky)).length, CANDIDATES)
  } finally {
    mock.restoreAll()
  }
})

test("P7: a catalog with no practice-eligible protein stores nothing and picks nothing", async () => {
  await dropPoolSchema(db)
  await seedCatalog(db, [])
  const store = await coldIsolate()
  assert.deepEqual(await store.pickPracticeCandidateIds(meteredDb(db)), [])
  assert.equal(await storedPracticeFamilies(), null)
})

// ---- P8 -------------------------------------------------------------------

for (const [name, corrupt] of Object.entries({
  "truncated JSON": '[["FAM0001",["Q00001"',
  "an object instead of a list": "{}",
  "a family with a non-text member": '[["FAM0001",[1,2]]]',
  "a family without members": '[["FAM0001",[]]]',
  "an empty pool": "[]",
})) {
  test(`P8: a stored pool that is ${name} is rebuilt and replaced`, async () => {
    await freshCatalog()
    await (await coldIsolate()).pickPracticeCandidateIds(meteredDb(db))
    await db
      .prepare("UPDATE practice_selection_pool SET families_json = ? WHERE id = 1")
      .bind(corrupt)
      .run()
    const metered = meteredDb(db)
    const ids = await (await coldIsolate()).pickPracticeCandidateIds(metered)
    assert.equal(ids.length, CANDIDATES)
    assert.ok(metered.totalRead() >= SCAN_READS)
    await assertStoredPoolMatchesTheOldScan()
  })
}

// ---- P9 -------------------------------------------------------------------

test("P9: simultaneous requests in one isolate share one rebuild", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  const metered = meteredDb(db)
  const picks = await Promise.all(
    Array.from({ length: 20 }, () => store.pickPracticeCandidateIds(metered)),
  )
  assert.ok(picks.every((ids) => ids.length === CANDIDATES))
  assert.ok(
    metered.totalRead() < 2 * SCAN_READS,
    `20 simultaneous requests read ${metered.totalRead()} rows; one scan is ${SCAN_READS}`,
  )
  assert.equal(metered.receipts.filter((receipt) => isPracticeScan(receipt.sql)).length, 1)
})

// ---- P10 ------------------------------------------------------------------

test("P10: the triggers watch every column the practice SQL reads, and the SQL ignores structure failures", () => {
  const referenced = new Set(
    [...PRACTICE_SELECTION_POOL_SOURCE_SQL.matchAll(/\bp\.(\w+)/g)].map((match) => match[1]),
  )
  assert.ok(referenced.size > 0)
  for (const column of referenced) {
    assert.ok(
      DAILY_SELECTION_POOL_SOURCE_COLUMNS.includes(column),
      `the triggers do not watch ${column}`,
    )
    assert.ok(WRITES_THAT_CHANGE_THE_POOL[column], `no invalidation test for column ${column}`)
  }
  const sql = oneLine(PRACTICE_SELECTION_POOL_SOURCE_SQL)
  assert.doesNotMatch(sql, /structure_failures/)
  assert.doesNotMatch(sql, /alphafold/i)
  assert.match(sql, /p\.gene_summary IS NOT NULL/)
  assert.match(sql, /p\.structure_source IS NOT NULL/)
  assert.match(sql, /p\.gene_surname IS NOT NULL/)
})

// ---- P11: end to end on the Worker ----------------------------------------

function workerEnv(metered, { unreachable = () => false } = {}) {
  const kv = new Map()
  const sessions = new Map()
  return {
    sessions,
    env: {
      DB: metered,
      KV: {
        async get(key, options) {
          const value = kv.get(key) ?? null
          return options?.type === "json" && value ? JSON.parse(value) : value
        },
        async put(key, value) {
          kv.set(key, value)
        },
        async delete(key) {
          kv.delete(key)
        },
      },
      STRUCTURES_BUCKET: {
        async head(key) {
          return unreachable(key) ? null : { size: 1200 }
        },
      },
      GAME_SESSIONS: {
        idFromName: (name) => name,
        get(id) {
          return {
            async fetch(_url, init = {}) {
              if (init.method === "POST") {
                sessions.set(id, JSON.parse(init.body))
                return Response.json({ ok: true })
              }
              return Response.json(sessions.get(id) ?? null)
            },
          }
        },
      },
    },
  }
}

async function practiceBootstrap(env, query = "") {
  const waits = []
  const response = await worker.fetch(
    new Request(`https://geneguessr.brinedew.bio/api/game/bootstrap?practice=1${query}`),
    env,
    { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
  )
  await Promise.allSettled(waits)
  return response
}

test("P11: a practice bootstrap on the Worker reads a constant number of rows, however many sessions start", async (t) => {
  await freshCatalog()
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  try {
    // The first start builds the pool; every later one finds it stored.
    const building = meteredDb(db)
    assert.equal((await practiceBootstrap(workerEnv(building).env)).status, 200)
    t.diagnostic(`first start (builds the pool): ${building.totalRead()} rows read`)
    assert.ok(
      building.totalRead() <= SCAN_READS + 40,
      `the first start read ${building.totalRead()} rows; one scan is ${SCAN_READS}`,
    )

    const perStart = []
    const slowest = []
    for (let index = 0; index < 25; index += 1) {
      const metered = meteredDb(db)
      const { env, sessions } = workerEnv(metered)
      const response = await practiceBootstrap(env)
      assert.equal(response.status, 200)
      const payload = await response.json()
      assert.ok(payload.targetStructureToken, "the browser gets a structure token")
      assert.equal(sessions.size, 1)
      perStart.push(metered.totalRead())
      slowest.push(Math.max(...metered.receipts.map((receipt) => receipt.rows_read)))
    }
    mock.restoreAll()
    t.diagnostic(
      `rows read per practice bootstrap: min ${Math.min(...perStart)}, max ${Math.max(...perStart)}; largest single statement: ${Math.max(...slowest)}`,
    )
    assert.ok(Math.max(...slowest) <= 3, `a statement read ${Math.max(...slowest)} rows`)
    assert.ok(Math.max(...perStart) <= 8, `a practice start read ${Math.max(...perStart)} rows`)
  } finally {
    mock.restoreAll()
  }
})

test("P11: when the first pick's structure is unreachable the start moves to another family, not to the next row of the table", async (t) => {
  await freshCatalog()
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("not found", { status: 404 })
  mock.method(Math, "random", seededRandom(20261002))
  try {
    const unreachable = (key) => key.startsWith("pdb/")
    const source = new Map(
      (
        await db.prepare("SELECT uniprot, structure_source, gene_surname, id FROM proteins").all()
      ).results.map((row) => [row.uniprot, row]),
    )
    const failedIds = async () =>
      new Set(
        (await db.prepare("SELECT uniprot FROM structure_failures").all()).results.map(
          (row) => row.uniprot,
        ),
      )
    let starts = 0
    let walked = 0
    for (let index = 0; index < 40; index += 1) {
      const known = await failedIds()
      const { env, sessions } = workerEnv(meteredDb(db), { unreachable })
      const response = await practiceBootstrap(env)
      assert.equal(response.status, 200, `start ${index}`)
      const [state] = sessions.values()
      const target = source.get(state.targetId)
      assert.ok(target, `the target ${state.targetId} is a real protein`)
      assert.notEqual(target.structure_source, "pdb", "the target's structure is reachable")
      starts += 1
      // Unreachable picks this start walked past: each is now marked failed.
      const walkedPast = [...(await failedIds())].filter((id) => !known.has(id))
      walked += walkedPast.length
      for (const id of walkedPast) {
        assert.equal(
          source.get(id).structure_source,
          "pdb",
          "only unreachable structures are marked failed",
        )
        assert.notEqual(
          source.get(id).gene_surname,
          target.gene_surname,
          "the fallback is another family, not a sibling of the failed pick",
        )
        assert.notEqual(target.id, source.get(id).id + 1, "and not the next row of the table")
      }
    }
    t.diagnostic(
      `${starts} starts walked past ${walked} unreachable picks and all reached a reachable structure`,
    )
    assert.ok(walked > 0, "the run did meet unreachable picks")
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
})
