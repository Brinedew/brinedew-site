import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_IDLE_MINUTES,
  ICONOPLASM_NIGHTLY_MINUTES,
  ICONOPLASM_RECURRING_CRON,
  ICONOPLASM_NIGHTLY_CRON,
  ICONOPLASM_BACKGROUND_INVOCATIONS_PER_DAY,
  iconoplasmBackgroundJob,
  isIconoplasmRecurringTrigger,
  runIconoplasmBackgroundJob,
} from "./iconoplasm-background-schedule.js"
import {
  CARETAKER_COMMENT_DELIVERY_LIMIT,
  CARETAKER_SUPERVOTE_DELIVERY_LIMIT,
} from "./iconoplasm-caretaker-comment-notifications.js"

test("every configured background event invokes exactly its one job, including delayed delivery", async () => {
  const jobs = Object.keys({ ...ICONOPLASM_BACKGROUND_MINUTES, ...ICONOPLASM_NIGHTLY_MINUTES })
  const totals = {}
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute++) {
      for (const [cron, schedule] of [
        [ICONOPLASM_RECURRING_CRON, ICONOPLASM_BACKGROUND_MINUTES],
        [ICONOPLASM_NIGHTLY_CRON, hour === 23 ? ICONOPLASM_NIGHTLY_MINUTES : {}],
      ]) {
        const expected = Object.entries(schedule)
          .filter(([, minutes]) => minutes.includes(minute))
          .map(([job]) => job)
        const calls = []
        const handlers = Object.fromEntries(
          jobs.map((job) => [
            job,
            async () => {
              calls.push(job)
              return { ok: true }
            },
          ]),
        )
        // A historical date ensures selection never depends on Date.now().
        const result = await runIconoplasmBackgroundJob(
          { cron, scheduledTime: Date.UTC(2025, 0, 1, hour, minute) },
          handlers,
        )
        assert.deepEqual(calls, expected)
        assert.equal(result.handled, expected.length === 1)
        if (result.handled) totals[result.job] = (totals[result.job] || 0) + 1
      }
    }
  }
  assert.equal(
    Object.values(totals).reduce((a, b) => a + b, 0),
    ICONOPLASM_BACKGROUND_INVOCATIONS_PER_DAY,
  )
  assert.equal(totals.caretakerComments * CARETAKER_COMMENT_DELIVERY_LIMIT, 80 * 24)
  assert.equal(totals.caretakerSupervotes * CARETAKER_SUPERVOTE_DELIVERY_LIMIT, 80 * 24)
  assert.equal(totals.fulfillment, 96)
  assert.equal(totals.accounts, 120)
  assert.equal(totals.manifestations, 120)
  assert.equal(totals.gallery, 97)
  assert.equal(totals.archive, 1)
  assert.equal(totals.canonRepair, 1)
})

test("background schedules retain bounded cadence and never repeat nightly work hourly", () => {
  for (const [job, minutes] of Object.entries(ICONOPLASM_BACKGROUND_MINUTES)) {
    if (job === "sharedDelivery") {
      // Aggregate drains are cheap and tolerate a slightly wider wake gap than
      // the 15-minute chains, but still wake several times per hour.
      minutes.forEach((minute, i) =>
        assert.ok(
          minutes[(i + 1) % minutes.length] + (i === minutes.length - 1 ? 60 : 0) - minute <= 24,
        ),
      )
      continue
    }
    if (job === "discoveryMigration") {
      minutes.forEach((minute, i) =>
        assert.ok(
          minutes[(i + 1) % minutes.length] + (i === minutes.length - 1 ? 60 : 0) - minute <= 17,
        ),
      )
      continue
    }
    const expectedGap =
      job === "sharedDiscovery"
        ? 60
        : ["caretakerSupervotes", "accounts", "manifestations"].includes(job)
          ? 12
          : 15
    minutes.forEach((minute, i) =>
      assert.equal(
        minutes[(i + 1) % minutes.length] + (i === minutes.length - 1 ? 60 : 0) - minute,
        expectedGap,
        job,
      ),
    )
  }
  for (const cron of ["55 23 * * *", "3 0 * * *", "6 12 * * *", "*/15 * * * *"]) {
    assert.equal(
      iconoplasmBackgroundJob({ cron, scheduledTime: Date.UTC(2025, 0, 1, 23, 56) }),
      null,
    )
  }
  assert.throws(
    () => iconoplasmBackgroundJob({ cron: ICONOPLASM_RECURRING_CRON }),
    /scheduled timestamp/,
  )
})

test("a failed background job is visible and cannot start another job in its invocation", async () => {
  let otherCalls = 0
  const handlers = Object.fromEntries(
    Object.keys(ICONOPLASM_BACKGROUND_MINUTES).map((job) => [job, async () => otherCalls++]),
  )
  handlers.caretakerComments = async () => {
    throw new Error("delivery unavailable")
  }
  await assert.rejects(
    runIconoplasmBackgroundJob(
      {
        cron: ICONOPLASM_RECURRING_CRON,
        scheduledTime: Date.UTC(2025, 0, 1, 0, ICONOPLASM_BACKGROUND_MINUTES.caretakerComments[0]),
      },
      handlers,
    ),
    /delivery unavailable/,
  )
  assert.equal(otherCalls, 0)
})

test("Wrangler matches the canonical schedule within the Free five-cron allowance", () => {
  const config = readFileSync(
    new URL(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      import.meta.url,
    ),
    "utf8",
  )
  const productionTriggers = config.slice(
    config.indexOf("[triggers]"),
    config.indexOf("[env.staging]"),
  )
  const match = /crons\s*=\s*(\[[^\]]*\])/.exec(productionTriggers)
  assert.ok(match)
  assert.deepEqual(JSON.parse(match[1]), [
    "55 23 * * *",
    "3 0 * * *",
    "6 12 * * *",
    ICONOPLASM_RECURRING_CRON,
    ICONOPLASM_NIGHTLY_CRON,
  ])
})

// A routine push runs `wrangler versions upload`, which keeps the cron
// trigger Cloudflare already has installed. Failure modes:
// 1. The code computes a recurring cron string that differs from the
//    installed one; every recurring event then matches no job, and
//    fulfilment, manifestations, the catalog dispatch and the rest stop
//    without an error.
// 2. An idle minute of the installed trigger runs a job.
// 3. The scheduled handler does not recognise an idle minute as its own
//    trigger and logs it as an unknown cron 144 times a day.
// The string below is the trigger production runs, installed by the last
// `wrangler deploy` and identical to main's toml at 2018e880.
const INSTALLED_RECURRING_TRIGGER =
  "0,1,2,3,4,5,6,7,8,10,11,13,14,15,16,17,18,19,20,23,24,26,27,28,29,30,31,32,33,34,35,38,39,41,42,43,44,45,46,47,48,50,51,52,53,54,55,56,59 * * * *"

test("the router dispatches the recurring jobs from the trigger production has installed", async () => {
  assert.equal(ICONOPLASM_RECURRING_CRON, INSTALLED_RECURRING_TRIGGER)
  for (const [minute, job] of [
    [5, "fulfillment"],
    [7, "manifestations"],
    [8, "gallery"],
  ]) {
    const calls = []
    const handlers = Object.fromEntries(
      Object.keys(ICONOPLASM_BACKGROUND_MINUTES).map((name) => [
        name,
        async () => calls.push(name),
      ]),
    )
    const result = await runIconoplasmBackgroundJob(
      { cron: INSTALLED_RECURRING_TRIGGER, scheduledTime: Date.UTC(2026, 9, 3, 14, minute) },
      handlers,
    )
    assert.equal(result.handled, true, job)
    assert.equal(result.job, job)
    assert.deepEqual(calls, [job])
  }
  for (const minute of ICONOPLASM_IDLE_MINUTES) {
    const event = {
      cron: INSTALLED_RECURRING_TRIGGER,
      scheduledTime: Date.UTC(2026, 9, 3, 14, minute),
    }
    assert.equal(iconoplasmBackgroundJob(event), null, `minute ${minute} runs nothing`)
    assert.equal(isIconoplasmRecurringTrigger(event), true, `minute ${minute} is still ours`)
  }
  assert.equal(isIconoplasmRecurringTrigger({ cron: "3 0 * * *" }), false)
  const wrapper = readFileSync(
    new URL(
      "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const idleReturn = wrapper.indexOf("if (isIconoplasmRecurringTrigger(backgroundEvent)) return")
  assert.ok(idleReturn > 0, "the scheduled handler returns on an idle minute")
  assert.ok(
    idleReturn < wrapper.indexOf("No handler for cron expression"),
    "before the unknown-cron warning",
  )
})
