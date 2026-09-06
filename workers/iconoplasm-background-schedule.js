// One job per scheduled invocation: promises sharing a clock still share the
// Worker's D1/external-subrequest limits. This clock allocates independent
// invocations; each job still needs its own work bounds and daily admission.
const quarterHours = (minute) => Object.freeze([minute, minute + 15, minute + 30, minute + 45])

export const ICONOPLASM_BACKGROUND_MINUTES = Object.freeze({
  sharedDiscovery: Object.freeze([0]),
  caretakerComments: quarterHours(1),
  fulfillment: quarterHours(2),
  caretakerSupervotes: Object.freeze([3, 15, 27, 39, 51]),
  gallery: quarterHours(4),
  materialization: quarterHours(5),
  recognition: quarterHours(7),
  accounts: quarterHours(10),
  manifestations: quarterHours(11),
})

export const ICONOPLASM_NIGHTLY_MINUTES = Object.freeze({
  archive: Object.freeze([56]),
  voteProjection: Object.freeze([57]),
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
export const ICONOPLASM_RECURRING_CRON = `${[...recurringJobs.keys()].sort((a, b) => a - b).join(",")} * * * *`
export const ICONOPLASM_NIGHTLY_CRON = "56-59 23 * * *"
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
