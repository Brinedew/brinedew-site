import assert from "node:assert/strict"
import test from "node:test"

import { viaStatefulWorker } from "./test-helpers/via-stateful-worker.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-888 (30 Sep 2026): ADO's gene page and the archive grid showed different
// winners for three days. The vote authority (per-gene Durable Object) held one
// upvote for an older candidate; D1 never received that vote because its
// delivery was refused by the old fixed mutation lanes (B-897). The workstation
// reconcile then re-elected from D1's zero-vote copy and promoted the newest
// upload, so the catalog and the per-gene publication disagreed.
//
// Failure modes, written before the fix:
// 1. A canonical election outside the vote authority ranks with D1's lagging
//    vote copy and picks a winner the authority would not.
// 2. When the authority cannot be read, the election falls back to D1 and
//    re-creates the split instead of deferring to the durable projection job.

const OLDER_VOTED = "c".repeat(64)
const NEWER_UNVOTED = "f".repeat(64)
const LEGACY = "a".repeat(64)

class Statement {
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
    if (this.sql.includes("CROSS JOIN icono_portrait_assets")) {
      return {
        results: this.db.assets.filter((row) =>
          JSON.parse(this.args[0]).some(
            ([symbol, sha]) => row.gene_symbol === symbol && row.asset_sha256 === sha,
          ),
        ),
      }
    }
    if (this.sql.includes("FROM icono_portrait_assets pa") && this.sql.includes("pa.created_at")) {
      return { results: this.db.assets }
    }
    if (this.sql.includes("FROM icono_publish_state")) {
      return {
        results: [{ gene_symbol: "ADO", current_asset_sha256: LEGACY, admin_override: 0 }],
      }
    }
    if (this.sql.includes("SELECT DISTINCT pa.emulsion_id")) return { results: [] }
    return { results: [] }
  }
  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    if (this.sql.includes("FROM icono_publish_state")) {
      return { current_asset_sha256: null, admin_override: 0 }
    }
    // The legacy D1 election: D1's copy of the votes is all zero, so it would
    // rank the newest upload first.
    if (this.sql.includes("LEFT JOIN icono_vote_asset_summary")) {
      return { asset_sha256: NEWER_UNVOTED, image_upvotes: 0, image_downvotes: 0, image_score: 0 }
    }
    return null
  }
  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    return { success: true, meta: { changes: 1 } }
  }
}

class FakeDb {
  constructor(assets) {
    this.calls = []
    this.assets = assets
  }
  prepare(sql) {
    return new Statement(this, sql)
  }
  async batch(statements) {
    const results = []
    for (const statement of statements) results.push(await statement.run())
    return results
  }
}

function coordinatorNamespace({ fail = false } = {}) {
  const requests = []
  return {
    requests,
    idFromName: (name) => name,
    get: () => ({
      async fetch(request) {
        const path = new URL(request.url).pathname
        requests.push(path)
        if (path === "/state") {
          if (fail) return Response.json({ error: "coordinator down" }, { status: 503 })
          return Response.json({
            ok: true,
            asset_summaries: [
              { asset_sha256: OLDER_VOTED, upvotes: 1, downvotes: 0, score: 1, vote_count: 1 },
              { asset_sha256: NEWER_UNVOTED, upvotes: 0, downvotes: 0, score: 0, vote_count: 0 },
            ],
          })
        }
        return Response.json({ ok: true })
      },
    }),
  }
}

function reconcileEnv(coordinators, { scheduled = [] } = {}) {
  const db = new FakeDb([
    {
      gene_symbol: "ADO",
      asset_sha256: OLDER_VOTED,
      status: "draft",
      autopick_eligible: 1,
      created_at: "2026-09-27 11:00:17",
    },
    {
      gene_symbol: "ADO",
      asset_sha256: NEWER_UNVOTED,
      status: "draft",
      autopick_eligible: 1,
      created_at: "2026-09-27 11:00:26",
    },
    {
      gene_symbol: "ADO",
      asset_sha256: LEGACY,
      status: "rejected",
      autopick_eligible: 1,
      is_stale: 0,
      is_legacy: 0,
      created_at: "2026-03-01 00:00:00",
    },
  ])
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_COORDINATORS: coordinators,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: {
      async send(message) {
        scheduled.push(message)
      },
    },
  }
  const env = { ...gatewayEnv, ICONOPLASM_DB: null, db }
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch: (request) =>
      handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        gatewayEnv,
        { waitUntil() {} },
      ),
  }
  return env
}

function reconcile(env) {
  return viaStatefulWorker(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/reconcile", {
      method: "POST",
      headers: { Authorization: "Bearer secret-admin-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        defer_read_models: true,
        scope_symbols: ["ADO"],
        keep: [],
        legacy: [],
        unpublish_missing: true,
      }),
    }),
    env,
    {},
  )
}

function promotedAssets(db) {
  return db.calls
    .filter((call) => call.method === "run" && call.sql.includes("INSERT INTO icono_publish_state"))
    .map((call) => call.args[1])
}

test("reconcile elects the winner from the vote authority, not D1's lagging vote copy (B-888)", async () => {
  const coordinators = coordinatorNamespace()
  const env = reconcileEnv(coordinators)
  const response = await reconcile(env)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  assert.equal(coordinators.requests.includes("/state"), true)
  assert.deepEqual(promotedAssets(env.db), [OLDER_VOTED])
})

test("an unreadable vote authority defers the election instead of electing from D1 (B-888)", async () => {
  const scheduled = []
  const env = reconcileEnv(coordinatorNamespace({ fail: true }), { scheduled })
  const response = await reconcile(env)
  assert.equal(response.status, 200)
  assert.deepEqual(promotedAssets(env.db), [])
  assert.equal(
    env.db.calls.some((call) => /INSERT INTO icono_vote_projection_refresh_jobs/.test(call.sql)),
    true,
    "the gene was not handed to the durable vote projection job",
  )
})
