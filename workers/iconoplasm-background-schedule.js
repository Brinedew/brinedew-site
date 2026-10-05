// One job per scheduled invocation: promises sharing a clock still share the
// Worker's D1/external-subrequest limits. This clock allocates independent
// invocations; each job still needs its own work bounds and daily admission.
// It is also GeneGuessr's: the free plan allows 5 cron triggers an account and
// the Worker already lists 5 expressions, so the "Top Streaks" refresh takes
// the free minutes of this one (`geneguessrBoard`, B-965).
const quarterHours = (minute) => Object.freeze([minute, minute + 15, minute + 30, minute + 45])

export const ICONOPLASM_BACKGROUND_MINUTES = Object.freeze({
  sharedDiscovery: Object.freeze([0]),
  discoveryMigration: Object.freeze([1, 16, 33, 48]),
  sharedDelivery: Object.freeze([10, 28, 46]),
  caretakerComments: quarterHours(2),
  fulfillment: quarterHours(5),
  caretakerSupervotes: Object.freeze([3, 15, 27, 39, 51]),
  gallery: quarterHours(8),
  materialization: quarterHours(11),
  recognition: quarterHours(14),
  // Every ten minutes or so, on the minutes no other job uses; the gap never exceeds 12.
  geneguessrBoard: Object.freeze([4, 13, 24, 34, 45, 52]),
  // B-896: the style picker's first page on the CDN. Free minutes again, so the
  // gaps are uneven; the page is never more than 20 minutes behind.
  requestPicker: Object.freeze([9, 21, 36, 49]),
  accounts: Object.freeze([6, 18, 30, 42, 54]),
  manifestations: Object.freeze([7, 19, 31, 43, 55]),
})

export const ICONOPLASM_NIGHTLY_MINUTES = Object.freeze({
  archive: Object.freeze([56]),
  canonRepair: Object.freeze([58]),
  gallery: Object.freeze([59]),
})

function jobsByMinute(schedule) {
  const jobs = new Map()
  for (const [job, minutes] of Object.entries(schedule)) {
    for (const minute of minutes) {
      if (!Number.isInteger(minute) || minute < 0 || minute > 59 || jobs.has(minute)) {
        throw new Error(`Invalid or overlapping Iconoplasm background minute: ${minute}`)
      }
      jobs.set(minute, job)
    }
  }
  return jobs
}

const recurringJobs = jobsByMinute(ICONOPLASM_BACKGROUND_MINUTES)
const nightlyJobs = jobsByMinute(ICONOPLASM_NIGHTLY_MINUTES)
// The trigger fires at exactly the job minutes. A normal push uploads a Worker
// version with `wrangler versions upload`, which never changes cron triggers,
// so the release compares the toml's triggers with the installed ones and runs
// `wrangler deploy` when they differ (scripts/stateful-worker-deploy-mode.mjs);
// the toml's string and this one must be the same set
// (workers/iconoplasm-background-schedule.test.js).
export const ICONOPLASM_RECURRING_CRON = `${[...recurringJobs.keys()].sort((a, b) => a - b).join(",")} * * * *`
export const ICONOPLASM_NIGHTLY_CRON = "56,58,59 23 * * *"
export const ICONOPLASM_BACKGROUND_INVOCATIONS_PER_DAY = recurringJobs.size * 24 + nightlyJobs.size

export function iconoplasmBackgroundJob(event) {
  const cron = event?.cron
  if (cron !== ICONOPLASM_RECURRING_CRON && cron !== ICONOPLASM_NIGHTLY_CRON) return null
  // Delayed cron deliveries must run the job for the scheduled minute, not
  // whichever minute happens to be on the wall clock when execution begins.
  if (!Number.isFinite(event?.scheduledTime)) throw new TypeError("Missing scheduled timestamp")
  const scheduled = new Date(event.scheduledTime)
  if (!Number.isFinite(scheduled.getTime())) throw new TypeError("Invalid scheduled timestamp")
  const jobs = cron === ICONOPLASM_RECURRING_CRON ? recurringJobs : nightlyJobs
  if (jobs === nightlyJobs && scheduled.getUTCHours() !== 23) return null
  return jobs.get(scheduled.getUTCMinutes()) || null
}

export async function runIconoplasmBackgroundJob(event, handlers) {
  const job = iconoplasmBackgroundJob(event)
  if (!job) return Object.freeze({ handled: false })
  if (typeof handlers?.[job] !== "function") throw new Error(`Missing background handler: ${job}`)
  const result = await handlers[job]()
  return Object.freeze({ handled: true, job, result })
}
