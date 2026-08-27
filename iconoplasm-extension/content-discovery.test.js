import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

// Execute the actual content-script function with only its browser/transport
// dependencies stubbed. This catches the await-order bug, not just a regex.
const content = readFileSync(new URL("./content.js", import.meta.url), "utf8")
const functionSource = content.slice(
  content.indexOf("  async function postDiscoveryEncounter("),
  content.indexOf("  function scheduleDiscoveryEncounter("),
)
assert.ok(functionSource.includes("async function postDiscoveryEncounter"))

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
