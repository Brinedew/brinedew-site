import assert from "node:assert/strict"
import test from "node:test"

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  }
}

test("portrait delivery module startup performs no anonymous metadata request", async () => {
  const originalFetch = globalThis.fetch
  const originalSessionStorage = globalThis.sessionStorage
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    throw new Error("anonymous startup entered the Worker")
  }
  globalThis.sessionStorage = memoryStorage()
  try {
    await import(`./portrait-delivery.js?zero-state-startup=${Date.now()}`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.sessionStorage = originalSessionStorage
  }
})

// B-855. Ways studio search could fail, written before the change:
// 1. "p53" lists CFAP53 and NOP53 before TP53;
// 2. "E-cadherin" finds nothing;
// 3. the alias metadata is fetched on every keystroke (Worker cost per key);
// 4. a metadata failure breaks plain symbol search;
// 5. one gene appears twice (symbol hit plus alias hit).
const STUDIO_CATALOG = [
  { symbol: "CFAP53", full_name: "cilia and flagella associated protein 53" },
  { symbol: "NOP53", full_name: "NOP53 ribosome biogenesis factor" },
  { symbol: "TP53", full_name: "tumor protein p53" },
  { symbol: "CDH1", full_name: "cadherin 1" },
]

function fakeReader() {
  return {
    async search(query, { limit = 12, symbols = null } = {}) {
      const needle = String(query).trim().toLowerCase()
      const genes = STUDIO_CATALOG.filter(
        (gene) =>
          (!symbols || symbols.includes(gene.symbol)) &&
          (gene.symbol.toLowerCase().includes(needle) ||
            gene.full_name.toLowerCase().includes(needle)),
      )
        .sort((left, right) => left.symbol.localeCompare(right.symbol))
        .slice(0, limit)
      return { genes, query: needle.toUpperCase() }
    },
  }
}

async function withStudio(fetchImpl, run) {
  const originalWindow = globalThis.window
  const originalReader = globalThis.IconoplasmPublicationReader
  const originalFetch = globalThis.fetch
  globalThis.window = {
    location: { hostname: "iconoplasm.brinedew.bio", origin: "https://iconoplasm.brinedew.bio" },
    localStorage: memoryStorage(),
  }
  globalThis.IconoplasmPublicationReader = fakeReader()
  globalThis.fetch = fetchImpl
  try {
    const studio = await import(`./diagram-studio.js?studio-search=${Date.now()}-${Math.random()}`)
    await run(studio)
  } finally {
    globalThis.window = originalWindow
    globalThis.IconoplasmPublicationReader = originalReader
    globalThis.fetch = originalFetch
  }
}

test("studio search ranks curated aliases like the server, with one metadata fetch per session", async () => {
  const fetched = []
  await withStudio(
    async (url) => {
      fetched.push(String(url))
      return Response.json({
        publication_aliases: { by_symbol: { TP53: ["p53"], CDH1: ["E-cadherin"] } },
      })
    },
    async (studio) => {
      const p53 = await studio.searchPublishedGenes("p53", { limit: 8 })
      assert.deepEqual(
        p53.genes.map((gene) => gene.symbol),
        ["TP53", "CFAP53", "NOP53"],
      )
      const cadherin = await studio.searchPublishedGenes("E-cadherin", { limit: 8 })
      assert.deepEqual(
        cadherin.genes.map((gene) => gene.symbol),
        ["CDH1"],
      )
      await studio.searchPublishedGenes("e-cad", { limit: 8 })
      await studio.searchPublishedGenes("cdh", { limit: 8 })
      assert.deepEqual(fetched, ["https://iconoplasm.brinedew.bio/api/public/v1/metadata"])
    },
  )
})

test("studio symbol search still works when the alias metadata cannot load", async () => {
  await withStudio(
    async () => {
      throw new Error("offline")
    },
    async (studio) => {
      const result = await studio.searchPublishedGenes("tp53", { limit: 8 })
      assert.deepEqual(
        result.genes.map((gene) => gene.symbol),
        ["TP53"],
      )
    },
  )
})

test("the application has no JavaScript semantic-blot route fallback", async () => {
  const app = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./app.js", import.meta.url), "utf8"),
  )
  assert.doesNotMatch(app, /public-blot-route/)
  assert.doesNotMatch(app, /publicBlotRouteActive/)
})
