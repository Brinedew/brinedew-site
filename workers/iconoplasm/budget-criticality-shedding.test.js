import assert from "node:assert/strict"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway,
  handleIconoplasmSyncFinalizationQueue,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { realBudgetLedger } from "../test-helpers/reservation-receipts-harness.js"
import { FREE_D1_DAILY_LIMITS } from "../../shared/iconoplasm-d1-budget-policy.js"

// B-1026. On 2026-10-05 batch work and then one 151k-read storage audit spent the
// whole operator ledger (1,000,000 reads), and the lane that delivers players'
// portraits was refused for the rest of the UTC day. Work now sheds by
// criticality, lowest first (Google SRE "Handling Overload"): admin diagnostics
// at 60% of the day, batch at 85%, player deliveries only at 100%. Since
// 2026-10-09 "the day" is the whole account's use of Cloudflare's own allowance,
// readers included; the private 1M operator slice is gone (it stopped the Drain
// at 600k reads while the account had used about 782k of 5M).
//
// How this could go wrong (written before the code):
// 1. A diagnostic still runs past 60% and eats the deliveries' slice.
// 2. A diagnostic admitted just under 60% keeps querying past it (the audit was
//    two statements of 100k and 50k).
// 3. Batch runs past 85%.
// 4. A delivery is refused below 100%: the bug this replaces. That includes
//    publishing the generated portrait, which uses the same routes as a bulk
//    sync; only the drain knows it is a delivery, so it says so.
// 4b. Anyone else claims that: a bulk sync, a diagnostic, an uncredentialed call.
// 5. A refused request still touches D1, or a refused claim holds a write
//    reservation that crowds the next delivery.
// 6. The refusal doesn't say which tier was shed, so nobody can tell a
//    diagnostic refusal from a spent day.
// 7. Readers' reads, which never enter our own tally, are not counted, so batch
//    keeps spending the day readers need.
// Each test drives the real gateway against the real shared ledger; D1 is a
// stand-in that bills a stated number of rows per statement and records calls.

const ADMIN_TOKEN = "founder-secret"
const GENERATION_TOKEN = "generation-secret"
const ORIGIN = "https://the-only-allowed-internal-stateful-worker-do-not-duplicate"
const OPERATOR_READS = FREE_D1_DAILY_LIMITS.reads
const OPERATOR_WRITES = FREE_D1_DAILY_LIMITS.writes

const quiet = (t) => {
  const original = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  t.after(() => {
    ;[console.log, console.warn, console.error] = original
  })
}

function billingD1(rowsReadPerStatement = 1) {
  const calls = []
  const receipt = () => ({
    results: [],
    success: true,
    meta: { rows_read: rowsReadPerStatement, rows_written: 0 },
  })
  const statement = (sql) => ({
    bind: () => statement(sql),
    async all() {
      calls.push(sql)
      return receipt()
    },
    async run() {
      calls.push(sql)
      return receipt()
    },
    async first() {
      calls.push(sql)
      return null
    },
  })
  return {
    calls,
    db: {
      prepare: statement,
      async batch(statements) {
        calls.push("<batch>")
        return statements.map(receipt)
      },
    },
  }
}

// The real ledger with today's own usage already at `rowsRead` and `rowsWritten`,
// and, when given, Cloudflare's sample of the whole account's reads.
function fixture(
  t,
  { rowsRead = 0, rowsWritten = 0, rowsReadPerStatement = 1, accountRowsRead } = {},
) {
  quiet(t)
  const ledger = realBudgetLedger(0, { providerRowsRead: accountRowsRead })
  t.after(() => ledger.close())
  const day = new Date().toISOString().slice(0, 10)
  ledger.owner.state.storage.sql.exec(
    "INSERT INTO daily_budget_usage (day_key, cycle_key, rows_read, rows_written) VALUES (?, '', ?, ?)",
    day,
    rowsRead,
    rowsWritten,
  )
  const reservations = []
  const namespace = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        if (new URL(request.url).pathname === "/reserve-mutation-writes")
          reservations.push(await request.clone().json())
        return ledger.namespace.get().fetch(request)
      },
    }),
  }
  const d1 = billingD1(rowsReadPerStatement)
  const env = {
    ICONOPLASM_DB: d1.db,
    ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
    ICONOPLASM_AUTHORITY_GENERATION_TOKEN: GENERATION_TOKEN,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: namespace,
  }
  const send = async (path, init = {}) => {
    const response = await gateway(new Request(`${ORIGIN}${path}`, init), env, {
      waitUntil() {},
    })
    const payload = await response.json().catch(() => null)
    return { status: response.status, payload }
  }
  return {
    d1,
    env,
    reservations,
    // The budget object refreshes its account sample in the background between
    // requests; a test takes that sample before its first request.
    observe: () => ledger.owner.providerD1Observation(day),
    send,
    // Admin diagnostics: SHEDDABLE.
    diagnostic: (query = "") =>
      send(`/api/iconoplasm/admin/assets/summary${query}`, {
        headers: { "x-iconoplasm-admin-token": ADMIN_TOKEN },
      }),
    // Batch: SHEDDABLE_PLUS.
    batch: () =>
      send("/api/iconoplasm/admin/read-models/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-iconoplasm-admin-token": ADMIN_TOKEN },
        body: "{}",
      }),
    // Publishing a generated portrait: batch unless the drain declares a delivery.
    publish: (declared) =>
      send("/api/iconoplasm/admin/finalization/enqueue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-iconoplasm-admin-token": ADMIN_TOKEN,
          ...(declared ? { "x-iconoplasm-criticality": "critical" } : {}),
        },
        body: JSON.stringify({ rows: [], reason: "criticality-test" }),
      }),
    diagnosticDeclaringCritical: () =>
      send("/api/iconoplasm/admin/assets/summary", {
        headers: {
          "x-iconoplasm-admin-token": ADMIN_TOKEN,
          "x-iconoplasm-criticality": "critical",
        },
      }),
    // Moderation, pulling a portrait: batch, it can wait for the reset.
    moderation: () =>
      send("/api/iconoplasm/admin/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-iconoplasm-admin-token": ADMIN_TOKEN },
        body: JSON.stringify({ gene_symbol: "C10ORF62", asset_sha256: "0".repeat(64) }),
      }),
    // A player's portrait: CRITICAL.
    delivery: () =>
      send("/api/iconoplasm/authority/generation-leases/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GENERATION_TOKEN}`,
        },
        body: JSON.stringify({ lease_owner_id: "workstation_criticality", limit: 1 }),
      }),
  }
}

const shed = (answer) =>
  answer.status === 503 && answer.payload?.code === "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED"

test("at 61% of the day a diagnostic is refused before D1 while batch and deliveries run", async (t) => {
  const refused = fixture(t, { rowsRead: 0.61 * OPERATOR_READS })
  const diagnostic = await refused.diagnostic()
  assert.ok(shed(diagnostic), JSON.stringify(diagnostic))
  assert.equal(diagnostic.payload.budget.exhausted_by, "rows_read_sheddable")
  assert.equal(diagnostic.payload.budget.criticality, "sheddable")
  assert.equal(diagnostic.payload.budget.rows_read, 0.61 * OPERATOR_READS)
  assert.deepEqual(refused.d1.calls, [])

  const batch = await fixture(t, { rowsRead: 0.61 * OPERATOR_READS }).batch()
  assert.ok(!shed(batch), JSON.stringify(batch))
  const delivery = fixture(t, { rowsRead: 0.61 * OPERATOR_READS })
  const claimed = await delivery.delivery()
  assert.ok(!shed(claimed), JSON.stringify(claimed))
  assert.ok(delivery.d1.calls.length > 0, "the claim reached D1")
})

test("at 86% batch is refused and holds no reservation, while a delivery still runs", async (t) => {
  const batch = fixture(t, { rowsRead: 0.86 * OPERATOR_READS })
  const refused = await batch.batch()
  assert.ok(shed(refused), JSON.stringify(refused))
  assert.equal(refused.payload.budget.exhausted_by, "rows_read_sheddable_plus")
  assert.deepEqual(batch.d1.calls, [])

  const delivery = fixture(t, { rowsRead: 0.86 * OPERATOR_READS })
  const claimed = await delivery.delivery()
  assert.ok(!shed(claimed), JSON.stringify(claimed))
  assert.equal(delivery.reservations.length, 1, "the admitted claim reserved its writes")
  assert.ok(delivery.d1.calls.length > 0)

  const moderation = await fixture(t, { rowsRead: 0.86 * OPERATOR_READS }).moderation()
  assert.ok(shed(moderation), JSON.stringify(moderation))
  assert.equal(moderation.payload.budget.exhausted_by, "rows_read_sheddable_plus")
})

test("at 86% the drain's publication of a delivery runs; the same call from a bulk sync waits", async (t) => {
  const delivery = await fixture(t, { rowsRead: 0.86 * OPERATOR_READS }).publish(true)
  assert.ok(!shed(delivery), JSON.stringify(delivery))
  const bulk = await fixture(t, { rowsRead: 0.86 * OPERATOR_READS }).publish(false)
  assert.ok(shed(bulk), JSON.stringify(bulk))
  // Only delivery-publication steps may claim it.
  const diagnostic = await fixture(t, {
    rowsRead: 0.61 * OPERATOR_READS,
  }).diagnosticDeclaringCritical()
  assert.ok(shed(diagnostic), JSON.stringify(diagnostic))
})

// 2026-10-06: the admin mutation limiter answers before the tier check, at the
// same 85%, for its own route families. Those include the routes a delivery is
// published through, so a player's portrait sat paused from about 10:20 UTC
// while the tiers said it had the whole day. The read-side test above never saw
// it: the limiter watches rows written.
test("at 86% of the day's writes the drain's publication of a delivery runs; a bulk sync waits", async (t) => {
  const delivery = await fixture(t, { rowsWritten: 0.86 * OPERATOR_WRITES }).publish(true)
  assert.ok(delivery.status !== 503, JSON.stringify(delivery))
  const bulk = await fixture(t, { rowsWritten: 0.86 * OPERATOR_WRITES }).publish(false)
  assert.equal(bulk.status, 503, JSON.stringify(bulk))
})

// During a delivery's publication the workstation declares every admin call
// critical, including reconcile and the read-model sync. Those two routes used
// to ignore the declaration and pause the delivery at 85%.
test("at 86% of the day's writes a delivery's finalization phases run; a bulk sync's pause", async (t) => {
  const call = async (path, payload, declared) => {
    const f = fixture(t, { rowsWritten: 0.86 * OPERATOR_WRITES })
    const response = await f.send(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iconoplasm-admin-token": ADMIN_TOKEN,
        ...(declared ? { "x-iconoplasm-criticality": "critical" } : {}),
      },
      body: JSON.stringify(payload),
    })
    return response.status === 503 || response.payload?.partial === true ? "paused" : "ran"
  }
  const reconcile = {
    dry_run: false,
    reason: "criticality-test",
    defer_read_models: true,
    scope_symbols: ["C10ORF62"],
    keep: [],
    legacy: [],
  }
  const voteSummaries = {
    symbols: ["C10ORF62"],
    skip_gene_rollups: true,
    skip_vision_rollups: true,
    skip_dashboard: true,
  }
  assert.equal(await call("/api/iconoplasm/admin/reconcile", reconcile, true), "ran")
  assert.equal(await call("/api/iconoplasm/admin/reconcile", reconcile, false), "paused")
  assert.equal(await call("/api/iconoplasm/admin/read-models/sync", voteSummaries, true), "ran")
  assert.equal(await call("/api/iconoplasm/admin/read-models/sync", voteSummaries, false), "paused")
})

test("at 86% the finalization queue runs a delivery's message and holds a bulk sync's", async (t) => {
  // A held message is handed to the sync governor to wake after the reset.
  const run = async (drainScoped) => {
    const env = fixture(t, { rowsRead: 0.86 * OPERATOR_READS }).env
    const governorPaths = []
    const message = {
      body: {
        kind: "drain_finalization_ledger",
        run_id: "criticality-test",
        symbols: ["C10ORF62"],
        ...(drainScoped ? { drain_scoped_phases: true } : {}),
      },
      ack() {},
      retry() {},
    }
    const queueEnv = {
      ...env,
      ICONOPLASM_SYNC_GOVERNOR: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async (request) => {
            const path = new URL(request.url).pathname
            governorPaths.push(path)
            return path === "/permit"
              ? Response.json({ ok: true, granted: 1, lease_id: "criticality-lease" })
              : Response.json({ ok: true })
          },
        }),
      },
    }
    await handleIconoplasmSyncFinalizationQueue({ messages: [message] }, queueEnv, {
      waitUntil() {},
    }).catch(() => null)
    return governorPaths.some((path) => path.startsWith("/defer-finalization")) ? "held" : "ran"
  }
  assert.equal(await run(true), "ran")
  assert.equal(await run(false), "held")
})

test("a spent day still refuses deliveries, before reserving any writes", async (t) => {
  const delivery = fixture(t, { rowsRead: OPERATOR_READS })
  const refused = await delivery.delivery()
  assert.ok(shed(refused), JSON.stringify(refused))
  assert.equal(refused.payload.budget.exhausted_by, "rows_read_daily")
  assert.deepEqual(delivery.reservations, [])
  assert.deepEqual(delivery.d1.calls, [])
})

test("a diagnostic admitted just under 60% stops on the statement after it crosses", async (t) => {
  // 2,999,000 used; each statement bills 20,000, so the first lands at 3,019,000.
  const audit = fixture(t, { rowsRead: 2_999_000, rowsReadPerStatement: 20_000 })
  // refresh=1 is the multi-statement proof refresh behind Website Ops' button.
  const answer = await audit.diagnostic("?refresh=1")
  assert.ok(shed(answer), JSON.stringify(answer))
  assert.equal(answer.payload.budget.exhausted_by, "rows_read_sheddable")
  assert.equal(audit.d1.calls.length, 1, "exactly one statement ran")
})

test("readers' reads count: a diagnostic is shed once the account passes 60%, though our own tally is low", async (t) => {
  // Our own work has read 100,000 rows; readers have taken the account to 61%.
  const busy = { rowsRead: 100_000, accountRowsRead: 0.61 * OPERATOR_READS }
  const audit = fixture(t, busy)
  await audit.observe()
  const diagnostic = await audit.diagnostic()
  assert.ok(shed(diagnostic), JSON.stringify(diagnostic))
  assert.equal(diagnostic.payload.budget.exhausted_by, "rows_read_sheddable")
  assert.equal(diagnostic.payload.budget.account_rows_read, 0.61 * OPERATOR_READS)
  assert.deepEqual(audit.d1.calls, [])

  const batchFixture = fixture(t, busy)
  await batchFixture.observe()
  assert.ok(!shed(await batchFixture.batch()))
  const deliveryFixture = fixture(t, busy)
  await deliveryFixture.observe()
  assert.ok(!shed(await deliveryFixture.delivery()))

  // At 86% of the account batch stops too, and a player's delivery still runs.
  const fuller = { rowsRead: 100_000, accountRowsRead: 0.86 * OPERATOR_READS }
  const batchAt86 = fixture(t, fuller)
  await batchAt86.observe()
  const refusedBatch = await batchAt86.batch()
  assert.ok(shed(refusedBatch), JSON.stringify(refusedBatch))
  assert.equal(refusedBatch.payload.budget.exhausted_by, "rows_read_sheddable_plus")
  const deliveryAt86 = fixture(t, fuller)
  await deliveryAt86.observe()
  assert.ok(!shed(await deliveryAt86.delivery()))
})

test("our own work is no longer stopped at a private 1M slice of the day", async (t) => {
  // 1,200,000 of our own reads, the account a little above that: far under 60% of 5M.
  const busy = { rowsRead: 1_200_000, accountRowsRead: 1_400_000 }
  const audit = fixture(t, busy)
  await audit.observe()
  const diagnostic = await audit.diagnostic()
  assert.ok(!shed(diagnostic), JSON.stringify(diagnostic))
})

test("publishing's asset-state read is batch, and runs when a delivery declares it", async (t) => {
  // 10-09: filed with the diagnostics, this read stopped every publication at 60%.
  const read = (rowsRead, declared) =>
    fixture(t, { rowsRead }).send("/api/iconoplasm/admin/assets/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iconoplasm-admin-token": ADMIN_TOKEN,
        ...(declared ? { "x-iconoplasm-criticality": "critical" } : {}),
      },
      body: JSON.stringify({ symbols: ["C10ORF62"] }),
    })
  assert.ok(!shed(await read(0.61 * OPERATOR_READS, false)), "batch runs past 60%")
  const batch = await read(0.86 * OPERATOR_READS, false)
  assert.ok(shed(batch), JSON.stringify(batch))
  assert.equal(batch.payload.budget.exhausted_by, "rows_read_sheddable_plus")
  assert.ok(!shed(await read(0.86 * OPERATOR_READS, true)), "a declared delivery runs")
})
