import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_PORTRAIT_DELIVERY_POLICY,
  createPortraitDeliverySession,
  portraitSourceFromUrl,
} from "../shared/iconoplasm-portrait/portrait-delivery-core.js"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function readRepositoryFile(relativePath) {
  return readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8")
}

const registry = JSON.parse(readRepositoryFile("architecture-fences.json"))

test("architecture fence registry distributes every decision across independent guard categories", () => {
  assert.equal(registry.schema_version, 1)
  assert.ok(Array.isArray(registry.fences) && registry.fences.length > 0)

  const ids = new Set()
  for (const fence of registry.fences) {
    assert.match(fence.id, /^[A-Z][A-Z0-9]*-\d{3}$/)
    assert.equal(ids.has(fence.id), false, `Duplicate architecture fence id: ${fence.id}`)
    ids.add(fence.id)
    assert.ok(fence.decision?.trim(), `${fence.id} must state the protected decision`)
    assert.ok(fence.reason?.trim(), `${fence.id} must explain why the decision exists`)
    assert.ok(fence.change_control?.trim(), `${fence.id} must explain how it may be changed`)
    assert.ok(fence.runbook?.trim(), `${fence.id} must name its current-state runbook`)

    const categories = new Set(fence.markers.map((marker) => marker.category))
    const requiredCategories = [
      ...registry.baseline_marker_categories,
      ...(fence.additional_required_marker_categories || []),
    ]
    for (const category of requiredCategories) {
      assert.equal(
        categories.has(category),
        true,
        `${fence.id} is missing the ${category} enforcement category`,
      )
    }

    for (const marker of fence.markers) {
      assert.match(
        readRepositoryFile(marker.file),
        new RegExp(marker.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${fence.id} marker is missing from ${marker.file}`,
      )
    }
  }
})

// ARCHITECTURE FENCE [IPD-001]
// This test is deliberately independent of the website and extension adapter
// tests. A future edit that changes the defaults and updates a nearby test must
// still confront the cross-system cost and fallback contract here.
test("IPD-001 keeps Bunny primary on healthy tabs and canonical as the one-probe fallback", async () => {
  assert.deepEqual(DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator, {
    id: "bunny",
    origin: "https://iconoplasmportraits.b-cdn.net",
    enabled: true,
  })
  assert.equal(DEFAULT_PORTRAIT_DELIVERY_POLICY.decision_scope, "tab")
  assert.equal(DEFAULT_PORTRAIT_DELIVERY_POLICY.probe_timeout_ms, 2500)

  const canonicalUrl = "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp"
  let healthyProbeCount = 0
  const healthy = createPortraitDeliverySession({
    probe: async () => {
      healthyProbeCount += 1
      return true
    },
  })
  assert.equal(
    await healthy.ensure(canonicalUrl),
    "https://iconoplasmportraits.b-cdn.net/portraits/v1/aa/asset/medium.webp",
  )
  assert.equal(healthyProbeCount, 1)

  let blockedProbeCount = 0
  const blocked = createPortraitDeliverySession({
    probe: async () => {
      blockedProbeCount += 1
      return false
    },
  })
  assert.equal(await blocked.ensure(canonicalUrl), canonicalUrl)
  assert.equal(blockedProbeCount, 1)
  assert.deepEqual(blocked.state(), { state: "canonical", failed: ["accelerator"] })

  const disabledPolicy = {
    ...DEFAULT_PORTRAIT_DELIVERY_POLICY,
    accelerator: { ...DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator, enabled: false },
  }
  assert.equal(
    portraitSourceFromUrl(
      "https://iconoplasmportraits.b-cdn.net/portraits/v1/aa/asset/medium.webp",
      disabledPolicy,
    ),
    "accelerator",
    "Known accelerator URLs must remain rewritable after an explicit disable",
  )

  const workerSource = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  assert.doesNotMatch(workerSource, /ICONOPLASM_PORTRAIT_ACCELERATOR_ENABLED/)
  assert.match(workerSource, /enabled:\s*Boolean\(acceleratorOrigin\)/)

  const wranglerConfig = readRepositoryFile(
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  )
  assert.equal(
    wranglerConfig.match(
      /^ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL = "https:\/\/iconoplasmportraits\.b-cdn\.net"$/gm,
    )?.length,
    2,
    "Production and staging must both declare the direct Bunny delivery origin",
  )
  assert.match(
    readRepositoryFile("quartz/components/Head.tsx"),
    /<link rel="preconnect" href="https:\/\/iconoplasmportraits\.b-cdn\.net" \/>/,
  )
})

// ARCHITECTURE FENCE [IPD-004]
test("IPD-004 keeps ledger wakeups due-time aware", () => {
  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  assert.match(runtime, /queueDelaySecondsUntil\(drainResult\?\.next_attempt_at\)/)
  assert.match(runtime, /voteProjectionQueueRetryDelaySeconds/)
  assert.doesNotMatch(runtime, /Math\.min\(300, secondsUntilDue\)/)
})

// ARCHITECTURE FENCE [IPD-005]
test("IPD-005 uses the per-database wall and a verified cold archive", () => {
  const config = readRepositoryFile(
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  )
  const admin = readRepositoryFile("quartz/static/iconoplasm/admin.js")
  const archive = readRepositoryFile("workers/iconoplasm-publish-event-archive.js")
  const snapshotGenerator = readRepositoryFile(
    "scripts/generate-iconoplasm-observability-snapshot.mjs",
  )
  assert.match(
    config,
    /ICONOPLASM_D1_DATABASE_STORAGE_HARD_LIMIT_BYTES_DO_NOT_SET_CASUALLY = "500000000"/,
  )
  assert.match(config, /binding = "ICONOPLASM_AUDIT_DB"/)
  assert.match(admin, /d1Storage\.databaseLimitBytes/)
  assert.doesNotMatch(admin, /d1Storage\.databaseSizeBytes,\s*5 \* 1024 \* 1024 \* 1024/)
  assert.match(snapshotGenerator, /\/d1\/database\/\$\{databaseId\}/)
  assert.match(snapshotGenerator, /databaseMetadata\?\.file_size/)
  assert.match(snapshotGenerator, /"d1_control_plane"/)
  assert.match(archive, /Publish-event archive verification failed/)
  assert.match(archive, /DELETE FROM icono_publish_events/)
})

// ARCHITECTURE FENCE [IPD-006]
test("IPD-006 preserves durable per-gene batches and bounded Discord receipts", () => {
  const delivery = readRepositoryFile("workers/iconoplasm-request-notifications.js")
  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  const migration = readRepositoryFile(
    "migrations-iconoplasm/0058_request_notification_batches.sql",
  )
  assert.match(delivery, /DISCORD_MAX_ATTACHMENTS_PER_MESSAGE = 10/)
  assert.match(delivery, /DISCORD_ATTACHMENT_BATCH_MAX_BYTES/)
  assert.match(delivery, /request_batch_id/)
  assert.match(delivery, /request_batch_size/)
  assert.match(delivery, /full\.webp/)
  assert.match(runtime, /requestBatchId: batchId/)
  assert.match(runtime, /requestBatchSize: uniqueVisionIds\.length/)
  assert.match(migration, /legacy-request:/)
  assert.doesNotMatch(delivery, /setTimeout|setInterval/)
})
