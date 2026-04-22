import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeStatement {
  constructor(sql, existingAsset, bucket) {
    this.sql = String(sql || "")
    this.boundValues = []
    this.existingAsset = existingAsset
    this.bucket = bucket
  }

  bind(...values) {
    this.boundValues = values
    return this
  }

  async all() {
    if (this.sql.includes("FROM icono_portrait_assets pa") && this.sql.includes("JOIN incoming")) {
      const raw = this.boundValues[0]
      const incoming = JSON.parse(String(raw || "[]"))
      const match = incoming.find(
        (row) =>
          String(row?.symbol || "").toUpperCase() === this.existingAsset.symbol &&
          String(row?.asset_sha256 || "").toLowerCase() === this.existingAsset.asset_sha256,
      )
      return { results: match ? [this.existingAsset] : [] }
    }
    throw new Error(`Unexpected SQL in fake DB all(): ${this.sql}`)
  }

  async first() {
    return null
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_portrait_assets")) {
      return { success: true, meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_storage_audit_queue")) {
      return { success: true, meta: { changes: 1 } }
    }
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  constructor(existingAsset, bucket) {
    this.existingAsset = existingAsset
    this.bucket = bucket
  }

  prepare(sql) {
    return new FakeStatement(sql, this.existingAsset, this.bucket)
  }
}

class FakePortraitBucket {
  constructor() {
    this.headCalls = []
    this.putCalls = []
  }

  async head(key) {
    this.headCalls.push(key)
    return null
  }

  async put(key, bytes, options) {
    this.putCalls.push({ key, size: bytes.length, options })
    return { key }
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

function buildEnv() {
  const bucket = new FakePortraitBucket()
  const existingAsset = {
    symbol: "TTN",
    asset_sha256: "e985557951f4433f43320cc97997ab52fbbf9111f92a60e51173bf25a9ad34af",
    status: "approved",
    autopick_eligible: 1,
    is_stale: 0,
    r2_key_full: "portraits/v1/e9/e985557951f4433f43320cc97997ab52fbbf9111f92a60e51173bf25a9ad34af/full.webp",
    r2_key_medium: "portraits/v1/e9/e985557951f4433f43320cc97997ab52fbbf9111f92a60e51173bf25a9ad34af/medium.webp",
    r2_key_thumb: "portraits/v1/e9/e985557951f4433f43320cc97997ab52fbbf9111f92a60e51173bf25a9ad34af/thumb.webp",
    vision_id: "anima-v1-9044",
    emulsion_id: null,
    workflow_id: null,
    workflow_label: null,
    workflow_path: null,
    prompt_version: null,
    variant_slot: null,
    artist_tag: null,
    artist_name: null,
  }
  const gatewayDb = new FakeIconoplasmDb(existingAsset, bucket)
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
    ICONOPLASM_PORTRAITS: bucket,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
    bucket,
  }
  return bindOnlyAllowedGateway(env, gatewayEnv)
}

test("admin ingest verify_storage reuploads missing portrait blobs for existing asset rows", async () => {
  const env = buildEnv()
  const renditionBytes = Buffer.from("fake-webp-payload")
  const base64 = renditionBytes.toString("base64")
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry_run: false,
      defer_read_models: true,
      verify_storage: true,
      items: [
        {
          symbol: "TTN",
          asset_sha256: "e985557951f4433f43320cc97997ab52fbbf9111f92a60e51173bf25a9ad34af",
          vision_id: "anima-v1-9044",
          renditions: {
            full: { base64, width: 1024, height: 1024, bytes: renditionBytes.length },
            medium: { base64, width: 512, height: 512, bytes: renditionBytes.length },
            thumb: { base64, width: 256, height: 256, bytes: renditionBytes.length },
          },
        },
      ],
    }),
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env, {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.processed, 1)
  assert.equal(payload?.failed, 0)
  assert.equal(payload?.results?.[0]?.ok, true)
  assert.equal(payload?.results?.[0]?.status, "approved")
  assert.deepEqual(payload?.results?.[0]?.uploads, {
    full: "uploaded",
    medium: "uploaded",
    thumb: "uploaded",
  })
  assert.equal(env.bucket.headCalls.length, 3)
  assert.equal(env.bucket.putCalls.length, 3)
})

test("admin ingest force_upload overwrites existing portrait blobs without storage HEAD probes", async () => {
  const env = buildEnv()
  const renditionBytes = Buffer.from("fake-webp-payload")
  const base64 = renditionBytes.toString("base64")
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry_run: false,
      defer_read_models: true,
      force_upload: true,
      items: [
        {
          symbol: "TTN",
          asset_sha256: "e985557951f4433f43320cc97997ab52fbbf9111f92a60e51173bf25a9ad34af",
          vision_id: "anima-v1-9044",
          renditions: {
            full: { base64, width: 1024, height: 1024, bytes: renditionBytes.length },
            medium: { base64, width: 512, height: 512, bytes: renditionBytes.length },
            thumb: { base64, width: 256, height: 256, bytes: renditionBytes.length },
          },
        },
      ],
    }),
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env, {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.processed, 1)
  assert.equal(payload?.failed, 0)
  assert.equal(payload?.results?.[0]?.ok, true)
  assert.deepEqual(payload?.results?.[0]?.uploads, {
    full: "uploaded",
    medium: "uploaded",
    thumb: "uploaded",
  })
  assert.equal(env.bucket.headCalls.length, 0)
  assert.equal(env.bucket.putCalls.length, 3)
})
