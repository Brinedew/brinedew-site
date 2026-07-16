import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { deliverPendingRequestFulfillmentNotifications } from "./iconoplasm-request-notifications.js"

const BRINEDEW_USER_ID = "1289482311557058641"

class NotificationStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    if (this.sql.includes("COUNT(*) AS unread_count")) {
      return { unread_count: this.db.notifications.filter((row) => !row.read_at).length }
    }
    return null
  }

  async all() {
    if (
      this.sql.includes("FROM icono_request_notifications n") &&
      this.sql.includes("discord_status IN")
    ) {
      return {
        results: this.db.notifications.filter((row) =>
          ["pending", "retry"].includes(row.discord_status),
        ),
      }
    }
    if (this.sql.includes("FROM icono_request_notifications n")) {
      return { results: this.db.notifications }
    }
    if (this.sql.includes("FROM icono_generation_requests gr")) {
      return { results: this.db.openRequests }
    }
    return { results: [] }
  }

  async run() {
    if (this.sql.includes("SET read_at = COALESCE")) {
      const userId = String(this.args[0] || "")
      const ids = this.args.slice(1).map(Number)
      let changes = 0
      for (const row of this.db.notifications) {
        if (row.requester_user_id !== userId || row.read_at) continue
        if (ids.length && !ids.includes(Number(row.id))) continue
        row.read_at = "2026-07-16 14:00:00"
        changes += 1
      }
      return { meta: { changes } }
    }
    if (this.sql.includes("discord_attempt_count = discord_attempt_count + 1")) {
      const row = this.db.notifications.find((item) => Number(item.id) === Number(this.args[0]))
      if (!row || !["pending", "retry"].includes(row.discord_status))
        return { meta: { changes: 0 } }
      row.discord_status = "sending"
      row.discord_attempt_count = Number(row.discord_attempt_count || 0) + 1
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("SET discord_status = ?")) {
      const id = Number(this.args[5])
      const row = this.db.notifications.find((item) => Number(item.id) === id)
      if (!row) return { meta: { changes: 0 } }
      row.discord_status = String(this.args[0] || "")
      row.discord_channel_id = String(this.args[2] || "")
      row.discord_message_id = String(this.args[3] || "")
      row.discord_error = String(this.args[4] || "")
      return { meta: { changes: 1 } }
    }
    throw new Error(`Unexpected notification SQL: ${this.sql}`)
  }
}

class NotificationDb {
  constructor(notifications = [], openRequests = []) {
    this.notifications = notifications
    this.openRequests = openRequests
  }

  prepare(sql) {
    return new NotificationStatement(this, sql)
  }
}

function buildSessionBinding(userId = BRINEDEW_USER_ID) {
  return {
    idFromName(name) {
      return name
    },
    get() {
      return {
        async fetch() {
          return Response.json({ user_id: userId, username: "brinedew" })
        },
      }
    },
  }
}

function notificationRow(overrides = {}) {
  return {
    id: 7,
    notification_key: "request_fulfilled:42:" + "a".repeat(64),
    request_id: 42,
    requester_user_id: BRINEDEW_USER_ID,
    gene_symbol: "INS",
    request_kind: "new_candidate",
    fulfilled_asset_sha256: "a".repeat(64),
    fulfilled_vision_id: "anima-v1-4527",
    request_mode: "specific",
    requested_vision_id: "anima-v1-4527",
    requested_emulsion_id: "A1-4527",
    requested_emulsion_label: "A1-4527",
    requested_artist_tag: "anima",
    requested_artist_name: "Anima",
    requested_workflow_id: "A1-",
    requested_prompt_version: "4",
    requested_variant_slot: "527",
    fulfillment_note: "fulfilled by workstation website sync",
    created_at: "2026-07-16 13:45:00",
    read_at: null,
    discord_status: "pending",
    discord_attempt_count: 0,
    ...overrides,
  }
}

function validWebpResponse() {
  const bytes = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    0x08,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50, // WEBP
    0x56,
    0x50,
    0x38,
    0x20,
  ])
  return new Response(bytes, { headers: { "Content-Type": "image/webp" } })
}

function deliveryEnv(db) {
  return {
    ICONOPLASM_DB: db,
    DISCORD_BOT_TOKEN: "test-token",
    ICONOPLASM_PORTRAIT_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-storage-access-key",
  }
}

test("notification migration creates inbox rows atomically and never backfills users", () => {
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0047_request_fulfillment_notifications.sql", import.meta.url),
    "utf8",
  )

  assert.match(migration, /AFTER UPDATE OF status ON icono_generation_requests/)
  assert.match(migration, /OLD\.status <> 'fulfilled' AND NEW\.status = 'fulfilled'/)
  assert.match(migration, /INSERT OR IGNORE INTO icono_request_notifications/)
  assert.match(migration, /request_id INTEGER NOT NULL UNIQUE/)
  assert.doesNotMatch(migration, /INSERT[\s\S]+SELECT[\s\S]+FROM icono_generation_requests/i)

  const requestKindMigration = readFileSync(
    new URL("../migrations-iconoplasm/0048_request_notification_request_kind.sql", import.meta.url),
    "utf8",
  )
  assert.match(requestKindMigration, /ADD COLUMN request_kind/)
  assert.match(requestKindMigration, /DROP TRIGGER IF EXISTS/)
  assert.match(requestKindMigration, /NEW\.request_kind/)
  assert.doesNotMatch(
    requestKindMigration,
    /INSERT[\s\S]+SELECT[\s\S]+FROM icono_generation_requests/i,
  )
})

test("authenticated inbox returns exact fulfillment context and durable unread count", async () => {
  const db = new NotificationDb(
    [notificationRow()],
    [
      {
        id: 51,
        gene_symbol: "TP53",
        requester_user_id: BRINEDEW_USER_ID,
        request_mode: "random",
        requested_vision_id: "",
        request_kind: "new_candidate",
        status: "open",
        created_at: "2026-07-16 13:50:00",
      },
    ],
  )
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/notifications", {
        headers: { Cookie: "session=test" },
      }),
      { ICONOPLASM_DB: db, GAME_SESSIONS: buildSessionBinding() },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, true)
  assert.equal(payload.unread_count, 1)
  assert.equal(payload.open_count, 1)
  assert.equal(payload.notifications[0].request_id, 42)
  assert.equal(payload.notifications[0].gene_symbol, "INS")
  assert.equal(payload.notifications[0].requested_emulsion_label, "A1-4527")
  assert.match(payload.notifications[0].image_url, /a{64}\/thumb\.webp$/)
})

test("read state is written only inside the authenticated requester's inbox", async () => {
  const own = notificationRow({ id: 7 })
  const anotherUser = notificationRow({
    id: 8,
    request_id: 43,
    requester_user_id: "757634039292362843",
  })
  const db = new NotificationDb([own, anotherUser])
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/notifications/read", {
        method: "POST",
        headers: { Cookie: "session=test", "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: [7, 8] }),
      }),
      { ICONOPLASM_DB: db, GAME_SESSIONS: buildSessionBinding() },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.marked_read, 1)
  assert.ok(own.read_at)
  assert.equal(anotherUser.read_at, null)
})

test("non-Brinedew fulfillment is suppressed before any Discord fetch", async () => {
  const row = notificationRow({ requester_user_id: "757634039292362843" })
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error("Discord must not be called")
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(
      { ICONOPLASM_DB: db, DISCORD_BOT_TOKEN: "test-token" },
      { requestIds: [42] },
    )
    assert.equal(result.suppressed, 1)
    assert.equal(result.delivered, 0)
    assert.equal(fetchCalls, 0)
    assert.equal(row.discord_status, "suppressed_not_test_recipient")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Brinedew fulfillment sends one nonce-enforced DM and is retry-idempotent", async () => {
  const row = notificationRow({ request_mode: "random" })
  const db = new NotificationDb([row])
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init }
    calls.push(call)
    if (call.url.includes("storage.bunnycdn.com")) return validWebpResponse()
    if (call.url.endsWith("/users/@me/channels")) {
      call.json = JSON.parse(String(init?.body || "{}"))
      return Response.json({ id: "dm-channel-1" })
    }
    call.form = init?.body
    call.json = JSON.parse(String(call.form.get("payload_json") || "{}"))
    call.file = call.form.get("files[0]")
    return Response.json({ id: "discord-message-1" })
  }
  try {
    const first = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })
    const second = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })

    assert.equal(first.delivered, 1)
    assert.equal(second.considered, 0)
    assert.equal(calls.length, 3)
    assert.match(
      calls[0].url,
      new RegExp(`/iconoplasm-portraits/portraits/v1/aa/${"a".repeat(64)}/full\\.webp$`),
    )
    assert.equal(calls[0].init.headers.AccessKey, "test-storage-access-key")
    assert.equal(calls[1].json.recipient_id, BRINEDEW_USER_ID)
    assert.ok(calls[2].form instanceof FormData)
    assert.equal(calls[2].init.headers["Content-Type"], undefined)
    assert.equal(calls[2].json.nonce, "icono-fulfillment-7")
    assert.equal(calls[2].json.enforce_nonce, true)
    assert.deepEqual(calls[2].json.allowed_mentions, { parse: [] })
    assert.equal(
      calls[2].json.content,
      [
        "Your free queue request is ready.",
        "Gene: **INS**",
        "Emulsion: **Random** (resolved to A1-4527)",
        "Review it here: <https://iconoplasm.brinedew.bio/gene/INS>",
      ].join("\n"),
    )
    assert.deepEqual(calls[2].json.attachments, [
      {
        id: 0,
        filename: `iconoplasm-ins-${"a".repeat(12)}.webp`,
        description: "INS candidate blot from Iconoplasm's free generation queue",
      },
    ])
    assert.equal(calls[2].file.name, `iconoplasm-ins-${"a".repeat(12)}.webp`)
    assert.equal(calls[2].file.type, "image/webp")
    assert.ok(calls[2].file.size > 0)
    assert.equal(row.discord_status, "sent")
    assert.equal(row.discord_message_id, "discord-message-1")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("free blot-edit fulfillment copy preserves its distinct user journey", async () => {
  const row = notificationRow({ request_kind: "edit_image" })
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  let messagePayload
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("storage.bunnycdn.com")) return validWebpResponse()
    if (String(url).endsWith("/users/@me/channels")) {
      return Response.json({ id: "dm-channel-1" })
    }
    messagePayload = JSON.parse(String(init?.body?.get("payload_json") || "{}"))
    return Response.json({ id: "discord-message-1" })
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })

    assert.equal(result.delivered, 1)
    assert.equal(
      messagePayload.content,
      [
        "Your free queue edit request is ready.",
        "Gene: **INS**",
        "Emulsion: **A1-4527**",
        "Review it here: <https://iconoplasm.brinedew.bio/gene/INS>",
      ].join("\n"),
    )
    assert.equal(
      messagePayload.attachments[0].description,
      "INS blot edit from Iconoplasm's free generation queue",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("an ambiguous Discord message POST is terminal and never retried", async () => {
  const row = notificationRow()
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async (url) => {
    fetchCalls += 1
    if (String(url).includes("storage.bunnycdn.com")) return validWebpResponse()
    if (String(url).endsWith("/users/@me/channels")) return Response.json({ id: "dm-channel-1" })
    throw new Error("socket closed after upload")
  }
  try {
    const first = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })
    const second = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })

    assert.equal(first.unknown, 1)
    assert.equal(second.considered, 0)
    assert.equal(fetchCalls, 3)
    assert.equal(row.discord_status, "unknown")
    assert.match(row.discord_error, /outcome unknown/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a missing fulfilled image fails visibly before Discord receives a message", async () => {
  const row = notificationRow()
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    return new Response("missing", { status: 404, headers: { "Content-Type": "text/plain" } })
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })

    assert.equal(result.delivered, 0)
    assert.equal(result.failed, 1)
    assert.equal(urls.length, 1)
    assert.match(urls[0], /storage\.bunnycdn\.com/)
    assert.doesNotMatch(urls[0], /discord\.com/)
    assert.equal(row.discord_status, "failed")
    assert.match(row.discord_error, /portrait download failed \(404\)/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("an interrupted fulfilled image download returns the outbox to retry", async () => {
  const row = notificationRow()
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("storage stream reset"))
        },
      }),
      { headers: { "Content-Type": "image/webp" } },
    )
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })

    assert.equal(result.delivered, 0)
    assert.equal(result.failed, 1)
    assert.equal(row.discord_status, "retry")
    assert.match(row.discord_error, /download interrupted.*storage stream reset/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("request inbox UI uses server read state and bounded live refresh", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const inbox = readFileSync(
    new URL("../quartz/static/iconoplasm/request-inbox.js", import.meta.url),
    "utf8",
  )
  const css = readFileSync(new URL("../quartz/static/custom.css", import.meta.url), "utf8")
  const head = readFileSync(new URL("../quartz/components/Head.tsx", import.meta.url), "utf8")

  assert.match(app, /import \{ createRequestInbox \} from "\.\/request-inbox\.js"/)
  assert.match(inbox, /\/api\/iconoplasm\/notifications\?limit=25/)
  assert.match(inbox, /\/api\/iconoplasm\/notifications\/read/)
  assert.match(inbox, /refreshTimer = window\.setInterval/)
  assert.match(inbox, /document\.visibilityState === "visible"/)
  assert.match(inbox, /data-icono-request-notification-id/)
  assert.doesNotMatch(inbox, /icono_last_seen_fulfilled/)
  assert.match(css, /\.icono-request-inbox__item--unread/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /\.sidebar\.right > \.brd-sidebar-stack[\s\S]*max-height: none/)
  assert.match(head, /custom\.css\?v=\$\{CACHE_BUST\}/)
  assert.doesNotMatch(head, /custom\.css\?v=bio\d+/)
})

test("notification routes stay explicitly classified by the fail-loud cost fence", () => {
  const worker = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )

  assert.match(worker, /family === "request_notifications"\) return "first_party_read"/)
  assert.match(worker, /family === "request_notifications_read"\) return "first_party_write"/)
})
