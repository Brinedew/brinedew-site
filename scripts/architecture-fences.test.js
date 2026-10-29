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

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function readRepositoryFile(relativePath) {
  return readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8")
}

// ARCHITECTURE FENCE [IPD-001]
// This test is deliberately independent of the website and extension adapter
// tests. A future edit that changes the defaults and updates a nearby test must
// still confront the cross-system cost and fallback contract here.
test("IPD-001 keeps Bunny primary on healthy tabs and canonical as the one-probe fallback", async () => {
  assert.deepEqual(DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator, {
    id: "bunny",
    origin: "https://img.brinedew.bio",
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
    "https://img.brinedew.bio/portraits/v1/aa/asset/medium.webp",
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
      "https://img.brinedew.bio/portraits/v1/aa/asset/medium.webp",
      disabledPolicy,
    ),
    "accelerator",
    "Known accelerator URLs must remain rewritable after an explicit disable",
  )
})

// ARCHITECTURE FENCE [IPD-001]
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

// B-1037: on 2026-10-06 an 870-gene Image Lab batch died four times on a private 2,500
// request cap in the replica cost ledger that never read the tier table. Every daily
// allowance now lives in shared/iconoplasm-d1-budget-policy.js, and this fails when a
// new one is written as a number anywhere else, so the next bypass is caught here
// instead of by a dead run.
test("B-1037 every daily limit is a number only in the one budget policy", () => {
  // Product rules priced in their own units, not copies of a provider meter: each
  // states its cost against the policy's free-plan numbers in its own comment.
  const productRules = new Map([
    ["workers/iconoplasm/votes/vote-guards.js", "VOTE_PERSON_DAILY_LIMIT"],
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

// ARCHITECTURE FENCE [IPD-013]
// B-1085, the 2026-10-11 vote outage: a copy ran past a stop that only read
// Cloudflare's lagging meter. Fails if an admin route can be added without a
// price. workers/iconoplasm/app.test.js covers the gate refusing an unreadable
// meter.
test("IPD-013 lets batch work in by its price, and an unpriced admin route can't be built", async () => {
  const { Hono } = await import("hono")
  const { BATCH_GATE, assertEveryAdminRoutePriced } =
    await import("../workers/iconoplasm/batch-admission.js")
  const gate = Object.assign(async (c, next) => next(), { [BATCH_GATE]: true })
  const priced = new Hono()
  priced.post("/api/iconoplasm/admin/thing", gate, (c) => c.json({}))
  priced.post("/api/iconoplasm/caretaker/genes/:gene/saves", (c) => c.json({}))
  assert.doesNotThrow(() => assertEveryAdminRoutePriced(priced))
  const forgotten = new Hono()
  forgotten.post("/api/iconoplasm/admin/new-sweep", (c) => c.json({}))
  assert.throws(
    () => assertEveryAdminRoutePriced(forgotten),
    /POST \/api\/iconoplasm\/admin\/new-sweep must name its D1 price/,
  )

  const { BATCH_ROUTE_PRICES } = await import("../workers/iconoplasm/batch-route-prices.js")
  const { ICONOPLASM_ROUTE_CONTRACTS } = await import("../workers/iconoplasm-route-contract.js")
  for (const route of ICONOPLASM_ROUTE_CONTRACTS)
    if (route.auth === "administrator" || route.auth === "authority-generation-bearer")
      assert.ok(BATCH_ROUTE_PRICES[route.id], `${route.id} must name its D1 price`)
})
