import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  handleIconoplasmSyncFinalizationQueue,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function finalizationPhasePriority(phase) {
  const value = String(phase || "").trim().toLowerCase()
  if (value === "vision_rollups") return 0
  if (value === "gene_rollups") return 1
  if (value === "vote_summaries") return 2
  return 3
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, args: this.args })
    if (this.sql.includes("FROM icono_sync_finalization_jobs") && this.sql.includes("WHERE status = ?") && this.sql.includes("phase <> ?")) {
      const [scopedSymbolsJson, runningStatus, excludedPhase, scopedEnabled, limit] = this.args
      let scopedSymbols = null
      if (Number(scopedEnabled || 0) > 0) {
        try {
          scopedSymbols = new Set(
            (JSON.parse(String(scopedSymbolsJson || "[]")) || [])
              .map((item) => String(item || "").trim().toUpperCase())
              .filter(Boolean),
          )
        } catch {
          scopedSymbols = new Set()
        }
      }
      const rows = [...this.db.jobs.values()]
        .filter((row) => row.status === runningStatus && row.phase !== excludedPhase)
        .filter((row) => !scopedSymbols || scopedSymbols.has(String(row.gene_symbol || "").trim().toUpperCase()))
        .sort((left, right) => {
          const leftLeaseAt = String(left.last_attempt_at || left.requested_at || "")
          const rightLeaseAt = String(right.last_attempt_at || right.requested_at || "")
          const leaseDelta = leftLeaseAt.localeCompare(rightLeaseAt)
          if (leaseDelta !== 0) return leaseDelta
          return String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || ""))
        })
      return { results: rows.slice(0, Math.max(0, Number(limit || 0) || 0)).map((row) => ({ ...row })) }
    }
    if (this.sql.includes("FROM icono_sync_finalization_jobs") && this.sql.includes("WHERE status IN (?, ?)")) {
      const scopedQuery = this.sql.includes("WITH scoped_symbols")
      const [scopedSymbolsJson, queuedStatus, retryingStatus, excludedPhase, nowIso, scopedEnabled, visionRollupsPhase, geneRollupsPhase, voteSummariesPhase, limit] = scopedQuery
        ? this.args
        : ["[]", ...this.args, 0, "vision_rollups", "gene_rollups", "vote_summaries", 0]
      let scopedSymbols = []
      try {
        const parsed = JSON.parse(String(scopedSymbolsJson || "[]"))
        scopedSymbols = Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean) : []
      } catch {
        scopedSymbols = []
      }
      const rows = [...this.db.jobs.values()]
        .filter((row) => (row.status === queuedStatus || row.status === retryingStatus) && row.phase !== excludedPhase)
        .filter((row) => !row.next_attempt_at || String(row.next_attempt_at) <= String(nowIso || ""))
        .filter((row) => Number(scopedEnabled || 0) <= 0 || scopedSymbols.includes(String(row.gene_symbol || "").trim().toUpperCase()))
        .sort((left, right) => {
          const leftPriority = finalizationPhasePriority(left.phase)
          const rightPriority = finalizationPhasePriority(right.phase)
          if (leftPriority !== rightPriority) return leftPriority - rightPriority
          const requestedDelta = String(left.requested_at || "").localeCompare(String(right.requested_at || ""))
          if (requestedDelta !== 0) return requestedDelta
          return String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || ""))
        })
      return { results: rows.slice(0, Math.max(0, Number(limit || 0) || 0)).map((row) => ({ ...row })) }
    }
    if (this.sql.includes("FROM icono_sync_finalization_jobs") && this.sql.includes("WHERE status <> ?")) {
      const scopedQuery =
        this.sql.includes("WITH scoped_symbols") ||
        this.sql.includes("gene_symbol IN (SELECT value FROM json_each(?))")
      const [scopedSymbolsJson, completedStatus, scopedEnabled, pendingFinalizePhase, limit] = scopedQuery
        ? this.args
        : ["[]", this.args[0], 0, this.args[1], this.args[2]]
      let scopedSymbols = null
      if (Number(scopedEnabled || 0) > 0) {
        try {
          scopedSymbols = new Set(
            (JSON.parse(String(scopedSymbolsJson || "[]")) || [])
              .map((item) => String(item || "").trim().toUpperCase())
              .filter(Boolean),
          )
        } catch {
          scopedSymbols = new Set()
        }
      }
      const rows = [...this.db.jobs.values()]
        .filter((row) => row.status !== completedStatus)
        .filter((row) => !scopedSymbols || scopedSymbols.has(String(row.gene_symbol || "").trim().toUpperCase()))
        .sort((left, right) => {
          const leftPendingFinalize = left.phase === pendingFinalizePhase ? 1 : 0
          const rightPendingFinalize = right.phase === pendingFinalizePhase ? 1 : 0
          if (leftPendingFinalize !== rightPendingFinalize) return leftPendingFinalize - rightPendingFinalize
          const nextAttemptDelta = String(left.next_attempt_at || "").localeCompare(String(right.next_attempt_at || ""))
          if (nextAttemptDelta !== 0) return nextAttemptDelta
          const requestedDelta = String(left.requested_at || "").localeCompare(String(right.requested_at || ""))
          if (requestedDelta !== 0) return requestedDelta
          return String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || ""))
        })
      return { results: rows.slice(0, Math.max(0, Number(limit || 0) || 0)).map((row) => ({ ...row })) }
    }
    if (this.sql.includes("FROM icono_portrait_assets") || this.sql.includes("FROM icono_publish_state")) {
      return { results: [] }
    }
    return { results: [] }
  }

  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    if (this.sql.includes("SELECT *") && this.sql.includes("FROM icono_sync_finalization_jobs") && this.sql.includes("WHERE gene_symbol = ?")) {
      const symbol = String(this.args[0] || "").trim().toUpperCase()
      const row = this.db.jobs.get(symbol)
      return row ? { ...row } : null
    }
    if (this.sql.includes("SELECT MAX(completed_at) AS completed_at") && this.sql.includes("FROM icono_sync_finalization_jobs")) {
      const [status] = this.args
      const completedValues = [...this.db.jobs.values()]
        .filter((row) => row.status === status && String(row.completed_at || "").trim())
        .map((row) => String(row.completed_at || "").trim())
        .sort()
      return { completed_at: completedValues.at(-1) || "" }
    }
    if (this.sql.includes("SELECT COUNT(*) AS count") && this.sql.includes("FROM icono_sync_finalization_jobs")) {
      const parseScopedSymbols = (rawEnabled, rawSymbolsJson) => {
        if (Number(rawEnabled || 0) <= 0) return null
        try {
          const parsed = JSON.parse(String(rawSymbolsJson || "[]"))
          return new Set(
            (Array.isArray(parsed) ? parsed : [])
              .map((item) => String(item || "").trim().toUpperCase())
              .filter(Boolean),
          )
        } catch {
          return new Set()
        }
      }
      if (this.sql.includes("WHERE status = ?")) {
        const [status, scopedEnabled, scopedSymbolsJson] = this.args
        const scopedSymbols = parseScopedSymbols(scopedEnabled, scopedSymbolsJson)
        return {
          count: [...this.db.jobs.values()].filter(
            (row) =>
              row.status === status &&
              (!scopedSymbols || scopedSymbols.has(String(row.gene_symbol || "").trim().toUpperCase())),
          ).length,
        }
      }
      if (this.sql.includes("phase = ?") && this.sql.includes("status <> ?")) {
        const phaseBeforeStatus = this.sql.indexOf("phase = ?") < this.sql.indexOf("status <> ?")
        const [phase, excludedStatus, scopedEnabled, scopedSymbolsJson] = phaseBeforeStatus
          ? this.args
          : [this.args[1], this.args[0], this.args[2], this.args[3]]
        const scopedSymbols = parseScopedSymbols(scopedEnabled, scopedSymbolsJson)
        return {
          count: [...this.db.jobs.values()].filter(
            (row) =>
              row.phase === phase &&
              row.status !== excludedStatus &&
              (!scopedSymbols || scopedSymbols.has(String(row.gene_symbol || "").trim().toUpperCase())),
          ).length,
        }
      }
      if (this.sql.includes("phase NOT IN (?, ?)") && this.sql.includes("status <> ?")) {
        const [excludedStatus, excludedPhaseA, excludedPhaseB, scopedEnabled, scopedSymbolsJson] = this.args
        const scopedSymbols = parseScopedSymbols(scopedEnabled, scopedSymbolsJson)
        return {
          count: [...this.db.jobs.values()].filter(
            (row) =>
              row.status !== excludedStatus &&
              row.phase !== excludedPhaseA &&
              row.phase !== excludedPhaseB &&
              (!scopedSymbols || scopedSymbols.has(String(row.gene_symbol || "").trim().toUpperCase())),
          ).length,
        }
      }
      if (this.sql.includes("WHERE status <> ?")) {
        const [excludedStatus, scopedEnabled, scopedSymbolsJson] = this.args
        const scopedSymbols = parseScopedSymbols(scopedEnabled, scopedSymbolsJson)
        return {
          count: [...this.db.jobs.values()].filter(
            (row) =>
              row.status !== excludedStatus &&
              (!scopedSymbols || scopedSymbols.has(String(row.gene_symbol || "").trim().toUpperCase())),
          ).length,
        }
      }
    }
    return null
  }

  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    if (this.sql.includes("CREATE TABLE IF NOT EXISTS icono_sync_finalization_jobs") || this.sql.includes("CREATE INDEX IF NOT EXISTS idx_icono_sync_finalization_jobs")) {
      return { success: true }
    }
    if (this.sql.includes("INSERT INTO icono_sync_finalization_jobs")) {
      const [
        symbol,
        actorId,
        reason,
        phase,
        keepAssetsJson,
        legacyAssetsJson,
        visionIdsJson,
        requestedAt,
        updatedAt,
        nextAttemptAt,
      ] = this.args
      this.db.jobs.set(String(symbol), {
        gene_symbol: String(symbol),
        actor_id: String(actorId),
        reason: String(reason),
        status: "queued",
        phase: String(phase),
        keep_assets_json: String(keepAssetsJson || "[]"),
        legacy_assets_json: String(legacyAssetsJson || "[]"),
        vision_ids_json: String(visionIdsJson || "[]"),
        requested_at: String(requestedAt || ""),
        updated_at: String(updatedAt || ""),
        last_attempt_at: "",
        next_attempt_at: String(nextAttemptAt || ""),
        attempts: 0,
        last_error: "",
        completed_at: "",
      })
      return { success: true }
    }
    if (this.sql.includes("UPDATE icono_sync_finalization_jobs")) {
      const symbol = String(this.args[this.args.length - 1] || "")
      const current = this.db.jobs.get(symbol)
      if (current) {
        const setClause = this.sql.split("SET")[1]?.split("WHERE")[0] || ""
        const assignments = setClause
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
        let index = 0
        for (const assignment of assignments) {
          const [field, rawValue] = assignment.split("=").map((item) => item.trim())
          if (!field || String(rawValue || "").includes("CURRENT_TIMESTAMP")) continue
          current[field] = this.args[index]
          index += 1
        }
        this.db.jobs.set(symbol, current)
      }
      return { success: true }
    }
    return { success: true }
  }
}

class FakeIconoplasmDb {
  constructor({ jobs = [] } = {}) {
    this.calls = []
    this.jobs = new Map()
    for (const job of Array.isArray(jobs) ? jobs : []) {
      const symbol = String(job?.gene_symbol || "").trim().toUpperCase()
      if (!symbol) continue
      this.jobs.set(symbol, {
        gene_symbol: symbol,
        actor_id: String(job?.actor_id || "workstation_sync"),
        reason: String(job?.reason || "sync_finalization"),
        status: String(job?.status || "queued"),
        phase: String(job?.phase || "reconcile"),
        keep_assets_json: String(job?.keep_assets_json || "[]"),
        legacy_assets_json: String(job?.legacy_assets_json || "[]"),
        vision_ids_json: String(job?.vision_ids_json || "[]"),
        requested_at: String(job?.requested_at || "2026-04-16T00:00:00.000Z"),
        updated_at: String(job?.updated_at || "2026-04-16T00:00:00.000Z"),
        last_attempt_at: String(job?.last_attempt_at || ""),
        next_attempt_at: String(job?.next_attempt_at || "2026-04-16T00:00:00.000Z"),
        attempts: Number(job?.attempts || 0) || 0,
        last_error: String(job?.last_error || ""),
        completed_at: String(job?.completed_at || ""),
      })
    }
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  if (!env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE) {
    env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(request, gatewayEnv, ctx)
      },
    }
  }
  return env
}

function buildEnv({ jobs = [] } = {}, { bindGateway = true } = {}) {
  const gatewayDb = new FakeIconoplasmDb({ jobs })
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

function buildFakeQueue() {
  return {
    sent: [],
    async send(message) {
      this.sent.push(message)
    },
  }
}

test("admin finalization pending exposes queued, retrying, and pending-finalize jobs", async () => {
  const env = buildEnv({
    jobs: [
      {
        gene_symbol: "TP53",
        status: "queued",
        phase: "reconcile",
        requested_at: "2026-04-16T00:00:00.000Z",
        next_attempt_at: "2026-04-16T00:00:00.000Z",
      },
      {
        gene_symbol: "BRCA1",
        status: "retrying",
        phase: "gene_rollups",
        requested_at: "2026-04-16T00:01:00.000Z",
        next_attempt_at: "2026-04-16T00:02:00.000Z",
        attempts: 2,
        last_error: "timed out",
      },
      {
        gene_symbol: "EGFR",
        status: "queued",
        phase: "completed_pending_finalize",
        requested_at: "2026-04-16T00:03:00.000Z",
        next_attempt_at: "2026-04-16T00:03:00.000Z",
      },
      {
        gene_symbol: "MYC",
        status: "completed",
        phase: "completed_pending_finalize",
        completed_at: "2026-04-16T00:04:00.000Z",
      },
    ],
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/pending?limit=10", {
      method: "GET",
      headers: {
        Authorization: "Bearer secret-admin-token",
      },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.deepEqual(payload?.summary, {
    queued: 2,
    running: 0,
    retrying: 1,
    pending_finalize: 1,
    completed: 1,
    last_completed_at: "2026-04-16T00:04:00.000Z",
    total_pending: 4,
  })
  assert.deepEqual(
    (payload?.jobs || []).map((job) => job.symbol),
    ["TP53", "BRCA1", "EGFR"],
  )
})

test("admin finalization pending can scope the snapshot to selected symbols", async () => {
  const env = buildEnv({
    jobs: [
      {
        gene_symbol: "TP53",
        status: "queued",
        phase: "reconcile",
        requested_at: "2026-04-16T00:00:00.000Z",
        next_attempt_at: "2026-04-16T00:00:00.000Z",
      },
      {
        gene_symbol: "BRCA1",
        status: "retrying",
        phase: "gene_rollups",
        requested_at: "2026-04-16T00:01:00.000Z",
        next_attempt_at: "2026-04-16T00:02:00.000Z",
        attempts: 2,
        last_error: "timed out",
      },
      {
        gene_symbol: "EGFR",
        status: "queued",
        phase: "completed_pending_finalize",
        requested_at: "2026-04-16T00:03:00.000Z",
        next_attempt_at: "2026-04-16T00:03:00.000Z",
      },
    ],
  })

  const scopedSymbols = encodeURIComponent(JSON.stringify(["EGFR"]))
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request(`https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/pending?limit=10&symbols=${scopedSymbols}`, {
      method: "GET",
      headers: {
        Authorization: "Bearer secret-admin-token",
      },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.deepEqual(payload?.summary, {
    queued: 1,
    running: 0,
    retrying: 0,
    pending_finalize: 1,
    completed: 0,
    last_completed_at: "",
    total_pending: 2,
  })
  assert.deepEqual(
    (payload?.jobs || []).map((job) => job.symbol),
    ["EGFR"],
  )
})

test("admin finalization enqueue stores normalized durable job rows", async () => {
  const env = buildEnv()
  const queue = buildFakeQueue()
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
          ICONOPLASM_DB: env.gatewayDb,
          ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue,
        },
        { waitUntil() {} },
      )
    },
  }

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/enqueue", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: "pytest_sync_finalization",
        rows: [
          {
            symbol: "tp53",
            phase: "gene_rollups",
            keep: [{ symbol: "TP53", asset_sha256: "a".repeat(64) }],
            legacy: [{ symbol: "TP53", asset_sha256: "b".repeat(64) }],
            vision_ids: ["anima-v1-1"],
          },
          {
            symbol: "",
            phase: "reconcile",
          },
        ],
      }),
    }),
    env,
    {},
  )
  const payload = await response.json()
  const stored = env.gatewayDb.jobs.get("TP53")

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.queued, 1)
  assert.equal(payload?.queue_enabled, true)
  assert.equal(payload?.queue_messages, 1)
  assert.deepEqual(payload?.symbols, ["TP53"])
  assert.deepEqual(queue.sent, [
    {
      kind: "drain_finalization_ledger",
      run_id: "pytest_sync_finalization",
      symbols: ["TP53"],
      idempotency_key: "pytest_sync_finalization:drain:1:TP53:TP53",
    },
  ])
  assert.equal(stored?.phase, "gene_rollups")
  assert.equal(stored?.status, "queued")
  assert.deepEqual(JSON.parse(String(stored?.keep_assets_json || "[]")), [{ symbol: "TP53", asset_sha256: "a".repeat(64) }])
  assert.deepEqual(JSON.parse(String(stored?.legacy_assets_json || "[]")), [{ symbol: "TP53", asset_sha256: "b".repeat(64) }])
  assert.deepEqual(JSON.parse(String(stored?.vision_ids_json || "[]")), ["anima-v1-1"])
})

test("admin finalization enqueue returns current mutation-limiter telemetry for workstation accounting", async () => {
  const budgetNamespace = {
    idFromName(name) {
      return String(name || "")
    },
    get() {
      return {
        fetch: async () =>
          new Response(
            JSON.stringify({
              day_key: "2026-04-16",
              cycle_key: "2026-04",
              days_remaining_in_cycle: 12,
              rows_written: 24,
              rows_written_daily_smart_limit: 100,
              rows_written_daily_remaining: 76,
              rows_written_monthly_limit: 1000,
              rows_written_monthly_remaining: 976,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      }
    },
  }
  const gatewayDb = new FakeIconoplasmDb()
  const queue = buildFakeQueue()
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
    ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "1000",
    ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY: "7",
    ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY: "3",
  }
  const env = bindOnlyAllowedGateway(
    {
      ...gatewayEnv,
      ICONOPLASM_DB: null,
      gatewayDb,
    },
    gatewayEnv,
  )

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/enqueue", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: "pytest_sync_finalization",
        rows: [
          {
            symbol: "TP53",
            phase: "reconcile",
          },
        ],
      }),
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.mutation_limiter?.target_daily_percent, 90)
  assert.equal(payload?.mutation_limiter?.target_rows_written_ceiling, 90)
  assert.equal(payload?.mutation_limiter?.rows_written_target_remaining, 66)
  assert.equal(payload?.mutation_limiter?.budget_snapshot?.rows_written, 24)
  assert.equal(payload?.queue_enabled, true)
  assert.equal(payload?.queue_messages, 1)
})

test("admin finalization process route fails loud because finalization must use the Queue", async () => {
  const env = buildEnv({
    jobs: [
      {
        gene_symbol: "TP53",
        status: "queued",
        phase: "reconcile",
        keep_assets_json: JSON.stringify([{ symbol: "TP53", asset_sha256: "a".repeat(64) }]),
        legacy_assets_json: JSON.stringify([]),
        vision_ids_json: JSON.stringify(["anima-v1-1"]),
        requested_at: "2026-04-16T00:00:00.000Z",
        next_attempt_at: "2026-04-16T00:00:00.000Z",
      },
    ],
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/finalization/process", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: 25,
        finalize_if_drained: false,
      }),
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 410)
  assert.equal(payload?.ok, false)
  assert.equal(payload?.code, "QUEUE_PATH_REQUIRED")
  assert.match(String(payload?.error || ""), /Cloudflare Queue drain path/)
  const stored = env.gatewayDb.jobs.get("TP53")
  assert.equal(stored?.status, "queued")
  assert.equal(stored?.phase, "reconcile")
})

test("queue finalization consumer rejects the old per-symbol message path", async () => {
  const queue = buildFakeQueue()
  const env = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: new FakeIconoplasmDb({
      jobs: [
        {
          gene_symbol: "TP53",
          status: "queued",
          phase: "gene_rollups",
          keep_assets_json: JSON.stringify([{ symbol: "TP53", asset_sha256: "a".repeat(64) }]),
          legacy_assets_json: JSON.stringify([]),
          vision_ids_json: JSON.stringify(["anima-v1-1"]),
          requested_at: "2026-04-16T00:00:00.000Z",
          next_attempt_at: "2026-04-16T00:00:00.000Z",
        },
      ],
    }),
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue,
  }
  let acknowledged = false
  let retried = false

  const result = await handleIconoplasmSyncFinalizationQueue(
    {
      messages: [
        {
          body: {
            run_id: "sync-test",
            gene_symbol: "TP53",
            phase: "vote_summaries",
            attempt: 0,
          },
          ack() {
            acknowledged = true
          },
          retry() {
            retried = true
          },
        },
      ],
    },
    env,
    { waitUntil() {} },
  )

  assert.equal(result.ok, false)
  assert.equal(result.processed, 0)
  assert.equal(result.failed, 1)
  assert.equal(result.retrying, 1)
  assert.equal(acknowledged, false)
  assert.equal(retried, true)
  assert.equal(env.ICONOPLASM_DB.jobs.get("TP53")?.phase, "gene_rollups")
  assert.deepEqual(queue.sent, [])
})

test("queue drain message processes durable ledger batches without per-symbol phase fan-out", async () => {
  const queue = buildFakeQueue()
  const symbols = ["TP53", "BRCA1"]
  const env = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: new FakeIconoplasmDb({
      jobs: symbols.map((symbol) => ({
        gene_symbol: symbol,
        status: "queued",
        phase: "reconcile",
        keep_assets_json: JSON.stringify([{ symbol, asset_sha256: "a".repeat(64) }]),
        legacy_assets_json: JSON.stringify([]),
        vision_ids_json: JSON.stringify(["anima-v1-1"]),
        requested_at: "2026-04-16T00:00:00.000Z",
        next_attempt_at: "2026-04-16T00:00:00.000Z",
      })),
    }),
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue,
  }
  let acknowledged = false
  const retries = []

  const result = await handleIconoplasmSyncFinalizationQueue(
    {
      messages: [
        {
          body: {
            kind: "drain_finalization_ledger",
            run_id: "sync-test",
            symbols,
          },
          ack() {
            acknowledged = true
          },
          retry(options) {
            retries.push(options)
          },
        },
      ],
    },
    env,
    { waitUntil() {} },
  )

  assert.equal(result.ok, true)
  assert.equal(result.processed, 2)
  assert.equal(acknowledged, true)
  assert.deepEqual(retries, [])
  assert.deepEqual(
    symbols.map((symbol) => env.ICONOPLASM_DB.jobs.get(symbol)?.phase),
    ["vote_summaries", "vote_summaries"],
  )
  assert.deepEqual(queue.sent, [
    {
      kind: "drain_finalization_ledger",
      run_id: "sync-test",
      symbols,
      idempotency_key: "sync-test:drain:2:TP53:BRCA1",
    },
  ])
})

test("queue drain consumer does not retry a delivered drain message just because the governor grants fewer permits than processed jobs", async () => {
  const queue = buildFakeQueue()
  const symbols = ["TP53", "BRCA1", "EGFR"]
  const env = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: new FakeIconoplasmDb({
      jobs: symbols.map((symbol) => ({
        gene_symbol: symbol,
        status: "queued",
        phase: "reconcile",
        keep_assets_json: JSON.stringify([{ symbol, asset_sha256: "a".repeat(64) }]),
        legacy_assets_json: JSON.stringify([]),
        vision_ids_json: JSON.stringify(["anima-v1-1"]),
        requested_at: "2026-04-16T00:00:00.000Z",
        next_attempt_at: "2026-04-16T00:00:00.000Z",
      })),
    }),
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue,
    ICONOPLASM_SYNC_GOVERNOR: {
      idFromName(name) {
        return String(name || "")
      },
      get() {
        return {
          fetch: async (request) => {
            const url = new URL(request.url)
            if (url.pathname === "/permit") {
              return new Response(JSON.stringify({ ok: true, granted: 1 }), {
                headers: { "Content-Type": "application/json" },
              })
            }
            return new Response(JSON.stringify({ ok: true }), {
              headers: { "Content-Type": "application/json" },
            })
          },
        }
      },
    },
  }
  let acknowledged = false
  const retries = []

  const result = await handleIconoplasmSyncFinalizationQueue(
    {
      messages: [
        {
          body: {
            kind: "drain_finalization_ledger",
            run_id: "sync-test",
            symbols,
          },
          ack() {
            acknowledged = true
          },
          retry(options) {
            retries.push(options)
          },
        },
      ],
    },
    env,
    { waitUntil() {} },
  )

  assert.equal(result.ok, true)
  assert.equal(result.processed, 3)
  assert.equal(result.permit_granted, 1)
  assert.equal(result.granted, 1)
  assert.equal(acknowledged, true)
  assert.deepEqual(retries, [])
  assert.deepEqual(
    symbols.map((symbol) => env.ICONOPLASM_DB.jobs.get(symbol)?.phase),
    ["vote_summaries", "vote_summaries", "vote_summaries"],
  )
  assert.equal(queue.sent.length, 1)
})

test("queue finalization consumer fails loud when Queue path is disabled", async () => {
  const queue = buildFakeQueue()
  const env = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: new FakeIconoplasmDb({
      jobs: [
        {
          gene_symbol: "TP53",
          status: "queued",
          phase: "reconcile",
          keep_assets_json: JSON.stringify([{ symbol: "TP53", asset_sha256: "a".repeat(64) }]),
          legacy_assets_json: JSON.stringify([]),
          vision_ids_json: JSON.stringify(["anima-v1-1"]),
          requested_at: "2026-04-16T00:00:00.000Z",
          next_attempt_at: "2026-04-16T00:00:00.000Z",
        },
      ],
    }),
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue,
    ICONOPLASM_SYNC_FINALIZATION_QUEUE_DISABLED: "1",
  }
  let acknowledged = false
  let retried = false

  const result = await handleIconoplasmSyncFinalizationQueue(
    {
      messages: [
        {
          body: {
            run_id: "sync-test",
            gene_symbol: "TP53",
            phase: "reconcile",
            attempt: 0,
          },
          ack() {
            acknowledged = true
          },
          retry() {
            retried = true
          },
        },
      ],
    },
    env,
    { waitUntil() {} },
  )

  assert.equal(result.ok, false)
  assert.equal(result.skipped_disabled, 1)
  assert.equal(result.processed, 0)
  assert.equal(acknowledged, false)
  assert.equal(retried, true)
  assert.equal(env.ICONOPLASM_DB.jobs.get("TP53")?.phase, "reconcile")
  assert.deepEqual(queue.sent, [])
})
