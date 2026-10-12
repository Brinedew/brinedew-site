import assert from "node:assert/strict"
import test from "node:test"

import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"
import { createIconoplasmApp } from "./app.js"

// B-1085: batch work is let in by its price, before it runs, through the real
// Hono app on the D1 schema of every production migration. The meter below
// behaves like Cloudflare's: a minute shows up two minutes late. Failure modes
// written before the code:
// 1. a job the day can't hold starts anyway and runs past the stop (2026-10-11:
//    the copy started at 72,000 written and spent the wall);
// 2. a fast stream of batch requests runs past the stop while the meter, a
//    minute or two behind, still shows room;
// 3. an unreadable meter lets batch work through, or stops a reader;
// 4. the gate counts minutes the meter already shows twice and starves batch
//    work long before the stop.
const TOKEN = "factory-token-0000000000000000000000085"
const MINUTE = 60_000
const minuteStart = (at) => Math.floor(at / MINUTE) * MINUTE

function harness(t, { meter, authoringRows = 0 }) {
  const db = iconoplasmDatabase()
  t.after(() => db.database.close())
  // What batch work really spent, at the instant it ran.
  const spent = []
  const app = createIconoplasmApp({
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async (env, symbol) => {
      spent.push({ at: Date.now(), rows_written: 60, rows_read: 300 })
      return { symbol, withdrawn: false }
    },
    refreshSummaries: async () => {},
    accountUsage: async () => meter(spent),
    windowUsage: async () => null,
  })
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: TOKEN,
    // The copy's source: only its size matters before the copy is let in.
    ICONOPLASM_AUTHORING_DB: {
      prepare: () => ({ first: async () => ({ n: authoringRows }) }),
    },
  }
  const post = async (path, body) => {
    const response = await app.request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      },
      env,
    )
    return { status: response.status, body: await response.json() }
  }
  return { app, env, db, spent, post }
}

// Cloudflare's meter: the day's rows from minutes at least two minutes old, and
// the newest minute it shows.
const laggingMeter =
  ({ before = 0 } = {}) =>
  (spent) => {
    const shown = minuteStart(Date.now()) - 2 * MINUTE
    const counted = spent.filter((row) => row.at < shown + MINUTE)
    return {
      rows_written: before + counted.reduce((sum, row) => sum + row.rows_written, 0),
      rows_read: counted.reduce((sum, row) => sum + row.rows_read, 0),
      meter_counted_before: new Date(shown).toISOString(),
    }
  }

test("a copy the day can't hold is refused before its first write", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-11T10:40:00.000Z") })
  // 2026-10-11: 72,000 rows written when the copy of 20,155 texts started.
  const h = harness(t, { meter: laggingMeter({ before: 72_000 }), authoringRows: 20_155 })
  const refused = await h.post("/api/iconoplasm/admin/caretaking/copy", { table: "texts" })
  assert.equal(refused.status, 503)
  assert.equal(refused.body.code, "D1_BATCH_SHARE_SPENT")
  assert.equal(refused.body.meter, "rows_written")
  assert.ok(refused.body.price > 80_000, `the whole copy is priced: ${refused.body.price}`)
  assert.match(refused.body.error.message, /^This job costs/)
  assert.equal(
    h.db.database.prepare("SELECT COUNT(*) AS n FROM icono_batch_admissions").get().n,
    0,
    "a refused job records nothing",
  )

  // The same question asked of the usage route first, as a script should.
  const quote = await h.app.request(
    "/api/iconoplasm/admin/d1-usage?quote_written=80620&quote_read=70540",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    h.env,
  )
  assert.equal((await quote.json()).quote.fits, false)
})

test("a fast batch stream stops before the stop although the meter runs two minutes late", async (t) => {
  let now = Date.parse("2026-10-11T10:00:00.000Z")
  t.mock.timers.enable({ apis: ["Date"], now })
  const h = harness(t, { meter: laggingMeter({ before: 40_000 }) })
  const genes = ["A1BG", "A2M", "AAAS", "AACS", "AAGAB", "AAK1", "AAMP", "AANAT"]
  let refused = null
  let meterAtRefusal = null
  // Eight cards every two seconds: 14,400 rows written a minute, about the
  // copy's 17,800 on 2026-10-11.
  for (let request = 0; request < 2_000 && !refused; request += 1) {
    const answer = await h.post("/api/iconoplasm/admin/publication/republish", { symbols: genes })
    if (answer.status === 503) {
      refused = answer.body
      meterAtRefusal = laggingMeter({ before: 40_000 })(h.spent).rows_written
    } else assert.equal(answer.status, 200, JSON.stringify(answer.body))
    now += 2_000
    t.mock.timers.setTime(now)
  }
  assert.ok(refused, "the stream was stopped")
  assert.equal(refused.code, "D1_BATCH_SHARE_SPENT")
  const truth = 40_000 + h.spent.reduce((sum, row) => sum + row.rows_written, 0)
  assert.ok(truth <= 85_000, `batch work really spent ${truth} of the 85,000 stop`)
  assert.ok(
    meterAtRefusal < 85_000 - 10_000,
    `the meter alone still showed room: ${meterAtRefusal}`,
  )
  // The gate counts the meter's newest minute twice at most: batch work gets
  // most of its share, not a fraction of it.
  assert.ok(truth >= 85_000 - 2 * 14_400, `batch work was starved at ${truth}`)
})

test("an unreadable meter stops batch work and never a reader's own registration", async (t) => {
  const h = harness(t, {
    meter: () => {
      throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
    },
  })
  const rebuild = await h.post("/api/iconoplasm/admin/publication/republish", {
    symbols: ["TP53"],
  })
  assert.equal(rebuild.status, 503)
  assert.equal(rebuild.body.code, "D1_METER_UNAVAILABLE")
  assert.equal(rebuild.body.retry_after_seconds, 60)
  assert.equal(h.spent.length, 0)

  h.db.database
    .prepare(
      "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53', 'tumor protein p53')",
    )
    .run()
  const reader = await h.post("/api/iconoplasm/admin/portraits/register", {
    created_by: "drain:local",
    criticality: "critical",
    portraits: [{ symbol: "TP53", asset_sha256: "a".repeat(64), width: 768, height: 1024 }],
  })
  assert.equal(reader.status, 200, JSON.stringify(reader.body))
})
