import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_PORTRAIT_DELIVERY_POLICY,
  createPortraitDeliverySession,
  portraitSourceFromUrl,
} from "../shared/iconoplasm-portrait/portrait-delivery-core.js"
import {
  D1_BACKGROUND_WRITE_CEILING,
  D1_USER_ACTION_DAILY_WRITE_CEILING,
  FREE_D1_DAILY_LIMITS,
} from "../shared/iconoplasm-d1-budget-policy.js"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function readRepositoryFile(relativePath) {
  return readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8")
}

const registry = JSON.parse(readRepositoryFile("architecture-fences.json"))

test("IPD-001 portrait module URLs follow actual bytes through the immutable import chain", () => {
  for (const [module, consumers] of [
    ["generated/portrait-delivery-core.js", ["portrait-delivery.js"]],
    ["portrait-delivery.js", ["app.js", "gene-card-thumb-delivery.js"]],
  ]) {
    const bytes = readFileSync(path.join(REPOSITORY_ROOT, "quartz/static/iconoplasm", module))
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16)
    for (const consumer of consumers) {
      assert.ok(
        readRepositoryFile(`quartz/static/iconoplasm/${consumer}`).includes(
          `./${module}?v=${digest}`,
        ),
        `${consumer} must load the current ${module}, not a permanently cached dated import`,
      )
    }
  }
})

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
  assert.equal(fence.title, "Every public canonical blot uses the one stable gene object")
  assert.equal(fence.runbook, "docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md")

  assert.match(fence.decision, /stable gene object owns the public character/i)
  assert.match(fence.decision, /canonical blot/i)
  assert.match(fence.decision, /Every public surface resolves that same identity/i)

  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  const publicMediaStart = runtime.indexOf("async function handlePublicMedia")
  const publicMediaEnd = runtime.indexOf("\nasync function ", publicMediaStart + 1)
  assert.ok(publicMediaStart >= 0 && publicMediaEnd > publicMediaStart)
  const publicMedia = runtime.slice(publicMediaStart, publicMediaEnd)
  assert.match(publicMedia, /readStableGeneObjectProjection/)
  assert.doesNotMatch(publicMedia, /readPublishedGeneCardPortraitProjection/)
  assert.match(publicMedia, /publicGeneBlotMediaEnvelope/)
  assert.doesNotMatch(publicMedia, /await portraitState\(env/)

  const resolverStart = runtime.indexOf("async function handlePublicImageResolve")
  const resolverEnd = runtime.indexOf("\nasync function ", resolverStart + 1)
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart)
  const resolver = runtime.slice(resolverStart, resolverEnd)
  assert.match(resolver, /readStableGeneObjectProjection/)
  assert.doesNotMatch(resolver, /readPublishedCardCatalogArtifact|currentMobileCardSnapshotVersion/)
})

// ARCHITECTURE FENCE [IPD-003]
test("IPD-003 keeps discovery eligibility on the exact published card", () => {
  const fence = registry.fences.find((entry) => entry.id === "IPD-003")
  assert.ok(fence, "IPD-003 must remain registered")
  assert.match(fence.decision, /One stable gene object defines each gene's public identity/i)
  assert.match(fence.decision, /canonical blot/i)
  assert.match(fence.decision, /fails closed/i)
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
test("IPD-008 keeps foreground hover on the stable CDN gene object and cross-site portrait reuse", () => {
  const contentSource = readRepositoryFile("iconoplasm-extension/content.js")
  const apiSource = readRepositoryFile("iconoplasm-extension/content-api.js")
  const portraitSource = readRepositoryFile("iconoplasm-extension/content-portrait-cache.js")
  const background = readRepositoryFile("iconoplasm-extension/service-worker.js")
  const routeSource = readRepositoryFile("workers/iconoplasm-route-contract.js")
  const runtimeSource = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )

  // B-898 stage 1: hover detail is the one stable object per gene on the free
  // CDN. The metered card-snapshots routes remain the website's fallback only;
  // the extension must never reference them again.
  assert.doesNotMatch(contentSource, /\/api\/public\/v1\/card-snapshots\//)
  assert.match(background, /https:\/\/iconoplasmportraits\.b-cdn\.net\/genes\/v3\//)
  assert.doesNotMatch(background, /card-snapshots|card-content\/v1|delivery-index/)
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
  assert.match(portraitSource, /GET_PORTRAIT_DATA_URL/)
  assert.doesNotMatch(portraitSource, /GET_PORTRAIT_SOURCE_PLAN/)
  assert.match(background, /portraitByteCache\.get/)
  assert.doesNotMatch(
    contentSource,
    /storageApi: chrome\.storage\.local|\.hydratePersistentCache\(/,
    "pages must not clone the whole saved detail or locator collection",
  )
  assert.match(background, /loadPlannedSource/)
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
  assert.match(fence.decision, /read the two published objects/i)
  assert.match(fence.decision, /do not probe private identity/i)
  assert.match(fence.change_control, /one published authority/i)

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
  assert.match(delivery.decision, /Bunny accelerates the two published Iconoplasm objects/i)
  assert.match(delivery.decision, /First-party identity remains canonical/i)
  assert.match(readPlane.decision, /read the two published objects/i)
  assert.match(canon.decision, /same identity/i)
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
  const lanes = readRepositoryFile("workers/lib/iconoplasm-mutation-lane-reservations.js")
  assert.match(runtime, /queueDelaySecondsUntil\(drainResult\?\.next_attempt_at\)/)
  assert.doesNotMatch(runtime, /Math\.min\(300, secondsUntilDue\)/)
  assert.doesNotMatch(runtime, /icono_gene_discoveries/)
  // B-1067: a reader's action never reserves in the referee; only background work does.
  assert.doesNotMatch(runtime, /lane: "user_action"/)
  assert.match(runtime, /lane: "finalization_recovery"/)
  assert.match(runtime, /lane: "laptop_delivery"/)
  // B-897: admission is measured provider pressure, not fixed lane totals.
  // B-1036: the lanes take their numbers from the one budget policy, and a reader
  // always keeps a band above the point where operator work stops.
  // B-1026 (10-09): those numbers are shares of Cloudflare's meter, not a private slice.
  assert.match(lanes, /MUTATION_BACKGROUND_CEILING = D1_BACKGROUND_WRITE_CEILING/)
  assert.match(lanes, /MUTATION_USER_ACTION_CEILING = D1_USER_ACTION_DAILY_WRITE_CEILING/)
  assert.doesNotMatch(lanes, /_CEILING = d/)
  assert.ok(D1_USER_ACTION_DAILY_WRITE_CEILING > D1_BACKGROUND_WRITE_CEILING)
  // B-1026: a person's action is critical and runs to Cloudflare's own wall.
  assert.equal(D1_USER_ACTION_DAILY_WRITE_CEILING, FREE_D1_DAILY_LIMITS.writes)
  assert.match(lanes, /MUTATION_ANALYTICS_LAG_MS = 15 \* 60_000/)
  assert.doesNotMatch(lanes, /daily_mutation_lane_usage \(/)
  assert.doesNotMatch(runtime, /MUTATION_PROVIDER_OBSERVATION_(MISSING|STALE|MALFORMED)/)
  assert.doesNotMatch(
    lanes,
    /previous\.day === day\s*&&/,
    "an uncertain exact command must replay its original reservation after UTC rollover",
  )
})

// B-1037: on 2026-10-06 an 870-gene Image Lab batch died four times on a private 2,500
// request cap in the replica cost ledger that never read the tier table. Every daily
// allowance now lives in shared/iconoplasm-d1-budget-policy.js, and this fails when a
// new one is written as a number anywhere else, so the next bypass is caught here
// instead of by a dead run.
test("B-1037 every daily limit is a number only in the one budget policy", () => {
  // Product rules priced in their own units, not copies of a provider meter: each
  // states its cost against the policy's free-plan numbers in its own comment.
  const productRules = new Map([
    ["workers/iconoplasm/votes/vote-guards.js", "VOTE_DAILY_LIMIT"],
    ["workers/iconoplasm/caretaker/taggerizer.js", "TAGGERIZER_DAILY_LIMIT"],
  ])
  const named =
    /(?:\b(?:const|let|var)\s+|\$)([A-Za-z_]\w*)\s*=\s*(?:Object\.freeze\(\s*)?\(?\s*[1-9]/g
  const property = /\b(\w*daily\w*limit\w*|\w*limit\w*daily\w*)\)?\s*(?::|\|\|)\s*[1-9]/gi
  const found = []
  for (const root of ["workers", "shared", "scripts", "quartz/static"]) {
    for (const entry of readdirSync(path.join(REPOSITORY_ROOT, root), { recursive: true })) {
      const file = `${root}/${String(entry).replaceAll("\\", "/")}`
      if (!/\.(m?js|ps1)$/.test(file)) continue
      if (/node_modules\/|\.test\.|\.e2e\.|\/generated\/|test-helpers\//.test(file)) continue
      if (file === "shared/iconoplasm-d1-budget-policy.js") continue
      const source = readRepositoryFile(file).replace(/^\s*(?:\/\/|\*|#).*$/gm, "")
      const lineOf = (index) => source.slice(0, index).split("\n").length
      for (const match of source.matchAll(named)) {
        const name = match[1].toUpperCase()
        if (!/DAILY|PER_?DAY/.test(name) || !/LIMIT|CAP|CEILING|ALLOWANCE|BUDGET|MAX/.test(name)) {
          continue
        }
        if (productRules.get(file) === match[1]) continue
        found.push(`${file}:${lineOf(match.index)} ${match[1]}`)
      }
      for (const match of source.matchAll(property)) {
        found.push(`${file}:${lineOf(match.index)} ${match[1]}`)
      }
    }
  }
  assert.deepEqual(
    found,
    [],
    "import these from shared/iconoplasm-d1-budget-policy.js instead of restating them",
  )
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

// ARCHITECTURE FENCE [IPD-012]
test("IPD-012 keeps one manifestation command authority", () => {
  const fence = registry.fences.find((entry) => entry.id === "IPD-012")
  assert.ok(fence, "IPD-012 must remain registered")
  assert.match(fence.decision, /Website is the sole command authority/)
  assert.match(fence.decision, /plain-text objects in a private storage zone/)
  assert.match(fence.decision, /workstation is a version-bound replica/)

  const config = readRepositoryFile(
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  )
  const deploy = readRepositoryFile(".github/workflows/deploy-quartz.yml")
  const storage = readRepositoryFile("workers/lib/iconoplasm-manifestation-body-storage.js")
  const requestBudget = readRepositoryFile("scripts/lib/CloudflareWorkerRequestBudget.ps1")
  assert.match(config, /binding = "ICONOPLASM_AUTHORING_DB"/)
  assert.match(config, /database_name = "iconoplasm-authoring"/)
  assert.match(config, /ICONOPLASM_AUTHORING_STORAGE_ZONE = "iconoplasm-authoring"/)
  assert.match(config, /ICONOPLASM_AUTHORING_STORAGE_ZONE = "iconoplasm-authoring-staging"/)
  const authoringZones = [
    ...config.matchAll(/^ICONOPLASM_AUTHORING_STORAGE_ZONE = "([^"]+)"$/gm),
  ].map((match) => match[1])
  assert.deepEqual(
    new Set(authoringZones).size,
    2,
    "production and staging authoring zones must differ",
  )
  assert.match(deploy, /node scripts\/run-admitted-d1-migrations\.mjs/)
  assert.match(
    deploy,
    /- name: Apply reviewed D1 migrations through prediction admission\n\s+if: inputs\.data_maintenance == true/,
  )
  assert.doesNotMatch(deploy, /wrangler\s+d1\s+migrations\s+apply/)
  assert.match(storage, /AccessKey/)
  assert.doesNotMatch(storage, /b-cdn\.net|EXTERNAL_PORTRAIT/)
  // B-1036: the PowerShell budget reads the operator ceilings from the one policy.
  assert.match(requestBudget, /'shared' 'iconoplasm-d1-budget-policy\.js'/)
  assert.match(requestBudget, /OPERATOR_ACCOUNT_CEILINGS/)
  assert.match(requestBudget, /FREE_PLAN_DAILY_LIMITS\.requests/)
  assert.doesNotMatch(requestBudget, /\b(2500|75000|3500000|70000)\b/)
  assert.match(requestBudget, /workersInvocationsAdaptive/)
  assert.match(requestBudget, /FileShare\]::None/)
})

test("IPD-012 caretaker migrations remain compatible with the remote D1 trigger splitter", () => {
  const migrationGroups = [
    ["migrations-iconoplasm-authoring", /^000[1-8]_.*\.sql$/],
    ["migrations-iconoplasm", /^00(?:8[4-9]|9[0-2])_.*\.sql$/],
  ]

  for (const [directory, filenamePattern] of migrationGroups) {
    const filenames = readdirSync(path.join(REPOSITORY_ROOT, directory))
      .filter((filename) => filenamePattern.test(filename))
      .sort()
    assert.ok(filenames.length > 0, `${directory} must contain caretaker authority migrations`)

    for (const filename of filenames) {
      const sql = readRepositoryFile(`${directory}/${filename}`)
      const topLevelCreate = /^CREATE (?:TABLE|(?:UNIQUE )?INDEX|TRIGGER)\b/gm
      const starts = [...sql.matchAll(topLevelCreate)].map((match) => match.index)
      starts.push(sql.length)
      for (let index = 0; index < starts.length - 1; index += 1) {
        const statement = sql.slice(starts[index], starts[index + 1])
        if (!statement.startsWith("CREATE TRIGGER")) continue
        assert.doesNotMatch(
          statement,
          /\b(?:CASE|END)\b/,
          `${directory}/${filename} uses uppercase CASE/END inside a trigger; remote D1 mis-splits the inner END and returns SQLITE 7500 incomplete input`,
        )
      }
    }
  }
})

// ARCHITECTURE FENCE [IPD-009]
test("IPD-009 keeps the cold path and deployment topology explicit", () => {
  const fence = registry.fences.find((entry) => entry.id === "IPD-009")
  assert.ok(fence, "IPD-009 must remain registered")
  assert.match(fence.decision, /one publisher's coherent static release/i)
  assert.match(fence.decision, /never reconstruct public truth from D1/i)
  assert.match(fence.decision, /second state owner/i)

  const topology = JSON.parse(readRepositoryFile("cloudflare/deployment-topology.json"))
  assert.equal(topology.architectureFence, "IPD-009")
  assert.equal(topology.stateOwner.cloudflareScript, "geneguessr-api")
  assert.equal(topology.staticFirst.dynamicInvocationCount, 1)
  assert.equal(topology.staticFirst.staticAssetsBypassWorker, true)
  assert.equal(topology.stateOwner.publicProxyAllowed, false)

  const lifecycle = readRepositoryFile("docs/ICONOPLASM_REQUEST_LIFECYCLE.md")
  assert.match(lifecycle, /application shell and published Iconoplasm\s+artifacts/i)
  assert.match(lifecycle, /Sign-in adds explicit private or mutation requests/i)
  assert.match(lifecycle, /publication system owns two objects/i)

  const runtime = readRepositoryFile(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  assert.match(runtime, /ARCHITECTURE FENCE \[IPD-009\]/)
  assert.match(runtime, /FROM icono_published_gene_routes/)
  assert.match(runtime, /ICONOPLASM PUBLICATION \(B-898\)\. Two published objects/)
  assert.match(runtime, /export async function publishIconoplasmGeneStableObject\(/)

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
  assert.match(runtime, /fulfillmentPublicationId: p\?\.fulfillment_publication_id/)
  assert.match(runtime, /fulfillment_publication_id = \?/)
  assert.match(runtime, /fulfillment_group_size = \?/)
  assert.match(migration, /legacy-request:/)
  assert.doesNotMatch(delivery, /setTimeout|setInterval/)
})

// B-774: request-scoped discovery resolution must never scan the catalog
// aliases. One full alias scan measured 0.5M-2.1M D1 rows read and matched
// nothing; three of them consumed 3.16M reads on 2026-09-18.
test("B-774 forbids catalog-wide alias scans in discovery resolution", () => {
  for (const file of [
    "workers/iconoplasm/discovery-ordinal-store.js",
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  ]) {
    const source = readRepositoryFile(file)
    assert.doesNotMatch(source, /json_each\(\s*icono_gene_catalog\.aliases_json\s*\)/, file)
    assert.doesNotMatch(source, /resolveCatalogAliases/, file)
  }
})

// B-764: D1 records migration filenames, not their later contents. Production
// missed the activation table when 0106 was edited after application. Lock the
// applied bytes; every future repair must use a new forward-only migration.
test("B-764 locks the applied compact-discovery migration bytes", () => {
  const migration = readFileSync(
    path.join(REPOSITORY_ROOT, "migrations-iconoplasm/0106_compact_discovery_state_v2.sql"),
  )
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "bf13d7e18d332494ffa2a194b49296b3a419a756757e34afac76221455b9acb3",
    "0106 was already applied; add a new migration instead of editing history",
  )
})
