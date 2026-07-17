import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  reconcileDeliveredRequestFulfillments,
  resolveIconoplasmFulfillmentDeliveryPolicy,
} from "./iconoplasm-request-notifications.js"
import { createRequestInbox } from "../quartz/static/iconoplasm/request-inbox.js"

const BRINEDEW_USER_ID = "1289482311557058641"

test("DM delivery policy defaults to Brinedew-only and expands only with the exact rollout flag", () => {
  assert.deepEqual(resolveIconoplasmFulfillmentDeliveryPolicy({}), {
    mode: "brinedew_test",
    all_requesters: false,
    test_recipient_id: BRINEDEW_USER_ID,
  })
  assert.deepEqual(
    resolveIconoplasmFulfillmentDeliveryPolicy({
      ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters",
    }),
    {
      mode: "all_requesters",
      all_requesters: true,
      test_recipient_id: BRINEDEW_USER_ID,
    },
  )
  assert.equal(
    resolveIconoplasmFulfillmentDeliveryPolicy({
      ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requester",
    }).all_requesters,
    false,
  )
})

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
      const requesterUserId = String(this.args[0] || "")
      return {
        unread_count: this.db.notifications.filter(
          (row) =>
            row.requester_user_id === requesterUserId &&
            row.discord_status === "sent" &&
            !row.read_at,
        ).length,
      }
    }
    if (this.sql.includes("AS ready_count") && this.sql.includes("AS cancelled_count")) {
      const requesterUserId = String(this.args[0] || "")
      const rows = [...this.db.readyRequests, ...this.db.openRequests].filter(
        (row) => row.requester_user_id === requesterUserId,
      )
      return {
        ready_count: rows.filter((row) => row.status === "fulfilled").length,
        open_count: rows.filter((row) => ["open", "delivery_pending"].includes(row.status)).length,
        cancelled_count: this.db.cancelledRequests.filter(
          (row) => row.requester_user_id === requesterUserId,
        ).length,
      }
    }
    return null
  }

  async all() {
    if (
      this.sql.includes("FROM icono_request_notifications n") &&
      this.sql.includes("discord_status IN")
    ) {
      const deliverableStatuses = this.args.filter((value) =>
        ["pending", "retry", "suppressed_not_test_recipient"].includes(String(value || "")),
      )
      return {
        results: this.db.notifications.filter((row) =>
          deliverableStatuses.includes(row.discord_status),
        ),
      }
    }
    if (this.sql.includes("FROM icono_request_notifications n")) {
      const requesterUserId = String(this.args[0] || "")
      const requestIds = this.args.slice(1).map(Number).filter(Boolean)
      return {
        results: this.db.notifications.filter(
          (row) =>
            row.requester_user_id === requesterUserId &&
            row.discord_status === "sent" &&
            (!requestIds.length || requestIds.includes(Number(row.request_id))),
        ),
      }
    }
    if (this.sql.includes("FROM icono_generation_requests gr")) {
      const requesterScoped = this.sql.includes("gr.requester_user_id = ?")
      const requesterUserId = String(
        requesterScoped
          ? this.args.find(
              (value) => !["open", "delivery_pending"].includes(String(value || "")),
            ) || ""
          : "",
      )
      const source = this.sql.includes("gr.status = 'fulfilled'")
        ? this.db.readyRequests
        : this.db.openRequests
      return {
        results: requesterScoped
          ? source.filter((row) => row.requester_user_id === requesterUserId)
          : source,
      }
    }
    return { results: [] }
  }

  async run() {
    if (this.sql.includes("SET read_at = COALESCE")) {
      const userId = String(this.args[0] || "")
      const ids = this.args.slice(1).map(Number)
      let changes = 0
      for (const row of this.db.notifications) {
        if (row.requester_user_id !== userId || row.discord_status !== "sent" || row.read_at)
          continue
        if (ids.length && !ids.includes(Number(row.id))) continue
        row.read_at = "2026-07-16 14:00:00"
        changes += 1
      }
      return { meta: { changes } }
    }
    if (this.sql.includes("discord_attempt_count = discord_attempt_count + 1")) {
      const row = this.db.notifications.find((item) => Number(item.id) === Number(this.args[0]))
      if (
        !row ||
        !["pending", "retry", "suppressed_not_test_recipient"].includes(row.discord_status)
      )
        return { meta: { changes: 0 } }
      row.discord_status = "sending"
      row.discord_attempt_count = Number(row.discord_attempt_count || 0) + 1
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("SET discord_status = ?")) {
      const id = Number(this.args[6])
      const row = this.db.notifications.find((item) => Number(item.id) === id)
      if (!row) return { meta: { changes: 0 } }
      row.discord_status = String(this.args[0] || "")
      row.discord_channel_id = String(this.args[2] || "")
      row.discord_message_id = String(this.args[3] || "")
      row.discord_error = String(this.args[4] || "")
      row.discord_next_attempt_at = String(this.args[5] || "")
      return { meta: { changes: 1 } }
    }
    throw new Error(`Unexpected notification SQL: ${this.sql}`)
  }
}

class NotificationDb {
  constructor(notifications = [], openRequests = [], readyRequests = null, cancelledRequests = []) {
    this.notifications = notifications
    this.openRequests = openRequests
    this.readyRequests = Array.isArray(readyRequests)
      ? readyRequests
      : notifications
          .filter((row) => row.discord_status === "sent")
          .map((row) => ({
            id: row.request_id,
            gene_symbol: row.gene_symbol,
            requester_user_id: row.requester_user_id,
            requester_username: "requester",
            request_mode: row.request_mode,
            requested_vision_id: row.requested_vision_id,
            requested_emulsion_id: row.requested_emulsion_id,
            requested_emulsion_label: row.requested_emulsion_label,
            request_kind: row.request_kind,
            status: "fulfilled",
            created_at: row.created_at,
            updated_at: row.created_at,
            fulfilled_at: row.created_at,
            fulfilled_asset_sha256: row.fulfilled_asset_sha256,
            fulfilled_vision_id: row.fulfilled_vision_id,
          }))
    this.cancelledRequests = cancelledRequests
  }

  prepare(sql) {
    return new NotificationStatement(this, sql)
  }
}

class DeliveryReconciliationStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async run() {
    if (!this.sql.includes("UPDATE icono_generation_requests")) {
      throw new Error(`Unexpected reconciliation SQL: ${this.sql}`)
    }
    const ids = this.args.map(Number)
    let changes = 0
    for (const request of this.db.requests) {
      if (ids.length && !ids.includes(Number(request.id))) continue
      const notification = this.db.notifications.find(
        (row) => Number(row.request_id) === Number(request.id),
      )
      if (request.status !== "delivery_pending" || notification?.discord_status !== "sent") continue
      request.status = "fulfilled"
      changes += 1
    }
    return { meta: { changes } }
  }

  async all() {
    if (!this.sql.includes("FROM icono_generation_requests")) {
      throw new Error(`Unexpected reconciliation SQL: ${this.sql}`)
    }
    const ids = this.args.map(Number)
    return {
      results: this.db.requests
        .filter(
          (request) => ids.includes(Number(request.id)) && request.status === "delivery_pending",
        )
        .map((request) => ({ id: request.id })),
    }
  }
}

class DeliveryReconciliationDb {
  constructor({ requests, notifications }) {
    this.requests = requests
    this.notifications = notifications
  }

  prepare(sql) {
    return new DeliveryReconciliationStatement(this, sql)
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
    [notificationRow({ discord_status: "sent" })],
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
  assert.equal(payload.ready_count, 1)
  assert.equal(payload.open_count, 1)
  assert.equal(payload.ready_requests[0].request_id, 42)
  assert.equal(payload.ready_requests[0].notification_id, 7)
  assert.equal(payload.ready_requests[0].gene_symbol, "INS")
  assert.equal(payload.ready_requests[0].requested_emulsion_label, "A1-4527")
  assert.match(payload.ready_requests[0].image_url, /a{64}\/thumb\.webp$/)
})

test("request inbox keeps repeated submissions separate from delivery notices", async () => {
  const sent = notificationRow({ request_id: 37, discord_status: "sent" })
  const repeatedRequests = [37, 2, 1].map((id) => ({
    id,
    gene_symbol: "HPN",
    requester_user_id: BRINEDEW_USER_ID,
    requester_username: "brinedew",
    request_mode: "random",
    requested_vision_id: "",
    request_kind: "new_candidate",
    status: "fulfilled",
    created_at: `2026-04-05 10:38:0${id === 37 ? 4 : id}`,
    updated_at: "2026-07-16 11:45:32",
    fulfilled_at: "2026-07-16 11:45:32",
    fulfilled_asset_sha256: "a".repeat(64),
    fulfilled_vision_id: "anima-v1-1",
  }))
  const db = new NotificationDb([sent], [], repeatedRequests, [
    {
      id: 35,
      requester_user_id: BRINEDEW_USER_ID,
      status: "cancelled",
    },
  ])
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
  assert.equal(payload.ready_count, 3)
  assert.equal(payload.cancelled_count, 1)
  assert.deepEqual(
    payload.ready_requests.map((row) => row.request_id),
    [37, 2, 1],
  )
  assert.equal(payload.ready_requests[0].notification_id, 7)
  assert.equal(payload.ready_requests[1].notification_id, 0)
  assert.equal(payload.ready_requests[2].notification_id, 0)
  assert.ok(payload.ready_requests.every((row) => row.gene_symbol === "HPN"))
})

test("a request stays waiting until Discord delivery is confirmed", async () => {
  const db = new NotificationDb(
    [notificationRow({ discord_status: "retry" })],
    [
      {
        id: 42,
        gene_symbol: "INS",
        requester_user_id: BRINEDEW_USER_ID,
        request_mode: "specific",
        requested_vision_id: "anima-v1-4527",
        request_kind: "new_candidate",
        status: "delivery_pending",
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
  assert.equal(payload.unread_count, 0)
  assert.deepEqual(payload.ready_requests, [])
  assert.equal(payload.open_count, 1)
  assert.deepEqual(
    payload.open_requests.map((row) => row.request_id),
    [42],
  )
})

test("only a sent Discord outbox row can complete a delivery-pending request", async () => {
  const request = { id: 42, status: "delivery_pending" }
  const notification = notificationRow({ discord_status: "retry" })
  const db = new DeliveryReconciliationDb({ requests: [request], notifications: [notification] })

  const waiting = await reconcileDeliveredRequestFulfillments(
    { ICONOPLASM_DB: db },
    { requestIds: [42] },
  )
  assert.equal(waiting.finalized, 0)
  assert.deepEqual(waiting.pending_request_ids, [42])
  assert.equal(request.status, "delivery_pending")

  notification.discord_status = "sent"
  const delivered = await reconcileDeliveredRequestFulfillments(
    { ICONOPLASM_DB: db },
    { requestIds: [42] },
  )
  assert.equal(delivered.finalized, 1)
  assert.deepEqual(delivered.pending_request_ids, [])
  assert.equal(request.status, "fulfilled")
})

test("each user sees only their own inbox and waiting requests", async () => {
  const otherUserId = "757634039292362843"
  const db = new NotificationDb(
    [
      notificationRow({
        id: 7,
        request_id: 42,
        requester_user_id: BRINEDEW_USER_ID,
        discord_status: "sent",
      }),
      notificationRow({
        id: 8,
        request_id: 43,
        requester_user_id: otherUserId,
        gene_symbol: "NR3C2",
        discord_status: "sent",
      }),
    ],
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
      {
        id: 52,
        gene_symbol: "NR3C2",
        requester_user_id: otherUserId,
        request_mode: "specific",
        requested_vision_id: "anima-v1-2048",
        request_kind: "new_candidate",
        status: "open",
        created_at: "2026-07-16 13:51:00",
      },
    ],
  )

  const brinedewResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/notifications", {
        headers: { Cookie: "session=test" },
      }),
      { ICONOPLASM_DB: db, GAME_SESSIONS: buildSessionBinding(BRINEDEW_USER_ID) },
      { waitUntil() {} },
    )
  const otherResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/notifications", {
        headers: { Cookie: "session=test" },
      }),
      { ICONOPLASM_DB: db, GAME_SESSIONS: buildSessionBinding(otherUserId) },
      { waitUntil() {} },
    )
  const brinedewInbox = await brinedewResponse.json()
  const otherInbox = await otherResponse.json()

  assert.deepEqual(
    brinedewInbox.ready_requests.map((row) => row.request_id),
    [42],
  )
  assert.deepEqual(
    brinedewInbox.open_requests.map((row) => row.request_id),
    [51],
  )
  assert.equal(brinedewInbox.unread_count, 1)
  assert.equal(brinedewInbox.open_count, 1)

  assert.deepEqual(
    otherInbox.ready_requests.map((row) => row.request_id),
    [43],
  )
  assert.deepEqual(
    otherInbox.open_requests.map((row) => row.request_id),
    [52],
  )
  assert.equal(otherInbox.unread_count, 1)
  assert.equal(otherInbox.open_count, 1)
})

test("read state is written only inside the authenticated requester's inbox", async () => {
  const own = notificationRow({ id: 7, discord_status: "sent" })
  const anotherUser = notificationRow({
    id: 8,
    request_id: 43,
    requester_user_id: "757634039292362843",
    discord_status: "sent",
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

test("explicit all-requesters mode delivers a held test-period notification", async () => {
  const otherUserId = "757634039292362843"
  const row = notificationRow({
    requester_user_id: otherUserId,
    discord_status: "suppressed_not_test_recipient",
  })
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
    return Response.json({ id: "discord-message-1" })
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(
      {
        ...deliveryEnv(db),
        ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters",
      },
      { requestIds: [42] },
    )

    assert.equal(result.delivered, 1)
    assert.equal(calls.length, 3)
    assert.equal(calls[1].json.recipient_id, otherUserId)
    assert.equal(row.discord_status, "sent")
    assert.equal(row.discord_error, "")
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
  assert.match(inbox, /\/api\/iconoplasm\/notifications\?limit=50/)
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

test("request inbox uses one-open Shoelace groups and an accessible unread dot", async () => {
  const payload = {
    ok: true,
    authenticated: true,
    unread_count: 1,
    ready_count: 1,
    open_count: 1,
    cancelled_count: 0,
    ready_requests: [
      {
        id: 7,
        request_id: 42,
        notification_id: 7,
        unread: true,
        gene_symbol: "INS",
        gene_url: "/gene/INS",
        image_url: "https://example.test/ins.webp",
        requested_emulsion_label: "Random default",
        fulfilled_at: "2026-07-16 13:45:00",
      },
    ],
    open_requests: [
      {
        id: 51,
        gene_symbol: "DNMT3B",
        gene_url: "/gene/DNMT3B",
        requested_emulsion_label: "A1-1370",
        created_at: "2026-07-16 13:50:00",
      },
    ],
  }
  const inbox = createRequestInbox({
    fetchJSON: async () => payload,
    getCurrentUser: () => ({ id: BRINEDEW_USER_ID }),
    renderSidebar() {},
    escapeHtml: (value) => String(value ?? ""),
  })
  await inbox.refresh()

  const initialMarkup = inbox.panelMarkup()
  assert.equal((initialMarkup.match(/<sl-details/g) || []).length, 2)
  assert.match(initialMarkup, /data-icono-request-group="ready" open/)
  assert.doesNotMatch(initialMarkup, /data-icono-request-group="waiting" open/)
  assert.match(initialMarkup, /data-icono-request-id="42"/)
  assert.match(initialMarkup, /data-icono-request-notification-id="7"/)
  assert.match(initialMarkup, /<sl-badge[^>]+variant="danger"[^>]+aria-hidden="true"/)
  assert.match(initialMarkup, /1 unread notification/)

  function fakeGroup(name) {
    return {
      name,
      hideCalls: 0,
      handlers: {},
      getAttribute(attribute) {
        return attribute === "data-icono-request-group" ? this.name : ""
      },
      addEventListener(eventName, handler) {
        this.handlers[eventName] = handler
      },
      hide() {
        this.hideCalls += 1
        if (this.handlers["sl-hide"]) this.handlers["sl-hide"]()
        return Promise.resolve()
      },
      removeAttribute() {},
    }
  }
  const ready = fakeGroup("ready")
  const waiting = fakeGroup("waiting")
  const groups = [ready, waiting]
  inbox.wire({
    querySelector() {
      return null
    },
    querySelectorAll(selector) {
      return selector === "[data-icono-request-group]" ? groups : []
    },
  })

  waiting.handlers["sl-show"]()
  assert.equal(ready.hideCalls, 1)
  assert.equal(waiting.hideCalls, 0)
  assert.match(inbox.panelMarkup(), /data-icono-request-group="waiting" open/)
  assert.doesNotMatch(inbox.panelMarkup(), /data-icono-request-group="ready" open/)

  ready.handlers["sl-show"]()
  assert.equal(waiting.hideCalls, 1)
  assert.match(inbox.panelMarkup(), /data-icono-request-group="ready" open/)
  assert.doesNotMatch(inbox.panelMarkup(), /data-icono-request-group="waiting" open/)
})

test("request inbox renders every returned request even when genes repeat", async () => {
  const readyRequests = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    request_id: index + 1,
    notification_id: index === 0 ? 7 : 0,
    unread: index === 0,
    gene_symbol: index < 3 ? "HPN" : `GENE${index}`,
    gene_url: index < 3 ? "/gene/HPN" : `/gene/GENE${index}`,
    image_url: `https://example.test/${index + 1}.webp`,
    requested_emulsion_label: "Random default",
    fulfilled_at: "2026-07-16 13:45:00",
  }))
  const inbox = createRequestInbox({
    fetchJSON: async () => ({
      ok: true,
      authenticated: true,
      unread_count: 1,
      ready_count: 20,
      open_count: 0,
      cancelled_count: 1,
      ready_requests: readyRequests,
      open_requests: [],
    }),
    getCurrentUser: () => ({ id: BRINEDEW_USER_ID }),
    renderSidebar() {},
    escapeHtml: (value) => String(value ?? ""),
  })
  await inbox.refresh()

  const markup = inbox.panelMarkup()
  assert.equal((markup.match(/data-icono-request-id=/g) || []).length, 20)
  assert.equal((markup.match(/data-icono-request-notification-id=/g) || []).length, 1)
  assert.equal((markup.match(/<strong>HPN<\/strong>/g) || []).length, 3)
  assert.match(markup, /data-icono-request-group="ready" open/)
  assert.match(markup, />20<\/span>/)
  assert.match(markup, /Cancelled <span>1<\/span>/)
})

test("every Shoelace component used by the request inbox has a deployable public entry", () => {
  for (const component of ["details", "badge"]) {
    const entry = new URL(
      `../quartz/static/iconoplasm/vendor/shoelace/cdn/components/${component}/${component}.js`,
      import.meta.url,
    )
    assert.equal(existsSync(entry), true, `missing Shoelace ${component} entry`)
    const source = readFileSync(entry, "utf8")
    const imports = [...source.matchAll(/from "([^\"]+)"|import "([^\"]+)"/g)].map(
      (match) => match[1] || match[2],
    )
    assert.ok(imports.length > 0, `Shoelace ${component} entry has no module imports`)
    for (const importedPath of imports) {
      assert.equal(
        existsSync(new URL(importedPath, entry)),
        true,
        `Shoelace ${component} entry references missing ${importedPath}`,
      )
    }
  }
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

test("workstation fulfillment fails loudly until every requester DM is sent", () => {
  const worker = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const routeStart = worker.indexOf('path === "/api/iconoplasm/admin/requests/fulfill"')
  const routeEnd = worker.indexOf('\n    if (path === "/api/iconoplasm/user-emulsion")', routeStart)
  const route = worker.slice(routeStart, routeEnd)

  assert.notEqual(routeStart, -1)
  assert.notEqual(routeEnd, -1)
  assert.match(route, /const delivery = await deliverPendingRequestFulfillmentNotifications/)
  assert.match(route, /const settlement = await reconcileDeliveredRequestFulfillments/)
  assert.match(route, /const deliveryComplete =/)
  assert.match(route, /notification_delivery: delivery/)
  assert.match(route, /notification_settlement: settlement/)
  assert.match(route, /has not received the required Discord DM yet/)
  assert.doesNotMatch(route, /ctx\?\.waitUntil\(delivery\)/)
})

test("delivery completion is an explicit state transition, not an optimistic status label", () => {
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0049_request_delivery_completion.sql", import.meta.url),
    "utf8",
  )
  const notifications = readFileSync(
    new URL("./iconoplasm-request-notifications.js", import.meta.url),
    "utf8",
  )

  assert.match(migration, /'delivery_pending'/)
  assert.match(migration, /WHEN OLD\.status = 'open' AND NEW\.status = 'delivery_pending'/)
  assert.match(migration, /discord_next_attempt_at/)
  assert.match(notifications, /reconcileDeliveredRequestFulfillments/)
  assert.match(notifications, /WHERE status = 'delivery_pending'/)
  assert.match(notifications, /n\.discord_status = 'sent'/)
  assert.match(notifications, /discord_next_attempt_at <= CURRENT_TIMESTAMP/)
  assert.doesNotMatch(notifications, /DISCORD_MAX_ATTEMPTS/)
})
