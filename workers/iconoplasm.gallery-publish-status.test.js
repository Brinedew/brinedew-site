import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// Shared live gallery version across both tests. currentGalleryVersionBarrier has
// a 5s isolate-local memory cache that is not keyed by env, so both tests must
// agree on the live version or the cache from the first test would bleed into the
// second. They differ only on watermark/changes, which is what we assert.
const LIVE_VERSION = "ccv1-LIVEEEEEEEEEEEEEEEEEEEEEEEEEE"

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
  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    if (
      this.sql.includes("FROM icono_publish_events") &&
      this.sql.includes("changed_symbol_count")
    ) {
      return this.db.changesSummary
    }
    return null
  }
  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, args: this.args })
    return { results: [] }
  }
  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    return { success: true }
  }
}

class FakeIconoplasmDb {
  constructor({ changesSummary } = {}) {
    this.calls = []
    this.changesSummary = changesSummary || {
      changed_symbol_count: 0,
      event_count: 0,
      min_created_at: null,
      max_created_at: null,
    }
  }
  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

class FakeKV {
  constructor(seed = {}) {
    this.store = new Map(Object.entries(seed))
  }
  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null
  }
  async put(key, value) {
    this.store.set(key, value)
  }
}

function buildEnv({ changesSummary, kvSeed } = {}) {
  const gatewayDb = new FakeIconoplasmDb({ changesSummary })
  const kv = new FakeKV(kvSeed)
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
    KV: kv,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    KV: null,
    gatewayDb,
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          gatewayEnv,
          { waitUntil() {} },
        )
      },
    },
  }
  return env
}

async function getStatus(env) {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/gallery/publish-status", {
        method: "GET",
        headers: { Authorization: "Bearer secret-admin-token" },
      }),
      env,
      {},
    )
  return { response, payload: await response.json() }
}

test("publish-status reports the gallery stale when there is no watermark yet", async () => {
  const env = buildEnv({
    kvSeed: {
      "iconoplasm:gallery-version": JSON.stringify({ current: LIVE_VERSION }),
    },
    changesSummary: {
      changed_symbol_count: 3,
      event_count: 7,
      min_created_at: "2026-06-01 00:00:00",
      max_created_at: "2026-06-05 12:00:00",
    },
  })

  const { response, payload } = await getStatus(env)

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.has_watermark, false)
  assert.equal(payload.live_gallery_version, LIVE_VERSION)
  assert.equal(payload.published_artifact_version, null)
  assert.equal(payload.live_matches_published, false)
  assert.equal(payload.changes_since_publish, 3)
  assert.equal(payload.is_stale, true)

  // No whole-catalog scan: the only DB call is the single changes summary query.
  const dbReads = env.gatewayDb.calls.filter((call) => call.method === "first")
  assert.equal(dbReads.length, 1)
  assert.match(dbReads[0].sql, /FROM icono_publish_events/)
})

test("publish-status reports fresh when watermark matches live and no changes remain", async () => {
  const env = buildEnv({
    kvSeed: {
      "iconoplasm:gallery-version": JSON.stringify({ current: LIVE_VERSION }),
      "iconoplasm:card-catalog-publish-watermark:v1": JSON.stringify({
        schema: "iconoplasm.cardCatalogPublishWatermark.v1",
        artifact_version: LIVE_VERSION,
        watermark_event_at: "2026-06-05 12:00:00",
        published_at: "2026-06-05T12:00:01.000Z",
      }),
    },
    changesSummary: {
      changed_symbol_count: 0,
      event_count: 0,
      min_created_at: null,
      max_created_at: null,
    },
  })

  const { response, payload } = await getStatus(env)

  assert.equal(response.status, 200)
  assert.equal(payload.has_watermark, true)
  assert.equal(payload.published_artifact_version, LIVE_VERSION)
  assert.equal(payload.live_matches_published, true)
  assert.equal(payload.changes_since_publish, 0)
  assert.equal(payload.is_stale, false)
})
