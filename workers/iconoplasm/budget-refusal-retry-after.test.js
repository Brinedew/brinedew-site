import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { FREE_D1_DAILY_LIMITS } from "../../shared/iconoplasm-d1-budget-policy.js"
import { secondsUntilCloudflareDailyReset } from "../lib/cloudflare-availability.js"
import * as laneModule from "../lib/iconoplasm-mutation-lane-reservations.js"
import { generationClaimWriteUnits } from "../lib/iconoplasm-mutation-write-bounds.js"
import { realBudgetLedger, spyOnLedger } from "../test-helpers/reservation-receipts-harness.js"

// B-968. A daily-budget refusal says when the same request is worth sending again, so
// the workstation (which waits through a refusal, B-961) does not have to assume the
// next UTC day for a refusal that clears in minutes.
//
// How this could go wrong (written before the code, B-968):
// 1. The refusal states no time (today): the workstation waits for the next UTC day.
// 2. The header and the body disagree, because two places computed a number.
// 3. A refusal that only the reset can clear (the provider's own count already blocks
//    the request) is told 15 minutes: three waits later the sync surfaces a failure.
// 4. A refusal driven by in-flight reservations (it would fit without them) is told the
//    whole day, or told a time that never works.
// 5. The 15 minute hint is wrong in practice: walk the real ledger's clock.
// 6. The admin mutation limiter's 503, the other budget 503, states nothing.
// 7. The discovery 429s keep a made-up 60 seconds next to the real answer.
// 8. A refusal that is not a budget refusal picks up a hint.
// Each test below drives the real gateway against the real shared ledger, with D1
// replaced by a stand-in that fails the test if a refused request reaches it.

const { MUTATION_ANALYTICS_LAG_MS, MUTATION_BACKGROUND_CEILING } = laneModule
const GENERATION_TOKEN = "generation-secret"
const REPLICA_TOKEN = "replica-secret"
const CLAIM = "/api/iconoplasm/authority/generation-leases/claim"
const CLAIM_UNITS = generationClaimWriteUnits(50)
const quiet = (t) => {
  const original = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  t.after(() => {
    ;[console.log, console.warn, console.error] = original
  })
}

function untouchedD1() {
  const reached = []
  const refuse = (what) => () => {
    reached.push(what)
    throw new Error(`a refused request reached D1 (${what})`)
  }
  return { reached, db: { prepare: refuse("prepare"), batch: refuse("batch") } }
}

// The whole of what the workstation reads: the standard header, and the body's copy.
async function stated(response) {
  const payload = await response.json()
  const header = response.headers.get("Retry-After")
  return { status: response.status, header, body: payload.retry_after_seconds, payload }
}

// A refusal made late in the UTC day must state the seconds to the reset (with the
// default five seconds of slack). The wall clock moves, so the answer is bracketed by
// the function itself before and after the call; if the UTC day rolled over during the
// call, ask again.
async function untilTheReset(ask) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = secondsUntilCloudflareDailyReset()
    const answer = await ask()
    const after = secondsUntilCloudflareDailyReset()
    if (after <= before) return { before, after, ...answer }
  }
  throw new Error("the UTC day kept rolling over")
}

function assertStatesTheReset(answer) {
  assert.match(answer.header, /^\d+$/, "Retry-After is whole seconds")
  assert.equal(Number(answer.header), answer.body, "header and body come from one number")
  assert.ok(
    answer.body <= answer.before && answer.body >= answer.after,
    `${answer.body} s is not the time to the reset (${answer.after} to ${answer.before})`,
  )
}

function laptopGateway(t, providerRowsWritten) {
  quiet(t)
  const ledger = realBudgetLedger(providerRowsWritten)
  t.after(() => ledger.close())
  const spy = spyOnLedger(ledger)
  const d1 = untouchedD1()
  const env = {
    ICONOPLASM_DB: d1.db,
    ICONOPLASM_AUTHORITY_GENERATION_TOKEN: GENERATION_TOKEN,
    ICONOPLASM_AUTHORITY_REPLICA_TOKEN: REPLICA_TOKEN,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: spy.namespace,
  }
  const day = new Date().toISOString().slice(0, 10)
  return {
    d1,
    // Reservations other lanes already hold: they are what "in flight" means.
    async hold(lane, units, operationId) {
      const response = await ledger.namespace.get().fetch(
        new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ day_key: day, lane, operation_id: operationId, units }),
        }),
      )
      assert.equal(response.status, 200, `${lane} could not hold ${units} units`)
    },
    claim: () =>
      gateway(
        new Request(`https://the-only-allowed-internal-stateful-worker-do-not-duplicate${CLAIM}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GENERATION_TOKEN}`,
          },
          body: JSON.stringify({ lease_owner_id: "workstation_retry_after", limit: 50 }),
        }),
        env,
        { waitUntil() {} },
      ),
  }
}

test("a claim the provider's own count already blocks is told the seconds to the UTC reset", async (t) => {
  // Failure modes 1, 2 and 3: room for the old claim but not for this one, nothing in flight.
  const fixture = laptopGateway(t, MUTATION_BACKGROUND_CEILING - CLAIM_UNITS + 1)
  const answer = await untilTheReset(async () => stated(await fixture.claim()))
  assert.equal(answer.status, 503)
  assert.equal(answer.payload.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assertStatesTheReset(answer)
  assert.deepEqual(fixture.d1.reached, [])
})

test("a claim refused only by reservations in flight is told the 15 minutes they take to age out", async (t) => {
  // Failure mode 4: the written count leaves 8,000 units of room beyond the claim, so
  // that count + the 2,000 asked fits, and the 9,000 held tips it over the ceiling.
  // Time alone clears it.
  const written = MUTATION_BACKGROUND_CEILING - CLAIM_UNITS - 8_000
  const fixture = laptopGateway(t, written)
  await fixture.hold("finalization_recovery", 9_000, "in-flight:finalization")
  const answer = await stated(await fixture.claim())
  assert.equal(answer.status, 503)
  assert.equal(answer.payload.budget.mutation_lane.in_flight_units, 9_000)
  assert.equal(answer.header, String(MUTATION_ANALYTICS_LAG_MS / 1000))
  assert.equal(answer.body, MUTATION_ANALYTICS_LAG_MS / 1000)
  assert.deepEqual(fixture.d1.reached, [])
})

test("a few reservations in flight do not turn a refusal only the reset can clear into a 15 minute one", async (t) => {
  // Failure mode 3, the case the first draft of B-968 got wrong: the written count sits
  // 1,000 under the ceiling, so it plus the 2,000 asked is already over, and the held
  // 500 units are not the reason.
  assert.ok(CLAIM_UNITS > 1_000)
  const fixture = laptopGateway(t, MUTATION_BACKGROUND_CEILING - 1_000)
  await fixture.hold("finalization_recovery", 500, "in-flight:small")
  const answer = await untilTheReset(async () => stated(await fixture.claim()))
  assert.equal(answer.status, 503)
  assert.equal(answer.payload.budget.mutation_lane.in_flight_units, 500)
  assertStatesTheReset(answer)
})

test("the 15 minute hint is honest: the real ledger admits the request within two stated waits", async (t) => {
  // Failure mode 5. A reservation stops counting once a provider sample is a whole
  // 15 minute bucket plus the 15 minute window past the bucket it was made in, so a
  // refusal that clears by time clears between 15 and 30 minutes after the newest
  // reservation. Walk that clock on the real ledger, taking each wait from the refusal.
  const ledger = realBudgetLedger()
  t.after(() => ledger.close())
  const lanes = ledger.owner.mutationReservations
  const day = "2026-10-03"
  const t0 = Date.parse("2026-10-03T12:07:00Z")
  const ask = (now, provider) => ({
    day,
    lane: "laptop_delivery",
    operation_id: "walk:claim",
    units: CLAIM_UNITS,
    now: new Date(now).toISOString(),
    observed_at: new Date(now).toISOString(),
    provider_rows_written: provider,
    local_rows_written: 0,
  })
  // The meter starts 8,000 units short of the claim's room, so the 9,000 held is what
  // refuses; 3,000 of the held units' real writes reach the meter between the waits.
  const meterBefore = MUTATION_BACKGROUND_CEILING - CLAIM_UNITS - 8_000
  const meterAfter = meterBefore + 3_000
  const held = lanes.reserve({
    ...ask(t0, meterBefore),
    lane: "finalization_recovery",
    operation_id: "walk:held",
    units: 9_000,
  })
  assert.equal(held.ok, true)

  let now = t0
  let waits = 0
  let provider = meterBefore
  for (;;) {
    const answer = lanes.reserve(ask(now, provider))
    if (answer.ok) break
    assert.equal(answer.in_flight_units, 9_000, "still refused for the reservation in flight")
    const wait = laneModule.mutationRefusalRetryAfterSeconds(answer, now)
    assert.equal(wait, 900)
    now += wait * 1000
    // Between the waits the held operation's real writes (3,000 of its 9,000) reach the meter.
    provider = meterAfter
    waits += 1
    assert.ok(waits <= 2, "a refusal that time alone clears took more than two stated waits")
  }
  assert.equal(waits, 2)
})

test("the admin mutation limiter's 503 states the seconds to the UTC reset", async (t) => {
  // Failure mode 6. The limiter's target is 85% of Cloudflare's daily write allowance,
  // and the account has written one row past it.
  quiet(t)
  const d1 = untouchedD1()
  const written = Math.floor(FREE_D1_DAILY_LIMITS.writes * 0.85) + 1
  const snapshot = {
    day_key: new Date().toISOString().slice(0, 10),
    cycle_key: "2026-04-07",
    rows_read: 0,
    rows_written: written,
    cycle_rows_read: 0,
    cycle_rows_written: written,
    rows_read_monthly_limit: null,
    rows_written_monthly_limit: null,
    rows_read_monthly_remaining: null,
    rows_written_monthly_remaining: null,
    rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
    rows_read_daily_remaining: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_remaining: FREE_D1_DAILY_LIMITS.writes - written,
    account_rows_read: 0,
    account_rows_written: written,
    days_remaining_in_cycle: 20,
    exhausted: false,
    exhausted_by: null,
  }
  const answer = await untilTheReset(async () =>
    stated(
      await gateway(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-iconoplasm-admin-token": "founder-secret",
            },
            body: JSON.stringify({
              defer_read_models: true,
              items: [{ gene_symbol: "TP53", full_name: "Tumor protein p53", aliases_json: [] }],
            }),
          },
        ),
        {
          ICONOPLASM_DB: d1.db,
          ICONOPLASM_ADMIN_TOKEN: "founder-secret",
          ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
            idFromName: () => "global",
            get: () => ({ fetch: async () => Response.json(snapshot) }),
          },
        },
        { waitUntil() {} },
      ),
    ),
  )
  assert.equal(answer.status, 503)
  assert.equal(answer.payload.code, "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE")
  assertStatesTheReset(answer)
  assert.deepEqual(d1.reached, [])
})

test("a day the shared ledger itself reports spent is told the seconds to the UTC reset", async (t) => {
  // The kill-switch wrapper's own refusal (no lane involved): the ledger's snapshot says exhausted.
  quiet(t)
  const d1 = untouchedD1()
  const snapshot = {
    day_key: new Date().toISOString().slice(0, 10),
    cycle_key: "2026-04-07",
    rows_read: FREE_D1_DAILY_LIMITS.reads,
    rows_written: 0,
    rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
    exhausted: true,
    exhausted_by: "rows_read_daily",
  }
  const answer = await untilTheReset(async () =>
    stated(
      await gateway(
        new Request(
          "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/assets/summary",
          { headers: { "x-iconoplasm-admin-token": "founder-secret" } },
        ),
        {
          ICONOPLASM_DB: d1.db,
          ICONOPLASM_ADMIN_TOKEN: "founder-secret",
          ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
            idFromName: () => "global",
            get: () => ({ fetch: async () => Response.json(snapshot) }),
          },
        },
        { waitUntil() {} },
      ),
    ),
  )
  assert.equal(answer.status, 503)
  assert.equal(answer.payload.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(answer.payload.budget.exhausted_by, "rows_read_daily")
  assertStatesTheReset(answer)
})

test("an unreachable ledger is a misconfiguration, not a refusal that clears at a stated time", async (t) => {
  // Failure mode 8: no Durable Object binding means a 500 the owner must fix; telling the
  // workstation when to try again would only make it wait for something that cannot clear.
  quiet(t)
  const d1 = untouchedD1()
  const response = await gateway(
    new Request(
      "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/assets/summary",
      { headers: { "x-iconoplasm-admin-token": "founder-secret" } },
    ),
    { ICONOPLASM_DB: d1.db, ICONOPLASM_ADMIN_TOKEN: "founder-secret" },
    { waitUntil() {} },
  )
  const answer = await stated(response)
  assert.equal(answer.status, 500)
  assert.equal(answer.header, null)
  assert.equal(answer.body, undefined)
})
