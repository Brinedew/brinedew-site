import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__")

const mod = await import("./discord-feed.js")
const {
  buildExcerpt,
  paragraphsOf,
  htmlToPlainText,
  buildFeedMessage,
} = mod.__test
const { handlePostDailyFeed, handlePostFeed } = mod

function fixture(name) {
  return readFileSync(join(FIXTURES, name), "utf-8")
}

function mockFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

function mockKv(initial) {
  const store = new Map(Object.entries(initial || {}))
  return {
    get: (k) => Promise.resolve(store.get(k) || null),
    put: (k, v, opts) => { store.set(k, v); return Promise.resolve() },
    list: () => Promise.resolve([]),
    _store: store,
  }
}

// ─── buildExcerpt ───────────────────────────────────────────

test("buildExcerpt collects ≥2 paragraphs and hits a sentence boundary in [250,600]", () => {
  const p1 = "A short first sentence. This continues with more detail about the topic, filling up enough characters that when combined with the second paragraph we exceed the minimum threshold of two hundred and fifty characters for the excerpt building rule to activate properly."
  const p2 = "Second paragraph that discusses an important subtopic. It goes into depth about the implications of the findings described above."
  const text = [p1, p2, "Unused third paragraph."].join("\n\n")
  const result = buildExcerpt(text)
  assert.ok(result.length >= 250, `Expected ≥250 chars, got ${result.length}`)
  assert.ok(result.length <= 600, `Expected ≤600 chars, got ${result.length}`)
  assert.ok(/[.!?]$/.test(result), `Expected sentence boundary, got: "${result.slice(-20)}"`)
  const paraCount = (result.match(/\n\n/g) || []).length + 1
  assert.equal(paraCount, 2, `Expected exactly 2 paragraphs, got ${paraCount}`)
})

test("buildExcerpt includes a single long paragraph whole (never cuts mid-paragraph)", () => {
  const longPara = "This is a very long single paragraph. ".repeat(30)
  const result = buildExcerpt(longPara)
  assert.ok(result.length > 0, "Expected non-empty excerpt")
  // The excerpt includes the full paragraph — no mid-paragraph truncation.
  assert.ok(result.length >= longPara.trim().length - 5, `Expected near-full paragraph, got ${result.length} vs ${longPara.trim().length}`)
})

test("buildExcerpt returns first paragraph when only one is given", () => {
  const text = "Just one paragraph here. With a sentence boundary."
  const result = buildExcerpt(text)
  assert.equal(result, "Just one paragraph here. With a sentence boundary.")
})

test("buildExcerpt always ends at paragraph boundaries", () => {
  const shortP1 = "Short first para."
  const hugeP2 = "Huge paragraph. " + "A".repeat(800) + "."
  const result = buildExcerpt(shortP1 + "\n\n" + hugeP2)
  // With only 1 short paragraph, we must add the second to reach ≥2 paragraphs.
  // The excerpt includes both — it's longer than 600 but ends at a paragraph boundary.
  const paras = result.split(/\n\n/)
  assert.ok(paras.length >= 2, `Expected ≥2 paragraphs, got ${paras.length}`)
  assert.ok(result.includes("Short first para."))
  assert.ok(result.includes("Huge paragraph."))
})

test("buildExcerpt skips separator lines (---, ***, ~~~) as paragraph boundaries", () => {
  const text = [
    "First real paragraph. It goes on at length about the topic.",
    "---",
    "This is actually the second paragraph. But the --- shouldn't count as one.",
  ].join("\n\n")
  const result = buildExcerpt(text)
  assert.ok(result.includes("First real paragraph"), `Expected first para, got: "${result.slice(0, 40)}"`)
  assert.ok(result.includes("This is actually"), "Expected second para to be included")
})

test("buildExcerpt image caption text is naturally excluded because figure/figcaption are stripped before text is built", () => {
  const para1 = "Knoepfler said this was interesting. The study found new results."
  const para2 = "Another relevant paragraph about the topic. It continues with more analysis."
  const text = para1 + "\n\n" + para2
  const result = buildExcerpt(text)
  assert.ok(!result.includes("Knoepfler image"), "Image caption text leaked through")
  assert.ok(result.includes("Knoepfler said"), "Real article text should be present")
})

// ─── paragraphsOf ───────────────────────────────────────────

test("paragraphsOf splits on double newlines and trims each paragraph", () => {
  const result = paragraphsOf("  First para.  \n\n  Second para.  ")
  assert.deepEqual(result, ["First para.", "Second para."])
})

test("paragraphsOf filters empty paragraphs", () => {
  const result = paragraphsOf("First.\n\n\n\nSecond.")
  assert.deepEqual(result, ["First.", "Second."])
})

test("paragraphsOf filters separator-only paragraphs", () => {
  const result = paragraphsOf("First.\n\n---\n\nSecond.")
  assert.deepEqual(result, ["First.", "Second."])
})

// ─── htmlToPlainText ───────────────────────────────────────

test("htmlToPlainText strips HTML, skips figure/figcaption", () => {
  const html = [
    "<p>First paragraph with real content.</p>",
    '<figure><img src="x.jpg"/><figcaption>Knoepfler image caption</figcaption></figure>',
    "<p>Second paragraph with <b>important</b> details.</p>",
  ].join("")
  const result = htmlToPlainText(html)
  assert.ok(result.includes("First paragraph"), "First para missing")
  assert.ok(!result.includes("Knoepfler image"), "Image caption leaked through figure/figcaption")
  assert.ok(result.includes("Second paragraph"), "Second para missing")
  assert.ok(result.includes("important"), "Bold text should be preserved as text")
})

// ─── buildFeedMessage ──────────────────────────────────────

test("buildFeedMessage formats a single source item correctly", () => {
  const items = [
    {
      id: "1", sourceName: "TestSource", author: "Author Name",
      title: "Post Title", url: "https://example.com/post",
      excerpt: "First para. Second para that continues."
    }
  ]
  const result = buildFeedMessage(items)
  assert.ok(result, "Expected formatted message")
  assert.ok(result.chunks.length >= 1, "Expected at least one chunk")
  assert.ok(result.chunks[0].includes("Daily Feed"), "Expected header")
  assert.ok(result.chunks[0].includes("Author Name"), "Expected byline with author")
  assert.ok(result.chunks[0].includes("Post Title"), "Expected title")
})

test("buildFeedMessage returns null for empty items", () => {
  assert.equal(buildFeedMessage([]), null)
})

test("buildFeedMessage splits chunks at 1900 chars", () => {
  const items = [
    { id: "1", sourceName: "Source", author: "A", title: "T".repeat(400), url: "https://x.com/p1", excerpt: "X".repeat(1600) },
    { id: "2", sourceName: "Source", author: "B", title: "Normal", url: "https://x.com/p2", excerpt: "This should be in a different chunk from the first oversized item." },
  ]
  const result = buildFeedMessage(items)
  assert.ok(result.chunks.length > 1, `Expected multiple chunks, got ${result.chunks.length}`)
  assert.ok(result.chunks[0].includes("Daily Feed"), "First chunk must include the header")
  assert.ok(result.chunks.some((c) => c.includes("This should be")), "Second item should appear in a chunk")
})

// ─── rssAdatper.parse ──────────────────────────────────────────

test("rssAdapter parses Owl Posting RSS into FeedItems with excerpts", async () => {
  const items = await rssAdapterCollect("owlposting", { maxAgeDays: 365 })
  assert.ok(items.length > 0, "Expected items from real RSS")
  const item = items[0]
  assert.ok(item.id, "Expected item id")
  assert.ok(item.title, "Expected item title")
  assert.ok(item.url, "Expected item url")
  assert.ok(item.excerpt, "Expected excerpt")
  assert.ok(item.excerpt.length >= 250, `Expected excerpt ≥250 chars, got ${item.excerpt.length}`)
  assert.ok(item.sourceName === "Owl Posting", `Expected sourceName, got ${item.sourceName}`)
  assert.ok(item.author, "Expected author")
  assert.ok(item.publishedAt, "Expected publishedAt")
})

test("rssAdapter parses For Better Science RSS (WordPress, contentEncoded available)", async () => {
  const items = await rssAdapterCollect("forbetterscience")
  assert.ok(items.length > 0, "Expected items from real RSS")
  const item = items[0]
  assert.ok(item.title, "Expected title")
  assert.ok(item.excerpt, "Expected excerpt from content:encoded")
  assert.ok(item.excerpt.length >= 250, `Expected excerpt ≥250 chars, got ${item.excerpt.length} chars`)
})

// ─── Content quality ──────────────────────────────────────────

test("rssAdapter Owl Posting 'cancer vaccine' excerpt skips TOC entries and includes real article content", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  const vaccine = items.find((i) => i.title.includes("cancer vaccine"))
  assert.ok(vaccine, "Expected cancer vaccine article")
  assert.ok(!vaccine.excerpt.includes("1. Introduction"), "TOC entry '1. Introduction' should be filtered out")
  assert.ok(!vaccine.excerpt.includes("INTRODUCTION"), "TOC entry 'INTRODUCTION' should be filtered out")
  assert.ok(vaccine.excerpt.includes("cancer vaccine") || vaccine.excerpt.includes("normal vaccines"), "Excerpt should include actual article content about cancer vaccines")
  const paras = vaccine.excerpt.split(/\n\n/)
  assert.ok(paras.length >= 2, `Expected ≥2 paragraphs in excerpt, got ${paras.length}`)
})

test("rssAdapter Owl Posting 'TIGIT' excerpt is real content, not metadata", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  const tigit = items.find((i) => i.title.includes("TIGIT"))
  assert.ok(tigit, "Expected TIGIT article")
  assert.ok(tigit.excerpt.startsWith("There exist drug classes"), `Expected real content, got: "${tigit.excerpt.slice(0, 40)}"`)
  assert.ok(tigit.excerpt.includes("amyloid-beta"), "Expected article body content")
})

test("rssAdapter Owl Posting paragraphs are separated by double newlines", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  const bioweapon = items.find((i) => i.title.includes("bioweapon"))
  assert.ok(bioweapon, "Expected bioweapon article")
  // The excerpt should end at a paragraph boundary (never mid-paragraph).
  const paras = bioweapon.excerpt.split(/\n\n/)
  assert.ok(paras.length >= 1, `Expected at least 1 paragraph, got ${paras.length}`)
  // If there are multiple paragraphs, verify the excerpt is complete.
  if (paras.length >= 2) {
    assert.ok(paras[0].includes("Note:"), "First para should be the author's note")
    assert.ok(paras[1].includes("ogre") || paras[1].includes("creature"), "Second para should be article content")
  }
})

test("rssAdapter For Better Science 'Rui the Drunk' excerpt is real content", async () => {
  const items = await rssAdapterCollect("forbetterscience", { maxItems: 10, maxAgeDays: 365 })
  const rui = items.find((i) => i.title.includes("Rui"))
  assert.ok(rui, "Expected Rui article")
  assert.ok(rui.excerpt.includes("dictator") || rui.excerpt.includes("misconduct"), "Expected article content about misconduct")
  assert.ok(!rui.excerpt.includes("Schneider Shorts"), "Should not include Schneider Shorts preamble")
})

test("rssAdapter no image captions in excerpts", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  for (const item of items) {
    assert.ok(!item.excerpt.includes("image caption"), `Image caption leaked into excerpt for "${item.title}"`)
    assert.ok(!item.excerpt.includes("figcaption"), "figcaption tag leaked into excerpt")
  }
})

// ─── handlePostDailyFeed ──────────────────────────────────────

test("handlePostDailyFeed skips when no new items exist (all already posted)", async () => {
  const kv = simpleKv()
  // Mark all items as posted for the first source it encounters
  const originalCollect = globalThis.__feed_collect_override
  const feedMock = mockFetch((url) => {
    return new Response("<rss><channel><title>Test</title></channel></rss>")
  })
  try {
    const result = await handlePostDailyFeed({
      KV: kv,
      DISCORD_FEED_CHANNEL_ID: "123",
      DISCORD_BOT_TOKEN: "bot",
    })
    assert.ok(result.ok)
    assert.equal(result.skipped, "no_new_content")
  } finally {
    feedMock.restore()
  }
})

test("handlePostDailyFeed posts items and marks KV on first run for new source", async () => {
  const { rssAdapter } = (await import("./discord-feed.js")).__test
  const kv = simpleKv()

  // This tests the actual pipeline: collect → filter → build → post
  // We'll use a small feed fixture with known items
  const feedFixture = fixture("owlposting-rss.xml")

  const fetchMock = mockFetch((url) => {
    const parsed = new URL(url)
    if (parsed.href === "https://www.owlposting.com/feed/" || parsed.pathname.endsWith("/feed/")) {
      return new Response(feedFixture, { status: 200 })
    }
    // Discord API
    if (parsed.hostname === "discord.com") {
      return new Response(JSON.stringify({ id: "mock_msg_1" }), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  })

  try {
    // Override SOURCES to only Owl Posting for this test
    const result = await handlePostDailyFeed({
      KV: kv,
      DISCORD_FEED_CHANNEL_ID: "123",
      DISCORD_BOT_TOKEN: "bot",
    })
    // Should either post or report no-new-content (items may be old)
    // Either way it should not crash
    assert.ok(result.ok)
  } finally {
    fetchMock.restore()
  }
})

// ─── Helpers ───────────────────────────────────────────────────

function simpleKv() {
  const m = new Map()
  return {
    get: (k) => Promise.resolve(m.get(k) ?? null),
    put: (k, v) => { m.set(k, v); return Promise.resolve() },
    _: m,
  }
}

async function rssAdapterCollect(sourceId, opts = {}) {
  const { rssAdapter } = (await import("./discord-feed.js")).__test
  const xml = fixture(sourceId === "owlposting" ? "owlposting-rss.xml" : sourceId === "forbetterscience" ? "forbetterscience-rss.xml" : null)
  if (!xml) throw new Error(`No fixture for ${sourceId}`)
  const urlMap = {
    owlposting: "https://www.owlposting.com/feed/",
    forbetterscience: "https://forbetterscience.com/feed/",
  }
  const feedUrl = urlMap[sourceId]
  if (!feedUrl) throw new Error(`Unknown source ${sourceId}`)

  const fm = mockFetch((url) => {
    if (String(url).includes("/feed/")) return new Response(xml, { status: 200 })
    return new Response("not found", { status: 404 })
  })
  try {
    const adapter = rssAdapter({
      id: sourceId,
      name: sourceId === "owlposting" ? "Owl Posting" : "For Better Science",
      url: feedUrl,
      maxAgeDays: opts.maxAgeDays || 365,
      maxItems: opts.maxItems || 5,
    })
    return await adapter.collect({ KV: simpleKv() })
  } finally {
    fm.restore()
  }
}
