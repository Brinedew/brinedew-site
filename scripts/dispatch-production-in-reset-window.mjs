import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { readAccountBudget } from "./lib/cloudflare-account-budget.mjs"
import { readIconoplasmReleaseState } from "./read-iconoplasm-release-state.mjs"
import { isFullRelease, isMigrationCheckpoint } from "./lib/iconoplasm-release-evidence.mjs"
export { isFullRelease, FULL_RELEASE_STEPS } from "./lib/iconoplasm-release-evidence.mjs"

const REPOSITORY = "Brinedew/brinedew-site"
const WORKFLOW = "deploy-quartz.yml"
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"])
export function deploymentHeadroom(usage, now) {
  if (
    usage?.day !== new Date(now).toISOString().slice(0, 10) ||
    !Number.isSafeInteger(usage.measured_at) ||
    usage.measured_at > now ||
    now - usage.measured_at > 60000
  )
    throw new Error("RESET_TELEMETRY_STALE")
  // Negative-only checks. The canonical workflow still prices the complete
  // release and atomically reserves every operation. No allowance is raised.
  const ceilings = {
    rows_read: 1500000,
    rows_written: 40000,
    requests: 60000,
    do_rows_read: 3500000,
    do_rows_written: 70000,
    do_requests: 70000,
    do_duration_gb_seconds: 9000,
    queue_operations: 6000,
    kv_reads: 60000,
    kv_writes: 600,
    kv_deletes: 600,
    kv_lists: 600,
  }
  for (const [meter, ceiling] of Object.entries(ceilings)) {
    if (
      (meter === "do_duration_gb_seconds"
        ? !Number.isFinite(usage[meter])
        : !Number.isSafeInteger(usage[meter])) ||
      usage[meter] < 0
    )
      throw new Error(`RESET_TELEMETRY_INVALID:${meter}`)
    if (usage[meter] >= ceiling) return { ok: false, meter, used: usage[meter], ceiling }
  }
  return { ok: true }
}

export async function dispatchResetTick({
  intent,
  state = {},
  gh,
  readUsage,
  readState,
  persist,
  now = Date.now,
  verifyOnly = false,
}) {
  const instant = now(),
    day = new Date(instant).toISOString().slice(0, 10)
  if (
    !/^[a-f0-9]{40}$/.test(intent?.required_head_sha || "") ||
    !Number.isFinite(Date.parse(intent?.deadline))
  )
    throw new Error("RESET_RELEASE_INTENT_REQUIRED")
  const save = async (patch) => {
    state = {
      ...state,
      ...patch,
      checked_at: new Date(now()).toISOString(),
      failure_destination: "Linear B-756 / current Codex recovery task",
    }
    if (!verifyOnly) await persist(state)
    return state
  }
  const utcMinutes = (instant % 86400000) / 60000
  if (!verifyOnly && day > intent.reset_day && state.phase !== "deployed")
    return save({
      phase: "failed",
      error:
        "The armed reset day has ended. Executor reconciliation is required; no new daily migration lineage is created.",
    })
  if (!verifyOnly && (utcMinutes > 390 || day < intent.reset_day))
    return {
      phase: "waiting_for_reset",
      reset_day: intent.reset_day,
      required_head_sha: intent.required_head_sha,
    }
  const sha = (await gh([`repos/${REPOSITORY}/commits/main`])).sha
  if (sha !== intent.required_head_sha) {
    const comparison = await gh([
      `repos/${REPOSITORY}/compare/${intent.required_head_sha}...${sha}`,
    ])
    if (comparison.status !== "ahead") throw new Error("RESET_REQUIRED_REPAIR_NOT_ON_MAIN")
  }
  const payload = await gh([
    `repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=100`,
  ])
  if (!Array.isArray(payload.workflow_runs)) throw new Error("RESET_RUN_INVENTORY_INVALID")
  const runs = payload.workflow_runs.filter(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.path === `.github/workflows/${WORKFLOW}`,
  )
  const jobs = async (run) => {
    const result = await gh([
      `repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt || 1}/jobs?per_page=100`,
    ])
    if (!Array.isArray(result.jobs) || result.jobs.length >= 100)
      throw new Error("RESET_JOB_INVENTORY_INVALID")
    return result.jobs
  }
  // A later failed, active or reader-only attempt supersedes an older full
  // release. Reruns are ordered by their attempt start, not original creation.
  const latest = runs
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.run_started_at || b.created_at) - Date.parse(a.run_started_at || a.created_at),
    )[0]
  let checkpoint = null
  if (latest?.status === "completed" && latest.conclusion === "success") {
    const run = latest
    const latestJobs = await jobs(run)
    if (isFullRelease(run, latestJobs)) {
      const installed = await readState()
      if (typeof installed?.schema_transition !== "boolean")
        throw new Error("RESET_INSTALLED_STATE_INVALID")
      if (!installed.schema_transition)
        return save({
          version: 2,
          day,
          sha,
          phase: "deployed",
          run_id: run.id,
          run_attempt: run.run_attempt,
          url: run.html_url,
          full_release_verified_at: new Date(now()).toISOString(),
        })
    }
    if (isMigrationCheckpoint(run, latestJobs)) checkpoint = run
  }
  const active = payload.workflow_runs.find((run) => ACTIVE.has(run.status))
  if (active) {
    if (active.head_sha !== sha)
      return save({ phase: "waiting_for_active_release", blocking_run_id: active.id })
    return save({
      version: 2,
      day,
      sha,
      phase: "running",
      run_id: active.id,
      run_attempt: active.run_attempt,
      url: active.html_url,
      reserved_at: state.reserved_at || active.created_at,
      known_run_ids:
        state.known_run_ids || runs.filter((run) => run.id !== active.id).map((run) => run.id),
    })
  }
  if (state.reserved_at && state.sha !== sha && !["deployed", "failed"].includes(state.phase))
    return save({
      phase: "failed",
      error:
        "An earlier source dispatch has an uncertain outcome. Executor reconciliation must precede a new source dispatch.",
    })
  const retained = state.day === day && state.sha === sha && state.reserved_at
  if (retained) {
    const candidates = runs.filter(
      (run) =>
        !state.known_run_ids.includes(run.id) &&
        Date.parse(run.created_at) >= Date.parse(state.reserved_at) - 5000,
    )
    if (candidates.length > 1)
      return save({
        phase: "failed",
        error: "Multiple new releases require executor reconciliation; no duplicate dispatch.",
      })
    const run = candidates[0]
    // A checkpoint accounts for the previous dispatch without treating it as
    // activation. Unknown/failed outcomes still retain their reservation.
    if (run && run.id !== checkpoint?.id)
      return save({
        phase: "failed",
        run_id: run.id,
        run_attempt: run.run_attempt,
        url: run.html_url,
        error:
          "Canonical release did not complete full activation. Executor must inspect the failed or skipped step.",
      })
    if (!run)
      return save({
        phase: "dispatch_outcome_unknown",
        error:
          "Dispatch reservation retained; no matching run is visible. Executor must reconcile before any retry.",
      })
  }
  let continuationOrigin = ""
  const checkpointKey = checkpoint ? `${checkpoint.id}:${checkpoint.run_attempt || 1}` : ""
  if (checkpoint) {
    const completed = state.completed_checkpoints || []
    if (completed.includes(checkpointKey) || completed.length >= 8)
      return save({
        phase: "failed",
        error:
          "Migration checkpoint already continued or checkpoint bound reached; reconcile retained dispatch.",
      })
    const installed = await readState()
    if (installed?.schema_transition !== true || !/^\d+$/.test(installed.origin_run_id || ""))
      throw new Error("RESET_MIGRATION_CHECKPOINT_STATE_INVALID")
    continuationOrigin = installed.origin_run_id
  }
  const checks = await gh([`repos/${REPOSITORY}/commits/${sha}/check-runs?per_page=100`])
  const ci = checks.check_runs
    ?.filter((c) => c.name === "build-and-test")
    .sort(
      (a, b) => Date.parse(b.started_at || b.created_at) - Date.parse(a.started_at || a.created_at),
    )[0]
  if (ci?.status !== "completed" || ci.conclusion !== "success")
    return save({
      version: 2,
      day,
      sha,
      phase: "waiting_for_ci",
      error: "Exact main build-and-test has not passed.",
    })
  const usage = await readUsage()
  const headroom = deploymentHeadroom(usage, now())
  if (!headroom.ok)
    return save({
      version: 2,
      day,
      sha,
      phase: "waiting_for_headroom",
      headroom,
      error:
        now() > Date.parse(intent.deadline)
          ? "Reset release deadline missed; executor owns recovery."
          : "",
    })
  if (verifyOnly) return { phase: "ready", sha, day, headroom, usage }
  // Persist before the POST: an uncertain response must never become a second
  // dispatch or a fresh migration lineage after process/laptop restart.
  await save({
    version: 2,
    day,
    sha,
    phase: "dispatch_reserved",
    reserved_at: new Date(now()).toISOString(),
    known_run_ids: runs.map((r) => r.id),
    ...(checkpoint
      ? {
          completed_checkpoints: [...(state.completed_checkpoints || []), checkpointKey],
          continuation_origin_run_id: continuationOrigin,
        }
      : {}),
    usage_at_dispatch: usage,
  })
  try {
    await gh([
      "--method",
      "POST",
      `repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`,
      "-f",
      "ref=main",
      ...(continuationOrigin ? ["-f", `inputs[resume_run_id]=${continuationOrigin}`] : []),
    ])
    return save({ phase: "dispatched", dispatched_at: new Date(now()).toISOString() })
  } catch {
    return save({
      phase: "dispatch_outcome_unknown",
      error: "GitHub dispatch outcome is uncertain. Reservation retained; executor must reconcile.",
    })
  }
}

function gh(arguments_) {
  const executable = process.platform === "win32" ? "C:\\Program Files\\GitHub CLI\\gh.exe" : "gh"
  const output = execFileSync(executable, ["api", ...arguments_], {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 2000000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return output.trim() ? JSON.parse(output) : {}
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const directory = path.join(root, "artifacts", "reset-deploy")
  const statePath = path.join(directory, "state.json")
  const intent = JSON.parse(
    readFileSync(path.join(directory, "intent.json"), "utf8").replace(/^\uFEFF/, ""),
  )
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8").replace(/^\uFEFF/, ""))
    : {}
  const persist = (next) => {
    mkdirSync(directory, { recursive: true })
    const temporary = `${statePath}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n")
    renameSync(temporary, statePath)
  }
  try {
    const result = await dispatchResetTick({
      intent,
      state,
      gh,
      readUsage: () =>
        readAccountBudget({
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          token: process.env.CLOUDFLARE_API_TOKEN,
        }),
      readState: () => readIconoplasmReleaseState(),
      persist,
      verifyOnly: process.argv.includes("--verify-readiness"),
    })
    console.log(JSON.stringify(result))
    if (["failed", "dispatch_outcome_unknown"].includes(result.phase)) process.exitCode = 1
  } catch (error) {
    if (!process.argv.includes("--verify-readiness"))
      persist({
        ...state,
        phase: "executor_error",
        checked_at: new Date().toISOString(),
        error: /^(?:RESET_|COST_)/.test(error.message)
          ? error.message
          : "Reset executor transport failed; inspect local task and provider availability.",
        failure_destination: "Linear B-756 / current Codex recovery task",
      })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Reset deployment executor requires attention; retained state is in artifacts/reset-deploy/state.json.",
    )
    process.exitCode = 1
  })
