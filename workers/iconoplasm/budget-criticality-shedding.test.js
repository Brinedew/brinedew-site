import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { realBudgetLedger } from "../test-helpers/reservation-receipts-harness.js"

// B-1026. On 2026-10-05 batch work and then one 151k-read storage audit spent the
// whole operator ledger (1,000,000 reads), and the lane that delivers players'
// portraits was refused for the rest of the UTC day. The ledger now sheds by
// criticality, lowest first (Google SRE "Handling Overload"): admin diagnostics
// at 60% of the day, batch at 85%, player deliveries only at 100%.
//
// How this could go wrong (written before the code):
// 1. A diagnostic still runs past 60% and eats the deliveries' slice.
// 2. A diagnostic admitted just under 60% keeps querying past it (the audit was
//    two statements of 100k and 50k).
// 3. Batch runs past 85%.
// 4. A delivery, or moderation (rejecting a portrait), is refused below 100%:
//    the bug this replaces.
// 5. A refused request still touches D1, or a refused claim holds a write
//    reservation that crowds the next delivery.
// 6. The refusal doesn't say which tier was shed, so nobody can tell a
//    diagnostic refusal from a spent day.
// Each test drives the real gateway against the real shared ledger; D1 is a
// stand-in that bills a stated number of rows per statement and records calls.

const ADMIN_TOKEN = "founder-secret"
const GENERATION_TOKEN = "generation-secret"
const ORIGIN = "https://the-only-allowed-internal-stateful-worker-do-not-duplicate"
const OPERATOR_READS = 1_000_000

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

// The real ledger with today's operator usage already at `rowsRead`.
function fixture(t, { rowsRead, rowsReadPerStatement = 1 }) {
  quiet(t)
  const ledger = realBudgetLedger(0)
  t.after(() => ledger.close())
  const day = new Date().toISOString().slice(0, 10)
  ledger.owner.state.storage.sql.exec(
    "INSERT INTO daily_budget_usage (day_key, cycle_key, rows_read, rows_written) VALUES (?, '', ?, 0)",
    day,
    rowsRead,
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
    ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "40000000",
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
    reservations,
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
    // Moderation, pulling a portrait: CRITICAL.
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
  assert.ok(!shed(moderation), JSON.stringify(moderation))
})

test("a spent day still refuses deliveries, before reserving any writes", async (t) => {
  const delivery = fixture(t, { rowsRead: OPERATOR_READS })
  const refused = await delivery.delivery()
  assert.ok(shed(refused), JSON.stringify(refused))
  assert.equal(refused.payload.budget.exhausted_by, "rows_read_daily_smart")
  assert.deepEqual(delivery.reservations, [])
  assert.deepEqual(delivery.d1.calls, [])
})

test("a diagnostic admitted just under 60% stops on the statement after it crosses", async (t) => {
  // 599,000 used; each statement bills 20,000, so the first lands at 619,000.
  const audit = fixture(t, { rowsRead: 599_000, rowsReadPerStatement: 20_000 })
  // refresh=1 is the multi-statement proof refresh behind Website Ops' button.
  const answer = await audit.diagnostic("?refresh=1")
  assert.ok(shed(answer), JSON.stringify(answer))
  assert.equal(answer.payload.budget.exhausted_by, "rows_read_sheddable")
  assert.equal(audit.d1.calls.length, 1, "exactly one statement ran")
})
