// B-992: the public #iconoplasm Discord channel holds a copy of every gene comment, with the
// author's username in front of it (workers/lib/iconoplasm-comment-discord-mirror.js). The post's
// message id was never stored, and storing it now would only cover comments from today on, so the
// erasure finds the post again instead.
//
// The bot posts a comment's message right after the comment row is written, so the post sits just
// after the row's `created_at` in the channel. One `GET .../messages?after=<snowflake of that
// moment>` returns the next few messages; the one the poster's shape matches for this gene and
// this author is the post. A comment that stays is rewritten to the anonymous label in place
// (PATCH, the bot edits its own message); a comment its author had already removed is deleted
// (DELETE). Two Discord calls per comment at most, and nothing to remember: after an edit the
// message no longer names the person, so a repeat finds nothing and moves on.
import {
  commentMirrorAuthor,
  commentMirrorPostPattern,
  commentMirrorText,
  commentMirrorWithAuthor,
} from "../../lib/iconoplasm-comment-discord-mirror.js"

const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_EPOCH_MS = 1420070400000n
// The post follows the comment by the time the gene card takes to render: seconds, at most a
// minute or two. The window is generous both ways for clock skew between D1 and Discord.
const LOOKBACK_MS = 5_000
const WINDOW_MS = 5 * 60_000
const PAGE_SIZE = 20
// A rate-limit bucket that says it is spent is waited out up to this long; a longer wait ends the
// request and the operator sends it again.
const MAX_PACING_WAIT_MS = 5_000

export class DiscordMirrorError extends Error {
  constructor(message, { retryAfterSeconds = 0, code = "DISCORD_MIRROR_FAILED" } = {}) {
    super(message)
    this.name = "DiscordMirrorError"
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The bot token and channel, or null when this deployment never mirrored comments. */
export function discordMirrorConfig(env) {
  const token = String(env?.DISCORD_BOT_TOKEN || "").trim()
  const channelId = String(env?.DISCORD_ICONOPLASM_CHANNEL_ID || "").trim()
  return token && channelId ? { token, channelId } : null
}

export function snowflakeAtMs(ms) {
  return ((BigInt(Math.trunc(ms)) - DISCORD_EPOCH_MS) << 22n).toString()
}

// `created_at` is an ISO string; a SQLite CURRENT_TIMESTAMP default ("2026-10-03 12:00:00") is UTC.
function commentTimeMs(createdAt) {
  const text = String(createdAt || "").trim()
  if (!text) return NaN
  return Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`)
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function discordCall(config, budget, method, path, body) {
  budget.fetches -= 1
  const response = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${config.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text().catch(() => "")
  if (response.status === 429) {
    let retryAfterSeconds = Number(response.headers.get("retry-after")) || 0
    try {
      retryAfterSeconds = Number(JSON.parse(text)?.retry_after) || retryAfterSeconds
    } catch {
      /* the header is enough */
    }
    throw new DiscordMirrorError("Discord is rate limiting the bot", {
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
      code: "DISCORD_RATE_LIMITED",
    })
  }
  // A spent bucket: wait it out before the next call instead of earning a 429.
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const resetAfterMs = Math.ceil(Number(response.headers.get("x-ratelimit-reset-after")) * 1000)
    if (resetAfterMs > 0) await sleep(Math.min(resetAfterMs, MAX_PACING_WAIT_MS))
  }
  if (response.status === 404 && method !== "GET") return { status: 404, data: null }
  if (!response.ok) {
    const permission = response.status === 401 || response.status === 403
    throw new DiscordMirrorError(
      permission
        ? `Discord refused the bot (${response.status}): it needs View Channel and Read Message History in the comments channel to find the posts it made`
        : `Discord answered ${response.status} while ${method} ${path.split("?")[0].replace(/\/\d+/g, "/:id")}`,
      { code: permission ? "DISCORD_MIRROR_FORBIDDEN" : "DISCORD_MIRROR_UNAVAILABLE" },
    )
  }
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { status: response.status, data }
}

/**
 * Finds the Discord post of one comment and either rewrites its author to `label` or deletes it.
 * Returns "edited", "deleted", or "not_found" (a comment from before the mirror existed, a post a
 * moderator already removed, or one already rewritten by an earlier run).
 * `budget.fetches` is charged for every Discord call; the caller leaves two for each comment.
 */
export async function anonymiseCommentPost(config, budget, comment, { label, remove }) {
  const createdMs = commentTimeMs(comment.created_at)
  if (!Number.isFinite(createdMs)) return "not_found"
  const symbol = String(comment.gene_symbol || "")
  const pattern = commentMirrorPostPattern({ symbol, username: comment.username })
  const { data } = await discordCall(
    config,
    budget,
    "GET",
    `/channels/${encodeURIComponent(config.channelId)}/messages?after=${snowflakeAtMs(
      createdMs - LOOKBACK_MS,
    )}&limit=${PAGE_SIZE}`,
  )
  const candidates = (Array.isArray(data) ? data : [])
    .filter(
      (message) =>
        message?.author?.bot === true &&
        typeof message.content === "string" &&
        pattern.test(message.content) &&
        Date.parse(message.timestamp) <= createdMs + WINDOW_MS,
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  // The post that quotes this comment is the one to delete or rewrite. Without an exact match (an
  // edit on the site after posting, B-1001) the nearest post by the same person on the same gene is
  // still anonymised, because the person's name must leave the channel either way, but it is never
  // deleted: it may be the post of a different comment that stays (a comment from before the mirror
  // has no post of its own).
  const text = commentMirrorText(comment.body)
  const exact = candidates.find((message) => message.content.match(pattern)?.[3] === text)
  const post = exact || candidates[0]
  if (!post) return "not_found"
  const messagePath = `/channels/${encodeURIComponent(config.channelId)}/messages/${encodeURIComponent(post.id)}`
  if (remove && exact) {
    await discordCall(config, budget, "DELETE", messagePath)
    return "deleted"
  }
  const content = commentMirrorWithAuthor(post.content, {
    symbol,
    username: comment.username,
    author: commentMirrorAuthor(label),
  })
  await discordCall(config, budget, "PATCH", messagePath, {
    content,
    allowed_mentions: { parse: [] },
  })
  return "edited"
}
