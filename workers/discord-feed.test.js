import { test, mock } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__")

const mod = await import("./discord-feed.js")
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
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function mockKv(initial) {
  const store = new Map(Object.entries(initial || {}))
  return {
    get: (k) => Promise.resolve(store.get(k) || null),
    put: (k, v, opts) => {
      store.set(k, v)
      return Promise.resolve()
    },
    list: () => Promise.resolve([]),
    _store: store,
  }
}

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
  assert.ok(
    item.excerpt.length >= 250,
    `Expected excerpt ≥250 chars, got ${item.excerpt.length} chars`,
  )
})

// ─── Content quality ──────────────────────────────────────────

test("rssAdapter Owl Posting 'cancer vaccine' excerpt skips TOC entries and includes real article content", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  const vaccine = items.find((i) => i.title.includes("cancer vaccine"))
  assert.ok(vaccine, "Expected cancer vaccine article")
  assert.ok(
    !vaccine.excerpt.includes("1. Introduction"),
    "TOC entry '1. Introduction' should be filtered out",
  )
  assert.ok(
    !vaccine.excerpt.includes("INTRODUCTION"),
    "TOC entry 'INTRODUCTION' should be filtered out",
  )
  assert.ok(
    vaccine.excerpt.includes("cancer vaccine") || vaccine.excerpt.includes("normal vaccines"),
    "Excerpt should include actual article content about cancer vaccines",
  )
  const paras = vaccine.excerpt.split(/\n\n/)
  assert.ok(paras.length >= 2, `Expected ≥2 paragraphs in excerpt, got ${paras.length}`)
})

test("rssAdapter Owl Posting 'TIGIT' excerpt is real content, not metadata", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  const tigit = items.find((i) => i.title.includes("TIGIT"))
  assert.ok(tigit, "Expected TIGIT article")
  assert.ok(
    tigit.excerpt.startsWith("There exist drug classes"),
    `Expected real content, got: "${tigit.excerpt.slice(0, 40)}"`,
  )
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
    assert.ok(
      paras[1].includes("ogre") || paras[1].includes("creature"),
      "Second para should be article content",
    )
  }
})

test("rssAdapter For Better Science 'Rui the Drunk' excerpt is real content", async () => {
  const items = await rssAdapterCollect("forbetterscience", { maxItems: 10, maxAgeDays: 365 })
  const rui = items.find((i) => i.title.includes("Rui"))
  assert.ok(rui, "Expected Rui article")
  assert.ok(
    rui.excerpt.includes("dictator") || rui.excerpt.includes("misconduct"),
    "Expected article content about misconduct",
  )
  assert.ok(
    !rui.excerpt.includes("Schneider Shorts"),
    "Should not include Schneider Shorts preamble",
  )
})

test("rssAdapter no image captions in excerpts", async () => {
  const items = await rssAdapterCollect("owlposting", { maxItems: 10, maxAgeDays: 365 })
  for (const item of items) {
    assert.ok(
      !item.excerpt.includes("image caption"),
      `Image caption leaked into excerpt for "${item.title}"`,
    )
    assert.ok(!item.excerpt.includes("figcaption"), "figcaption tag leaked into excerpt")
  }
})

// The excerpt rules, on every item of every real feed fixture. An excerpt is whole paragraphs of
// the article text, separated by one blank line: no markup, no separator lines, no image
// captions, and no more than the three paragraphs the builder takes.
test("every item of the real feed fixtures reads as an excerpt of whole paragraphs", async () => {
  const feeds = [
    ["owlposting", "owlposting-rss.xml", 20],
    ["forbetterscience", "forbetterscience-rss.xml", 10],
    ["ipscell", "ipscell-rss.xml", 10],
    ["liorpachter", "liorpachter-rss.xml", 10],
  ]
  const { rssAdapter } = mod.__test
  for (const [id, file, expected] of feeds) {
    const fm = mockFetch(() => new Response(fixture(file), { status: 200 }))
    let items
    try {
      const adapter = rssAdapter({
        id,
        name: id,
        url: `https://example.test/${id}/feed/`,
        maxAgeDays: 100_000,
        maxItems: 50,
      })
      items = await adapter.collect({ KV: simpleKv() })
    } finally {
      fm.restore()
    }
    assert.equal(items.length, expected, `${id}: every item of the fixture is collected`)
    for (const item of items) {
      const where = `${id}: ${item.title}`
      assert.ok(item.excerpt.length > 0, `${where}: no excerpt`)
      assert.equal(item.excerpt, item.excerpt.trim(), `${where}: untrimmed`)
      const paragraphs = item.excerpt.split("\n\n")
      assert.ok(paragraphs.length <= 3, `${where}: ${paragraphs.length} paragraphs`)
      for (const paragraph of paragraphs) {
        assert.ok(paragraph.trim(), `${where}: an empty paragraph`)
        assert.doesNotMatch(paragraph, /^[-*~=_\s]+$/, `${where}: a separator line is a paragraph`)
      }
      assert.doesNotMatch(item.excerpt, /<\/?[a-z][^>]*>/i, `${where}: markup in the excerpt`)
      assert.doesNotMatch(item.excerpt, /figcaption|image caption/i, `${where}: a caption`)
    }
  }
})

// ─── sitemapAdapter (no-RSS sources) ──────────────────────────

test("sitemapAdapter baselines silently on first run, then posts only new articles", async () => {
  const { sitemapAdapter } = mod.__test
  const kv = simpleKv()
  const baseSitemap = fixture("asimov-sitemap.xml")
  const withNew = baseSitemap.replace(
    "</urlset>",
    "  <url><loc>https://press.asimov.com/articles/new-discovery</loc></url>\n</urlset>",
  )
  const article = fixture("asimov-article.html")
  let sitemapCalls = 0
  const fm = mockFetch((url) => {
    if (String(url).includes("sitemap-0.xml")) {
      sitemapCalls += 1
      return new Response(sitemapCalls === 1 ? baseSitemap : withNew, { status: 200 })
    }
    if (String(url).includes("/articles/")) return new Response(article, { status: 200 })
    return new Response("not found", { status: 404 })
  })
  try {
    const adapter = sitemapAdapter({
      id: "asimovpress",
      name: "Asimov Press",
      sitemapUrl: "https://press.asimov.com/sitemap-0.xml",
      dropSelectors: [".ap-listen-btn"],
      maxAgeDays: 3650,
    })

    const baseline = await adapter.collect({ KV: kv })
    assert.deepEqual(baseline, [], "first run must baseline silently")
    assert.ok(kv._.has("feed_source_seen_v34:asimovpress"), "seen marker must be written")
    assert.ok(
      kv._.has("feed_v34:asimovpress:https://press.asimov.com/articles/adjuvants"),
      "existing article must be marked posted",
    )

    const items = await adapter.collect({ KV: kv })
    assert.equal(items.length, 1, "only the newly discovered article should post")
    const item = items[0]
    assert.equal(item.id, "https://press.asimov.com/articles/new-discovery")
    assert.equal(item.title, "The Origins of Adjuvants")
    assert.equal(item.author, "Kamal Nahas")
    assert.equal(item.publishedAt, "2026-01-15T00:00:00.000Z")
    assert.ok(
      !item.excerpt.includes("Listen to this article"),
      "the listen control must not leak into the excerpt",
    )
    assert.ok(item.excerpt.includes("James Phipps"), "real lead paragraph must be present")
  } finally {
    fm.restore()
  }
})

test("sitemapAdapter first run posts the newest latest-page article and baselines the rest", async () => {
  const { sitemapAdapter } = mod.__test
  const kv = simpleKv()
  const sitemap = fixture("asimov-sitemap.xml")
  const home = fixture("asimov-home.html")
  const article = fixture("asimov-article.html")
  const fm = mockFetch((url) => {
    const u = String(url)
    if (u.includes("sitemap-0.xml")) return new Response(sitemap, { status: 200 })
    if (u === "https://press.asimov.com" || u === "https://press.asimov.com/") {
      return new Response(home, { status: 200 })
    }
    if (u.endsWith("/articles/xenopus")) {
      return new Response(article.replace("2026-01-15", "2026-09-08"), { status: 200 })
    }
    if (u.includes("/articles/")) return new Response(article, { status: 200 })
    return new Response("not found", { status: 404 })
  })
  try {
    const adapter = sitemapAdapter({
      id: "asimovpress",
      name: "Asimov Press",
      sitemapUrl: "https://press.asimov.com/sitemap-0.xml",
      latestPage: "https://press.asimov.com",
      dropSelectors: [".ap-listen-btn"],
      maxAgeDays: 3650,
    })

    const first = await adapter.collect({ KV: kv })
    assert.equal(first.length, 1, "first run posts the single newest article")
    assert.equal(
      first[0].id,
      "https://press.asimov.com/articles/xenopus",
      "newest by published date wins",
    )
    assert.ok(
      !kv._.has("feed_v34:asimovpress:https://press.asimov.com/articles/xenopus"),
      "featured article must stay unposted so the handler posts it",
    )
    assert.ok(
      kv._.has("feed_v34:asimovpress:https://press.asimov.com/articles/adjuvants"),
      "the rest of the catalogue must be baselined",
    )
  } finally {
    fm.restore()
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

// The Owl Posting feed of 2026-06-18 (a real capture), read on 2026-06-20: three posts are within
// the 30 days the source keeps, and together they are longer than one Discord message.
async function runDailyFeed({ discordStatus = 200 } = {}) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-06-20T12:00:00.000Z") })
  const kv = simpleKv()
  // Every source has been read before, so each keeps its age limit and posts what is new.
  for (const id of ["owlposting", "ipscell", "liorpachter", "asimovpress", "clockwork"]) {
    kv._.set(`feed_source_seen_v34:${id}`, "1")
  }
  const posts = []
  const network = mockFetch((url, init) => {
    const parsed = new URL(url)
    if (parsed.hostname === "discord.com") {
      posts.push(JSON.parse(init.body).content)
      return discordStatus === 200
        ? new Response(JSON.stringify({ id: `message-${posts.length}` }), { status: 200 })
        : new Response(JSON.stringify({ message: "Missing Access" }), { status: discordStatus })
    }
    if (parsed.href === "https://www.owlposting.com/feed/") {
      return new Response(fixture("owlposting-rss.xml"), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  })
  try {
    const result = await handlePostDailyFeed({
      KV: kv,
      DISCORD_FEED_CHANNEL_ID: "123",
      DISCORD_BOT_TOKEN: "bot",
    })
    return { result, posts, kv }
  } finally {
    network.restore()
    mock.timers.reset()
  }
}

test("handlePostDailyFeed turns the real Owl Posting feed into Discord messages under Discord's limit", async () => {
  const { result, posts, kv } = await runDailyFeed()
  assert.equal(result.ok, true)
  assert.equal(result.item_count, 3)
  assert.deepEqual(result.sources, ["Owl Posting"])
  assert.ok(posts.length >= 2, `three long posts need more than one message, got ${posts.length}`)
  assert.ok(
    posts.every((content) => content.length <= 2000),
    `Discord refuses a message over 2000 characters: ${posts.map((post) => post.length)}`,
  )
  assert.match(posts[0], /^\*\*Daily Feed — June 20th, 2026\*\*/)
  const all = posts.join("\n")
  for (const title of [
    "The makings of a good bioweapon",
    "How to build a cancer vaccine",
    "The ballad of TIGIT",
  ]) {
    assert.ok(all.includes(title), `${title} was not posted`)
  }
  // Only what was posted is marked posted: the older posts stay for a later day.
  const marked = [...kv._.keys()].filter((key) => key.startsWith("feed_v34:owlposting:"))
  assert.equal(marked.length, 3)
})

test("handlePostDailyFeed marks nothing posted when Discord refuses, so tomorrow posts it", async () => {
  const { result, kv } = await runDailyFeed({ discordStatus: 403 })
  assert.equal(result.ok, false)
  assert.equal(result.error, "post_failed")
  assert.match(result.details, /Discord API 403/)
  assert.deepEqual(
    [...kv._.keys()].filter((key) => key.startsWith("feed_v34:")),
    [],
  )
})

// ─── Helpers ───────────────────────────────────────────────────

function simpleKv() {
  const m = new Map()
  return {
    get: (k) => Promise.resolve(m.get(k) ?? null),
    put: (k, v) => {
      m.set(k, v)
      return Promise.resolve()
    },
    _: m,
  }
}

async function rssAdapterCollect(sourceId, opts = {}) {
  const { rssAdapter } = (await import("./discord-feed.js")).__test
  const xml = fixture(
    sourceId === "owlposting"
      ? "owlposting-rss.xml"
      : sourceId === "forbetterscience"
        ? "forbetterscience-rss.xml"
        : null,
  )
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
