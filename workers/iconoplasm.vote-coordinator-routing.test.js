import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  IconoplasmVoteCoordinator,
  handleIconoplasmQueue,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  handleIconoplasmVoteProjectionQueue,
  resolveDesiredVoteValue,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class DurableObjectSqlForTest {
  constructor() {
    this.db = new DatabaseSync(":memory:")
  }

  exec(sql, ...bindings) {
    const source = String(sql || "")
    let rows = []
    if (bindings.length) {
      rows = this.db.prepare(source).all(...bindings)
    } else if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(source) && !source.trim().includes(";")) {
      rows = this.db.prepare(source).all()
    } else {
      this.db.exec(source)
    }
    return { toArray: () => rows }
  }
}

function fakeVoteCoordinatorState() {
  const sql = new DurableObjectSqlForTest()
  const alarms = []
  const state = {
    storage: {
      sql,
      transactionSync(callback) {
        sql.db.exec("BEGIN IMMEDIATE")
        try {
          const result = callback()
          sql.db.exec("COMMIT")
          return result
        } catch (error) {
          sql.db.exec("ROLLBACK")
          throw error
        }
      },
      async setAlarm(timestamp) {
        alarms.push(timestamp)
      },
    },
    blockConcurrencyWhile(callback) {
      this.ready = Promise.resolve().then(callback)
      return this.ready
    },
  }
  return { state, alarms }
}

class RecordingStatement {
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
    this.db.calls.push({ type: "first", sql: this.sql, args: this.args })
    for (const [needle, result] of this.db.firstResults) {
      if (this.sql.includes(needle)) {
        return typeof result === "function" ? result(this.sql, this.args) : result
      }
    }
    if (this.sql.includes("FROM icono_publish_state")) {
      return { current_asset_sha256: "", admin_override: 0 }
    }
    return null
  }

  async all() {
    this.db.calls.push({ type: "all", sql: this.sql, args: this.args })
    for (const [needle, results] of this.db.allResults) {
      if (this.sql.includes(needle)) {
        return { results: typeof results === "function" ? results(this.sql, this.args) : results }
      }
    }
    if (this.sql.includes("FROM icono_gene_catalog gc")) {
      return {
        results: [
          {
            gene_symbol: "TP53",
            catalog_full_name: "tumor protein p53",
            color_hex: "#77aadd",
          },
        ],
      }
    }
    return { results: [] }
  }

  async run() {
    this.db.calls.push({ type: "run", sql: this.sql, args: this.args })
    if (this.db.runHandler) {
      const result = await this.db.runHandler({ sql: this.sql, args: this.args })
      if (result) return result
    }
    return { success: true, meta: { changes: 1 } }
  }
}

class RecordingDb {
  constructor({ allResults = [], firstResults = [], runHandler = null } = {}) {
    this.calls = []
    this.allResults = Array.isArray(allResults) ? allResults : []
    this.firstResults = Array.isArray(firstResults) ? firstResults : []
    this.runHandler = typeof runHandler === "function" ? runHandler : null
  }

  prepare(sql) {
    return new RecordingStatement(this, sql)
  }

  async batch(statements) {
    const results = []
    for (const statement of Array.isArray(statements) ? statements : []) {
      results.push(await statement.run())
    }
    return results
  }
}

class FakeVoteCoordinatorBinding {
  constructor(handlers = {}) {
    this.handlers = handlers
    this.calls = []
  }

  idFromName(name) {
    return String(name || "")
  }

  get(id) {
    return {
      fetch: async (request) => {
        const cloned = request.clone()
        const url = new URL(cloned.url)
        const body =
          cloned.method === "GET" || cloned.method === "HEAD" ? null : await cloned.json()
        this.calls.push({
          id,
          method: cloned.method,
          pathname: url.pathname,
          body,
        })
        const handler = this.handlers[url.pathname]
        if (!handler) {
          return Response.json(
            { error: `Unexpected coordinator path ${url.pathname}` },
            { status: 404 },
          )
        }
        return handler({ id, method: cloned.method, pathname: url.pathname, body })
      },
    }
  }
}

function fakeSessions(user = { user_id: "user_123", username: "founder" }) {
  return {
    idFromName(name) {
      return String(name || "")
    },
    get() {
      return {
        async fetch() {
          return Response.json(user)
        },
      }
    },
  }
}

function fakeKv({ putError = null } = {}) {
  const calls = []
  return {
    calls,
    async get() {
      return null
    },
    async put(key, value) {
      calls.push({ key: String(key || ""), value: String(value || "") })
      if (putError) throw putError
    },
    async delete() {},
  }
}

function fakeQueue() {
  const messages = []
  return {
    messages,
    async send(body) {
      messages.push(body)
    },
  }
}

function waitUntilRecorder() {
  const promises = []
  return {
    promises,
    waitUntil(promise) {
      promises.push(Promise.resolve(promise))
    },
  }
}

async function drainWaitUntil(ctx) {
  await Promise.all(ctx.promises)
}

function healthyBudgetSnapshot() {
  return {
    kv: { reads_remaining: 100, writes_remaining: 100, lists_remaining: 100 },
    d1: { rows_read_remaining: 1000, rows_written_remaining: 1000 },
    queues: { operations_remaining: 100 },
    workers: { requests_remaining: 100, cpu_ms_remaining: 1000 },
    durable_objects: { requests_remaining: 100, rows_written_remaining: 100 },
    r2: { available: false, required: false },
    logs: { events_remaining: 100 },
  }
}

test("desired vote commands are idempotent under identical retry", () => {
  assert.equal(resolveDesiredVoteValue(0, 1), 1)
  assert.equal(resolveDesiredVoteValue(1, 1), 1)
  assert.equal(resolveDesiredVoteValue(-1, -1), -1)
  assert.equal(resolveDesiredVoteValue(1, 0), 0)
})

test("vote-event mutation migration deduplicates replayed audit events", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(
    readFileSync(
      new URL("../migrations-iconoplasm/0020_add_vote_event_feed.sql", import.meta.url),
      "utf8",
    ),
  )
  db.exec(
    readFileSync(
      new URL("../migrations-iconoplasm/0056_vote_event_mutation_id.sql", import.meta.url),
      "utf8",
    ),
  )
  const insert = db.prepare(
    `INSERT INTO icono_vote_events (
       gene_symbol, asset_sha256, vision_id, candidate_ref, user_id, vote_value, mutation_id
     ) VALUES ('TP53', ?, '', ?, 'user_123', 1, 'TP53:1')
     ON CONFLICT(mutation_id) WHERE mutation_id IS NOT NULL DO NOTHING`,
  )
  const assetSha = "a".repeat(64)
  insert.run(assetSha, `a:TP53|${assetSha}`)
  insert.run(assetSha, `a:TP53|${assetSha}`)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM icono_vote_events").get().count, 1)
})

test("VoteCoordinator stores one transactional outbox mutation for an identical retry", async () => {
  const { state } = fakeVoteCoordinatorState()
  const coordinator = new IconoplasmVoteCoordinator(state, {})
  await state.ready
  const assetSha = "f".repeat(64)
  coordinator.setMeta("symbol", "TP53")
  coordinator.setMeta("bootstrapped", "1")
  const ensuredAsset = coordinator.ensureAssetSummaryRow(assetSha, {
    visionId: "anima-v1-1",
    candidateImageId: 41,
  })

  const first = coordinator.applyVoteMutation({
    assetSha256: assetSha,
    userId: "user_123",
    requestedVoteValue: 1,
    visionId: "anima-v1-1",
    candidateImageId: 41,
    ensuredAsset,
  })
  const retry = coordinator.applyVoteMutation({
    assetSha256: assetSha,
    userId: "user_123",
    requestedVoteValue: 1,
    visionId: "anima-v1-1",
    candidateImageId: 41,
    ensuredAsset,
  })

  assert.equal(first.changed, true)
  assert.equal(first.final_vote_value, 1)
  assert.equal(first.snapshot.image_upvotes, 1)
  assert.equal(retry.changed, false)
  assert.equal(retry.final_vote_value, 1)
  assert.equal(retry.snapshot.image_upvotes, 1)
  assert.equal(coordinator.pendingOutboxRows(10).length, 1)
  assert.equal(coordinator.pendingOutboxRows(10)[0].mutation_id, first.mutation_id)
})

test("VoteCoordinator outbox survives a partial D1 handoff and replays with one mutation identity", async (t) => {
  t.mock.method(console, "error", () => {})
  let failProjectionJob = true
  const db = new RecordingDb({
    runHandler: ({ sql }) => {
      if (failProjectionJob && /INSERT INTO icono_vote_projection_refresh_jobs/i.test(sql)) {
        throw new Error("simulated D1 projection-job failure")
      }
      return null
    },
  })
  const queue = fakeQueue()
  const { state } = fakeVoteCoordinatorState()
  const coordinator = new IconoplasmVoteCoordinator(state, {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: queue,
  })
  await state.ready
  const assetSha = "e".repeat(64)
  coordinator.setMeta("symbol", "SOX4")
  coordinator.setMeta("bootstrapped", "1")
  const ensuredAsset = coordinator.ensureAssetSummaryRow(assetSha, {
    visionId: "anima-v1-9",
    candidateImageId: 99,
  })
  const mutation = coordinator.applyVoteMutation({
    assetSha256: assetSha,
    userId: "user_123",
    requestedVoteValue: 1,
    visionId: "anima-v1-9",
    candidateImageId: 99,
    ensuredAsset,
  })

  const firstDrain = await coordinator.drainVoteOutbox()
  assert.equal(firstDrain.ok, false)
  assert.equal(coordinator.pendingOutboxRows(10).length, 1)

  failProjectionJob = false
  const retryDrain = await coordinator.drainVoteOutbox()
  assert.equal(retryDrain.ok, true)
  assert.equal(coordinator.pendingOutboxRows(10).length, 0)
  assert.equal(queue.messages.length, 1)
  const eventWrites = db.calls.filter((call) => /INSERT INTO icono_vote_events/i.test(call.sql))
  assert.equal(eventWrites.length, 2)
  assert.equal(eventWrites[0].args.at(-1), mutation.mutation_id)
  assert.equal(eventWrites[1].args.at(-1), mutation.mutation_id)
  assert.match(eventWrites[0].sql, /ON CONFLICT\(mutation_id\)/)
})

test("public vote set is routed through the vote coordinator instead of reading current vote state from D1", async () => {
  const assetSha = "a".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/set": ({ body }) =>
      Response.json({
        ok: true,
        symbol: "TP53",
        asset_sha256: assetSha,
        resolved_vision_id: "anima-v1-1",
        candidate_image_id: 41,
        current_vote_value: 0,
        final_vote_value: 1,
        changed: true,
        mutation_id: "TP53:1",
        snapshot: {
          image_upvotes: 1,
          image_downvotes: 0,
          image_score: 1,
          user_vote: 1,
          vision_upvotes: 1,
          vision_downvotes: 0,
          vision_score: 1,
          candidate_ref: body?.candidate_ref || `a:TP53|${assetSha}`,
          vision_id: "anima-v1-1",
        },
        asset_summaries: [
          {
            asset_sha256: assetSha,
            candidate_ref: `a:TP53|${assetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 41,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "TP53",
        asset_summaries: [
          {
            asset_sha256: assetSha,
            candidate_ref: `a:TP53|${assetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 41,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb()
  const ctx = waitUntilRecorder()
  const queue = fakeQueue()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/set",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            symbol: "TP53",
            asset_sha256: assetSha,
            candidate_ref: `a:TP53|${assetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 41,
            vote_value: 1,
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        ICONOPLASM_VOTE_PROJECTION_QUEUE: queue,
        GAME_SESSIONS: fakeSessions(),
        KV: fakeKv(),
      },
      ctx,
    )
  const payload = await response.json()
  await drainWaitUntil(ctx)

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(coordinator.calls.length, 1)
  assert.equal(coordinator.calls[0]?.pathname, "/vote/set")
  assert.equal(queue.messages.length, 0)
  assert.equal(payload?.projection_refresh?.durable, true)
  assert.equal(payload?.projection_refresh?.mode, "durable_outbox")
  assert.equal(payload?.projection_refresh?.mutation_id, "TP53:1")
  assert.equal(
    db.calls.some((call) =>
      /icono_image_votes|icono_vote_events|vote_projection_refresh_jobs/i.test(call.sql),
    ),
    false,
  )
  assert.equal(
    db.calls.some(
      (call) =>
        call.type === "first" &&
        /SELECT vote_value\s+FROM icono_image_votes[\s\S]*AND asset_sha256 = \?[\s\S]*AND user_id = \?/i.test(
          call.sql,
        ),
    ),
    false,
  )
})

test("public vote set returns after durable coordinator outbox commit without inline projection", async () => {
  const assetSha = "d".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/set": () =>
      Response.json({
        ok: true,
        symbol: "SOCS1",
        asset_sha256: assetSha,
        resolved_vision_id: "anima-v1-5567",
        candidate_image_id: 49076,
        current_vote_value: 0,
        final_vote_value: 1,
        changed: true,
        mutation_id: "SOCS1:1",
        snapshot: {
          image_upvotes: 1,
          image_downvotes: 0,
          image_score: 1,
          user_vote: 1,
          vision_upvotes: 1,
          vision_downvotes: 0,
          vision_score: 1,
          candidate_ref: `a:SOCS1|${assetSha}`,
          vision_id: "anima-v1-5567",
        },
      }),
  })
  const db = new RecordingDb()
  const queue = fakeQueue()
  const ctx = waitUntilRecorder()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/set",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            symbol: "SOCS1",
            asset_sha256: assetSha,
            candidate_ref: `a:SOCS1|${assetSha}`,
            vision_id: "anima-v1-5567",
            candidate_image_id: 49076,
            vote_value: 1,
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        ICONOPLASM_VOTE_PROJECTION_QUEUE: queue,
        GAME_SESSIONS: fakeSessions(),
        KV: fakeKv(),
      },
      ctx,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(ctx.promises.length, 0)
  assert.equal(queue.messages.length, 0)
  assert.equal(payload?.projection_refresh?.mode, "durable_outbox")
  assert.equal(payload?.projection_refresh?.mutation_id, "SOCS1:1")
  assert.equal(
    db.calls.some((call) => /INSERT INTO icono_publish_state/i.test(call.sql)),
    false,
  )
})

test("queue dispatcher recognizes Cloudflare REST vote projection message envelope", async () => {
  const db = new RecordingDb()
  const ctx = waitUntilRecorder()
  let acked = false
  let retried = false

  const result = await handleIconoplasmQueue(
    {
      messages: [
        {
          body: {
            body: {
              kind: "process_vote_projection_refresh",
              symbol: "SOCS1",
              actor_id: "1289482311557058641",
              reason: "vote_auto_promote",
            },
            content_type: "json",
          },
          ack() {
            acked = true
          },
          retry() {
            retried = true
          },
        },
      ],
    },
    { ICONOPLASM_DB: db },
    ctx,
  )

  assert.equal(result?.ok, true)
  assert.equal(result?.skipped, 1)
  assert.equal(acked, true)
  assert.equal(retried, false)
  assert.equal(
    db.calls.some(
      (call) => call.type === "first" && /FROM icono_vote_projection_refresh_jobs/i.test(call.sql),
    ),
    true,
  )
})

test("vote request does not mutate canonical state before the projection queue drains", async (t) => {
  t.mock.method(console, "error", () => {})
  const oldAssetSha = "1".repeat(64)
  const newAssetSha = "2".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/set": () =>
      Response.json({
        ok: true,
        symbol: "PRL",
        asset_sha256: newAssetSha,
        resolved_vision_id: "anima-v1-1",
        candidate_image_id: 31345,
        current_vote_value: 0,
        final_vote_value: 1,
        snapshot: {
          image_upvotes: 1,
          image_downvotes: 0,
          image_score: 1,
          user_vote: 1,
          vision_upvotes: 1,
          vision_downvotes: 0,
          vision_score: 1,
          candidate_ref: `a:PRL|${newAssetSha}`,
          vision_id: "anima-v1-1",
        },
        asset_summaries: [
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:PRL|${newAssetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "PRL",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:PRL|${oldAssetSha}`,
            vision_id: "anima-v1-0",
            candidate_image_id: 25515,
            upvotes: 0,
            downvotes: 0,
            score: 0,
            vote_count: 0,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:PRL|${newAssetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 0 }],
    ],
    allResults: [
      [
        "FROM icono_portrait_assets pa",
        [
          {
            asset_sha256: oldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-0",
            candidate_image_id: 25515,
            created_at: "2026-05-20T05:00:00.000Z",
          },
          {
            asset_sha256: newAssetSha,
            status: "draft",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            created_at: "2026-05-20T05:05:00.000Z",
          },
        ],
      ],
    ],
  })
  const ctx = waitUntilRecorder()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/set",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            symbol: "PRL",
            asset_sha256: newAssetSha,
            candidate_ref: `a:PRL|${newAssetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            vote_value: 1,
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        GAME_SESSIONS: fakeSessions(),
        KV: fakeKv(),
      },
      ctx,
    )
  const payload = await response.json()
  await drainWaitUntil(ctx)

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(
    db.calls.some(
      (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
    ),
    false,
  )
})

test("vote projection rolls back canonical promotion when read-model projection fails", async (t) => {
  t.mock.method(console, "error", () => {})
  const oldAssetSha = "3".repeat(64)
  const newAssetSha = "4".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/set": () =>
      Response.json({
        ok: true,
        symbol: "PRL",
        asset_sha256: newAssetSha,
        resolved_vision_id: "anima-v1-1",
        candidate_image_id: 31345,
        current_vote_value: 0,
        final_vote_value: 1,
        snapshot: {
          image_upvotes: 2,
          image_downvotes: 0,
          image_score: 2,
          user_vote: 1,
          vision_upvotes: 2,
          vision_downvotes: 0,
          vision_score: 2,
          candidate_ref: `a:PRL|${newAssetSha}`,
          vision_id: "anima-v1-1",
        },
        asset_summaries: [
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:PRL|${newAssetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            upvotes: 2,
            downvotes: 0,
            score: 2,
            vote_count: 2,
          },
        ],
      }),
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "PRL",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:PRL|${oldAssetSha}`,
            vision_id: "anima-v1-0",
            candidate_image_id: 25515,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:PRL|${newAssetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            upvotes: 2,
            downvotes: 0,
            score: 2,
            vote_count: 2,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "PRL",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 0 }],
    ],
    allResults: [
      [
        "FROM icono_portrait_assets pa",
        [
          {
            asset_sha256: oldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-0",
            candidate_image_id: 25515,
            created_at: "2026-05-20T05:00:00.000Z",
          },
          {
            asset_sha256: newAssetSha,
            status: "draft",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            created_at: "2026-05-20T05:05:00.000Z",
          },
        ],
      ],
      [
        "FROM icono_gene_catalog gc",
        [
          {
            gene_symbol: "PRL",
            catalog_full_name: "prolactin",
            color_hex: "#77aadd",
            asset_sha256: newAssetSha,
            width: 1024,
            height: 1024,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
          },
        ],
      ],
    ],
    runHandler: ({ sql }) => {
      if (/INSERT INTO icono_vote_asset_summary/i.test(sql)) {
        throw new Error("simulated vote read-model write failure")
      }
      return null
    },
  })
  const ctx = waitUntilRecorder()
  const queue = fakeQueue()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_COORDINATORS: coordinator,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: queue,
    GAME_SESSIONS: fakeSessions(),
    KV: fakeKv(),
    ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
    ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
  }

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/set",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "session=abc123",
          },
          body: JSON.stringify({
            symbol: "PRL",
            asset_sha256: newAssetSha,
            candidate_ref: `a:PRL|${newAssetSha}`,
            vision_id: "anima-v1-1",
            candidate_image_id: 31345,
            vote_value: 1,
          }),
        },
      ),
      env,
      ctx,
    )
  const payload = await response.json()
  assert.equal(queue.messages.length, 0)
  await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "PRL",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    env,
    ctx,
  )

  const rollback = db.calls.find(
    (call) =>
      call.type === "run" &&
      /UPDATE icono_publish_state/i.test(call.sql) &&
      /SET current_asset_sha256 = \?/i.test(call.sql) &&
      /AND current_asset_sha256 = \?/i.test(call.sql),
  )

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.ok(
    db.calls.some(
      (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
    ),
  )
  assert.ok(rollback)
  assert.equal(rollback.args[0], oldAssetSha)
  assert.equal(rollback.args[2], "PRL")
  assert.equal(rollback.args[3], newAssetSha)
  assert.equal(env.KV.calls.length, 0)
})

test("vote projection promotes newer asset when score and upvotes tie", async () => {
  const oldAssetSha = "a".repeat(64)
  const newAssetSha = "b".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "SLC11A2",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:SLC11A2|${oldAssetSha}`,
            vision_id: "anima-v1-18",
            candidate_image_id: 1818,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:SLC11A2|${newAssetSha}`,
            vision_id: "anima-v1-19",
            candidate_image_id: 1919,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "SLC11A2",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 0 }],
    ],
    allResults: [
      [
        "FROM icono_portrait_assets pa",
        [
          {
            asset_sha256: oldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-18",
            candidate_image_id: 1818,
            created_at: "2026-05-21T15:25:49.000Z",
          },
          {
            asset_sha256: newAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-19",
            candidate_image_id: 1919,
            created_at: "2026-05-26T19:33:46.000Z",
          },
        ],
      ],
      [
        "FROM icono_gene_catalog gc",
        [
          {
            gene_symbol: "SLC11A2",
            catalog_full_name: "solute carrier family 11 member 2",
            color_hex: "#77aadd",
            asset_sha256: newAssetSha,
            width: 1024,
            height: 1024,
            vision_id: "anima-v1-19",
            candidate_image_id: 1919,
          },
        ],
      ],
    ],
  })
  const kv = fakeKv()
  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "SLC11A2",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_VOTE_COORDINATORS: coordinator,
      KV: kv,
      ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
      ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
    },
  )

  const promotion = db.calls.find(
    (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
  )

  assert.equal(result?.ok, true)
  assert.ok(promotion, "tied newer candidate should be promoted")
  assert.equal(promotion.args[0], "SLC11A2")
  assert.equal(promotion.args[1], newAssetSha)
  assert.equal(kv.calls.length, 0, "vote projection must not publish cards for tie promotion")
})

test("vote projection preserves explicit admin override when newer tied asset exists", async () => {
  const oldAssetSha = "c".repeat(64)
  const newAssetSha = "d".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "GLYAT",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:GLYAT|${oldAssetSha}`,
            vision_id: "anima-v1-20",
            candidate_image_id: 2020,
            upvotes: 2,
            downvotes: 0,
            score: 2,
            vote_count: 2,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:GLYAT|${newAssetSha}`,
            vision_id: "anima-v1-21",
            candidate_image_id: 2121,
            upvotes: 2,
            downvotes: 0,
            score: 2,
            vote_count: 2,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "GLYAT",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 1 }],
    ],
  })
  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "GLYAT",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_VOTE_COORDINATORS: coordinator,
      KV: fakeKv(),
      ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
      ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
    },
  )

  assert.equal(result?.ok, true)
  assert.equal(
    db.calls.some(
      (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
    ),
    false,
  )
})

test("vote projection Queue batch does not publish the public card artifact for due jobs", async () => {
  const tp53OldAssetSha = "5".repeat(64)
  const tp53NewAssetSha = "6".repeat(64)
  const socs1OldAssetSha = "7".repeat(64)
  const socs1NewAssetSha = "8".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": ({ id }) => {
      if (id === "TP53") {
        return Response.json({
          ok: true,
          symbol: "TP53",
          asset_summaries: [
            {
              asset_sha256: tp53NewAssetSha,
              candidate_ref: `a:TP53|${tp53NewAssetSha}`,
              vision_id: "anima-v1-1",
              candidate_image_id: 1001,
              upvotes: 4,
              downvotes: 0,
              score: 4,
              vote_count: 4,
            },
          ],
        })
      }
      if (id === "SOCS1") {
        return Response.json({
          ok: true,
          symbol: "SOCS1",
          asset_summaries: [
            {
              asset_sha256: socs1NewAssetSha,
              candidate_ref: `a:SOCS1|${socs1NewAssetSha}`,
              vision_id: "anima-v1-2",
              candidate_image_id: 1002,
              upvotes: 5,
              downvotes: 0,
              score: 5,
              vote_count: 5,
            },
          ],
        })
      }
      return Response.json({ ok: true, symbol: id, asset_summaries: [] })
    },
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        (_sql, args) => {
          const symbol = args[0]
          return {
            gene_symbol: symbol,
            actor_id: "user_123",
            reason: "vote_auto_promote",
            attempts: 0,
            next_attempt_at: "2000-01-01T00:00:00.000Z",
          }
        },
      ],
      [
        "FROM icono_publish_state",
        (_sql, args) => ({
          current_asset_sha256: args[0] === "SOCS1" ? socs1OldAssetSha : tp53OldAssetSha,
          admin_override: 0,
        }),
      ],
    ],
    allResults: [
      [
        "FROM icono_portrait_assets pa",
        () => [
          {
            asset_sha256: tp53OldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-0",
            candidate_image_id: 9001,
            created_at: "2026-05-20T05:00:00.000Z",
          },
          {
            asset_sha256: tp53NewAssetSha,
            status: "draft",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-1",
            candidate_image_id: 1001,
            created_at: "2026-05-20T05:05:00.000Z",
          },
          {
            asset_sha256: socs1OldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-0",
            candidate_image_id: 9002,
            created_at: "2026-05-20T05:00:00.000Z",
          },
          {
            asset_sha256: socs1NewAssetSha,
            status: "draft",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-2",
            candidate_image_id: 1002,
            created_at: "2026-05-20T05:05:00.000Z",
          },
        ],
      ],
      [
        "FROM icono_gene_catalog gc",
        [
          {
            gene_symbol: "SOCS1",
            catalog_full_name: "suppressor of cytokine signaling 1",
            color_hex: "#77aadd",
            asset_sha256: socs1NewAssetSha,
            width: 1024,
            height: 1024,
            vision_id: "anima-v1-2",
            candidate_image_id: 1002,
          },
          {
            gene_symbol: "TP53",
            catalog_full_name: "tumor protein p53",
            color_hex: "#ddaa77",
            asset_sha256: tp53NewAssetSha,
            width: 1024,
            height: 1024,
            vision_id: "anima-v1-1",
            candidate_image_id: 1001,
          },
        ],
      ],
    ],
  })
  const kv = fakeKv()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_COORDINATORS: coordinator,
    KV: kv,
    ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
    ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
  }
  let acked = 0
  let retried = 0

  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "TP53",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {
            acked += 1
          },
          retry() {
            retried += 1
          },
        },
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "SOCS1",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {
            acked += 1
          },
          retry() {
            retried += 1
          },
        },
      ],
    },
    env,
  )

  assert.equal(result?.ok, true)
  assert.equal(result?.processed, 2)
  assert.equal(acked, 2)
  assert.equal(retried, 0)
  assert.equal(kv.calls.length, 0, "vote projection must not spend KV writes publishing cards")
})

test("vote projection Queue retries instead of acking jobs whose D1 backoff is not due", async () => {
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "LAIR2",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 1,
          next_attempt_at: "2999-01-01T00:00:00.000Z",
        },
      ],
    ],
  })
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_COORDINATORS: new FakeVoteCoordinatorBinding(),
  }
  let acked = 0
  const retryCalls = []

  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "LAIR2",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {
            acked += 1
          },
          retry(options) {
            retryCalls.push(options)
          },
        },
      ],
    },
    env,
  )

  assert.equal(result?.ok, true)
  assert.equal(result?.skipped, 1)
  assert.equal(acked, 0, "backoff-delayed jobs must not lose their only Queue message")
  assert.equal(retryCalls.length, 1)
  assert.ok(retryCalls[0]?.delaySeconds >= 30)
})

test("vote projection promotes newer asset when score and upvotes tie", async () => {
  const oldAssetSha = "a".repeat(64)
  const newAssetSha = "b".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "SLC11A2",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:SLC11A2|${oldAssetSha}`,
            vision_id: "anima-v1-18",
            candidate_image_id: 1818,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:SLC11A2|${newAssetSha}`,
            vision_id: "anima-v1-19",
            candidate_image_id: 1919,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "SLC11A2",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 0 }],
    ],
    allResults: [
      [
        "FROM icono_portrait_assets pa",
        [
          {
            asset_sha256: oldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-18",
            candidate_image_id: 1818,
            created_at: "2026-05-21T15:25:49.000Z",
          },
          {
            asset_sha256: newAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-19",
            candidate_image_id: 1919,
            created_at: "2026-05-26T19:33:46.000Z",
          },
        ],
      ],
      [
        "FROM icono_gene_catalog gc",
        [
          {
            gene_symbol: "SLC11A2",
            catalog_full_name: "solute carrier family 11 member 2",
            color_hex: "#77aadd",
            asset_sha256: newAssetSha,
            width: 1024,
            height: 1024,
            vision_id: "anima-v1-19",
            candidate_image_id: 1919,
          },
        ],
      ],
    ],
  })
  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "SLC11A2",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_VOTE_COORDINATORS: coordinator,
      KV: fakeKv(),
      ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
      ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
    },
  )

  const promotion = db.calls.find(
    (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
  )

  assert.equal(result?.ok, true)
  assert.ok(promotion, "tied newer candidate should be promoted")
  assert.equal(promotion.args[0], "SLC11A2")
  assert.equal(promotion.args[1], newAssetSha)
})

test("vote projection preserves explicit admin override when newer tied asset exists", async () => {
  const oldAssetSha = "c".repeat(64)
  const newAssetSha = "d".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "GLYAT",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:GLYAT|${oldAssetSha}`,
            vision_id: "anima-v1-20",
            candidate_image_id: 2020,
            upvotes: 2,
            downvotes: 0,
            score: 2,
            vote_count: 2,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:GLYAT|${newAssetSha}`,
            vision_id: "anima-v1-21",
            candidate_image_id: 2121,
            upvotes: 2,
            downvotes: 0,
            score: 2,
            vote_count: 2,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "GLYAT",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 1 }],
    ],
  })
  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "GLYAT",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_VOTE_COORDINATORS: coordinator,
      KV: fakeKv(),
      ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
      ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
    },
  )

  assert.equal(result?.ok, true)
  assert.equal(
    db.calls.some(
      (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
    ),
    false,
  )
})

test("public vote snapshot can run from the vote coordinator without a D1 binding", async () => {
  const assetSha = "b".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/snapshot": () =>
      Response.json({
        ok: true,
        symbol: "A1BG",
        asset_sha256: assetSha,
        snapshot: {
          image_upvotes: 4,
          image_downvotes: 1,
          image_score: 3,
          user_vote: 0,
          vision_upvotes: 4,
          vision_downvotes: 1,
          vision_score: 3,
          candidate_ref: `a:A1BG|${assetSha}`,
          vision_id: "anima-v1-2",
        },
      }),
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/snapshot",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: "A1BG",
            asset_sha256: assetSha,
            candidate_ref: `a:A1BG|${assetSha}`,
            vision_id: "anima-v1-2",
          }),
        },
      ),
      {
        ICONOPLASM_DB: null,
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        GAME_SESSIONS: fakeSessions(null),
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(coordinator.calls.length, 1)
  assert.equal(coordinator.calls[0]?.pathname, "/vote/snapshot")
  assert.equal(payload?.snapshot?.vision_id, "anima-v1-2")
})

test("public gene vote snapshots use one coordinator batch request", async () => {
  const firstAsset = "1".repeat(64)
  const secondAsset = "2".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/snapshots": ({ body }) =>
      Response.json({
        ok: true,
        snapshots: body.items.map((item, index) => ({
          candidate_ref: item.candidate_ref,
          symbol: item.symbol,
          asset_sha256: item.asset_sha256,
          snapshot: {
            image_upvotes: index + 1,
            image_downvotes: 0,
            image_score: index + 1,
            user_vote: 0,
            candidate_ref: item.candidate_ref,
          },
        })),
      }),
  })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/snapshots",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              { symbol: "TP53", asset_sha256: firstAsset },
              { symbol: "TP53", asset_sha256: secondAsset },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        GAME_SESSIONS: fakeSessions(null),
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.snapshots.length, 2)
  assert.equal(coordinator.calls.length, 1)
  assert.equal(coordinator.calls[0].pathname, "/vote/snapshots")
  assert.equal(coordinator.calls[0].body.items.length, 2)
})

test("admin vote import is routed through the vote coordinator batch endpoint", async () => {
  const assetSha = "c".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/vote/import": () =>
      Response.json({
        ok: true,
        symbol: "A1BG",
        upserted: 1,
        deleted: 0,
        invalid: 0,
        results: [
          {
            candidate_ref: `a:A1BG|${assetSha}`,
            symbol: "A1BG",
            asset_sha256: assetSha,
            vision_id: "anima-v1-3",
            candidate_image_id: 7,
            user_id: "local_admin",
            current_vote_value: 0,
            final_vote_value: 1,
            changed: true,
            mutation_id: "A1BG:1",
          },
        ],
        asset_summaries: [
          {
            asset_sha256: assetSha,
            candidate_ref: `a:A1BG|${assetSha}`,
            vision_id: "anima-v1-3",
            candidate_image_id: 7,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "A1BG",
        asset_summaries: [
          {
            asset_sha256: assetSha,
            candidate_ref: `a:A1BG|${assetSha}`,
            vision_id: "anima-v1-3",
            candidate_image_id: 7,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb()
  const ctx = waitUntilRecorder()
  const queue = fakeQueue()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/votes/import",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Iconoplasm-Admin-Token": "secret",
          },
          body: JSON.stringify({
            items: [
              {
                symbol: "A1BG",
                asset_sha256: assetSha,
                candidate_ref: `a:A1BG|${assetSha}`,
                vision_id: "anima-v1-3",
                candidate_image_id: 7,
                user_id: "local_admin",
                vote_value: 1,
              },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        ICONOPLASM_ADMIN_TOKEN: "secret",
        ICONOPLASM_VOTE_PROJECTION_QUEUE: queue,
        KV: fakeKv(),
      },
      ctx,
    )
  const payload = await response.json()
  await drainWaitUntil(ctx)

  assert.equal(response.status, 200)
  assert.equal(payload?.upserted, 1)
  assert.equal(coordinator.calls.length, 1)
  assert.equal(coordinator.calls[0]?.pathname, "/vote/import")
  assert.equal(queue.messages.length, 0)
  assert.equal(payload?.projection_refresh_queued, 1)
  assert.equal(
    db.calls.some(
      (call) =>
        call.type === "first" &&
        /SELECT vote_value\s+FROM icono_image_votes[\s\S]*AND asset_sha256 = \?[\s\S]*AND user_id = \?/i.test(
          call.sql,
        ),
    ),
    false,
  )
})

test("admin pending vote projection refresh endpoint exposes durable queue rows", async () => {
  const db = new RecordingDb({
    allResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        [
          {
            gene_symbol: "TP53",
            actor_id: "vote_projection",
            reason: "vote_auto_promote",
            requested_at: "2026-04-15 10:00:00",
            last_attempt_at: "2026-04-15 10:01:00",
            next_attempt_at: "2026-04-15 10:05:00",
            attempts: 2,
            last_error: "timed out",
          },
        ],
      ],
    ],
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/votes/projection-refresh/pending?limit=5",
        {
          method: "GET",
          headers: {
            "X-Iconoplasm-Admin-Token": "secret",
          },
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_ADMIN_TOKEN: "secret",
        KV: fakeKv(),
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.count, 1)
  assert.deepEqual(payload?.requests?.[0], {
    symbol: "TP53",
    actor_id: "vote_projection",
    reason: "vote_auto_promote",
    requested_at: "2026-04-15 10:00:00",
    last_attempt_at: "2026-04-15 10:01:00",
    next_attempt_at: "2026-04-15 10:05:00",
    attempts: 2,
    last_error: "timed out",
    retrying: true,
  })
})

test("admin vote projection process endpoint drains due durable jobs", async () => {
  const oldAssetSha = "1".repeat(64)
  const newAssetSha = "2".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "LAIR2",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:LAIR2|${oldAssetSha}`,
            vision_id: "anima-v1-732",
            candidate_image_id: 28142,
            upvotes: 0,
            downvotes: 1,
            score: -1,
            vote_count: 1,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:LAIR2|${newAssetSha}`,
            vision_id: "anima-v1-9860",
            candidate_image_id: 10720,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "LAIR2",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 1,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 0 }],
    ],
    allResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        [
          {
            gene_symbol: "LAIR2",
            actor_id: "user_123",
            reason: "vote_auto_promote",
            attempts: 1,
            next_attempt_at: "2000-01-01T00:00:00.000Z",
          },
        ],
      ],
      [
        "FROM icono_portrait_assets pa",
        [
          {
            asset_sha256: oldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-732",
            candidate_image_id: 28142,
            created_at: "2026-04-16T15:44:00.000Z",
          },
          {
            asset_sha256: newAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-9860",
            candidate_image_id: 10720,
            created_at: "2026-03-17T13:07:57.000Z",
          },
        ],
      ],
      [
        "FROM icono_gene_catalog gc",
        [
          {
            gene_symbol: "LAIR2",
            catalog_full_name: "leukocyte associated immunoglobulin like receptor 2",
            color_hex: "#77aadd",
            asset_sha256: newAssetSha,
            width: 768,
            height: 1024,
            vision_id: "anima-v1-9860",
            candidate_image_id: 10720,
          },
        ],
      ],
    ],
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/votes/projection-refresh/process",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ limit: 10 }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_VOTE_COORDINATORS: coordinator,
        ICONOPLASM_ADMIN_TOKEN: "secret",
        KV: fakeKv(),
        GAME_SESSIONS: fakeSessions(),
        ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED: "1",
        ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST: healthyBudgetSnapshot(),
      },
      waitUntilRecorder(),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.processed, 1)
  assert.ok(
    db.calls.some(
      (call) =>
        call.type === "run" &&
        /INSERT INTO icono_publish_state/i.test(call.sql) &&
        call.args[1] === newAssetSha,
    ),
  )
})

test("admin vision stats endpoint stays exposed for Website Ops vote telemetry", async () => {
  const db = new RecordingDb({
    allResults: [
      ["FROM icono_artist_style_blacklist", []],
      [
        "FROM icono_admin_vision_rollup",
        [
          {
            vision_id: "anima-v1-1",
            artist_tag: "@artist_(name)",
            artist_name: "Artist Name",
            image_count: 3,
            avg_vote: 1.5,
            rejected_count: 0,
            rejection_rate: 0,
            upvotes: 5,
            downvotes: 1,
            score: 4,
            live_count: 2,
            blacklisted: 0,
            blacklist_reason: "",
            blacklist_updated_at: "",
          },
        ],
      ],
    ],
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/votes/vision-stats",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Iconoplasm-Admin-Token": "secret",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_ADMIN_TOKEN: "secret",
        KV: fakeKv(),
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.count, 1)
  assert.equal(payload?.rows?.[0]?.vision_id, "anima-v1-1")
  assert.equal(payload?.rows?.[0]?.live_count, 2)
  assert.deepEqual(payload?.blacklisted, [])
})
