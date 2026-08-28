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

// ARCHITECTURE FENCE [IPD-011]
test("IPD-011 keeps one exact-card blot authority across every public surface", () => {
  const fence = registry.fences.find((entry) => entry.id === "IPD-011")
  assert.ok(fence, "IPD-011 must remain registered")
  assert.equal(fence.title, "Every public canonical blot uses one published card artifact")
  assert.equal(fence.runbook, "docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md")

  for (const protectedTerm of [
    "canonical workstation-materialized blot",
    "KV_GALLERY_VERSION",
    "IconoplasmCardPublicationCoordinator",
    "authenticated Bunny GET/hash verification",
    "frozen migration evidence",
    "gene-page standard images and metadata",
    "structured data",
    "Massive gene-range pages remain text-only",
    "image-sitemap children",
    "public media",
    "matching immutable blot WebP",
    "does not require a blot-only KV publication",
    "Every derived cache and ETag includes the selected card version",
    "fails closed",
  ]) {
    assert.match(
      fence.decision,
      new RegExp(protectedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      `IPD-011 no longer protects ${protectedTerm}`,
    )
  }
  assert.match(fence.reason, /publishedPortraitRefs/)
  assert.match(fence.reason, /raw D1 portrait/)
  assert.match(fence.decision, /remains an indexable gene profile and sitemap\/archive member/)
  assert.match(fence.change_control, /raw icono_publish_state as a public image source/)
  assert.match(fence.change_control, /Worker-side blot rendering/)
  assert.match(fence.change_control, /page, sitemap, and public media agree/)
  assert.match(fence.change_control, /signed-in homepage and gene page visually match/)

  const markerFiles = new Set(fence.markers.map((marker) => marker.file))
  for (const protectedFile of [
    "AGENTS.md",
    "docs/ICONOPLASM_HOME_PERFORMANCE.md",
    "docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md",
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
    "workers/iconoplasm-gene-discovery.js",
    "workers/iconoplasm.account-gallery-window.test.js",
    "scripts/architecture-fences.test.js",
  ]) {
    assert.equal(markerFiles.has(protectedFile), true, `IPD-011 no longer guards ${protectedFile}`)
  }

  const instructions = readRepositoryFile("AGENTS.md")
  assert.match(instructions, /canonical public machine image is the Iconoplasm gene blot/)
  assert.match(instructions, /source portrait remains available as subordinate/)
  assert.match(instructions, /On any healthy network/)

  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  const siteDetailStart = runtime.indexOf("async function handleSiteGeneDetail")
  const siteDetailEnd = runtime.indexOf("\nasync function ", siteDetailStart + 1)
  assert.ok(siteDetailStart >= 0 && siteDetailEnd > siteDetailStart)
  const siteDetail = runtime.slice(siteDetailStart, siteDetailEnd)
  assert.match(siteDetail, /readPublishedGeneCardPortraitProjection/)
  assert.match(siteDetail, /portraitOverride/)
  assert.match(siteDetail, /etagFor\(\{ card_snapshot_version:/)
  assert.doesNotMatch(siteDetail, /await portraitState\(env/)

  const publicMediaStart = runtime.indexOf("async function handlePublicMedia")
  const publicMediaEnd = runtime.indexOf("\nasync function ", publicMediaStart + 1)
  assert.ok(publicMediaStart >= 0 && publicMediaEnd > publicMediaStart)
  const publicMedia = runtime.slice(publicMediaStart, publicMediaEnd)
  assert.match(publicMedia, /readPublishedGeneCardPortraitProjection/)
  assert.match(publicMedia, /publicGeneBlotMediaEnvelope/)
  assert.doesNotMatch(publicMedia, /await portraitState\(env/)
})

// ARCHITECTURE FENCE [IPD-003]
test("IPD-003 keeps discovery eligibility on the exact published card", () => {
  const fence = registry.fences.find((entry) => entry.id === "IPD-003")
  assert.ok(fence, "IPD-003 must remain registered")
  assert.match(
    fence.decision,
    /canonical public machine image is the Iconoplasm gene blot, not its source portrait/,
  )
  assert.match(
    fence.decision,
    /exact versioned published card selected by KV_GALLERY_VERSION owns every input from which the renderer fingerprint and immutable object key are deterministically derived/,
  )
  assert.match(
    fence.decision,
    /valid complete card without a ready matching blot remains indexable/,
  )
  assert.match(fence.decision, /linked from its frozen text-only archive range/)
  assert.match(fence.decision, /listed in its gene-sitemap shard/)
  assert.match(fence.decision, /only its image-specific projections are absent/)
  assert.match(
    fence.decision,
    /missing requested card or invalid selected artifact[\s\S]*uncached 503/,
  )
  assert.match(fence.decision, /Only a workstation may render the 768x1024 WebP/)
  assert.match(fence.decision, /bounded POST resolver of at most 50 identifiers/)
  assert.match(fence.decision, /returns only a deterministically resolvable gene_blot/)
  assert.match(
    fence.decision,
    /temporary \/portrait\/\{SYMBOL\}\.webp alias was retired after a live exact-card audit proved ready blots for all 19,023 published genes and regional delivery checks passed/,
  )
  assert.match(fence.change_control, /Do not promote a raw portrait as the canonical public image/)
  assert.match(fence.change_control, /publish a full-corpus image manifest/)
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
  assert.equal(
    healthy.plan(canonicalUrl).hedgeDelayMs,
    350,
    "A successful CDN never triggers zero-delay duplicate loads",
  )

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
  assert.equal(
    blocked.plan(canonicalUrl).hedgeDelayMs,
    null,
    "Known blocked delivery has no periodic probe or automatic race",
  )

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
test("IPD-001 late image results cannot undo a newer source decision", () => {
  const session = createPortraitDeliverySession()
  const canonical = "https://iconoplasm.brinedew.bio/portraits/v1/a.webp"
  const first = session.plan(canonical)
  const concurrent = session.plan(canonical)
  session.reportSuccess(first.fallbackUrl, first.decisionId)
  assert.equal(
    session.reportSuccess(concurrent.primaryUrl, concurrent.decisionId).ignored,
    "superseded_decision",
  )
  assert.equal(session.state().state, "canonical")
  const later = session.plan(canonical)
  assert.equal(later.hedgeDelayMs, null)
  session.reportSuccess(later.fallbackUrl, later.decisionId)
  assert.equal(session.state().state, "accelerator")
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
  assert.match(apiSource, /ICONOPLASM_CONTEXT_INVALIDATED/)
  assert.match(contentSource, /sendMessage: extensionRuntime\.sendMessage/)
  assert.match(contentSource, /extensionRuntime\.checkConnected\(\)/)
  assert.match(contentSource, /readingSession\.dispose\(\)/)
  assert.match(contentSource, /portraitCache\.dispose\(\)/)
  assert.doesNotMatch(
    portraitSource,
    /runtime\.sendMessage/,
    "Portrait requests must share terminal update-disconnection handling with metadata",
  )
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

// ARCHITECTURE FENCE [IPD-008]
test("IPD-008 forbids public KV discovery scans and preserves one bounded portrait lane", () => {
  const fence = registry.fences.find((entry) => entry.id === "IPD-008")
  assert.ok(fence, "IPD-008 must remain registered")
  assert.match(fence.decision, /Normal public recognition reads perform zero KV list operations/)
  assert.match(fence.decision, /GET one exact current pointer and its exact immutable pair/)
  assert.match(fence.change_control, /missing-pointer legacy discovery is migration-only/)
  assert.match(
    fence.change_control,
    /locator must remain a direct projection of the named card payload[\s\S]*must never acquire an independent selection or publication pointer/,
  )
  assert.match(
    fence.change_control,
    /never run on Data Saver or 2G, exceed ten symbols or two workers/,
  )

  const policyTests = readRepositoryFile("workers/iconoplasm-publication-alias-policy.test.js")
  assert.match(policyTests, /coherent public reader is O\(1\) at max history/)
  assert.match(policyTests, /assert\.equal\(kv\.lists\.length, 0\)/)

  const routeSource = readRepositoryFile("workers/iconoplasm-route-contract.js")
  assert.match(routeSource, /rateLimit:\s*rateLimit\("gene_detail", 120\)/)
  assert.match(routeSource, /rateLimit:\s*rateLimit\("portrait_locator", 120\)/)
})

// ARCHITECTURE FENCE [IPD-001] + [IPD-008] + [IPD-011]
test("Bunny fences protect canonical authority without forbidding immutable CDN caches", () => {
  const delivery = registry.fences.find((entry) => entry.id === "IPD-001")
  const readPlane = registry.fences.find((entry) => entry.id === "IPD-008")
  const canon = registry.fences.find((entry) => entry.id === "IPD-011")
  assert.match(delivery.decision, /Country is not connectivity/)
  assert.match(
    delivery.decision,
    /R2 enablement or a Cloudflare paid upgrade is not a prerequisite/,
  )
  assert.match(
    delivery.change_control,
    /private or mutable APIs must never enter that public cache/,
  )
  assert.match(delivery.change_control, /actual CDN HITs, cold-miss and fallback costs/)
  assert.match(
    readPlane.change_control,
    /per-gene Worker transport is an implementation, not a fence/,
  )
  assert.match(canon.decision, /Byte-equivalent CDN caches are allowed/)
  assert.match(
    canon.decision,
    /Independent immutable detail and locator projections share the named card authority/,
  )
  const instructions = readRepositoryFile("AGENTS.md")
  assert.doesNotMatch(instructions, /healthy cold read is one\s+bounded prefix list/)
  assert.doesNotMatch(instructions, /including the exact-pair\s+fast path; never disable cleanup/)
  assert.match(instructions, /Write competing\s+hypotheses and disproof tests/)
  assert.doesNotMatch(instructions, /project almost certainly did not change/)
  for (const fence of registry.fences) {
    assert.doesNotMatch(fence.decision, /non-Vietnam/, "A country is not a connectivity test")
  }
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
  const fence = registry.fences.find((entry) => entry.id === "IPD-009")
  assert.ok(fence, "IPD-009 must remain registered")
  assert.match(
    fence.decision,
    /route index and discovery\/catalog rows establish identity and membership only/,
  )
  assert.match(
    fence.decision,
    /requested exact card from the artifact selected by KV_GALLERY_VERSION[\s\S]*sole public portrait authority/,
  )
  assert.match(
    fence.decision,
    /complete detail response ETag and HTML cache key include the selected card version/,
  )
  assert.match(
    fence.decision,
    /valid exact card without a published portrait produces a noindex gene page/,
  )
  assert.match(
    fence.decision,
    /missing requested card or missing or invalid selected artifact produces an uncached 503/,
  )

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
  assert.match(
    lifecycle,
    /detail response[\s\S]*card shard selected by `KV_GALLERY_VERSION`[\s\S]*ETag[\s\S]*card version/i,
  )

  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  assert.match(runtime, /ARCHITECTURE FENCE \[IPD-009\]/)
  assert.match(runtime, /FROM icono_published_gene_routes/)
  assert.match(runtime, /source: "published_gene_route_d1"/)
  assert.match(runtime, /shared version barrier is the sole published source-portrait authority/)
  assert.match(runtime, /matching workstation-rendered blot reference/)
  assert.match(runtime, /D1 route index and discovery\/catalog rows are identity and membership/)
  assert.match(runtime, /old exact card artifact remains coherently live/)
  assert.doesNotMatch(runtime, /versioned KV card catalog is a coarse browsing snapshot/)
  assert.doesNotMatch(runtime, /roll the D1 canonical portrait back/)
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
