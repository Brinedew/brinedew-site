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
  assert.equal(DEFAULT_PORTRAIT_DELIVERY_POLICY.fallback_hedge_delay_ms, 350)

  const canonicalUrl = "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp"
  let healthyProbeCount = 0
  const healthy = createPortraitDeliverySession({
    probe: async () => {
      healthyProbeCount += 1
      return true
    },
  })
  assert.deepEqual(
    {
      primarySource: healthy.plan(canonicalUrl).primarySource,
      fallbackSource: healthy.plan(canonicalUrl).fallbackSource,
      hedgeDelayMs: healthy.plan(canonicalUrl).hedgeDelayMs,
    },
    { primarySource: "accelerator", fallbackSource: "canonical", hedgeDelayMs: 350 },
  )
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

// ARCHITECTURE FENCE [IPD-008]
test("IPD-008 keeps foreground hover on immutable cancellable reads and native portrait loading", () => {
  const contentSource = readRepositoryFile("iconoplasm-extension/content.js")
  const apiSource = readRepositoryFile("iconoplasm-extension/content-api.js")
  const portraitSource = readRepositoryFile("iconoplasm-extension/content-portrait-cache.js")
  const routeSource = readRepositoryFile("workers/iconoplasm-route-contract.js")
  const runtimeSource = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )

  assert.match(contentSource, /\/api\/public\/v1\/card-snapshots\//)
  assert.match(contentSource, /priority:\s*"foreground"/)
  assert.match(apiSource, /CANCEL_ICONOPLASM_API_FETCH/)
  assert.match(portraitSource, /GET_PORTRAIT_SOURCE_PLAN/)
  assert.match(portraitSource, /new ImageCtor\(\)/)
  assert.match(portraitSource, /Promise\.any\(\[primaryPromise, fallbackPromise\]\)/)
  assert.match(routeSource, /public_card_snapshot_gene/)
  assert.match(runtimeSource, /max-age=31536000, immutable/)
  assert.doesNotMatch(
    contentSource,
    /if \(geneDetailStore\.promiseCache\.has\(normalizedSymbol\)\)/,
    "Foreground hover must not inherit speculative batch tail latency",
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

// ARCHITECTURE FENCE [IPD-009]
test("IPD-009 keeps the cold path and deployment topology explicit", () => {
  const topology = JSON.parse(readRepositoryFile("cloudflare/deployment-topology.json"))
  assert.equal(topology.architectureFence, "IPD-009")
  assert.equal(topology.stateOwner.cloudflareScript, "geneguessr-api")
  assert.equal(topology.staticFirst.dynamicInvocationCount, 1)
  assert.equal(topology.staticFirst.staticAssetsBypassWorker, true)
  assert.equal(topology.stateOwner.publicProxyAllowed, false)

  const lifecycle = readRepositoryFile("docs/ICONOPLASM_REQUEST_LIFECYCLE.md")
  assert.match(lifecycle, /HTML cache before parsing JSON or rendering/i)
  assert.match(lifecycle, /Login can enable private action\s+islands/i)
  assert.match(lifecycle, /icono_published_gene_routes/)
  assert.match(lifecycle, /detail response[\s\S]*ETag[\s\S]*vote-fresh/i)

  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  assert.match(runtime, /ARCHITECTURE FENCE \[IPD-009\]/)
  assert.match(runtime, /FROM icono_published_gene_routes/)
  assert.match(runtime, /source: "published_gene_route_d1"/)
  assert.doesNotMatch(runtime, /iconoplasm-web/)

  const routeMigration = readRepositoryFile("migrations-iconoplasm/0059_published_gene_routes.sql")
  assert.match(routeMigration, /gene_symbol TEXT PRIMARY KEY NOT NULL/)
  assert.doesNotMatch(
    routeMigration.match(
      /CREATE TABLE IF NOT EXISTS icono_published_gene_routes[\s\S]*?WITHOUT ROWID;/,
    )?.[0] || "",
    /asset_sha256|portrait|vote/i,
  )
})

// ARCHITECTURE FENCE [IPD-006]
test("IPD-006 preserves durable publication groups and bounded Discord receipts", () => {
  const delivery = readRepositoryFile("workers/iconoplasm-request-notifications.js")
  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  const migration = readRepositoryFile(
    "migrations-iconoplasm/0062_fulfillment_publication_notification_groups.sql",
  )
  assert.match(delivery, /DISCORD_MAX_ATTACHMENTS_PER_MESSAGE = 10/)
  assert.match(delivery, /DISCORD_ATTACHMENT_BATCH_MAX_BYTES/)
  assert.match(delivery, /fulfillment_publication_id/)
  assert.match(delivery, /fulfillment_group_size/)
  assert.match(delivery, /full\.webp/)
  assert.match(runtime, /publicationId: p\?\.publication_id/)
  assert.match(runtime, /fulfillment_publication_id = \?/)
  assert.match(runtime, /fulfillment_group_size = \?/)
  assert.match(migration, /legacy-request:/)
  assert.doesNotMatch(delivery, /setTimeout|setInterval/)
})
