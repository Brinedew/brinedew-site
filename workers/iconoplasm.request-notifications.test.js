import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  fulfillGenerationRequests,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  DISCORD_MAX_ATTACHMENTS_PER_MESSAGE,
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
    if (this.sql.includes("COUNT(*) AS ready_count")) {
      const requesterUserId = String(this.args[0] || "")
      const ready = this.db.notifications.filter(
        (row) => row.requester_user_id === requesterUserId && row.discord_status === "sent",
      )
      const groups = new Set(
        ready.map((row) =>
          [
            row.fulfillment_publication_id || `legacy-request:${row.request_id}`,
            row.gene_symbol,
          ].join("|"),
        ),
      )
      const unreadGroups = new Set(
        ready
          .filter((row) => !row.read_at)
          .map((row) =>
            [
              row.fulfillment_publication_id || `legacy-request:${row.request_id}`,
              row.gene_symbol,
            ].join("|"),
          ),
      )
      return {
        ready_count: ready.length,
        unread_count: ready.filter((row) => !row.read_at).length,
        ready_group_count: groups.size,
        unread_group_count: unreadGroups.size,
      }
    }
    if (this.sql.includes("AS open_count") && this.sql.includes("AS cancelled_count")) {
      const requesterUserId = String(this.args[0] || "")
      const rows = this.db.openRequests.filter((row) => row.requester_user_id === requesterUserId)
      return {
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
      this.sql.includes("SELECT MIN(leader.id)")
    ) {
      const deliverableStatuses = this.args.filter((value) =>
        ["pending", "retry", "suppressed_not_test_recipient"].includes(String(value || "")),
      )
      const groups = new Map()
      for (const row of this.db.notifications) {
        const key = [row.requester_user_id, row.fulfillment_publication_id, row.gene_symbol].join(
          "|",
        )
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(row)
      }
      const limit = Number(this.args[this.args.length - 1]) || groups.size
      return {
        results: Array.from(groups.values())
          .filter(
            (rows) =>
              rows.length === Number(rows[0].fulfillment_group_size || 1) &&
              deliverableStatuses.includes(rows[0].discord_status),
          )
          .map((rows) => rows.sort((a, b) => Number(a.id) - Number(b.id))[0])
          .slice(0, limit),
      }
    }
    if (
      this.sql.includes("FROM icono_request_notifications n") &&
      this.sql.includes("n.fulfillment_publication_id = ?")
    ) {
      const [requesterUserId, fulfillmentPublicationId, geneSymbol] = this.args
      return {
        results: this.db.notifications.filter(
          (row) =>
            row.requester_user_id === requesterUserId &&
            row.fulfillment_publication_id === fulfillmentPublicationId &&
            row.gene_symbol === geneSymbol,
        ),
      }
    }
    if (this.sql.includes("FROM icono_request_notifications n")) {
      const requesterUserId = String(this.args[0] || "")
      return {
        results: this.db.notifications.filter(
          (row) => row.requester_user_id === requesterUserId && row.discord_status === "sent",
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
      const grouped = this.sql.includes("fulfillment_publication_id = ?")
      const publicationId = grouped ? String(this.args[1] || "") : ""
      const symbol = grouped ? String(this.args[2] || "") : ""
      const ids = grouped ? [] : this.args.slice(1).map(Number)
      let changes = 0
      for (const row of this.db.notifications) {
        if (row.requester_user_id !== userId || row.discord_status !== "sent" || row.read_at)
          continue
        if (
          grouped &&
          (row.fulfillment_publication_id !== publicationId || row.gene_symbol !== symbol)
        )
          continue
        if (ids.length && !ids.includes(Number(row.id))) continue
        row.read_at = "2026-07-16 14:00:00"
        changes += 1
      }
      return { meta: { changes } }
    }
    if (this.sql.includes("discord_attempt_count = discord_attempt_count + 1")) {
      const ids = this.args
        .filter((value) => !["pending", "retry", "suppressed_not_test_recipient"].includes(value))
        .map(Number)
      let changes = 0
      for (const row of this.db.notifications) {
        if (
          !ids.includes(Number(row.id)) ||
          !["pending", "retry", "suppressed_not_test_recipient"].includes(row.discord_status)
        )
          continue
        row.discord_status = "sending"
        row.discord_attempt_count = Number(row.discord_attempt_count || 0) + 1
        changes += 1
      }
      return { meta: { changes } }
    }
    if (this.sql.includes("SET discord_status = ?")) {
      const ids = this.args.slice(6).map(Number)
      let changes = 0
      for (const row of this.db.notifications) {
        if (!ids.includes(Number(row.id))) continue
        row.discord_status = String(this.args[0] || "")
        row.discord_channel_id = String(this.args[2] || "")
        row.discord_message_id = String(this.args[3] || "")
        row.discord_error = String(this.args[4] || "")
        row.discord_next_attempt_at = String(this.args[5] || "")
        changes += 1
      }
      return { meta: { changes } }
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

class FulfillmentStatement {
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
    if (!this.sql.includes("FROM icono_generation_requests")) {
      throw new Error(`Unexpected fulfillment read SQL: ${this.sql}`)
    }
    const request = this.db.requests.find((row) => Number(row.id) === Number(this.args[0]))
    return request ? { ...request } : null
  }

  async run() {
    if (this.sql.includes("UPDATE icono_request_notifications")) {
      const [publicationId, groupSize, requestId] = this.args
      let changes = 0
      for (const row of this.db.notifications) {
        if (
          Number(row.request_id) !== Number(requestId) ||
          row.discord_status === "sent" ||
          (row.fulfillment_publication_id &&
            row.fulfillment_publication_id !== `legacy-request:${requestId}` &&
            row.fulfillment_publication_id !== String(this.args[3] || ""))
        ) {
          continue
        }
        row.fulfillment_publication_id = String(publicationId || "")
        row.fulfillment_group_size = Number(groupSize || 1)
        if (row.discord_status === "failed") {
          row.discord_status = "retry"
          row.discord_error = ""
          row.discord_next_attempt_at = null
        }
        changes += 1
      }
      return { meta: { changes } }
    }
    if (this.sql.includes("SET status = 'delivery_pending'")) {
      const requestId = Number(this.args[6])
      const request = this.db.requests.find((row) => Number(row.id) === requestId)
      if (!request || request.status !== "open") return { meta: { changes: 0 } }
      request.status = "delivery_pending"
      request.fulfilled_asset_sha256 = String(this.args[1] || "")
      request.fulfilled_vision_id = String(this.args[2] || "")
      request.fulfillment_note = String(this.args[3] || "")
      request.fulfillment_publication_id = String(this.args[4] || "")
      request.fulfillment_group_size = Number(this.args[5] || 1)
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes("SET updated_at = CURRENT_TIMESTAMP")) {
      const [publicationId, groupSize, requestId, assetSha, visionId] = this.args
      const request = this.db.requests.find((row) => Number(row.id) === Number(requestId))
      const matches =
        request?.status === "delivery_pending" &&
        request.fulfilled_asset_sha256 === assetSha &&
        request.fulfilled_vision_id === visionId
      if (matches) {
        request.fulfillment_publication_id = String(publicationId || "")
        request.fulfillment_group_size = Number(groupSize || 1)
      }
      return { meta: { changes: matches ? 1 : 0 } }
    }
    throw new Error(`Unexpected fulfillment write SQL: ${this.sql}`)
  }
}

class FulfillmentDb {
  constructor(requests, notifications = []) {
    this.requests = requests.map((request) => ({
      requester_user_id: BRINEDEW_USER_ID,
      gene_symbol: "INS",
      fulfillment_publication_id: "",
      fulfillment_group_size: 1,
      ...request,
    }))
    this.notifications = notifications
  }

  prepare(sql) {
    return new FulfillmentStatement(this, sql)
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
    candidate_image_id: 59981,
    asset_created_at: "2026-07-16 13:44:10",
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
    request_batch_id: "legacy-request:42",
    request_batch_size: 1,
    fulfillment_publication_id: "legacy-request:42",
    fulfillment_group_size: 1,
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
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-storage-access-key",
  }
}

test("fulfillment replay settles only the exact asset already bound to the request", async () => {
  const assetSha = "a".repeat(64)
  const db = new FulfillmentDb([
    {
      id: 40,
      status: "open",
      fulfilled_asset_sha256: "",
      fulfilled_vision_id: "",
    },
  ])
  const item = {
    request_ids: [40],
    fulfilled_asset_sha256: assetSha,
    fulfilled_vision_id: "anima-v1-1398",
  }

  const started = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    { items: [item], resolvedBy: "pytest", publicationId: "pub-replay" },
  )
  assert.equal(started.ok, true)
  assert.deepEqual(started.request_ids, [40])
  assert.deepEqual(started.settled_request_ids, [])
  assert.equal(db.requests[0].status, "delivery_pending")
  assert.equal(db.requests[0].fulfilled_asset_sha256, assetSha)

  const pendingReplay = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    { items: [item], resolvedBy: "pytest", publicationId: "pub-replay" },
  )
  assert.equal(pendingReplay.ok, true)
  assert.deepEqual(pendingReplay.request_ids, [40])
  assert.deepEqual(pendingReplay.settled_request_ids, [])

  db.requests[0].status = "fulfilled"
  const replayed = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    { items: [item], resolvedBy: "pytest", publicationId: "pub-replay" },
  )
  assert.equal(replayed.ok, true)
  assert.deepEqual(replayed.request_ids, [])
  assert.deepEqual(replayed.settled_request_ids, [40])
})

test("fulfillment replay rejects a later candidate for an already settled request", async () => {
  const originalAsset = "a".repeat(64)
  const laterAsset = "b".repeat(64)
  const db = new FulfillmentDb([
    {
      id: 40,
      status: "fulfilled",
      fulfilled_asset_sha256: originalAsset,
      fulfilled_vision_id: "anima-v1-1398",
    },
  ])

  const result = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    {
      items: [
        {
          request_ids: [40],
          fulfilled_asset_sha256: laterAsset,
          fulfilled_vision_id: "anima-v1-4534",
        },
      ],
      resolvedBy: "pytest",
      publicationId: "pub-conflict",
    },
  )

  assert.equal(result.ok, false)
  assert.deepEqual(result.request_ids, [])
  assert.deepEqual(result.settled_request_ids, [])
  assert.equal(result.conflicts[0].reason, "request_already_bound_to_different_result")
  assert.equal(db.requests[0].fulfilled_asset_sha256, originalAsset)
  assert.equal(db.requests[0].fulfilled_vision_id, "anima-v1-1398")
})

test("fulfillment replay requeues a failed pre-Discord notification", async () => {
  const assetSha = "c".repeat(64)
  const notification = {
    request_id: 40,
    fulfillment_publication_id: "pub-replay",
    fulfillment_group_size: 1,
    discord_status: "failed",
    discord_error: "Fulfilled portrait download failed (404).",
    discord_next_attempt_at: "2026-08-06 18:00:00",
  }
  const db = new FulfillmentDb(
    [
      {
        id: 40,
        status: "delivery_pending",
        fulfilled_asset_sha256: assetSha,
        fulfilled_vision_id: "anima-v1-1398",
        fulfillment_publication_id: "pub-replay",
      },
    ],
    [notification],
  )

  const result = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    {
      items: [
        {
          request_ids: [40],
          fulfilled_asset_sha256: assetSha,
          fulfilled_vision_id: "anima-v1-1398",
        },
      ],
      resolvedBy: "pytest",
      publicationId: "pub-replay",
    },
  )

  assert.equal(result.ok, true)
  assert.deepEqual(result.request_ids, [40])
  assert.equal(notification.discord_status, "retry")
  assert.equal(notification.discord_error, "")
  assert.equal(notification.discord_next_attempt_at, null)
})

test("fulfillment batch preflight prevents partial rebinding", async () => {
  const originalAsset = "a".repeat(64)
  const db = new FulfillmentDb([
    {
      id: 40,
      status: "open",
      fulfilled_asset_sha256: "",
      fulfilled_vision_id: "",
    },
    {
      id: 41,
      status: "fulfilled",
      fulfilled_asset_sha256: originalAsset,
      fulfilled_vision_id: "anima-v1-original",
    },
  ])

  const result = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    {
      items: [
        {
          request_ids: [40],
          fulfilled_asset_sha256: "b".repeat(64),
          fulfilled_vision_id: "anima-v1-new",
        },
        {
          request_ids: [41],
          fulfilled_asset_sha256: "c".repeat(64),
          fulfilled_vision_id: "anima-v1-wrong",
        },
      ],
      resolvedBy: "pytest",
      publicationId: "pub-atomic-conflict",
    },
  )

  assert.equal(result.ok, false)
  assert.equal(db.requests[0].status, "open")
  assert.equal(db.requests[0].fulfilled_asset_sha256, "")
  assert.equal(db.requests[1].fulfilled_asset_sha256, originalAsset)
})

test("fulfillment binds separate random requests to one completed publication group", async () => {
  const requests = Array.from({ length: 6 }, (_, index) => ({
    id: 60 + index,
    status: "open",
    request_batch_id: `single-random-${index}`,
    request_batch_size: 1,
  }))
  const db = new FulfillmentDb(requests)
  const result = await fulfillGenerationRequests(
    { ICONOPLASM_DB: db },
    {
      publicationId: "pub-kncn-six",
      resolvedBy: "pytest",
      items: requests.map((request, index) => ({
        request_ids: [request.id],
        fulfilled_asset_sha256: (index + 30).toString(16).padStart(64, "0"),
        fulfilled_vision_id: `anima-v1-${index + 1}`,
      })),
    },
  )

  assert.equal(result.ok, true)
  assert.deepEqual(
    result.request_ids,
    requests.map((request) => request.id),
  )
  assert.ok(db.requests.every((request) => request.fulfillment_publication_id === "pub-kncn-six"))
  assert.ok(db.requests.every((request) => request.fulfillment_group_size === 6))
})

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

  const batchMigration = readFileSync(
    new URL("../migrations-iconoplasm/0058_request_notification_batches.sql", import.meta.url),
    "utf8",
  )
  assert.match(batchMigration, /ADD COLUMN request_batch_id/)
  assert.match(batchMigration, /ADD COLUMN request_batch_size/)
  assert.match(batchMigration, /NEW\.request_batch_id/)
  assert.match(batchMigration, /NEW\.request_batch_size/)
  assert.match(batchMigration, /legacy-request:/)

  const fulfillmentPublicationMigration = readFileSync(
    new URL(
      "../migrations-iconoplasm/0062_fulfillment_publication_notification_groups.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(fulfillmentPublicationMigration, /ADD COLUMN fulfillment_publication_id/)
  assert.match(fulfillmentPublicationMigration, /ADD COLUMN fulfillment_group_size/)
  assert.match(fulfillmentPublicationMigration, /NEW\.fulfillment_publication_id/)
  assert.match(fulfillmentPublicationMigration, /NEW\.fulfillment_group_size/)
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
  assert.equal(payload.unread_group_count, 1)
  assert.equal(payload.ready_group_count, 1)
  assert.equal(payload.open_count, 1)
  assert.equal(payload.ready_requests[0].request_id, 42)
  assert.equal(payload.ready_requests[0].notification_id, 7)
  assert.equal(payload.ready_requests[0].gene_symbol, "INS")
  assert.equal(payload.ready_requests[0].candidate_image_id, 59981)
  assert.equal(payload.ready_requests[0].asset_created_at, "2026-07-16 13:44:10")
  assert.equal(payload.ready_requests[0].requested_emulsion_label, "A1-4527")
  assert.equal(payload.ready_requests[0].fulfillment_publication_id, "legacy-request:42")
  assert.equal(payload.ready_requests[0].fulfillment_group_size, 1)
  assert.match(payload.ready_requests[0].image_url, /a{64}\/thumb\.webp$/)
})

test("request inbox does not promote legacy fulfilled rows without verified delivery receipts", async () => {
  const sent = notificationRow({
    request_id: 37,
    gene_symbol: "HPN",
    discord_status: "sent",
  })
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
  assert.equal(payload.ready_count, 1)
  assert.equal(payload.cancelled_count, 1)
  assert.deepEqual(
    payload.ready_requests.map((row) => row.request_id),
    [37],
  )
  assert.equal(payload.ready_requests[0].notification_id, 7)
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

test("one inbox receipt marks the complete publication and gene group read", async () => {
  const publicationRows = [7, 8, 9].map((id) =>
    notificationRow({
      id,
      request_id: 40 + id,
      gene_symbol: "HPN",
      fulfillment_publication_id: "pub-hpn-three",
      fulfillment_group_size: 3,
      discord_status: "sent",
    }),
  )
  const otherPublication = notificationRow({
    id: 10,
    request_id: 50,
    gene_symbol: "HPN",
    fulfillment_publication_id: "pub-hpn-other",
    discord_status: "sent",
  })
  const db = new NotificationDb([...publicationRows, otherPublication])
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/notifications/read", {
        method: "POST",
        headers: { Cookie: "session=test", "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillment_publication_id: "pub-hpn-three",
          gene_symbol: "HPN",
        }),
      }),
      { ICONOPLASM_DB: db, GAME_SESSIONS: buildSessionBinding() },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.marked_read, 3)
  assert.ok(publicationRows.every((row) => row.read_at))
  assert.equal(otherPublication.read_at, null)
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
    assert.equal(calls[2].json.nonce, "icono-batch-7")
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

// ARCHITECTURE FENCE [IPD-006]
test("one ten-candidate publication spanning two genes sends exactly two Discord messages", async () => {
  const rows = Array.from({ length: 10 }, (_, index) => {
    const isIns = index < 5
    const requestId = 100 + index
    return notificationRow({
      id: requestId,
      request_id: requestId,
      gene_symbol: isIns ? "INS" : "TP53",
      fulfillment_publication_id: "pub-two-gene",
      fulfillment_group_size: 5,
      fulfilled_asset_sha256: (index + 1).toString(16).padStart(64, "0"),
    })
  })
  const db = new NotificationDb(rows)
  const messages = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("storage.bunnycdn.com")) return validWebpResponse()
    if (String(url).endsWith("/users/@me/channels")) return Response.json({ id: "dm-channel-1" })
    messages.push(JSON.parse(String(init?.body?.get("payload_json") || "{}")))
    return Response.json({ id: `discord-message-${messages.length}` })
  }
  try {
    const first = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: rows.map((row) => row.request_id),
    })
    const second = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: rows.map((row) => row.request_id),
    })

    assert.equal(first.delivered, 1)
    assert.equal(first.delivered_requests, 5)
    assert.equal(second.delivered, 1)
    assert.equal(second.delivered_requests, 5)
    assert.equal(messages.length, 2)
    assert.deepEqual(
      messages.map((message) => message.attachments.length),
      [5, 5],
    )
    assert.match(messages[0].content, /5 free queue candidate blots for \*\*INS\*\*/)
    assert.match(messages[1].content, /5 free queue candidate blots for \*\*TP53\*\*/)
    assert.ok(rows.every((row) => row.discord_status === "sent"))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a Worker subrequest ceiling defers the Discord message without marking it unknown", async () => {
  const row = notificationRow()
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const value = String(url)
    if (value.includes("storage.bunnycdn.com")) return validWebpResponse()
    if (value.endsWith("/users/@me/channels")) return Response.json({ id: "dm-channel-1" })
    throw new Error("Too many subrequests by single Worker invocation")
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [row.request_id],
    })

    assert.equal(result.deferred, 1)
    assert.equal(result.failed, 0)
    assert.equal(result.unknown, 0)
    assert.equal(row.discord_status, "retry")
    assert.match(row.discord_error, /delivery deferred.*too many subrequests/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("six separately requested random blots completed in one publication send one Discord message", async () => {
  const rows = Array.from({ length: 6 }, (_, index) => {
    const requestId = 160 + index
    return notificationRow({
      id: requestId,
      request_id: requestId,
      gene_symbol: "KNCN",
      request_mode: "random",
      request_batch_id: `single-random-${index}`,
      request_batch_size: 1,
      fulfillment_publication_id: "pub-kncn-random-six",
      fulfillment_group_size: 6,
      fulfilled_asset_sha256: (index + 20).toString(16).padStart(64, "0"),
    })
  })
  const db = new NotificationDb(rows)
  const messages = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("storage.bunnycdn.com")) return validWebpResponse()
    if (String(url).endsWith("/users/@me/channels")) return Response.json({ id: "dm-channel-1" })
    messages.push(JSON.parse(String(init?.body?.get("payload_json") || "{}")))
    return Response.json({ id: "discord-message-kncn" })
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: rows.map((row) => row.request_id),
    })

    assert.equal(result.delivered, 1)
    assert.equal(result.delivered_requests, 6)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].attachments.length, 6)
    assert.match(messages[0].content, /6 free queue candidate blots for \*\*KNCN\*\*/)
    assert.ok(rows.every((row) => row.discord_message_id === "discord-message-kncn"))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a hundred-candidate batch remains one Discord receipt with ten previews", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const requestId = 200 + index
    return notificationRow({
      id: requestId,
      request_id: requestId,
      gene_symbol: "TP53",
      fulfillment_publication_id: "pub-hundred-candidate",
      fulfillment_group_size: 100,
      fulfilled_asset_sha256: (index + 1).toString(16).padStart(64, "0"),
    })
  })
  const db = new NotificationDb(rows)
  let message
  let storageFetches = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("storage.bunnycdn.com")) {
      storageFetches += 1
      return validWebpResponse()
    }
    if (String(url).endsWith("/users/@me/channels")) return Response.json({ id: "dm-channel-1" })
    message = JSON.parse(String(init?.body?.get("payload_json") || "{}"))
    return Response.json({ id: "discord-message-100" })
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db))

    assert.equal(DISCORD_MAX_ATTACHMENTS_PER_MESSAGE, 10)
    assert.equal(result.delivered, 1)
    assert.equal(result.delivered_requests, 100)
    assert.equal(storageFetches, 10)
    assert.equal(message.attachments.length, 10)
    assert.match(message.content, /Showing 10 of 100 previews/)
    assert.match(message.content, /Review all 100 here/)
    assert.ok(rows.every((row) => row.discord_status === "sent"))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("an incomplete publication group waits instead of fragmenting into multiple messages", async () => {
  const rows = [
    notificationRow({
      id: 300,
      request_id: 300,
      fulfillment_publication_id: "pub-partial",
      fulfillment_group_size: 2,
    }),
  ]
  const db = new NotificationDb(rows)
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error("Discord must not be called for an incomplete batch")
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db))
    assert.equal(result.considered, 0)
    assert.equal(fetchCalls, 0)
    assert.equal(rows[0].discord_status, "pending")
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
    assert.equal(urls.length, 2)
    assert.match(urls[0], /storage\.bunnycdn\.com/)
    assert.match(urls[1], /iconoplasmportraits\.b-cdn\.net/)
    assert.doesNotMatch(urls[0], /discord\.com/)
    assert.doesNotMatch(urls[1], /discord\.com/)
    assert.equal(row.discord_status, "failed")
    assert.match(row.discord_error, /portrait download failed \(404\)/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a regional authenticated-storage miss falls back to the public Bunny CDN before failing delivery", async () => {
  const row = notificationRow()
  const db = new NotificationDb([row])
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url, init) => {
    const value = String(url)
    urls.push(value)
    if (value.includes("storage.bunnycdn.com")) {
      return new Response("storage replica not ready", { status: 404 })
    }
    if (value.includes("iconoplasmportraits.b-cdn.net")) return validWebpResponse()
    if (value.endsWith("/users/@me/channels")) return Response.json({ id: "dm-channel-1" })
    return Response.json({ id: "discord-message-fallback" })
  }
  try {
    const result = await deliverPendingRequestFulfillmentNotifications(deliveryEnv(db), {
      requestIds: [42],
    })

    assert.equal(result.delivered, 1)
    assert.equal(result.failed, 0)
    assert.match(urls[0], /storage\.bunnycdn\.com/)
    assert.match(urls[1], /iconoplasmportraits\.b-cdn\.net/)
    assert.equal(row.discord_status, "sent")
    assert.equal(row.discord_message_id, "discord-message-fallback")
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

  assert.match(app, /import \{ createRequestInbox \} from "\.\/request-inbox\.js\?v=[^"]+"/)
  assert.match(inbox, /\/api\/iconoplasm\/notifications\?limit=50/)
  assert.match(inbox, /\/api\/iconoplasm\/notifications\/read/)
  assert.match(inbox, /refreshTimer = window\.setTimeout/)
  assert.match(inbox, /state\.open_count <= 0/)
  assert.match(inbox, /document\.visibilityState !== "visible"/)
  assert.match(inbox, /data-icono-request-notification-id/)
  assert.doesNotMatch(inbox, /icono_last_seen_fulfilled/)
  assert.match(css, /\.icono-request-inbox__item--unread/)
  assert.match(css, /\.icono-request-inbox__item\s*\{[^}]*flex:\s*0 0 auto/)
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
    unread_group_count: 1,
    ready_group_count: 1,
    open_count: 1,
    cancelled_count: 0,
    ready_requests: [
      {
        id: 7,
        request_id: 42,
        notification_id: 7,
        unread: true,
        fulfillment_publication_id: "pub-ins-one",
        fulfillment_group_size: 1,
        gene_symbol: "INS",
        gene_url: "/gene/INS",
        image_url: "https://example.test/ins.webp",
        requested_emulsion_label: "Random default",
        fulfilled_at: "2026-07-16 13:45:00",
        candidate_image_id: 59981,
        asset_created_at: "2026-07-16 13:44:10",
        fulfilled_asset_sha256: "a".repeat(64),
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
  assert.match(initialMarkup, /data-icono-candidate-image-id="59981"/)
  assert.match(initialMarkup, /data-icono-asset-sha="a{64}"/)
  assert.match(initialMarkup, /data-icono-request-publication-id="pub-ins-one"/)
  assert.match(initialMarkup, /receipt-count" aria-label="1 image">1</)
  assert.doesNotMatch(
    initialMarkup,
    /<em>(?:ready|queued)<\/em>|Completed|View all|Random default|Requested /,
  )
  assert.match(initialMarkup, /data-icono-request-notification-id="7"/)
  assert.match(initialMarkup, /<sl-badge[^>]+variant="danger"[^>]+aria-hidden="true"/)
  assert.match(initialMarkup, /1 unread generation/)

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

test("request inbox groups one publication and gene into one bounded receipt", async () => {
  const readyRequests = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    request_id: index + 1,
    notification_id: index + 1,
    unread: index === 0,
    fulfillment_publication_id:
      index < 6 ? "pub-hpn-six" : index === 6 ? "pub-hpn-next" : `pub-${index}`,
    fulfillment_group_size: index < 6 ? 6 : 1,
    gene_symbol: index < 7 ? "HPN" : `GENE${index}`,
    gene_url: index < 7 ? "/gene/HPN" : `/gene/GENE${index}`,
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
      unread_group_count: 1,
      ready_group_count: 15,
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
  assert.equal((markup.match(/data-icono-request-receipt/g) || []).length, 15)
  assert.equal((markup.match(/data-icono-request-id=/g) || []).length, 18)
  assert.equal((markup.match(/<strong>HPN<\/strong>/g) || []).length, 2)
  assert.match(markup, /data-icono-request-publication-id="pub-hpn-six"/)
  assert.match(markup, /data-icono-request-notification-ids="1,2,3,4,5,6"/)
  assert.match(markup, /receipt-count" aria-label="6 images">6</)
  assert.match(markup, />\+2<\/span>/)
  assert.doesNotMatch(markup, /<em>ready<\/em>|Completed|View all|Random default/)
  assert.match(markup, /data-icono-request-group="ready" open/)
  assert.match(markup, />15<\/span>/)
  assert.match(markup, /Cancelled <span>1<\/span>/)
})

test("request inbox receipt click acknowledges the durable group instead of one preview", async () => {
  const payload = {
    ok: true,
    authenticated: true,
    unread_count: 3,
    ready_count: 3,
    unread_group_count: 1,
    ready_group_count: 1,
    open_count: 0,
    cancelled_count: 0,
    ready_requests: [],
    open_requests: [],
  }
  const calls = []
  const inbox = createRequestInbox({
    fetchJSON: async (url, options) => {
      calls.push({ url, options })
      return payload
    },
    getCurrentUser: () => ({ id: BRINEDEW_USER_ID }),
    renderSidebar() {},
    escapeHtml: (value) => String(value ?? ""),
  })
  const attributes = {
    "data-icono-request-notification-ids": "7,8,9",
    "data-icono-request-publication-id": "pub-hpn-three",
    "data-icono-request-gene-symbol": "HPN",
    href: "/gene/HPN",
  }
  const handlers = {}
  const receipt = {
    getAttribute(name) {
      return attributes[name] || ""
    },
    addEventListener(name, handler) {
      handlers[name] = handler
    },
  }
  const previousWindow = globalThis.window
  let resolveNavigation
  const navigation = new Promise((resolve) => {
    resolveNavigation = resolve
  })
  globalThis.window = { location: { assign: resolveNavigation } }
  try {
    inbox.wire({
      querySelector() {
        return null
      },
      querySelectorAll(selector) {
        return selector === "[data-icono-request-receipt]" ? [receipt] : []
      },
    })
    let prevented = false
    handlers.click({
      preventDefault() {
        prevented = true
      },
    })
    const acknowledgement = calls.find((call) => call.url === "/api/iconoplasm/notifications/read")
    assert.equal(prevented, true)
    assert.ok(acknowledgement)
    assert.deepEqual(JSON.parse(acknowledgement.options.body), {
      notification_ids: [7, 8, 9],
      fulfillment_publication_id: "pub-hpn-three",
      gene_symbol: "HPN",
      all: false,
    })
    await navigation
  } finally {
    globalThis.window = previousWindow
  }
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
  assert.match(route, /ICONOPLASM_FULFILLMENT_DM_INLINE_LIMIT/)
  assert.match(route, /code: "DISCORD_DELIVERY_PENDING"/)
  assert.match(route, /const settlement = await reconcileDeliveredRequestFulfillments/)
  assert.match(route, /const deliveryComplete =/)
  assert.match(route, /notification_delivery: delivery/)
  assert.match(route, /notification_settlement: settlement/)
  assert.match(route, /has not received the required Discord DM yet/)
  assert.match(route, /admin_requests_fulfill_conflict/)
  assert.match(route, /json\(result, 409/)
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
