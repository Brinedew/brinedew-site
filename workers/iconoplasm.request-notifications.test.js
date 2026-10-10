import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  fulfillGenerationRequests,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  resolveIconoplasmFulfillmentDeliveryPolicy,
} from "./iconoplasm-request-notifications.js"
import { iconoplasmGenerationFingerprint } from "./lib/iconoplasm-generation-provenance.js"
import { createRequestInbox } from "../quartz/static/iconoplasm/request-inbox.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

const BRINEDEW_USER_ID = "1289482311557058641"
const FULFILLMENT_CONFIG_SHA256 = "f".repeat(64)
const FULFILLMENT_PROMPT_SHA256 = "e".repeat(64)
const FULFILLMENT_REQUEST_CONTRACT_SHA256 = "9".repeat(64)
const FULFILLMENT_LEASE_OWNER_ID = "workstation_fulfillment_owner_0001"
const fulfillmentRequestId = (requestId) =>
  `generation_request_fulfillment_${String(requestId).padStart(8, "0")}`
const fulfillmentAttemptId = (requestId) =>
  `generation_attempt_fulfillment_${String(requestId).padStart(8, "0")}`
const fulfillmentLeaseToken = (requestId) =>
  `generation_lease_fulfillment_${String(requestId).padStart(8, "0")}`
const FULFILLMENT_SOURCE = {
  generation_provenance_status: "bound",
  source_gene_id: "gene_ins_0001",
  source_manifestation_id: "manifestation_ins_0001",
  source_manifestation_revision_id: "revision_ins_0001",
  source_manifestation_body_sha256: "b".repeat(64),
  source_manifestation_derivative_id: "",
  source_manifestation_derivative_sha256: "",
  source_manifestation_derivative_tags_sha256: "",
  source_manifestation_derivative_tags_bytes: 0,
  source_manifestation_derivative_fields_sha256: "",
  source_manifestation_derivative_fields_bytes: 0,
  source_manifestation_derivative_recipe_id: "",
  source_manifestation_derivative_recipe_version: "",
  source_manifestation_derivative_provider_id: "",
  source_manifestation_derivative_model_id: "",
  source_manifestation_derivative_tagger_config_sha256: "",
  source_canonical_selection_id: "selection_ins_0001",
  source_canonical_head_version: 1,
  source_gene_revision: 1,
  source_sample_label: "INS-1",
  source_sample_number: 1,
  source_sample_text_sha256: "c".repeat(64),
  prompt_body_mode: "prose_prompt",
}
FULFILLMENT_SOURCE.source_snapshot_sha256 = await iconoplasmGenerationFingerprint(
  "iconoplasm.generation-source.v1",
  FULFILLMENT_SOURCE,
)

function fulfillmentItem(overrides = {}) {
  const requestId = Number(overrides?.request_ids?.[0] || 40)
  return {
    ...FULFILLMENT_SOURCE,
    generation_request_id: fulfillmentRequestId(requestId),
    source_snapshot_sha256: FULFILLMENT_SOURCE.source_snapshot_sha256,
    generation_attempt_id: fulfillmentAttemptId(requestId),
    generation_lease_token: fulfillmentLeaseToken(requestId),
    generation_lease_owner_id: FULFILLMENT_LEASE_OWNER_ID,
    generation_lease_version: 1,
    generation_request_contract_sha256: FULFILLMENT_REQUEST_CONTRACT_SHA256,
    provider_id: "workstation",
    model_id: "exact-model-v1",
    prompt_sha256: FULFILLMENT_PROMPT_SHA256,
    generation_config_sha256: FULFILLMENT_CONFIG_SHA256,
    ...overrides,
  }
}

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
    if (this.sql.includes("FROM icono_request_inbox_summary")) {
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
    if (this.sql.includes("RETURNING id") && this.sql.includes("discord_last_attempt_at"))
      return this.run()
    if (this.sql.includes("icono_request_delivery_ready_groups")) {
      const scoped = this.sql.includes("WITH scoped")
      const ids = scoped ? JSON.parse(this.args[0]) : []
      const mode = Number(this.args[scoped ? 1 : 0])
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
              rows.every((row) =>
                (mode === 2
                  ? ["pending", "retry"]
                  : ["pending", "retry", "suppressed_not_test_recipient"]
                ).includes(row.discord_status),
              ) &&
              (scoped ||
                mode === 2 ||
                rows.some((row) => row.discord_status === "suppressed_not_test_recipient")) &&
              (!ids.length || rows.some((row) => ids.includes(row.request_id))) &&
              (!rows[0].discord_next_attempt_at ||
                Date.parse(rows[0].discord_next_attempt_at) <= Date.now()),
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
    if (
      this.sql.includes("FROM icono_request_notifications n") ||
      this.sql.includes("FROM icono_request_inbox_members membership")
    ) {
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
    if (this.sql.includes("RETURNING id") && this.sql.includes("discord_last_attempt_at")) {
      const ids = JSON.parse(this.args[0])
      const statuses = JSON.parse(this.args[1])
      if (
        this.db.notifications.filter(
          (row) => ids.includes(Number(row.id)) && statuses.includes(row.discord_status),
        ).length !== ids.length
      )
        return { meta: { changes: 0 }, results: [] }
      let changes = 0
      const results = []
      for (const row of this.db.notifications) {
        if (
          !ids.includes(Number(row.id)) ||
          !["pending", "retry", "suppressed_not_test_recipient"].includes(row.discord_status)
        )
          continue
        row.discord_status = "sending"
        row.discord_attempt_count = Number(row.discord_attempt_count || 0) + 1
        changes += 1
        results.push({ id: row.id })
      }
      return { meta: { changes }, results }
    }
    if (this.sql.includes("SET discord_status = ?")) {
      const ids = JSON.parse(this.args[6])
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
    if (this.sql.includes("FROM icono_portrait_generation_provenance")) {
      const receipt = this.db.generationReceipts.get(String(this.args[0] || ""))
      return receipt ? { ...receipt } : null
    }
    if (this.sql.includes("FROM icono_generation_execution_leases")) {
      const lease = this.db.leases.get(String(this.args[0] || ""))
      return lease ? { ...lease } : null
    }
    if (!this.sql.includes("FROM icono_generation_requests")) {
      throw new Error(`Unexpected fulfillment read SQL: ${this.sql}`)
    }
    const request = this.db.requests.find((row) => Number(row.id) === Number(this.args[0]))
    return request ? { ...request } : null
  }

  async run() {
    if (this.sql.includes("UPDATE icono_generation_execution_leases")) {
      const [completedAt, , generationRequestId, attemptId, token, ownerId, version] = this.args
      const lease = this.db.leases.get(String(generationRequestId || ""))
      const matches =
        lease?.status === "active" &&
        lease.generation_attempt_id === attemptId &&
        lease.lease_token === token &&
        lease.lease_owner_id === ownerId &&
        Number(lease.lease_version) === Number(version)
      if (matches) {
        lease.status = "completed"
        lease.completed_at = completedAt
        lease.updated_at = completedAt
      }
      return { meta: { changes: matches ? 1 : 0 } }
    }
    if (this.sql.includes("INSERT INTO icono_portrait_generation_provenance")) {
      const fields = [
        "generation_request_id",
        "generation_attempt_id",
        "gene_symbol",
        "asset_sha256",
        "source_gene_id",
        "source_manifestation_id",
        "source_manifestation_revision_id",
        "source_manifestation_body_sha256",
        "source_manifestation_derivative_id",
        "source_manifestation_derivative_sha256",
        "source_manifestation_derivative_tags_sha256",
        "source_manifestation_derivative_tags_bytes",
        "source_manifestation_derivative_fields_sha256",
        "source_manifestation_derivative_fields_bytes",
        "source_manifestation_derivative_recipe_id",
        "source_manifestation_derivative_recipe_version",
        "source_manifestation_derivative_provider_id",
        "source_manifestation_derivative_model_id",
        "source_manifestation_derivative_tagger_config_sha256",
        "source_canonical_selection_id",
        "source_canonical_head_version",
        "source_gene_revision",
        "source_snapshot_sha256",
        "provider_id",
        "model_id",
        "prompt_sha256",
        "generation_config_sha256",
        "sample_label",
        "sample_number",
        "sample_text_sha256",
      ]
      const receipt = Object.fromEntries(fields.map((field, index) => [field, this.args[index]]))
      if (this.db.generationReceipts.has(receipt.generation_request_id)) {
        return { meta: { changes: 0 } }
      }
      this.db.generationReceipts.set(receipt.generation_request_id, receipt)
      return { meta: { changes: 1 } }
    }
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
        // The statement writes only when the row's state moves (B-962).
        if (
          row.fulfillment_publication_id === String(publicationId || "") &&
          Number(row.fulfillment_group_size) === Number(groupSize || 1) &&
          row.discord_status !== "failed"
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
      const requestId = Number(this.args[10])
      const request = this.db.requests.find((row) => Number(row.id) === requestId)
      if (!request || request.status !== "open") return { meta: { changes: 0 } }
      request.status = "delivery_pending"
      request.fulfilled_asset_sha256 = String(this.args[1] || "")
      request.fulfilled_vision_id = String(this.args[2] || "")
      request.fulfilled_generation_attempt_id = String(this.args[3] || "")
      request.fulfilled_provider_id = String(this.args[4] || "")
      request.fulfilled_model_id = String(this.args[5] || "")
      request.fulfilled_prompt_sha256 = String(this.args[6] || "")
      request.fulfillment_note = String(this.args[7] || "")
      request.fulfillment_publication_id = String(this.args[8] || "")
      request.fulfillment_group_size = Number(this.args[9] || 1)
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
    this.requests = requests.map((request) => {
      const alreadyBound = ["delivery_pending", "fulfilled"].includes(String(request.status || ""))
      const stableRequestId =
        request.generation_request_id || fulfillmentRequestId(Number(request.id || 0))
      return {
        requester_user_id: BRINEDEW_USER_ID,
        gene_symbol: "INS",
        request_origin: "user",
        fulfillment_publication_id: "",
        fulfillment_group_size: 1,
        generation_request_id: stableRequestId,
        generation_request_contract_sha256: FULFILLMENT_REQUEST_CONTRACT_SHA256,
        fulfilled_generation_attempt_id: alreadyBound
          ? fulfillmentAttemptId(Number(request.id || 0))
          : "",
        fulfilled_provider_id: alreadyBound ? "workstation" : "",
        fulfilled_model_id: alreadyBound ? "exact-model-v1" : "",
        fulfilled_prompt_sha256: alreadyBound ? FULFILLMENT_PROMPT_SHA256 : "",
        generation_config_sha256: FULFILLMENT_CONFIG_SHA256,
        ...FULFILLMENT_SOURCE,
        ...request,
      }
    })
    this.notifications = notifications
    this.generationReceipts = new Map()
    this.leases = new Map(
      this.requests.map((request) => [
        request.generation_request_id,
        {
          generation_request_id: request.generation_request_id,
          request_row_id: request.id,
          generation_attempt_id: fulfillmentAttemptId(Number(request.id || 0)),
          lease_token: fulfillmentLeaseToken(Number(request.id || 0)),
          lease_owner_id: FULFILLMENT_LEASE_OWNER_ID,
          lease_version: 1,
          status: ["delivery_pending", "fulfilled"].includes(String(request.status || ""))
            ? "completed"
            : "active",
          claimed_at: "2026-08-30T00:00:00.000Z",
          expires_at: "2099-08-30T00:15:00.000Z",
          completed_at: ["delivery_pending", "fulfilled"].includes(String(request.status || ""))
            ? "2026-08-30T00:01:00.000Z"
            : null,
          failed_at: null,
          failure_code: null,
          updated_at: "2026-08-30T00:00:00.000Z",
        },
      ]),
    )
  }

  prepare(sql) {
    return new FulfillmentStatement(this, sql)
  }
}

class FulfillmentAuthoringStatement {
  bind() {
    return this
  }

  async first() {
    return {
      gene_id: FULFILLMENT_SOURCE.source_gene_id,
      gene_status: "active",
      manifestation_id: FULFILLMENT_SOURCE.source_manifestation_id,
      manifestation_status: "active",
      manifestation_revision_id: FULFILLMENT_SOURCE.source_manifestation_revision_id,
      body_sha256: FULFILLMENT_SOURCE.source_manifestation_body_sha256,
      body_bytes: 32,
      sample_label: FULFILLMENT_SOURCE.source_sample_label,
      sample_number: FULFILLMENT_SOURCE.source_sample_number,
      sample_text_sha256: FULFILLMENT_SOURCE.source_sample_text_sha256,
      revision_status: "active",
      revision_object_key:
        "private/manifestations/v1/aa/mbody_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin",
      revision_verified_at: "2026-08-30 00:00:00",
      canonical_selection_id: FULFILLMENT_SOURCE.source_canonical_selection_id,
      selected_manifestation_id: FULFILLMENT_SOURCE.source_manifestation_id,
      selected_revision_id: FULFILLMENT_SOURCE.source_manifestation_revision_id,
      selection_head_version: FULFILLMENT_SOURCE.source_canonical_head_version,
      selection_gene_revision: FULFILLMENT_SOURCE.source_gene_revision,
    }
  }
}

const FULFILLMENT_AUTHORING_DB = Object.freeze({
  prepare() {
    return new FulfillmentAuthoringStatement()
  },
})

function fulfillmentEnv(db) {
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_AUTHORING_DB: FULFILLMENT_AUTHORING_DB,
  }
}

// A browser signed in as `userId` (B-1069: a real sealed session cookie).
function signedInAs(userId = BRINEDEW_USER_ID) {
  return sessionCookieFor({ user_id: userId, username: "brinedew" })
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

  const result = await fulfillGenerationRequests(fulfillmentEnv(db), {
    items: [
      fulfillmentItem({
        request_ids: [40],
        fulfilled_asset_sha256: laterAsset,
        fulfilled_vision_id: "anima-v1-4534",
      }),
    ],
    resolvedBy: "pytest",
    publicationId: "pub-conflict",
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.request_ids, [])
  assert.deepEqual(result.settled_request_ids, [])
  assert.equal(result.conflicts[0].reason, "request_already_bound_to_different_result")
  assert.equal(db.requests[0].fulfilled_asset_sha256, originalAsset)
  assert.equal(db.requests[0].fulfilled_vision_id, "anima-v1-1398")
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

  const result = await fulfillGenerationRequests(fulfillmentEnv(db), {
    items: [
      fulfillmentItem({
        request_ids: [40],
        fulfilled_asset_sha256: "b".repeat(64),
        fulfilled_vision_id: "anima-v1-new",
      }),
      fulfillmentItem({
        request_ids: [41],
        fulfilled_asset_sha256: "c".repeat(64),
        fulfilled_vision_id: "anima-v1-wrong",
      }),
    ],
    resolvedBy: "pytest",
    publicationId: "pub-atomic-conflict",
  })

  assert.equal(result.ok, false)
  assert.equal(db.requests[0].status, "open")
  assert.equal(db.requests[0].fulfilled_asset_sha256, "")
  assert.equal(db.requests[1].fulfilled_asset_sha256, originalAsset)
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
        headers: { Cookie: await signedInAs() },
      }),
      { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
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
  assert.match(payload.ready_requests[0].image_url, /a{64}\/medium\.webp$/)
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
        headers: { Cookie: await signedInAs() },
      }),
      { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
      { waitUntil() {} },
    )
  const otherResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/notifications", {
        headers: { Cookie: await signedInAs(otherUserId) },
      }),
      { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
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
        headers: { Cookie: await signedInAs(), "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: [7, 8] }),
      }),
      { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
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
        headers: { Cookie: await signedInAs(), "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillment_publication_id: "pub-hpn-three",
          gene_symbol: "HPN",
        }),
      }),
      { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
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
    assert.deepEqual(first.delivered_request_ids, [42])
    assert.deepEqual(second.delivered_request_ids, [])
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
    assert.deepEqual(first.delivered_request_ids, [100, 101, 102, 103, 104])
    assert.equal(second.delivered, 1)
    assert.equal(second.delivered_requests, 5)
    assert.deepEqual(second.delivered_request_ids, [105, 106, 107, 108, 109])
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

// B-1029: the Ready list holds unread results only, one entry per gene. Failure
// modes: a seen result lingers; one gene splits across its batches; the merged
// count is not the sum of its images.
test("request inbox shows unread results only, one entry per gene with its batches merged", async () => {
  const readyRequests = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    request_id: index + 1,
    notification_id: index + 1,
    unread: index < 7 || index % 2 === 0,
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
      unread_count: 13,
      ready_count: 20,
      unread_group_count: 8,
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
  // HPN plus the six unread GENE8, GENE10 ... GENE18; the read odd ones are gone.
  assert.equal((markup.match(/data-icono-request-receipt/g) || []).length, 7)
  assert.equal((markup.match(/<strong>HPN<\/strong>/g) || []).length, 1)
  assert.doesNotMatch(markup, /GENE9|GENE11/)
  assert.match(markup, /data-icono-request-notification-ids="1,2,3,4,5,6,7"/)
  assert.match(markup, /receipt-count" aria-label="7 images">7</)
  assert.match(markup, />\+3<\/span>/)
  assert.match(markup, /class="icono-thumbnail-viewport-image"/)
  assert.doesNotMatch(markup, /<em>ready<\/em>|Completed|View all|Random default/)
  assert.match(markup, /data-icono-request-group="ready" open/)
  assert.match(markup, /group-count">7<\/span>/)
  assert.match(markup, /Cancelled <span>1<\/span>/)
})

// B-1029: a result is seen once its gene page opens, however the person got there.
// Failure modes: a receipt click and the page view both post; a page view posts
// when nothing of that gene is unread; a page that opens before the inbox has
// loaded never marks; a gene's results stay listed after its page opened.
test("opening a gene page marks its results seen; a receipt click only navigates", async () => {
  const unreadHpn = {
    request_id: 7,
    notification_id: 7,
    unread: true,
    fulfillment_publication_id: "pub-hpn",
    gene_symbol: "HPN",
    gene_url: "/gene/HPN",
  }
  const payload = {
    ok: true,
    authenticated: true,
    unread_count: 1,
    ready_count: 1,
    open_count: 0,
    cancelled_count: 0,
    ready_requests: [unreadHpn],
    open_requests: [],
  }
  const posts = []
  let navigated = ""
  const inbox = createRequestInbox({
    fetchJSON: async (url, options) => {
      if (url === "/api/iconoplasm/notifications/read") {
        posts.push(JSON.parse(options.body))
        payload.ready_requests = []
        payload.unread_count = 0
        return { ok: true }
      }
      return url.startsWith("/api/iconoplasm/notifications")
        ? JSON.parse(JSON.stringify(payload))
        : { ok: true, caretaker: null }
    },
    getCurrentUser: () => ({ id: BRINEDEW_USER_ID }),
    renderSidebar() {},
    escapeHtml: (value) => String(value ?? ""),
    navigate: (href) => {
      navigated = href
    },
  })

  // The gene page renders before the inbox has loaded: the mark waits for the load.
  await inbox.noteGeneViewed("HPN")
  assert.equal(posts.length, 0)
  await inbox.refresh()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posts, [
    { notification_ids: [], fulfillment_publication_id: "", gene_symbol: "HPN", all: false },
  ])
  assert.doesNotMatch(inbox.panelMarkup(), /<strong>HPN<\/strong>/)

  // Nothing unread for this gene: no request.
  await inbox.noteGeneViewed("TP53")
  assert.equal(posts.length, 1)

  // A receipt click navigates and leaves the marking to the page view.
  const handlers = {}
  const receipt = {
    getAttribute: (name) => ({ href: "/gene/HPN" })[name] || "",
    addEventListener: (name, handler) => {
      handlers[name] = handler
    },
  }
  inbox.wire({
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === "[data-icono-request-receipt]" ? [receipt] : []),
  })
  let prevented = false
  handlers.click({
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(navigated, "/gene/HPN")
  assert.equal(posts.length, 1)
})

test("signed-out inbox performs zero caretaker or generation requests", async () => {
  var fetches = 0
  const inbox = createRequestInbox({
    fetchJSON: async () => {
      fetches += 1
      return { ok: true }
    },
    getCurrentUser: () => null,
    renderSidebar() {},
    escapeHtml: (value) => String(value ?? ""),
  })
  await inbox.refresh()
  assert.equal(fetches, 0)
  assert.equal(inbox.panelMarkup(), "")
})

test("account switch and remount discard stale responses from both inbox feeds", async () => {
  function deferred() {
    var resolve
    var promise = new Promise((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  function requestPayload(symbol) {
    return {
      ok: true,
      authenticated: true,
      unread_count: 1,
      ready_count: 1,
      unread_group_count: 1,
      ready_group_count: 1,
      open_count: 0,
      cancelled_count: 0,
      ready_requests: [
        {
          request_id: symbol === "OLD" ? 1 : 2,
          notification_id: symbol === "OLD" ? 1 : 2,
          unread: true,
          fulfillment_publication_id: `publication_${symbol}`,
          fulfillment_group_size: 1,
          gene_symbol: symbol,
          gene_url: `/gene/${symbol}`,
        },
      ],
      open_requests: [],
    }
  }
  function caretakerPayload(symbol) {
    return {
      ok: true,
      caretaker: {
        caretaker_assignment_id: `assignment_${symbol}`,
        gene_id: `gene_${symbol}`,
        canonical_symbol: symbol,
        href: `/gene/${symbol}`,
        assignment_status: "active",
        assignment_version: 1,
        unread_comment_count: 1,
      },
    }
  }
  var user = { account_id: "account_stale_A" }
  const pending = []
  const inbox = createRequestInbox({
    fetchJSON: (url) => {
      const item = { url, account: user.account_id, deferred: deferred() }
      pending.push(item)
      return item.deferred.promise
    },
    getCurrentUser: () => user,
    renderSidebar() {},
    escapeHtml: (value) => String(value ?? ""),
  })

  const first = inbox.refresh()
  user = { account_id: "account_stale_B" }
  const second = inbox.refresh()
  const secondCalls = pending.filter((item) => item.account === "account_stale_B")
  secondCalls.forEach((item) =>
    item.deferred.resolve(
      item.url.includes("caretaker/me") ? caretakerPayload("NEW") : requestPayload("NEW"),
    ),
  )
  await second
  const firstCalls = pending.filter((item) => item.account === "account_stale_A")
  firstCalls.forEach((item) =>
    item.deferred.resolve(
      item.url.includes("caretaker/me") ? caretakerPayload("OLD") : requestPayload("OLD"),
    ),
  )
  await first
  assert.match(inbox.panelMarkup(), /data-icono-request-gene-symbol="NEW"/)
  assert.match(inbox.caretakerPanelMarkup(), /assignment_NEW/)
  assert.doesNotMatch(inbox.panelMarkup(), /data-icono-request-gene-symbol="OLD"/)
  assert.doesNotMatch(inbox.caretakerPanelMarkup(), /assignment_OLD/)

  const remountFirst = inbox.refresh()
  const remountOldCalls = pending.slice(-2)
  inbox.stop()
  const remountSecond = inbox.refresh()
  const remountNewCalls = pending.slice(-2)
  remountNewCalls.forEach((item) =>
    item.deferred.resolve(
      item.url.includes("caretaker/me")
        ? caretakerPayload("REMOUNT_NEW")
        : requestPayload("REMOUNT_NEW"),
    ),
  )
  await remountSecond
  remountOldCalls.forEach((item) =>
    item.deferred.resolve(
      item.url.includes("caretaker/me")
        ? caretakerPayload("REMOUNT_OLD")
        : requestPayload("REMOUNT_OLD"),
    ),
  )
  await remountFirst
  assert.match(inbox.panelMarkup(), /REMOUNT_NEW/)
  assert.match(inbox.caretakerPanelMarkup(), /REMOUNT_NEW/)
  assert.doesNotMatch(inbox.panelMarkup(), /REMOUNT_OLD/)
  assert.doesNotMatch(inbox.caretakerPanelMarkup(), /REMOUNT_OLD/)
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
