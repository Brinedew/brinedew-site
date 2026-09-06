import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import { WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE } from "../quartz/static/iconoplasm/guest-discovery-contract.js"

// Execute the actual content-script function with only its browser/transport
// dependencies stubbed. This catches the await-order bug, not just a regex.
const content = readFileSync(new URL("./content.js", import.meta.url), "utf8")
const functionSource = content.slice(
  content.indexOf("  async function postDiscoveryEncounter("),
  content.indexOf("  function scheduleDiscoveryEncounter("),
)
assert.ok(functionSource.includes("async function postDiscoveryEncounter"))

for (const client of ["extension", "website"]) {
  for (const outcome of [
    "success",
    "missing receipt",
    "partial receipt",
    "wrong symbols",
    "network failure",
  ]) {
    test(`${client} guest merge retains unacknowledged storage and spends one bounded attempt: ${outcome}`, async () => {
      const pending = new Set(Array.from({ length: 2000 }, (_, i) => `G${i}`))
      const requests = []
      const source =
        client === "extension"
          ? content
          : readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
      if (client === "extension")
        assert.equal(
          Number(source.match(/const GUEST_DISCOVERY_MERGE_BATCH_SIZE = (\d+)/)[1]),
          WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
        )
      const name =
        client === "extension"
          ? "mergeGuestDiscoveriesIfSignedIn"
          : "mergeWebsiteGuestDiscoveriesIfSignedIn"
      const start = source.indexOf(`${client === "extension" ? "async " : ""}function ${name}(`)
      const end = source.indexOf(
        client === "extension"
          ? "  function scheduleDiscoveryBufferFlush("
          : "  function invalidateImageEditProviders(",
        start,
      )
      assert.ok(start >= 0 && end > start)
      const transport = async (_url, options) => {
        const symbols = JSON.parse(options.body).symbols
        requests.push(symbols)
        if (outcome === "network failure") throw new Error("lost response")
        const acknowledged =
          outcome === "partial receipt"
            ? symbols.slice(0, 100)
            : outcome === "wrong symbols"
              ? [...symbols.slice(1), "UNKNOWN"]
              : symbols
        return outcome === "missing receipt"
          ? { ok: true, authenticated: true }
          : {
              ok: true,
              authenticated: true,
              schema: "iconoplasm.discoveryMerge.v2",
              merged_symbols: acknowledged,
              merged_count: acknowledged.length,
            }
      }
      const context = {
        runtimeDisconnected: false,
        guestDiscoveryMergePromise: null,
        guestDiscoveryMergeRemaining: 200,
        guestDiscoverySymbols: pending,
        discoveredPageSymbols: new Set(),
        normalizeDiscoverySymbolList: (values) => [...new Set(Array.isArray(values) ? values : [])],
        ensureDiscoveryStateFresh: async () => ({ authenticated: true, discovered_symbols: [] }),
        rememberDiscoveryAuthState() {},
        ICONOPLASM_DISCOVERY_MERGE_URL: "/merge",
        extensionApiFetch: async (url, options) => ({
          ok: true,
          json: () => transport(url, options),
        }),
        removeMergedGuestDiscoveries: async (symbols) => symbols.forEach((s) => pending.delete(s)),
        currentUser: { id: "test" },
        websiteGuestDiscoveryMergePromise: null,
        websiteGuestDiscoveryMergeRemaining: 200,
        websiteGuestDiscoveries: {
          pendingSymbols: (limit) => [...pending].slice(0, limit),
          remove: (symbols) => symbols.forEach((s) => pending.delete(s)),
        },
        fetchAuthedJSON: transport,
        console: { warn() {}, error() {} },
      }
      vm.createContext(context)
      vm.runInContext(source.slice(start, end), context)
      await Promise.all([context[name](), context[name]()])
      await context[name]()
      assert.equal(requests.length, 1)
      assert.equal(requests[0].length, 200)
      assert.equal(pending.size, outcome === "success" ? 1800 : 2000)
      assert.ok(pending.has("G1999"))
      assert.equal(pending.has("G0"), outcome !== "success")
    })
  }
}

for (const scenario of ["already saved", "new signed-in", "guest", "offline"]) {
  test(`discovery after asynchronous membership resolution: ${scenario}`, async () => {
    let posts = 0
    const guests = []
    const context = {
      runtimeDisconnected: false,
      discoveredPageSymbols: new Set(),
      discoveryInFlightSymbols: new Set(),
      guestDiscoverySymbols: new Set(),
      isDiscoveryCoolingDown: () => false,
      markDiscoveryCooldown() {},
      async ensureDiscoveryStateFresh() {
        await Promise.resolve()
        if (scenario === "already saved") context.discoveredPageSymbols.add("EZH2")
        if (scenario === "offline") throw new Error("offline")
        return { authenticated: scenario !== "guest" }
      },
      async extensionApiFetch() {
        posts++
        return { ok: true, json: async () => ({ authenticated: true, recorded: true }) }
      },
      async rememberGuestDiscovery(symbol) {
        guests.push(symbol)
      },
      rememberDiscoveryAuthState() {},
      scheduleDiscoveryBufferFlush() {},
      ICONOPLASM_DISCOVERY_ENCOUNTER_URL: "/api/iconoplasm/discoveries/encounter",
      DISCOVERY_HOVER_DWELL_MS: 900,
      console: { error() {}, warn() {} },
    }
    vm.createContext(context)
    vm.runInContext(functionSource, context)
    await context.postDiscoveryEncounter("ezh2")
    assert.equal(posts, scenario === "new signed-in" ? 1 : 0)
    assert.deepEqual(guests, ["guest", "offline"].includes(scenario) ? ["EZH2"] : [])
    assert.equal(
      context.discoveryInFlightSymbols.size,
      0,
      "early return must clear in-flight state",
    )
  })
}

test("membership windows include active intent, deduplicate concurrent calls and never fetch a full shelf", async () => {
  const calls = []
  const context = {
    discoveryAuthState: { checkedAt: 0, authenticated: null, discoveredSymbols: [] },
    discoveredPageSymbols: new Set(),
    DISCOVERY_AUTH_CACHE_TTL_MS: 300000,
    ICONOPLASM_DISCOVERY_STATE_URL: "https://example.test/discoveries/membership",
    normalizeDiscoverySymbolList: (values) => [...new Set((values || []).filter(Boolean))],
    readingSession: {
      snapshot: () => ({ documentSymbols: Array.from({ length: 300 }, (_, i) => "G" + i) }),
    },
    runtimeDisconnected: false,
    console,
    async extensionApiFetch(url) {
      const symbols = JSON.parse(new URL(url).searchParams.get("symbols"))
      calls.push(symbols)
      await Promise.resolve()
      return {
        ok: true,
        json: async () => ({
          authenticated: true,
          checked_symbols: symbols,
          discovered_symbols: symbols.filter((s) => s === "G299"),
        }),
      }
    },
  }
  vm.createContext(context)
  vm.runInContext(
    content.slice(
      content.indexOf("  function rememberDiscoveryAuthState("),
      content.indexOf("  async function mergeGuestDiscoveriesIfSignedIn("),
    ),
    context,
  )
  await Promise.all([
    context.ensureDiscoveryStateFresh("G299"),
    context.ensureDiscoveryStateFresh("G1"),
  ])
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "G299")
  assert.equal(calls[0].length, 128)
  assert.ok(context.discoveredPageSymbols.has("G299"))
  await context.ensureDiscoveryStateFresh("G298")
  assert.equal(calls.length, 2)
  assert.equal(calls[1][0], "G298")
  assert.equal(calls[1].length, 128)
  assert.ok(!calls[1].includes("G299"))
})
