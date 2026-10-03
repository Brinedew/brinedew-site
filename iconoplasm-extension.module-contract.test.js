import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { brotliDecompressSync } from "node:zlib"
import vm from "node:vm"

function readUtf8(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function readJson(path) {
  return JSON.parse(readUtf8(path))
}

function loadContentMatcher() {
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/content-matcher.js"), sandbox)
  return sandbox.IconoplasmContentMatcher
}

function normalizeMatcherResults(matches) {
  return Array.from(matches || [], (match) => ({ ...match }))
}

const woff2KnownTags = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
]

function readUIntBase128(buffer, cursor) {
  let value = 0
  for (let i = 0; i < 5; i += 1) {
    const byte = buffer[cursor.offset]
    cursor.offset += 1
    if (i === 0 && byte === 0x80) throw new Error("Invalid WOFF2 UIntBase128 leading zero")
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return value
  }
  throw new Error("Invalid WOFF2 UIntBase128 length")
}

function readWoff2Table(buffer, tableTag) {
  assert.equal(buffer.toString("ascii", 0, 4), "wOF2", "expected a WOFF2 font")
  const numTables = buffer.readUInt16BE(12)
  const totalCompressedSize = buffer.readUInt32BE(20)
  const cursor = { offset: 48 }
  const tables = []

  for (let i = 0; i < numTables; i += 1) {
    const flags = buffer[cursor.offset]
    cursor.offset += 1
    const tagIndex = flags & 0x3f
    const tag =
      tagIndex === 0x3f
        ? buffer.toString("ascii", cursor.offset, (cursor.offset += 4))
        : woff2KnownTags[tagIndex]
    const transformVersion = flags >> 6
    const originalLength = readUIntBase128(buffer, cursor)
    const transformed =
      tag === "glyf" || tag === "loca" ? transformVersion !== 3 : transformVersion !== 0
    const transformedLength = transformed ? readUIntBase128(buffer, cursor) : originalLength
    tables.push({ tag, originalLength, transformedLength })
  }

  const compressedData = buffer.subarray(cursor.offset, cursor.offset + totalCompressedSize)
  const decompressed = brotliDecompressSync(compressedData)
  let tableOffset = 0
  for (const table of tables) {
    const length = table.transformedLength
    const data = decompressed.subarray(tableOffset, tableOffset + length)
    if (table.tag === tableTag) return data.subarray(0, table.originalLength)
    tableOffset += length
  }
  throw new Error(`Missing WOFF2 table ${tableTag}`)
}

function cmapHasCodepoint(cmap, codepoint) {
  const tableCount = cmap.readUInt16BE(2)
  for (let i = 0; i < tableCount; i += 1) {
    const tableOffset = cmap.readUInt32BE(4 + i * 8 + 4)
    const format = cmap.readUInt16BE(tableOffset)
    if (format === 12) {
      const groupCount = cmap.readUInt32BE(tableOffset + 12)
      for (let group = 0; group < groupCount; group += 1) {
        const offset = tableOffset + 16 + group * 12
        const start = cmap.readUInt32BE(offset)
        const end = cmap.readUInt32BE(offset + 4)
        if (codepoint >= start && codepoint <= end) return true
      }
    }
    if (format === 4) {
      const segCount = cmap.readUInt16BE(tableOffset + 6) / 2
      const endCodes = tableOffset + 14
      const startCodes = endCodes + segCount * 2 + 2
      for (let segment = 0; segment < segCount; segment += 1) {
        const start = cmap.readUInt16BE(startCodes + segment * 2)
        const end = cmap.readUInt16BE(endCodes + segment * 2)
        if (codepoint >= start && codepoint <= end) return true
      }
    }
  }
  return false
}

const requiredContentModules = [
  "content-api.js",
  "content-settings.js",
  "content-matcher.js",
  "content-scanner.js",
  "content-lifecycle.js",
  "content-tooltip.js",
  "content-portrait-cache.js",
  "content-detail-cache.js",
  "content-vote-bridge.js",
  "content-reading-session.js",
  "discovery-batch-queue.js",
  "highlight-runtime.js",
]

test("DO NOT DELETE: extension content modules load before the content adapter", () => {
  const manifest = JSON.parse(readUtf8("./iconoplasm-extension/manifest.json"))
  const contentScript = manifest.content_scripts.find(
    (entry) => Array.isArray(entry.js) && entry.js.includes("content.js"),
  )
  assert.ok(contentScript, "manifest should contain the main content script entry")
  const jsFiles = contentScript.js
  const adapterIndex = jsFiles.indexOf("content.js")
  assert.ok(adapterIndex > 0, "content.js should load after its dependency modules")

  for (const moduleName of requiredContentModules) {
    const moduleIndex = jsFiles.indexOf(moduleName)
    assert.notEqual(moduleIndex, -1, `${moduleName} should be listed in manifest content scripts`)
    assert.ok(
      moduleIndex < adapterIndex,
      `${moduleName} should load before content.js so content.js stays a page adapter`,
    )
  }
})

test("DO NOT DELETE: the extension never mutates the React workstation DOM", () => {
  const manifest = JSON.parse(readUtf8("./iconoplasm-extension/manifest.json"))
  const contentScript = manifest.content_scripts.find(
    (entry) => Array.isArray(entry.js) && entry.js.includes("content.js"),
  )
  assert.ok(contentScript, "manifest should contain the main content script entry")
  const excluded = new Set(contentScript.exclude_matches || [])
  assert.equal(excluded.has("http://127.0.0.1/*"), true)
  assert.equal(excluded.has("http://localhost/*"), true)
})

test("DO NOT DELETE: Iconoplasm card fonts ship macron-vowel glyph coverage", () => {
  const fontPaths = [
    "./shared/iconoplasm-card/fonts/Caveat-400.woff2",
    "./shared/iconoplasm-card/fonts/IBMPlexMono-Medium.woff2",
    "./shared/iconoplasm-card/fonts/IBMPlexMono-Regular.woff2",
    "./shared/iconoplasm-card/fonts/LeagueSpartan-800.woff2",
    "./shared/iconoplasm-card/fonts/SpecialElite-Regular.woff2",
    "./quartz/static/iconoplasm/fonts/Caveat-400.woff2",
    "./quartz/static/iconoplasm/fonts/IBMPlexMono-Medium.woff2",
    "./quartz/static/iconoplasm/fonts/IBMPlexMono-Regular.woff2",
    "./quartz/static/iconoplasm/fonts/LeagueSpartan-800.woff2",
    "./quartz/static/iconoplasm/fonts/SpecialElite-Regular.woff2",
    "./iconoplasm-extension/fonts/Caveat-400.woff2",
    "./iconoplasm-extension/fonts/IBMPlexMono-Medium.woff2",
    "./iconoplasm-extension/fonts/IBMPlexMono-Regular.woff2",
    "./iconoplasm-extension/fonts/LeagueSpartan-800.woff2",
    "./iconoplasm-extension/fonts/SpecialElite-Regular.woff2",
  ]

  for (const fontPath of fontPaths) {
    const cmap = readWoff2Table(readFileSync(new URL(fontPath, import.meta.url)), "cmap")
    for (const codepoint of [
      0x0100, 0x0101, 0x0112, 0x0113, 0x012a, 0x012b, 0x014c, 0x014d, 0x016a, 0x016b,
    ]) {
      assert.ok(
        cmapHasCodepoint(cmap, codepoint),
        `${fontPath} should include U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`,
      )
    }
  }
})

test("DO NOT DELETE: canonical gene symbols require word-like boundaries while allowing hyphen prefixes", () => {
  const matcherApi = loadContentMatcher()
  assert.equal(typeof matcherApi?.createGeneMatcher, "function")

  const matcher = matcherApi.createGeneMatcher({
    SYMBOL: { c: "#123456", n: "Example gene" },
  })

  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("thatSYMBOL")),
    [],
    "SYMBOL inside a larger letter/digit word should not be highlighted",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("SYMBOLthat")),
    [],
    "SYMBOL followed by more letters or digits should not be highlighted",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("that-SYMBOL")),
    [{ symbol: "SYMBOL", index: 5, length: 6, text: "SYMBOL", matchedBy: "symbol" }],
    "SYMBOL after a separator hyphen should be highlighted as its own gene token",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("SYMBOL-that")),
    [{ symbol: "SYMBOL", index: 0, length: 6, text: "SYMBOL", matchedBy: "symbol" }],
    "SYMBOL before a separator hyphen should be highlighted as its own gene token",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("(SYMBOL)/that")),
    [{ symbol: "SYMBOL", index: 1, length: 6, text: "SYMBOL", matchedBy: "symbol" }],
    "punctuation should separate a canonical gene symbol from surrounding prose",
  )
})

test("DO NOT DELETE: a blocked phrase suppresses nested highlights without blocking the gene elsewhere", () => {
  const matcherApi = loadContentMatcher()
  const matcher = matcherApi.createGeneMatcher(
    {
      APC: { c: "#123456", n: "Adenomatous polyposis coli" },
      CXCL8: { a: ["IL8"], c: "#654321", n: "C-X-C motif chemokine ligand 8" },
    },
    { blocklist: new Set(["APC/C", "IL8/STAT3"]) },
  )

  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("APC/C activity")),
    [],
    "APC/C should protect the complete phrase from the nested APC symbol match",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("APC/C and APC")),
    [{ symbol: "APC", index: 10, length: 3, text: "APC", matchedBy: "symbol" }],
    "the same APC symbol should still highlight when it appears outside the protected phrase",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("IL8/STAT3 and IL8")),
    [{ symbol: "CXCL8", index: 14, length: 3, text: "IL8", matchedBy: "alias" }],
    "protected phrases should suppress nested curated aliases as well as canonical symbols",
  )
})

test("DO NOT DELETE: simple card metadata renders mass, age, and tissue when projected fields exist", async () => {
  const vm = await import("node:vm")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/generated/shared-card-runtime.js"), sandbox)
  const shared = sandbox.IconoplasmCardShared
  assert.equal(typeof shared?.collectTooltipMetaRows, "function")

  const rows = shared.collectTooltipMetaRows({
    symbol: "TP53",
    first_publication_year: 1979,
    molecular_weight_kda: 43.7,
    primary_tissue: "bone marrow",
    essence: {
      age_years: 47,
      weight_kg: 68,
      skin_name: "pale rose",
    },
  })

  assert.ok(
    rows.some((row) => row.character === "68 kg" && row.molecular === "44 kDa"),
    "mass row should survive the simple metadata projection",
  )
  assert.ok(
    rows.some((row) => row.character === "47 years old" && row.molecular === "discovered in 1979"),
    "age row should survive the simple metadata projection",
  )
  assert.ok(
    rows.some((row) => row.molecular === "bone marrow"),
    "skin/tissue row should survive the simple metadata projection",
  )
})

test("DO NOT DELETE: custom entries promoted into defaults behave like defaults", async () => {
  const vm = await import("node:vm")
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/content-settings.js"), sandbox)
  const settings = sandbox.IconoplasmContentSettings
  assert.equal(typeof settings?.buildEffectiveBlocklist, "function")

  assert.deepEqual(
    [...settings.buildEffectiveBlocklist(["GPT"], ["GPT"], [])],
    ["GPT"],
    "a stale custom GPT should collapse into the shipped default GPT",
  )
  assert.deepEqual(
    [...settings.buildEffectiveBlocklist(["GPT"], ["GPT"], ["GPT"])],
    [],
    "removing the default GPT should not be defeated by the stale custom GPT entry",
  )

  const removed = settings.removeBlocklistEntry(["GPT"], ["CUSTOM", "GPT"], [], "GPT")
  assert.deepEqual([...removed.userEntries], ["CUSTOM"])
  assert.deepEqual([...removed.removedDefaults], ["GPT"])
  assert.deepEqual(
    [...settings.buildEffectiveBlocklist([], removed.userEntries, removed.removedDefaults)],
    ["CUSTOM"],
    "removing a promoted default must delete its custom copy so policy demotion cannot revive it",
  )

  const explicitlyRestored = settings.addBlocklistEntries(
    [],
    removed.userEntries,
    removed.removedDefaults,
    ["GPT"],
  )
  assert.deepEqual([...explicitlyRestored.userEntries], ["CUSTOM", "GPT"])
  assert.deepEqual([...explicitlyRestored.removedDefaults], [])
  assert.deepEqual(
    [
      ...settings.buildEffectiveBlocklist(
        ["GPT"],
        explicitlyRestored.userEntries,
        explicitlyRestored.removedDefaults,
      ),
    ].sort(),
    ["CUSTOM", "GPT"],
    "default -> remove -> demote -> explicit custom Add -> re-promote must preserve the last Add",
  )
})

test("a new user's extension defaults are Color pills, Always on and Blot only", async () => {
  const vm = await import("node:vm")
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/content-settings.js"), sandbox)
  const settings = sandbox.IconoplasmContentSettings

  for (const absent of [undefined, null, ""]) {
    assert.equal(settings.normalizeHighlightMode(absent), "pill")
    assert.equal(settings.normalizeHighlightVisibility(absent), "always")
    assert.equal(settings.normalizeCardVariant(absent), "image-only")
  }
  // A stored choice is kept, not normalized back to the default.
  assert.equal(settings.normalizeHighlightMode("underline"), "underline")
  assert.equal(settings.normalizeHighlightVisibility("hover"), "hover")
  assert.equal(settings.normalizeCardVariant("simple"), "simple")
})

// What the store listing and the install prompt promise: the extension reads pages for gene
// symbols, keeps its settings, and talks to two hosts. A wider list is a privacy change that
// must be made on purpose.
test("the extension asks for storage and two origins, and nothing else", () => {
  const manifest = readJson("./iconoplasm-extension/manifest.json")
  assert.deepEqual(manifest.permissions, ["storage"])
  assert.deepEqual(manifest.host_permissions, [
    "https://iconoplasm.brinedew.bio/*",
    "https://iconoplasmportraits.b-cdn.net/*",
  ])
  assert.equal(manifest.optional_permissions, undefined)
  assert.equal(manifest.optional_host_permissions, undefined)
  assert.equal(manifest.background.service_worker, "service-worker.js")
})

test("DO NOT DELETE: authoritative shared defaults replace the packaged fallback", async () => {
  const vm = await import("node:vm")
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/content-settings.js"), sandbox)
  const settings = sandbox.IconoplasmContentSettings
  const candidate = readJson("./iconoplasm-extension/candidate-contract.json")
  assert.equal(settings.sharedBlocklistSchemaVersion, candidate.extension_blocklist_schema_version)
  assert.equal(
    settings.sharedBlocklistContractRevision,
    candidate.extension_blocklist_contract_revision,
  )
  const projection = {
    schema_version: 1,
    revision: 2,
    version: "ebl1-0000000000000002",
    term_count: 1,
    terms: [" remote\u2010term "],
  }

  assert.deepEqual(
    [...settings.resolveSharedBlocklistDefaults(projection, ["PACKAGED"])],
    ["REMOTE-TERM"],
  )
  assert.deepEqual(
    [
      ...settings.resolveSharedBlocklistDefaults(
        {
          schema_version: 1,
          revision: 3,
          version: "ebl1-0000000000000003",
          term_count: 0,
          terms: [],
        },
        ["PACKAGED"],
      ),
    ],
    [],
    "a valid empty shared policy must not fall back to packaged defaults",
  )
  assert.deepEqual(
    [...settings.resolveSharedBlocklistDefaults({ schema_version: 2 }, ["PACKAGED"])],
    ["PACKAGED"],
    "missing or malformed first-run state must use the packaged fallback",
  )
  assert.deepEqual(
    [...settings.parseUserBlocklistInput("spatial, pokemon\nSTAT;SPATIAL")],
    ["POKEMON", "SPATIAL", "STAT"],
  )
})

test("Iconoplasm settings prefer the current shared card-style cookie over stale host duplicates", async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  const storage = new Map([
    [
      "brinedew.iconoplasm.settings.v1",
      JSON.stringify({ homeLayout: "bricks", cardVariant: "lit-archival", showAllGenes: false }),
    ],
  ])
  globalThis.window = {
    location: {
      hostname: "iconoplasm.brinedew.bio",
      origin: "https://iconoplasm.brinedew.bio",
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  globalThis.document = {
    cookie:
      "brinedew_icono_card_variant=lit-archival; brinedew_icono_layout=bricks; brinedew_icono_card_variant=simple",
    dispatchEvent: () => true,
  }
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
    }
  }

  try {
    const preferences = await import(
      new URL(
        `./quartz/static/site-preferences.js?duplicate-card-cookie=${Date.now()}`,
        import.meta.url,
      )
    )
    assert.equal(preferences.readIconoplasmSettings().cardVariant, "simple")
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})

test("Iconoplasm settings writes both host and shared-domain cookies for card style", async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  const assignments = []
  const storage = new Map()
  globalThis.window = {
    location: {
      hostname: "brinedew.bio",
      origin: "https://brinedew.bio",
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  globalThis.document = {
    dispatchEvent: () => true,
  }
  Object.defineProperty(globalThis.document, "cookie", {
    get() {
      return ""
    },
    set(value) {
      assignments.push(String(value))
    },
  })
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
    }
  }

  try {
    const preferences = await import(
      new URL(
        `./quartz/static/site-preferences.js?write-card-cookie=${Date.now()}`,
        import.meta.url,
      )
    )
    assert.equal(
      preferences.writeIconoplasmSettings({
        homeLayout: "bricks",
        cardVariant: "simple",
        showAllGenes: false,
      }),
      true,
    )
    assert.ok(
      assignments.some(
        (assignment) =>
          assignment.startsWith("brinedew_icono_card_variant=simple;") &&
          !assignment.includes("Domain="),
      ),
      "settings writes should refresh the host cookie so stale same-host values cannot shadow the shared cookie",
    )
    assert.ok(
      assignments.some(
        (assignment) =>
          assignment.startsWith("brinedew_icono_card_variant=simple;") &&
          assignment.includes("Domain=.brinedew.bio"),
      ),
      "settings writes should refresh the shared domain cookie used across Brinedew hosts",
    )
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})

test("DO NOT DELETE: website guest defaults stay bricks and blot-only, and legacy provider settings are scrubbed", async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  const storage = new Map()
  globalThis.window = {
    location: {
      hostname: "iconoplasm.brinedew.bio",
      origin: "https://iconoplasm.brinedew.bio",
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  globalThis.document = {
    cookie: "",
    dispatchEvent: () => true,
  }
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
    }
  }

  try {
    const preferences = await import(
      new URL(`./quartz/static/site-preferences.js?guest-defaults=${Date.now()}`, import.meta.url)
    )
    assert.equal(preferences.readIconoplasmSettings().homeLayout, "bricks")
    assert.equal(preferences.readIconoplasmSettings().cardVariant, "image-only")

    // A blob stored by the old provider settings loses its key and endpoint on first read.
    const key = "brinedew.iconoplasm.settings.v1"
    storage.set(
      key,
      JSON.stringify({
        homeLayout: "bricks",
        generationApiKey: "sk-secret",
        generationProvider: "fal",
        generationModel: "model",
        generationEndpoint: "https://provider.test",
      }),
    )
    preferences.readIconoplasmSettings()
    assert.equal(storage.get(key).includes("sk-secret"), false)
    assert.deepEqual(Object.keys(JSON.parse(storage.get(key))).sort(), [
      "cardVariant",
      "homeLayout",
      "showAllGenes",
    ])
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})
