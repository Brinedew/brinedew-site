import Parser from "rss-parser"
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import { htmlToText } from "html-to-text"

const JSON_HEADERS = { "Content-Type": "application/json" }
const FEED_POSTED_PREFIX = "feed_v34:"
const FEED_ITEM_CACHE_PREFIX = "feed_item_v34:"
const FEED_SOURCE_SEEN_PREFIX = "feed_source_seen_v34:"
const FEED_TTL_SECONDS = 90 * 24 * 60 * 60
const FEED_DISCORD_POST_TIMEOUT_MS = 15000
const FEED_CHANNEL_NAME = "feed"

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/**
 * ─── Excerpt spec ──────────────────────────────────────────────
 *
 * The excerpt is the lead paragraphs of a post, shown as a blockquote in
 * Discord. It must be readable, complete, and never break mid-paragraph.
 *
 * RULES (applied uniformly to all sources):
 *
 * 1. Collect complete paragraphs one at a time.
 * 2. Skip short paragraphs (< 60 chars) — they are metadata artifacts
 *    (TOC entries, acknowledgments, numbered list items). The first
 *    paragraph is always accepted unconditionally.
 * 3. Stop collecting when ANY of these is true:
 *    a. We have ≥2 paragraphs AND ≥250 chars (enough content).
 *    b. Adding the next paragraph would exceed 600 chars AND we already
 *       have ≥2 paragraphs.
 * 4. The excerpt ALWAYS ends at a paragraph boundary. Never cuts
 *    mid-paragraph, never cuts mid-sentence. If this means the excerpt
 *    exceeds 600 chars, that is acceptable — a complete paragraph is
 *    more valuable than an arbitrary character limit.
 *
 * ────────────────────────────────────────────────────────────────
 */

const EXCERPT_MIN_CHARS = 250
const EXCERPT_MAX_CHARS = 600
const EXCERPT_MIN_PARAGRAPHS = 2
const EXCERPT_MIN_PARA_LENGTH = 60

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false,
  preserveNewlines: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
    { selector: "figure", format: "skip" },
    { selector: "figcaption", format: "skip" },
    { selector: "style", format: "skip" },
    { selector: "script", format: "skip" },
  ],
}

/**
 * @typedef {Object} FeedItem
 * @property {string} id          Stable per-post id (RSS guid, permalink, or content hash).
 * @property {string} sourceName  Display name (e.g. "iPSCell", "Owl Posting").
 * @property {string} author      Display author for the post.
 * @property {string} title       Post title.
 * @property {string} url         Canonical post URL (UTM-stripped).
 * @property {string} excerpt     Lead paragraph(s) of the post body.
 * @property {string} publishedAt ISO-8601 publish time.
 * @property {string} text        Full plain-text body (kept in KV cache only).
 */

/**
 * @typedef {Object} Source
 * @property {string} id
 * @property {string} name
 * @property {(env: any) => Promise<FeedItem[]>} collect
 *   Returns FeedItem[] in publish order (newest first is fine).
 *   Each adapter is the only thing that knows how to extract its own content.
 *   No tiered fallbacks. No per-source switches in the pipeline.
 */

function toErrorMessage(err) {
  if (err instanceof Error) return err.message
  return String(err)
}

function stripUtm(url) {
  if (!url) return ""
  const qIndex = url.indexOf("?")
  return qIndex === -1 ? url : url.slice(0, qIndex)
}

function cacheKey(sourceId, itemId) {
  return `${FEED_ITEM_CACHE_PREFIX}${sourceId}:${itemId}`
}

function postedKey(sourceId, itemId) {
  return `${FEED_POSTED_PREFIX}${sourceId}:${itemId}`
}

function sourceSeenKey(sourceId) {
  return `${FEED_SOURCE_SEEN_PREFIX}${sourceId}`
}

function htmlToPlainText(html) {
  if (!html) return ""
  const input = html.length > 50000 ? html.slice(0, 50000) : html
  return htmlToText(input, HTML_TO_TEXT_OPTIONS).replace(/\n{3,}/g, "\n\n").trim()
}

function paragraphsOf(text) {
  if (!text) return []
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0 && !/^[-*_=~]{3,}$/.test(p))
}

/**
 * Excerpt rule — applied uniformly to all sources. No per-source logic.
 *
 * Collect complete paragraphs until one of these conditions is met:
 *   1. We have ≥2 paragraphs AND ≥250 chars (enough content to be useful)
 *   2. Adding the next paragraph would exceed 600 chars
 *
 * The excerpt ALWAYS ends at a paragraph boundary. Never cuts mid-paragraph,
 * never cuts mid-sentence. If a single paragraph is longer than 600 chars,
 * include it whole — it's better to overshoot than to produce a broken snippet.
 *
 * Short paragraphs (< 60 chars) are skipped during accumulation because they
 * are metadata artifacts: numbered list entries, TOC items, acknowledgments.
 * The first paragraph is always accepted unconditionally.
 */
function buildExcerpt(text) {
  const paras = paragraphsOf(text)
  if (paras.length === 0) return ""

  const out = []
  let joined = ""
  for (const p of paras) {
    if (out.length === 0) {
      out.push(p)
      joined = p
    } else {
      if (p.length < EXCERPT_MIN_PARA_LENGTH) continue
      const candidate = joined + "\n\n" + p
      // Stop if we have enough content (≥2 paragraphs AND ≥250 chars).
      if (joined.length >= EXCERPT_MIN_CHARS && out.length >= EXCERPT_MIN_PARAGRAPHS) break
      // Stop if adding this paragraph would exceed the limit and we already
      // have at least 2 paragraphs — don't let one huge paragraph dominate.
      if (candidate.length > EXCERPT_MAX_CHARS && out.length >= EXCERPT_MIN_PARAGRAPHS) break
      out.push(p)
      joined = candidate
    }
  }

  return joined.replace(/\s+([.,;:!?])/g, "$1").trim()
}

async function fetchUrlText(url) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) return null
  const text = await resp.text()
  if (text.length < 200) return null
  return text
}

function extractWithReadability(html) {
  const { document } = parseHTML(html)
  const reader = new Readability(document)
  const article = reader.parse()
  return article?.content || null
}

const rssParser = new Parser({
  customFields: {
    item: [["dc:creator", "creator"], ["content:encoded", "contentEncoded"]],
  },
})

function itemsFromFeed(feed) {
  return (feed.items || []).filter((i) => i.pubDate && !isNaN(Date.parse(i.pubDate)))
}

function feedItemId(item) {
  return item.guid || item.link || item.title || ""
}

function feedItemToOutput(item, sourceName, author) {
  return {
    id: feedItemId(item),
    sourceName,
    author,
    title: (item.title || "").trim(),
    url: stripUtm(item.link || ""),
    excerpt: item.excerpt || "",
    publishedAt: item.pubDate || "",
    text: "",
  }
}

/**
 * Factory: an adapter that pulls items from any standard RSS/Atom feed and
 * extracts body text from a chosen source field. This is the single-file
 * addition contract from the original issue spec.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.name
 * @param {string} opts.url
 * @param {string} [opts.bodyField="contentEncoded"]  RSS field to use as body HTML.
 *   Pass "contentSnippet" for the short pre-trimmed description.
 * @param {number} [opts.maxAgeDays=14]                Skip items older than this.
 * @param {number} [opts.maxItems=5]                   Per-run cap.
 * @param {(author: string) => string} [opts.cleanAuthor]
 */
function rssAdapter(opts) {
  const {
    id,
    name,
    url,
    bodyField = "contentEncoded",
    maxAgeDays = 30,
    maxItems = 5,
    cleanAuthor = (a) => (a || "").trim(),
  } = opts

  return {
    id,
    name,
    async collect(env, { ignoreAge = false } = {}) {
      const xml = await fetchUrlText(url)
      if (!xml) return []
      const feed = await rssParser.parseString(xml)
      const cutoff = ignoreAge ? 0 : Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      const fresh = itemsFromFeed(feed)
        .filter((i) => Date.parse(i.pubDate) >= cutoff)
        .slice(0, maxItems)

      const out = []
      for (const item of fresh) {
        const body = item[bodyField] || item.content || ""
        const text = body ? htmlToPlainText(body) : ""
        if (!text) continue
        const author = cleanAuthor(item.creator || name)
        const cached = await loadCachedItem(env, id, feedItemId(item))
        out.push({
          id: feedItemId(item),
          sourceName: name,
          author,
          title: (item.title || "").trim(),
          url: stripUtm(item.link || ""),
          excerpt: buildExcerpt(text),
          publishedAt: item.pubDate || "",
          text,
          _cached: cached,
        })
      }
      return out
    },
  }
}

/**
 * Factory: an adapter that fetches the article URL (with desktop headers)
 * and runs Readability. For WordPress blogs whose RSS content:encoded is
 * truncated. The fetched HTML is parsed by linkedom; Readability returns
 * the article HTML; we convert to text with html-to-text.
 */
function readabilityAdapter(opts) {
  const { id, name, feedUrl, maxAgeDays = 30, maxItems = 5, cleanAuthor = (a) => (a || "").trim() } = opts

  return {
    id,
    name,
    async collect(env, { ignoreAge = false } = {}) {
      const xml = await fetchUrlText(feedUrl)
      if (!xml) return []
      const feed = await rssParser.parseString(xml)
      const cutoff = ignoreAge ? 0 : Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      const fresh = itemsFromFeed(feed)
        .filter((i) => Date.parse(i.pubDate) >= cutoff)
        .slice(0, maxItems)

      const out = []
      for (const item of fresh) {
        const articleUrl = stripUtm(item.link || "")
        const author = cleanAuthor(item.creator || name)

        const cached = await loadCachedItem(env, id, feedItemId(item))
        if (cached?.text) {
          out.push({
            id: feedItemId(item),
            sourceName: name,
            author,
            title: (item.title || "").trim(),
            url: articleUrl,
            excerpt: buildExcerpt(cached.text),
            publishedAt: item.pubDate || "",
            text: cached.text,
            _cached: cached,
          })
          continue
        }

        if (!articleUrl) continue
        const html = await fetchUrlText(articleUrl)
        if (!html) continue
        const articleHtml = extractWithReadability(html)
        if (!articleHtml) continue
        const text = htmlToPlainText(articleHtml)
        if (!text || text.length < 400) continue

        await env.KV.put(
          cacheKey(id, feedItemId(item)),
          JSON.stringify({ text, fetchedAt: Date.now() }),
          { expirationTtl: FEED_TTL_SECONDS },
        )

        out.push({
          id: feedItemId(item),
          sourceName: name,
          author,
          title: (item.title || "").trim(),
          url: articleUrl,
          excerpt: buildExcerpt(text),
          publishedAt: item.pubDate || "",
          text,
        })
      }
      return out
    },
  }
}

/**
 * Factory: an adapter for YouTube channels via the Atom RSS feed.
 * Videos don't need excerpts — Discord auto-embeds the thumbnail
 * when a bare YouTube URL is posted. Sets `linkOnly: true` on each
 * item so the message builder formats accordingly.
 */
function youtubeAdapter(opts) {
  const { id, name, channelId, maxAgeDays = 30, maxItems = 10 } = opts
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

  return {
    id,
    name,
    async collect(env, { ignoreAge = false } = {}) {
      const xml = await fetchUrlText(feedUrl)
      if (!xml) return []
      const feed = await rssParser.parseString(xml)
      const cutoff = ignoreAge ? 0 : Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      const fresh = itemsFromFeed(feed)
        .filter((i) => Date.parse(i.pubDate) >= cutoff)
        .slice(0, maxItems)

      return fresh.map((item) => {
        const videoId = item.id?.replace("yt:video:", "") || ""
        const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : stripUtm(item.link || "")
        return {
          id: item.id || item.guid || item.link || item.title || "",
          sourceName: name,
          author: name,
          title: (item.title || "").trim(),
          url,
          excerpt: "",
          publishedAt: item.pubDate || "",
          text: "",
          linkOnly: true,
        }
      })
    },
  }
}

async function loadCachedItem(env, sourceId, itemId) {
  if (!itemId) return null
  const raw = await env.KV.get(cacheKey(sourceId, itemId))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const SOURCES = [
  // Substack: full content lives in RSS content:encoded. Never fetch the SPA.
  rssAdapter({
    id: "owlposting",
    name: "Owl Posting",
    url: "https://www.owlposting.com/feed/",
  }),
  // WordPress: RSS content:encoded is truncated, so fetch the article URL
  // and run Readability. KV caches the extracted text so Worker IP / edge
  // cache divergences stop being a class of bug.
  readabilityAdapter({
    id: "ipscell",
    name: "iPSCell",
    feedUrl: "https://ipscell.com/feed/",
    cleanAuthor: (a) =>
      (a || "")
        .replace(/^(Professor|Prof\.?|Dr\.?)\s+/i, "")
        .replace(/\s*,\s*(Ph\.?D\.?|M\.?D\.?|Esq\.?)\s*/gi, "")
        .trim(),
  }),
  readabilityAdapter({
    id: "liorpachter",
    name: "Lior Pachter",
    feedUrl: "https://liorpachter.wordpress.com/feed/",
  }),
  youtubeAdapter({
    id: "clockwork",
    name: "Clockwork",
    channelId: "UCIZa-t5ctYtAn6BruNTxxwQ",
  }),
]

function buildFeedMessage(items, { includeHeader = true } = {}) {
  if (items.length === 0) return null
  const now = new Date()
  const day = now.getUTCDate()
  const suffix = [null, "st", "nd", "rd"][day % 10] || "th"
  const header = `**Daily Feed — ${now.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${day}${suffix}, ${now.getUTCFullYear()}**`

  const blocks = items.map((item) => {
    const byline = item.author?.trim() || item.sourceName
    const titleLine = item.url
      ? `*${byline}* — **[${item.title}](${item.url})**`
      : `*${byline}* — **${item.title}**`
    // linkOnly items (YouTube): just the title link. Discord embeds the
    // thumbnail from the hyperlink automatically. No bare URL, no excerpt.
    if (item.linkOnly) return titleLine
    if (!item.excerpt) return titleLine
    return `${titleLine}\n> ${item.excerpt.replace(/\n/g, "\n> ")}`
  })

  const chunks = []
  let current = includeHeader ? header : blocks[0]
  const start = includeHeader ? 0 : 1
  for (let i = start; i < blocks.length; i++) {
    const block = blocks[i]
    const candidate = current + "\n\n" + block
    if (candidate.length <= 1900) {
      current = candidate
    } else {
      chunks.push(current)
      current = block
    }
  }
  chunks.push(current)
  return { chunks }
}

async function postDiscordMessage(env, channelId, content) {
  const botToken = env.DISCORD_BOT_TOKEN
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort("discord_feed_timeout"), FEED_DISCORD_POST_TIMEOUT_MS)
  let resp
  try {
    resp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  const body = await resp.text()
  if (!resp.ok) throw new Error(`Discord API ${resp.status}: ${body || "empty"}`)
  const parsed = body ? JSON.parse(body) : null
  if (!parsed?.id) throw new Error("Discord response missing message id")
  return parsed.id
}

async function postFeedToDiscord(env, chunks) {
  let channelId = env.DISCORD_FEED_CHANNEL_ID
  if (!channelId) {
    channelId = await ensureFeedChannel(env)
    if (!channelId) throw new Error("DISCORD_FEED_CHANNEL_ID not configured")
  }
  const ids = []
  for (const content of chunks) ids.push(await postDiscordMessage(env, channelId, content))
  return ids
}

async function ensureFeedChannel(env) {
  const botToken = env.DISCORD_BOT_TOKEN
  const guildId = env.DISCORD_GUILD_ID
  if (!botToken || !guildId) return null
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FEED_CHANNEL_NAME, type: 0, topic: "Daily feed" }),
  })
  if (!r.ok) return null
  const data = await r.json()
  return data?.id || null
}

async function markPostedMulti(env, sourceId, items) {
  const expiration = Math.floor(Date.now() / 1000) + FEED_TTL_SECONDS
  await Promise.all(items.map((item) => env.KV.put(postedKey(sourceId, item.id), "1", { expiration })))
}

async function filterUnposted(env, sourceId, items) {
  const out = []
  for (const item of items) {
    const seen = await env.KV.get(postedKey(sourceId, item.id))
    if (!seen) out.push(item)
  }
  return out
}

export async function handlePostDailyFeed(env) {
  const allNew = []
  const bySource = new Map()

  for (const source of SOURCES) {
    try {
      const seen = await env.KV.get(sourceSeenKey(source.id))
      const ignoreAge = !seen
      const collected = await source.collect(env, { ignoreAge })
      console.log(`[FEED] ${source.id}: collected ${collected.length} items (ignoreAge=${ignoreAge})`)
      const filtered = await filterUnposted(env, source.id, collected)
      console.log(`[FEED] ${source.id}: ${filtered.length} unposted after filter`)
      if (filtered.length > 0) {
        // First-post guarantee: only include the latest item for unseen sources
        const items = ignoreAge ? [filtered[0]] : filtered
        allNew.push(...items)
        bySource.set(source.id, items)
      }
    } catch (err) {
      console.warn(`[FEED] Failed for ${source.id}:`, toErrorMessage(err))
    }
  }

  if (allNew.length === 0) {
    return { ok: true, skipped: "no_new_content", day: new Date().toISOString().slice(0, 10) }
  }

  // Split text items and link-only (video) items into separate messages.
  // Videos get their own messages so Discord embeds the thumbnail cleanly.
  const textItems = allNew.filter((i) => !i.linkOnly)
  const videoItems = allNew.filter((i) => i.linkOnly)

  const allChunks = []
  if (textItems.length > 0) {
    const built = buildFeedMessage(textItems, { includeHeader: true })
    if (built) allChunks.push(...built.chunks)
  }
  if (videoItems.length > 0) {
    const built = buildFeedMessage(videoItems, { includeHeader: false })
    if (built) allChunks.push(...built.chunks)
  }

  if (allChunks.length === 0) {
    return { ok: true, skipped: "no_content", day: new Date().toISOString().slice(0, 10) }
  }

  try {
    const ids = await postFeedToDiscord(env, allChunks)
    // Mark as posted only AFTER Discord confirms receipt.
    for (const [sourceId, items] of bySource) {
      await markPostedMulti(env, sourceId, items)
      await env.KV.put(sourceSeenKey(sourceId), "1")
    }
    return {
      ok: true,
      day: new Date().toISOString().slice(0, 10),
      message_ids: ids,
      sources: [...new Set(allNew.map((i) => i.sourceName))],
      item_count: allNew.length,
    }
  } catch (err) {
    return { ok: false, error: "post_failed", day: new Date().toISOString().slice(0, 10), details: toErrorMessage(err) }
  }
}

export async function handlePostFeed(request, env) {
  const result = await handlePostDailyFeed(env)
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: JSON_HEADERS,
  })
}

export const __test = {
  buildExcerpt,
  paragraphsOf,
  htmlToPlainText,
  buildFeedMessage,
  rssAdapter,
  readabilityAdapter,
  extractWithReadability,
}
