// B-992, B-993: the two external services an account erasure talks to, as a stateful fake at the
// `fetch` boundary. Production code runs unchanged against it: the real comment poster writes the
// Discord messages, the real portrait storage adapter issues the Bunny deletes. The fake keeps the
// state a real service would (a channel of messages with snowflake ids ordered by time, a bucket of
// objects), enforces the credentials, and can be told to fail, so a test asserts what is left in
// the channel and the bucket rather than which calls were made.
//
// Discord, as the erasure uses it: POST/GET/PATCH/DELETE on /channels/{id}/messages, where GET
// takes `after` and `limit` and answers newest first. Bunny Storage: PUT/GET/HEAD/DELETE on
// /{zone}/{path} with an AccessKey header; DELETE of an absent object answers 404.

export const BOT_TOKEN = "test-bot-token"
export const CHANNEL_ID = "1509977022363865110"
export const STORAGE_ZONE = "test-zone"
export const STORAGE_PASSWORD = "test-storage-password"
export const BOT_USER_ID = "900000000000000009"

const DISCORD_EPOCH = 1420070400000n
const snowflake = (ms, sequence) => ((BigInt(ms) - DISCORD_EPOCH) << 22n) | BigInt(sequence % 4096)

const jsonResponse = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })

export class FakeNetwork {
  constructor() {
    // Bunny Storage: key -> bytes.
    this.objects = new Map()
    // The Discord channel, oldest first.
    this.messages = []
    // Discord's clock: the time a message posted now gets.
    this.clock = Date.parse("2026-09-01T00:00:00.000Z")
    this.sequence = 0
    // Every external call, as "service METHOD path".
    this.calls = []
    // Faults. `discordStatus` answers every Discord call with that status; `rateLimits` is how many
    // of the next Discord calls answer 429; `storageFailures` how many of the next Bunny deletes
    // answer 500.
    this.discordStatus = 0
    this.rateLimits = 0
    this.storageFailures = 0
    this.original = null
  }

  install() {
    this.original = globalThis.fetch
    globalThis.fetch = (url, init) => this.handle(url, init)
  }

  restore() {
    if (this.original) globalThis.fetch = this.original
    this.original = null
  }

  storeObject(key, bytes = new Uint8Array([1, 2, 3])) {
    this.objects.set(key, bytes)
  }

  /** A message as Discord would store it, posted at `at` (ms) by a bot or a person. */
  addMessage({
    content,
    at = this.clock,
    bot = true,
    authorId = bot ? BOT_USER_ID : "700000000000000007",
  }) {
    this.sequence += 1
    const message = {
      id: String(snowflake(at, this.sequence)),
      channel_id: CHANNEL_ID,
      content,
      timestamp: new Date(at).toISOString(),
      author: { id: authorId, bot },
      attachments: [],
    }
    this.messages.push(message)
    this.messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    return message
  }

  callsTo(service) {
    return this.calls.filter((call) => call.startsWith(`${service} `))
  }

  async handle(url, init = {}) {
    const target = new URL(String(url))
    const method = String(init.method || "GET").toUpperCase()
    if (target.host === "discord.com") return this.discord(method, target, init)
    if (target.host === "storage.bunnycdn.com") return this.bunny(method, target, init)
    return this.original(url, init)
  }

  async discord(method, target, init) {
    this.calls.push(`discord ${method} ${target.pathname}`)
    if (this.discordStatus) return jsonResponse({ message: "fault", code: 0 }, this.discordStatus)
    if (init.headers?.Authorization !== `Bot ${BOT_TOKEN}`) {
      return jsonResponse({ message: "401: Unauthorized", code: 0 }, 401)
    }
    if (this.rateLimits > 0) {
      this.rateLimits -= 1
      return jsonResponse({ message: "You are being rate limited.", retry_after: 2.5 }, 429, {
        "Retry-After": "3",
      })
    }
    const route = target.pathname.match(/^\/api\/v10\/channels\/(\d+)\/messages(?:\/(\d+))?$/)
    if (!route || route[1] !== CHANNEL_ID) {
      return jsonResponse({ message: "Unknown Channel", code: 10003 }, 404)
    }
    const messageId = route[2]
    if (method === "POST" && !messageId) {
      const body = init.body
      const payload =
        body instanceof FormData ? JSON.parse(String(body.get("payload_json"))) : JSON.parse(body)
      return jsonResponse(this.addMessage({ content: payload.content }))
    }
    if (method === "GET" && !messageId) {
      const limit = Math.min(100, Math.max(1, Number(target.searchParams.get("limit")) || 50))
      const after = target.searchParams.get("after")
      const pool = after
        ? this.messages.filter((message) => BigInt(message.id) > BigInt(after))
        : this.messages.slice(-limit)
      // After a message: the ones nearest to it, handed back newest first, like the API.
      return jsonResponse(pool.slice(0, limit).reverse())
    }
    const message = this.messages.find((candidate) => candidate.id === messageId)
    if (!message) return jsonResponse({ message: "Unknown Message", code: 10008 }, 404)
    if (method === "PATCH") {
      const payload = JSON.parse(init.body)
      if (typeof payload.content === "string") message.content = payload.content
      message.edited_timestamp = new Date(this.clock).toISOString()
      return jsonResponse(message)
    }
    if (method === "DELETE") {
      this.messages = this.messages.filter((candidate) => candidate.id !== messageId)
      return new Response(null, { status: 204 })
    }
    return jsonResponse({ message: "405: Method Not Allowed", code: 0 }, 405)
  }

  async bunny(method, target, init) {
    this.calls.push(`bunny ${method} ${target.pathname}`)
    if (init.headers?.AccessKey !== STORAGE_PASSWORD) {
      return jsonResponse({ HttpCode: 401, Message: "Unauthorized" }, 401)
    }
    const prefix = `/${STORAGE_ZONE}/`
    if (!target.pathname.startsWith(prefix)) return jsonResponse({ HttpCode: 404 }, 404)
    const key = decodeURIComponent(target.pathname.slice(prefix.length))
    if (method === "PUT") {
      this.objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()))
      return jsonResponse({ HttpCode: 201, Message: "File uploaded." }, 201)
    }
    if (method === "DELETE") {
      if (this.storageFailures > 0) {
        this.storageFailures -= 1
        return jsonResponse({ HttpCode: 500, Message: "fault" }, 500)
      }
      if (!this.objects.delete(key)) return jsonResponse({ HttpCode: 404 }, 404)
      return jsonResponse({ HttpCode: 200, Message: "File deleted successfully." })
    }
    if (method === "GET" || method === "HEAD") {
      if (!this.objects.has(key)) return jsonResponse({ HttpCode: 404 }, 404)
      return new Response(method === "HEAD" ? null : this.objects.get(key), { status: 200 })
    }
    return jsonResponse({ HttpCode: 405 }, 405)
  }
}
