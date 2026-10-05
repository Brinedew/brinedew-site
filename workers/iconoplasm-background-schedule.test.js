import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_NIGHTLY_MINUTES,
  ICONOPLASM_RECURRING_CRON,
  ICONOPLASM_NIGHTLY_CRON,
  ICONOPLASM_BACKGROUND_INVOCATIONS_PER_DAY,
  iconoplasmBackgroundJob,
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
  assert.equal(totals.geneguessrBoard, 144)
  assert.equal(totals.requestPicker, 96)
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
    if (job === "geneguessrBoard") {
      // The "Top Streaks" refresh (B-965) takes the free minutes, so its gaps are not equal; the
      // board is never more than twelve minutes behind its last refresh.
      minutes.forEach((minute, i) =>
        assert.ok(
          minutes[(i + 1) % minutes.length] + (i === minutes.length - 1 ? 60 : 0) - minute <= 12,
        ),
      )
      continue
    }
    if (job === "requestPicker") {
      // The picker's first page (B-896) also takes free minutes: never 20 minutes stale.
      minutes.forEach((minute, i) =>
        assert.ok(
          minutes[(i + 1) % minutes.length] + (i === minutes.length - 1 ? 60 : 0) - minute <= 20,
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

// B-898 Stage 3 failure modes. The recurring trigger Cloudflare fires and the
// minute map are two lists that must be one set:
// 1. A minute in the trigger that no job owns fires an invocation that does
//    nothing, every hour, for as long as nobody notices.
// 2. A job minute missing from the trigger never runs, silently.
// 3. The trigger is read from the constant that is derived from the minute
//    map, so a toml that drifted would still agree with itself. This test
//    parses the checked-in toml's own string instead.
test("the toml's recurring trigger fires exactly the job minutes, and every one dispatches its own job", async () => {
  const toml = readFileSync(
    new URL(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      import.meta.url,
    ),
    "utf8",
  )
  const production = toml.slice(toml.indexOf("[triggers]"), toml.indexOf("[env.staging]"))
  const crons = JSON.parse(/crons\s*=\s*(\[[^\]]*\])/.exec(production)[1])
  const recurring = crons.filter((cron) => /^\d+(,\d+)* \* \* \* \*$/.test(cron))
  assert.equal(recurring.length, 1, "exactly one every-hour recurring trigger")
  const minutes = recurring[0].split(" ")[0].split(",").map(Number)
  const owned = Object.entries(ICONOPLASM_BACKGROUND_MINUTES).flatMap(([job, jobMinutes]) =>
    jobMinutes.map((minute) => [minute, job]),
  )
  assert.deepEqual(
    minutes,
    owned.map(([minute]) => minute).sort((a, b) => a - b),
    "the trigger's minutes are the job minutes, each once, in order",
  )
  assert.equal(recurring[0], ICONOPLASM_RECURRING_CRON)
  for (const [minute, job] of owned) {
    const calls = []
    const handlers = Object.fromEntries(
      Object.keys(ICONOPLASM_BACKGROUND_MINUTES).map((name) => [
        name,
        async () => calls.push(name),
      ]),
    )
    const result = await runIconoplasmBackgroundJob(
      { cron: recurring[0], scheduledTime: Date.UTC(2026, 9, 3, 14, minute) },
      handlers,
    )
    assert.equal(result.handled, true, `minute ${minute} dispatches`)
    assert.equal(result.job, job, `minute ${minute} runs ${job}`)
    assert.deepEqual(calls, [job])
  }
})
