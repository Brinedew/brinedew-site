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
