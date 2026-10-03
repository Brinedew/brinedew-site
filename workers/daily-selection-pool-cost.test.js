// The GeneGuessr daily selection pool is stored, not rescanned.
//
// Everything here runs against a real local D1 built from the real GeneGuessr
// migrations and seeded with the production shape measured on 2026-10-02:
// 19,110 proteins, 10,312 playable, 3,900 surname families. One scan of that
// catalog costs 29,422 rows read (19,110 table rows plus 10,312 sorted rows),
// the exact figure D1 analytics reported for production.
//
// "A cold isolate" is a fresh import of the module: the module holds no state,
// so every simulated isolate starts as empty as a real one.
//
// Failure modes this file proves, each written before the code that fixes it:
//   F1  a request reads the pool in O(pool) instead of O(1)
//   F2  a catalog write leaves a stale pool; unrelated writes churn it
//   F3  a write between a rebuild's scan and its persist leaves it stale forever
//   F4  the stored pool changes the fingerprint or the daily answer
//   F5  the table is missing on first use
//   F6  a D1 error on read or persist takes the game down
//   F7  a corrupt stored row is thrown instead of rebuilt
//   F8  the eligibility SQL gains a column the triggers do not watch
//   F9  trigger cost on bulk catalog writes is unbounded
//   F10 simultaneous requests in one isolate each pay a rebuild
//   GG-001 a surname holds two slots (or none), a year repeats a surname, or a large family's
//       representative never rotates
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test, { after, before, mock } from "node:test"

import * as proteinStore from "./lib/protein-store.js"
import {
  PRODUCTION_SHAPE,
  dropPoolSchema,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const {
  DAILY_SELECTION_POOL_SOURCE_COLUMNS,
  DAILY_SELECTION_POOL_SOURCE_SQL,
  buildDailySelectionPoolFingerprint,
  buildFamilyBalancedDailyCandidateIds,
} = proteinStore

const SALT = "pool-cost-salt"
const DAY = "2026-10-02"
const FULL_SCAN_READS = 29422

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
  await db.prepare("DELETE FROM structure_failures").run()
  await db.prepare("DELETE FROM protein_synonyms").run()
  await seedCatalog(db, productionShapedCatalogRows(options))
}

const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim()
const isPoolScan = (sql) => oneLine(sql) === oneLine(DAILY_SELECTION_POOL_SOURCE_SQL)

// Independent reference: the statement as the database ran it before the pool
// was stored, grouped the way the lottery groups it.
const REFERENCE_SCAN = `SELECT p.uniprot, p.gene_surname FROM proteins p
  WHERE p.structure_source IS NOT NULL AND LOWER(TRIM(p.structure_source)) <> 'alphafold'
    AND p.gene_summary IS NOT NULL
  ORDER BY p.gene_surname ASC, p.uniprot ASC`

async function referenceRows() {
  return (await db.prepare(REFERENCE_SCAN).all()).results
}

async function referenceFingerprint() {
  const families = new Map()
  for (const row of await referenceRows()) {
    const uniprot = String(row.uniprot).trim().toUpperCase()
    const surname = String(row.gene_surname || "")
      .trim()
      .toUpperCase()
    const key = surname || `__UNFAMILIED__:${uniprot}`
    if (!families.has(key)) families.set(key, new Set())
    families.get(key).add(uniprot)
  }
  return buildDailySelectionPoolFingerprint(
    Array.from(families, ([surname, members]) => ({ surname, members: Array.from(members) })),
  )
}

const storedRow = async () =>
  db
    .prepare(
      "SELECT catalog_version, fingerprint, families_json FROM daily_selection_pool WHERE id = 1",
    )
    .first()

// ---- F1 -------------------------------------------------------------------

test("F1: the first caller pays one scan, then every cold isolate reads a constant number of rows", async (t) => {
  await freshCatalog()
  const builder = meteredDb(db)
  const first = await (await coldIsolate()).planDailyTarget(builder, SALT, DAY)
  assert.equal(first.candidateIds.length, PRODUCTION_SHAPE.families)
  assert.ok(
    builder.totalRead() >= FULL_SCAN_READS && builder.totalRead() <= FULL_SCAN_READS + 20,
    `the build reads one scan, got ${builder.totalRead()}`,
  )
  // Seven rows written, once: the schema entries for the table and its three
  // triggers, the pool row, and the stored pool.
  assert.ok(
    builder.totalWritten() <= 8,
    `the build writes a few rows, got ${builder.totalWritten()}`,
  )

  const perIsolate = []
  for (let index = 0; index < 25; index += 1) {
    const metered = meteredDb(db)
    const picked = await (await coldIsolate()).pickDailyTarget(metered, SALT, DAY)
    assert.equal(picked.uniprot, first.uniprot)
    assert.ok(picked.protein, "the pick resolves to a protein row")
    assert.ok(
      metered.receipts.every((receipt) => !isPoolScan(receipt.sql)),
      "no request runs the pool scan",
    )
    perIsolate.push(metered.totalRead())
  }
  t.diagnostic(`cold-isolate pickDailyTarget rows read: ${[...new Set(perIsolate)].join(",")}`)
  assert.ok(Math.max(...perIsolate) <= 6, `got ${Math.max(...perIsolate)}`)
})

test("F1: the 365-day admin schedule reads the pool in a constant number of rows", async () => {
  await freshCatalog()
  await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  const dates = Array.from({ length: 365 }, (_, offset) => {
    const date = new Date(`${DAY}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  })
  const metered = meteredDb(db)
  const store = await coldIsolate()
  const fingerprint = await store.getDailySelectionPoolFingerprint(metered)
  const plans = await store.planDailyTargets(metered, SALT, dates)
  assert.equal(plans.length, 365)
  assert.equal(new Set(plans.map((plan) => plan.uniprot)).size, 365)
  assert.ok(plans.every((plan) => plan.poolFingerprint === fingerprint))
  assert.ok(metered.totalRead() <= 4, `schedule read ${metered.totalRead()} rows`)
})

test("the bulk plan picks exactly what the one-day picker picks", async () => {
  await freshCatalog({ quirks: true })
  const store = await coldIsolate()
  const dates = Array.from({ length: 30 }, (_, offset) => {
    const date = new Date("2026-08-04T00:00:00.000Z")
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  })
  const bulk = await store.planDailyTargets(meteredDb(db), "test-salt", dates)
  const canonical = []
  for (const date of dates)
    canonical.push(await store.planDailyTarget(meteredDb(db), "test-salt", date))
  assert.deepEqual(
    bulk.map((entry) => entry.uniprot),
    canonical.map((entry) => entry.candidateIds[0]),
  )
})

// ---- F2 -------------------------------------------------------------------

const WRITES_THAT_CHANGE_THE_POOL = {
  insert:
    "INSERT INTO proteins (id, uniprot, gene, gene_surname, structure_source, gene_summary) VALUES (100001, 'Q100001', 'NEWG', 'NEWFAM', 'pdb', 'summary')",
  delete: "DELETE FROM proteins WHERE uniprot = 'Q00002'",
  structure_source: "UPDATE proteins SET structure_source = 'alphafold' WHERE uniprot = 'Q00002'",
  gene_surname: "UPDATE proteins SET gene_surname = 'MOVEDFAM' WHERE uniprot = 'Q00002'",
  gene_summary: "UPDATE proteins SET gene_summary = NULL WHERE uniprot = 'Q00002'",
  uniprot: "UPDATE proteins SET uniprot = 'Q777777' WHERE uniprot = 'Q00002'",
}

for (const [kind, sql] of Object.entries(WRITES_THAT_CHANGE_THE_POOL)) {
  test(`F2: a ${kind} write invalidates the stored pool and the next reader rebuilds it exactly`, async () => {
    await freshCatalog()
    const built = await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
    assert.ok((await storedRow()).families_json, "the pool is stored")

    await db.prepare(sql).run()
    assert.equal((await storedRow()).families_json, null, "the write cleared the stored pool")

    const rebuilding = meteredDb(db)
    const rebuilt = await (await coldIsolate()).planDailyTarget(rebuilding, SALT, DAY)
    assert.ok(rebuilding.totalRead() >= FULL_SCAN_READS, "the next reader rescans once")
    assert.notEqual(rebuilt.poolFingerprint, built.poolFingerprint)
    assert.equal(rebuilt.poolFingerprint, await referenceFingerprint())

    const settled = meteredDb(db)
    await (await coldIsolate()).planDailyTarget(settled, SALT, DAY)
    assert.ok(settled.totalRead() <= 3, "and then it is stored again")
  })
}

const WRITES_THAT_LEAVE_THE_POOL_ALONE = {
  "a length, name or synonym edit":
    "UPDATE proteins SET length = 1234, full_name = 'Renamed', synonyms = '[\"X\"]' WHERE uniprot = 'Q00002'",
  "an assignment that changes nothing":
    "UPDATE proteins SET structure_source = structure_source, gene_surname = gene_surname, uniprot = uniprot, gene_summary = gene_summary WHERE id <= 500",
  "a structure failure": "INSERT INTO structure_failures (uniprot) VALUES ('Q00002')",
  "a synonym row":
    "INSERT INTO protein_synonyms (protein_id, synonym, normalized) VALUES (2, 'Z', 'Z')",
}

for (const [name, sql] of Object.entries(WRITES_THAT_LEAVE_THE_POOL_ALONE)) {
  test(`F2: ${name} does not churn the stored pool`, async () => {
    await freshCatalog()
    const built = await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
    await db.prepare(sql).run()
    const metered = meteredDb(db)
    const plan = await (await coldIsolate()).planDailyTarget(metered, SALT, DAY)
    assert.equal(plan.poolFingerprint, built.poolFingerprint)
    assert.ok(metered.totalRead() <= 3, `read ${metered.totalRead()} rows`)
  })
}

test("F2: transient structure failures never shrink the pool", async () => {
  await freshCatalog()
  const plain = await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  await dropPoolSchema(db)
  await db
    .prepare(
      "INSERT INTO structure_failures (uniprot) SELECT uniprot FROM proteins WHERE id <= 3000",
    )
    .run()
  const withFailures = await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  assert.equal(withFailures.poolFingerprint, plain.poolFingerprint)
  assert.deepEqual(withFailures.candidateIds, plain.candidateIds)
})

// ---- F3 -------------------------------------------------------------------

for (const when of [
  "after the scan, before the persist",
  "after the version is read, before the scan",
]) {
  test(`F3: a catalog write ${when} is never hidden behind a stored pool`, async () => {
    await freshCatalog()
    let injected = false
    const racing = meteredDb(db, {
      [when.startsWith("after the scan") ? "after" : "before"]: async (sql) => {
        if (injected || !isPoolScan(sql)) return
        injected = true
        await db
          .prepare("UPDATE proteins SET structure_source = 'alphafold' WHERE uniprot = 'Q00002'")
          .run()
      },
    })
    const plan = await (await coldIsolate()).planDailyTarget(racing, SALT, DAY)
    assert.ok(injected, "the write landed inside the rebuild")
    assert.ok(plan.candidateIds.length > 0, "the caller still gets a pool")
    assert.equal((await storedRow()).families_json, null, "but nothing stale was stored")

    const next = meteredDb(db)
    const settled = await (await coldIsolate()).planDailyTarget(next, SALT, DAY)
    assert.ok(next.totalRead() >= FULL_SCAN_READS, "the next reader rebuilds")
    assert.equal(settled.poolFingerprint, await referenceFingerprint())
    assert.ok((await storedRow()).families_json, "and that one is stored")
  })
}

// ---- F4 -------------------------------------------------------------------

// Computed from the pipeline as it ran before the pool was stored (the scan
// feeding the unchanged family builder), on this exact catalog.
const GOLDEN = {
  fingerprint: "86989f23d02fcd475ae05b5dff8b1eb40d394c8501c018bb8a8432ed972b1dd3",
  salt: "golden-salt",
  dates: {
    "2026-10-02": [
      "Q09066",
      3902,
      ["Q09066", "Q02692", "Q01946"],
      "7c81777dcd2d8905c592ee4627ab37bbeeb3319211259b1ca69d791e409840e0",
    ],
    "2026-10-03": [
      "Q02692",
      3902,
      ["Q02692", "Q01946", "Q02018"],
      "17cb737d29926505caab37d42aad9ce4d3ee08335316448c5591a9871d4f75a6",
    ],
    "2026-12-25": [
      "Q00288",
      3902,
      ["Q00288", "Q09164", "Q02483"],
      "21333de5bccce070d8d958e2c25a18d9824d2fc1bfe7a3f4be3270a388eb642b",
    ],
    "2027-03-01": [
      "Q04349",
      3902,
      ["Q04349", "Q05134", "Q05343"],
      "dff3d786714ffebe2648d8360cb1cd1235781c88aaa547c7095bd6576c51263f",
    ],
    "2028-02-29": [
      "Q07360",
      3902,
      ["Q07360", "Q06922", "Q09927"],
      "d9f65d3a124068808cbe3c9a5419a340dff0cd2f25b58c8543e8cc457bc46902",
    ],
  },
}

test("F4: stored or freshly built, the pool gives the answers the unchanged pipeline gave", async () => {
  await freshCatalog({ quirks: true })
  const dates = Object.keys(GOLDEN.dates)
  for (const pass of [
    "built from the scan",
    "read from the stored row",
    "read by another isolate",
  ]) {
    const store = await coldIsolate()
    for (const date of dates) {
      const plan = await store.planDailyTarget(meteredDb(db), GOLDEN.salt, date)
      const [uniprot, count, head, digest] = GOLDEN.dates[date]
      assert.equal(plan.poolFingerprint, GOLDEN.fingerprint, `${pass}: fingerprint on ${date}`)
      assert.equal(plan.uniprot, uniprot, `${pass}: pick on ${date}`)
      assert.equal(plan.candidateIds.length, count)
      assert.deepEqual(plan.candidateIds.slice(0, 3), head)
      assert.equal(createHash("sha256").update(plan.candidateIds.join(",")).digest("hex"), digest)
    }
    const bulk = await store.planDailyTargets(meteredDb(db), GOLDEN.salt, dates)
    assert.deepEqual(
      bulk.map((entry) => entry.uniprot),
      dates.map((date) => GOLDEN.dates[date][0]),
    )
    assert.equal(await store.getDailySelectionPoolFingerprint(meteredDb(db)), GOLDEN.fingerprint)
  }
})

test("F4: the stored pool matches the unchanged builders for other salts and dates", async () => {
  await freshCatalog({ quirks: true })
  const rows = await referenceRows()
  const ids = rows.map((row) => row.uniprot)
  const store = await coldIsolate()
  await store.planDailyTarget(meteredDb(db), "warm-up", DAY)
  for (const salt of ["alpha", "beta-2", ""]) {
    for (const date of ["2026-10-02", "2026-11-17", "2027-01-01", "2027-06-30", "2029-12-31"]) {
      const plan = await (await coldIsolate()).planDailyTarget(meteredDb(db), salt, date)
      assert.deepEqual(
        plan.candidateIds,
        await buildFamilyBalancedDailyCandidateIds(rows, ids, salt, date),
        `${salt}/${date}`,
      )
    }
  }
})

// ---- F5 -------------------------------------------------------------------

test("F5: the first use creates the table and its triggers once, then never touches the schema", async () => {
  await freshCatalog()
  const names = async () =>
    (
      await db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name LIKE 'daily_selection_pool%' ORDER BY name",
        )
        .all()
    ).results.map((row) => row.name)
  assert.deepEqual(await names(), [])

  const first = meteredDb(db)
  const plan = await (await coldIsolate()).planDailyTarget(first, SALT, DAY)
  assert.equal(plan.candidateIds.length, PRODUCTION_SHAPE.families)
  assert.equal((await names()).length, 4, "one table and three triggers")

  const later = meteredDb(db)
  await (await coldIsolate()).planDailyTarget(later, SALT, DAY)
  assert.ok(later.receipts.every((receipt) => !/^(CREATE|DROP|ALTER)\b/i.test(receipt.sql)))
  assert.ok(later.totalRead() <= 3)
})

test("F5: a missing pool row is recreated, not treated as an error", async () => {
  await freshCatalog()
  await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  await db.prepare("DELETE FROM daily_selection_pool").run()
  const plan = await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  assert.equal(plan.candidateIds.length, PRODUCTION_SHAPE.families)
  assert.ok((await storedRow()).families_json)
})

// ---- F6 -------------------------------------------------------------------

test("F6: a D1 outage on the pool read yields no pool, never an exception", async () => {
  await freshCatalog()
  mock.method(console, "warn", () => {})
  try {
    const down = meteredDb(db, {
      before: async () => {
        throw new Error("D1_ERROR: simulated outage")
      },
    })
    const store = await coldIsolate()
    assert.equal(await store.planDailyTarget(down, SALT, DAY), null)
    assert.deepEqual(await store.planDailyTargets(down, SALT, [DAY]), [])
    assert.equal(await store.getDailySelectionPoolFingerprint(down), null)
    assert.equal(await store.pickDailyTarget(down, SALT, DAY), null)
  } finally {
    mock.restoreAll()
  }
})

test("F6: a failed persist still answers the caller and stores nothing", async () => {
  await freshCatalog()
  mock.method(console, "warn", () => {})
  try {
    const failing = meteredDb(db, {
      before: async (sql) => {
        if (/^UPDATE daily_selection_pool SET fingerprint/.test(oneLine(sql)))
          throw new Error("D1_ERROR: row too big")
      },
    })
    const plan = await (await coldIsolate()).planDailyTarget(failing, SALT, DAY)
    assert.equal(plan.candidateIds.length, PRODUCTION_SHAPE.families)
    assert.equal((await storedRow()).families_json, null)
  } finally {
    mock.restoreAll()
  }
})

test("F6: a database that refuses the pool's schema still selects, from the scan, and says so", async () => {
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
    const plan = await (await coldIsolate()).planDailyTarget(refusing, SALT, DAY)
    assert.equal(plan.candidateIds.length, PRODUCTION_SHAPE.families)
    assert.equal(plan.poolFingerprint, await referenceFingerprint())
    assert.ok(warnings.some((line) => /stored daily selection pool is unavailable/.test(line)))
  } finally {
    mock.restoreAll()
  }
})

test("F6: a catalog with no playable protein stores nothing and selects nothing", async () => {
  await dropPoolSchema(db)
  await seedCatalog(db, [])
  const metered = meteredDb(db)
  const store = await coldIsolate()
  assert.equal(await store.planDailyTarget(metered, SALT, DAY), null)
  assert.equal((await storedRow()).families_json, null)
})

// ---- F7 -------------------------------------------------------------------

for (const [name, corrupt] of Object.entries({
  "truncated JSON": '[["FAM0001",["Q00001"',
  "an object instead of a list": "{}",
  "a family with a non-text member": '[["FAM0001",[1,2]]]',
  "a family without members": '[["FAM0001",[]]]',
  "an empty pool": "[]",
})) {
  test(`F7: a stored pool that is ${name} is rebuilt and replaced`, async () => {
    await freshCatalog()
    await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
    await db
      .prepare("UPDATE daily_selection_pool SET families_json = ? WHERE id = 1")
      .bind(corrupt)
      .run()
    const metered = meteredDb(db)
    const plan = await (await coldIsolate()).planDailyTarget(metered, SALT, DAY)
    assert.equal(plan.poolFingerprint, await referenceFingerprint())
    assert.ok(metered.totalRead() >= FULL_SCAN_READS)
    assert.notEqual((await storedRow()).families_json, corrupt)
  })
}

// ---- F8 -------------------------------------------------------------------

test("F8: the triggers watch exactly the columns the eligibility SQL reads", async () => {
  const referenced = new Set(
    [...DAILY_SELECTION_POOL_SOURCE_SQL.matchAll(/\bp\.(\w+)/g)].map((match) => match[1]),
  )
  assert.deepEqual([...referenced].sort(), [...DAILY_SELECTION_POOL_SOURCE_COLUMNS].sort())
  // Every watched column has an invalidation case above.
  for (const column of DAILY_SELECTION_POOL_SOURCE_COLUMNS) {
    assert.ok(WRITES_THAT_CHANGE_THE_POOL[column], `no invalidation test for column ${column}`)
  }
})

// ---- F9 -------------------------------------------------------------------

test("F9: bulk catalog writes pay at most one extra row written per changed row", async (t) => {
  await freshCatalog()
  const written = async (sql) => (await db.prepare(sql).run()).meta.rows_written
  const without = await written(
    "UPDATE proteins SET structure_source = 'sa' WHERE id BETWEEN 1 AND 1000",
  )
  await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  const withTriggers = await written(
    "UPDATE proteins SET structure_source = 'sb' WHERE id BETWEEN 1001 AND 2000",
  )
  t.diagnostic(
    `rows written for a 1,000-row update: ${without} without pool triggers, ${withTriggers} with`,
  )
  assert.ok(withTriggers - without <= 1000 + 2)
})

// ---- F10 ------------------------------------------------------------------

test("F10: simultaneous requests in one isolate share one rebuild", async () => {
  await freshCatalog()
  const store = await coldIsolate()
  const metered = meteredDb(db)
  const plans = await Promise.all(
    Array.from({ length: 20 }, () => store.planDailyTarget(metered, SALT, DAY)),
  )
  assert.equal(new Set(plans.map((plan) => plan.poolFingerprint)).size, 1)
  assert.ok(
    metered.totalRead() < 2 * FULL_SCAN_READS,
    `20 simultaneous requests read ${metered.totalRead()} rows; one scan is ${FULL_SCAN_READS}`,
  )
  assert.equal(metered.receipts.filter((receipt) => isPoolScan(receipt.sql)).length, 1)
})

// ---- GG-001 ---------------------------------------------------------------

// ARCHITECTURE FENCE [GG-001]: every normalized surname has one lottery slot. The rows are the
// production shape in a real D1, and the families are grouped by an independent reading of the
// stored surnames, not by the code under test.
async function familiesOfStoredRows() {
  const familyOf = new Map()
  for (const row of await referenceRows()) {
    const uniprot = String(row.uniprot).trim().toUpperCase()
    const surname = String(row.gene_surname || "")
      .trim()
      .toUpperCase()
    familyOf.set(uniprot, surname || `__UNFAMILIED__:${uniprot}`)
  }
  return familyOf
}

test("ARCHITECTURE FENCE [GG-001] every surname family has exactly one slot, however many rows it has", async () => {
  // The quirks are padded, lower-case, empty and missing surnames: rows a careless grouping
  // would turn into extra families.
  await freshCatalog({ quirks: true })
  const plan = await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  const familyOf = await familiesOfStoredRows()
  const slots = plan.candidateIds.map((id) => familyOf.get(String(id).toUpperCase()))

  assert.ok(slots.every(Boolean), "every candidate is a playable protein of the catalog")
  assert.equal(new Set(slots).size, plan.candidateIds.length, "no family holds two slots")
  assert.equal(plan.candidateIds.length, new Set(familyOf.values()).size, "every family holds one")
  // The largest family is as likely as a family of one: it too has one slot.
  const sizes = new Map()
  for (const family of familyOf.values()) sizes.set(family, (sizes.get(family) || 0) + 1)
  const [largest, members] = [...sizes].sort((a, b) => b[1] - a[1])[0]
  assert.ok(members > 50, `the catalog has a large family (${largest}: ${members})`)
  assert.equal(slots.filter((family) => family === largest).length, 1)
})

test("GG-001: 365 consecutive daily picks name 365 different surnames", async () => {
  await freshCatalog({ quirks: true })
  const dates = Array.from({ length: 365 }, (_, offset) => {
    const date = new Date(`${DAY}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  })
  const plans = await (await coldIsolate()).planDailyTargets(meteredDb(db), SALT, dates)
  const familyOf = await familiesOfStoredRows()
  assert.equal(new Set(plans.map((plan) => familyOf.get(plan.uniprot.toUpperCase()))).size, 365)
})

test("GG-001: a large family's representative changes from one complete bag cycle to the next", async () => {
  await dropPoolSchema(db)
  await db.prepare("DELETE FROM structure_failures").run()
  await db.prepare("DELETE FROM protein_synonyms").run()
  const member = (id, uniprot, surname) => ({
    id,
    uniprot,
    gene: `GENE${id}`,
    gene_surname: surname,
    structure_source: "pdb",
    gene_summary: "Summary",
    pdb_id: `1ABC${id}`,
  })
  // Two families make a two-day cycle, so days 0, 2 and 4 open three cycles.
  await seedCatalog(db, [
    member(1, "SLC_A", "SLC"),
    member(2, "SLC_B", "SLC"),
    member(3, "SLC_C", "SLC"),
    member(4, "TP53_A", "TP53"),
  ])
  const store = await coldIsolate()
  const representatives = []
  for (const date of ["2026-07-01", "2026-07-03", "2026-07-05"]) {
    const { candidateIds } = await store.planDailyTarget(meteredDb(db), "test-salt", date)
    assert.equal(candidateIds.length, 2, "one slot per family")
    representatives.push(candidateIds.find((id) => id.startsWith("SLC_")))
  }
  assert.equal(new Set(representatives).size, 3, `the family rotates: ${representatives}`)
})

// ---- size and CPU ---------------------------------------------------------

test("the stored pool is far below D1's 2 MB row limit and cheap to use", async (t) => {
  await freshCatalog()
  await (await coldIsolate()).planDailyTarget(meteredDb(db), SALT, DAY)
  const { bytes } = await db
    .prepare(
      "SELECT LENGTH(CAST(families_json AS BLOB)) AS bytes FROM daily_selection_pool WHERE id = 1",
    )
    .first()
  const store = await coldIsolate()
  const started = performance.now()
  await store.pickDailyTarget(meteredDb(db), SALT, DAY)
  const warmMs = performance.now() - started
  t.diagnostic(`stored pool ${bytes} bytes; warm pickDailyTarget ${warmMs.toFixed(1)} ms`)
  assert.ok(bytes < 400_000, `stored pool is ${bytes} bytes`)
  assert.ok(warmMs < 500, `warm pick took ${warmMs} ms`)
})
