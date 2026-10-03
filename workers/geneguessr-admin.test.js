// The GeneGuessr admin routes, through the real Worker.
//
// The admin plans and audits the daily target: a year of upcoming picks, the clue cards of a past
// day, and the one-off replacement of a pick whose structure is unreachable. A request goes
// through `worker.fetch` and the real routes, on a real local D1 built from the real GeneGuessr
// migrations and seeded with the production shape (19,110 proteins, 3,900 surname families).
// Only the Discord session authority (who the cookie belongs to) is stood in for.
//
// Failure modes this file proves, each written before the code that fixes it:
//   A1  the year schedule is a partial 200, repeats a protein or a surname, or costs a statement
//       per day
//   A2  the year schedule answers 200 with identities missing when the summaries are unavailable,
//       or caches the incomplete rows
//   A3  the card of a recorded past day fails or shows another day's protein
//   A4  a replacement pinned by the admin is not the pick the nightly cron records, is an
//       AlphaFold-only protein, or sits in a family the year already uses
//   A5  an admin route answers anyone who is not the admin, or the admin page does not parse
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { DAILY_SELECTION_POOL_SOURCE_SQL } from "./lib/protein-store.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"
const SALT = "admin-test-salt"
const HORIZON_DAYS = 365

let db
let dispose
let rows

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
  // The shaped catalog carries no names or lengths; the schedule shows both.
  await db.prepare("UPDATE proteins SET full_name = 'Protein ' || id, length = 100 + id").run()
})
after(async () => {
  await dispose()
})

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (day, days) => {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Silences the Worker's logging and stands in for the structure providers: every probe answers
// with a usable file, so no test reaches the network.
const quiet = () => {
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("data_structure\nHEADER    MODEL\nATOM  1\n", {
        status: 200,
        headers: { "Content-Type": "chemical/x-cif" },
      }),
  )
}

// A world for one request: the real D1 (metered, optionally wrapped to fail), a KV that lists
// and remembers every write, and a session authority that says the cookie is `admin`.
function newWorld({ wrap, kvEntries = {}, admin = "admin-user" } = {}) {
  const metered = meteredDb(db)
  const harness = geneguessrWorkerEnv(wrap ? wrap(metered) : metered, { kvEntries })
  return {
    metered,
    harness,
    kvPuts: harness.kvPuts,
    env: {
      ...harness.env,
      DAILY_TARGET_SALT: SALT,
      ADMIN_DISCORD_USER_ID: "admin-user",
      KV: {
        ...harness.env.KV,
        list: async ({ prefix = "" } = {}) => ({
          keys: [...harness.kv.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((name) => ({ name })),
          list_complete: true,
        }),
      },
      GAME_SESSIONS: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => Response.json({ user_id: admin }) }),
      },
    },
  }
}

async function call(
  path,
  { world = newWorld(), method = "GET", cookie = "session=admin-session", body } = {},
) {
  quiet()
  try {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      world.env,
      { waitUntil() {} },
    )
    const text = await response.text()
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {}
    return { status: response.status, payload, text, world }
  } finally {
    mock.restoreAll()
  }
}

const oneLine = (sql) => String(sql).replace(/\s+/g, " ").trim()
const isPoolScan = (sql) => oneLine(sql) === oneLine(DAILY_SELECTION_POOL_SOURCE_SQL)
const scheduleUrl = (days) => `/api/admin/schedule?futureDays=${days}`

// ---- the year schedule -----------------------------------------------------------------------

test("A1: the year schedule is 365 complete identities of different proteins and surnames, from a handful of statements", async () => {
  // The first request builds the stored pool (one scan); the cost of a request is the second.
  await call(scheduleUrl(HORIZON_DAYS - 1))
  const { status, payload, world } = await call(scheduleUrl(HORIZON_DAYS - 1))

  assert.equal(status, 200)
  assert.equal(payload.today, today())
  assert.equal(payload.upcoming.length, HORIZON_DAYS)
  assert.deepEqual(
    payload.upcoming.map((row) => row.date),
    Array.from({ length: HORIZON_DAYS }, (_, offset) => addDays(today(), offset)),
  )
  for (const row of payload.upcoming) {
    for (const field of ["uniprot", "hgnc", "full_name", "length"]) {
      assert.ok(row.computed?.[field], `${row.date} has no ${field}`)
    }
  }
  assert.equal(new Set(payload.upcoming.map((row) => row.computed.uniprot)).size, HORIZON_DAYS)
  assert.equal(
    new Set(payload.upcoming.map((row) => row.computed.gene_surname)).size,
    HORIZON_DAYS,
    "no surname twice in a year",
  )

  const sqls = world.metered.receipts.map((receipt) => receipt.sql)
  assert.ok(sqls.length <= 8, `${sqls.length} statements for 365 days`)
  assert.ok(
    sqls.every((sql) => !isPoolScan(sql)),
    "the schedule reads the stored pool",
  )
  assert.ok(
    sqls.every((sql) => !/SELECT \* FROM proteins/i.test(sql)),
    "no row per day",
  )
  assert.ok(world.metered.totalRead() < 2000, `${world.metered.totalRead()} rows read`)
  assert.deepEqual(world.kvPuts, [], "a schedule read does not spend the KV write budget")
})

test("A2: when the planned proteins cannot be read the schedule fails closed and stores nothing", async () => {
  // D1 answers every protein-summary read with no rows.
  const withoutSummaries = (inner) => ({
    prepare(sql) {
      if (/FROM proteins\s+WHERE uniprot IN \(SELECT value FROM json_each/i.test(sql)) {
        return { bind: () => ({ all: async () => ({ results: [] }) }) }
      }
      return inner.prepare(sql)
    },
    batch: (statements) => inner.batch(statements),
  })
  const { status, payload, world } = await call(scheduleUrl(HORIZON_DAYS - 1), {
    world: newWorld({ wrap: withoutSummaries }),
  })

  assert.equal(status, 503)
  assert.equal(payload.error, "Admin schedule generation incomplete")
  assert.equal(payload.requested, HORIZON_DAYS)
  assert.equal(payload.completed, 0)
  assert.equal(payload.incomplete_dates.length, HORIZON_DAYS)
  assert.deepEqual(world.kvPuts, [], "an incomplete schedule is cached nowhere")
})

// ---- the card of a past day ------------------------------------------------------------------

test("A3: the card of a recorded past day is the recorded protein's, whatever structure it has", async () => {
  const alphafold = rows.find((row) => row.structure_source === "alphafold" && row.gene_summary)
  const day = "2026-07-17"
  const { status, payload } = await call(`/api/admin/cards?date=${day}`, {
    world: newWorld({
      kvEntries: {
        [`puzzle_actual:${day}`]: JSON.stringify({
          date: day,
          uniprot_id: alphafold.uniprot,
          source: "computed",
          rejected: [],
        }),
      },
    }),
  })

  assert.equal(status, 200)
  assert.equal(payload.selection.uniprot_id, alphafold.uniprot)
  assert.equal(payload.selection.recorded, true)
  assert.equal(payload.protein.hgnc, alphafold.gene)
  assert.ok(payload.protein.uniprot, "the card names the protein")
})

// ---- a replacement for an unreachable pick ---------------------------------------------------

test("A4: a pinned replacement is outside the year's families, is not AlphaFold-only, and is the pick the nightly cron records", async () => {
  const kvEntries = {}
  const schedule = await call(scheduleUrl(HORIZON_DAYS - 1), { world: newWorld({ kvEntries }) })
  assert.equal(schedule.status, 200)
  const horizonEntries = schedule.payload.upcoming.map((row) => ({
    date: row.date,
    uniprot: row.computed.uniprot,
    geneSurname: row.computed.gene_surname,
  }))
  const tomorrow = addDays(today(), 1)
  const original = horizonEntries.find((entry) => entry.date === tomorrow)

  const pinned = await call("/api/admin/schedule/availability-replacement", {
    world: newWorld({ kvEntries }),
    method: "POST",
    body: { date: tomorrow, horizonEntries, rejectedUniprotIds: [] },
  })
  assert.equal(pinned.status, 200, pinned.text)
  const replacement = rows.find((row) => row.uniprot === pinned.payload.replacement_uniprot_id)
  assert.ok(replacement, "the replacement is a protein of the catalog")
  assert.equal(pinned.payload.original_uniprot_id, original.uniprot)
  assert.notEqual(replacement.structure_source, "alphafold", "never an AlphaFold-only protein")
  assert.equal(
    horizonEntries.some((entry) => entry.uniprot === replacement.uniprot),
    false,
    "not a protein the year already uses",
  )
  assert.equal(
    horizonEntries.some((entry) => entry.geneSurname === replacement.gene_surname),
    false,
    "not a family the year already uses",
  )

  // The schedule shows the pin, and the nightly cron records the replacement as tomorrow's pick.
  const after = await call(scheduleUrl(HORIZON_DAYS - 1), { world: newWorld({ kvEntries }) })
  const day = after.payload.upcoming.find((row) => row.date === tomorrow)
  assert.equal(day.availability_pin_uniprot_id, replacement.uniprot)

  quiet()
  try {
    const world = newWorld({ kvEntries })
    await worker.scheduled({ cron: "55 23 * * *" }, world.env, { waitUntil() {} })
    const recorded = JSON.parse(world.harness.kv.get(`puzzle_actual:${tomorrow}`))
    assert.equal(recorded.uniprot_id, replacement.uniprot)
    assert.equal(recorded.source, "availability_replacement")
  } finally {
    mock.restoreAll()
  }

  // A pin belongs to the salt and the pool it was made for: another salt's cron does not use it.
  quiet()
  try {
    const world = newWorld({ kvEntries })
    world.env.DAILY_TARGET_SALT = "another-salt"
    await worker.scheduled({ cron: "55 23 * * *" }, world.env, { waitUntil() {} })
    assert.equal(JSON.parse(world.harness.kv.get(`puzzle_actual:${tomorrow}`)).source, "computed")
  } finally {
    mock.restoreAll()
  }

  // Manual overrides are authoritative: a replacement never overwrites one.
  const refused = await call("/api/admin/schedule/availability-replacement", {
    world: newWorld({
      kvEntries: { ...kvEntries, [`puzzle_override:${addDays(today(), 2)}`]: "P04637" },
    }),
    method: "POST",
    body: { date: addDays(today(), 2), horizonEntries, rejectedUniprotIds: [] },
  })
  assert.equal(refused.status, 409)

  // A horizon that is not the whole year is refused.
  const partial = await call("/api/admin/schedule/availability-replacement", {
    world: newWorld({ kvEntries }),
    method: "POST",
    body: { date: tomorrow, horizonEntries: horizonEntries.slice(0, 30), rejectedUniprotIds: [] },
  })
  assert.equal(partial.status, 400)
})

// ---- who may ask, and the page ---------------------------------------------------------------

test("A5: every admin route refuses anyone but the admin", async () => {
  const requests = [
    ["GET", scheduleUrl(10)],
    ["GET", "/api/admin/cards?date=2026-07-17"],
    ["GET", "/api/admin/status"],
    ["POST", "/api/admin/schedule/availability-replacement"],
    ["GET", "/admin"],
  ]
  for (const [method, path] of requests) {
    for (const [who, options] of [
      ["no cookie", { cookie: null }],
      ["another account", { world: newWorld({ admin: "someone-else" }) }],
    ]) {
      const refused = await call(path, {
        method,
        body: method === "POST" ? {} : undefined,
        ...options,
      })
      assert.equal(refused.status, 403, `${method} ${path} for ${who}`)
      assert.doesNotMatch(refused.text, /apoptotic|uniprot_id|<script>/)
    }
  }
})

test("A5: the admin page is served to the admin, and its script parses", async () => {
  const page = await call("/admin")
  assert.equal(page.status, 200)
  const start = page.text.indexOf("<script>")
  const end = page.text.indexOf("</script>", start)
  assert.ok(start >= 0 && end > start, "the page carries its script")
  assert.doesNotThrow(() => new Function(page.text.slice(start + "<script>".length, end)))
})
