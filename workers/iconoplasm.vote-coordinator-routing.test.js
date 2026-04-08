import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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
    if (this.sql.includes("FROM icono_publish_state")) {
      return { current_asset_sha256: "", admin_override: 0 }
    }
    return null
  }

  async all() {
    this.db.calls.push({ type: "all", sql: this.sql, args: this.args })
    return { results: [] }
  }

  async run() {
    this.db.calls.push({ type: "run", sql: this.sql, args: this.args })
    return { success: true, meta: { changes: 1 } }
  }
}

class RecordingDb {
  constructor() {
    this.calls = []
  }

  prepare(sql) {
    return new RecordingStatement(this, sql)
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
          return Response.json({ error: `Unexpected coordinator path ${url.pathname}` }, { status: 404 })
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

function fakeKv() {
  return {
    async get() {
      return null
    },
    async put() {},
    async delete() {},
  }
}

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
  })
  const db = new RecordingDb()
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/set", {
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
    }),
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_VOTE_COORDINATORS: coordinator,
      GAME_SESSIONS: fakeSessions(),
      KV: fakeKv(),
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(coordinator.calls.length, 1)
  assert.equal(coordinator.calls[0]?.pathname, "/vote/set")
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

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/votes/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "A1BG",
        asset_sha256: assetSha,
        candidate_ref: `a:A1BG|${assetSha}`,
        vision_id: "anima-v1-2",
      }),
    }),
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
  })
  const db = new RecordingDb()

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/votes/import", {
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
    }),
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_VOTE_COORDINATORS: coordinator,
      ICONOPLASM_ADMIN_TOKEN: "secret",
      KV: fakeKv(),
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.upserted, 1)
  assert.equal(coordinator.calls.length, 1)
  assert.equal(coordinator.calls[0]?.pathname, "/vote/import")
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
