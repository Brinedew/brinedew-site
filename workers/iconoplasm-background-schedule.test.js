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
  assert.equal(totals.accounts, 96)
  assert.equal(totals.manifestations, 96)
  assert.equal(totals.gallery, 97)
  assert.equal(totals.archive, 1)
  assert.equal(totals.voteProjection, 1)
  assert.equal(totals.canonRepair, 1)
})

test("background schedules retain bounded cadence and never repeat nightly work hourly", () => {
  for (const [job, minutes] of Object.entries(ICONOPLASM_BACKGROUND_MINUTES)) {
    const expectedGap = job === "sharedDiscovery" ? 60 : job === "caretakerSupervotes" ? 12 : 15
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
      { cron: ICONOPLASM_RECURRING_CRON, scheduledTime: Date.UTC(2025, 0, 1, 0, 1) },
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
