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
