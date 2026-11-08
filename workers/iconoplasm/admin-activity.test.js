// The admin activity feed: people's votes, comments, requests, caretaker work
// and artist suggestions, with the owner's two accounts and automation
// removable. Failure modes, written first:
// 1. the feed only shows publishing events, so it is opaque to readers' activity;
// 2. hiding admin accounts misses an event because it asks by username only (or
//    by ID only), so brinedew or loweren still fills the page;
// 3. hiding automation misses an event, or hides a person's event;
// 4. a kind filter returns another kind, or a page repeats an event;
// 5. a person's name is missing because the users lookup is skipped;
// 6. a non-admin can read the feed;
// 7. a timestamp from one table is ordered as if it were in another format.
import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { iconoplasmDatabase, SqliteD1 } from "../test-helpers/account-erasure-fixture.js"
import { BATCH_ROUTE_PRICES } from "./batch-route-prices.js"
import { createIconoplasmApp } from "./app.js"

const TOKEN = "admin-token-0000000000000000000000000003"
const BRINEDEW_ID = "1289482311557058641"
const LOWEREN_ID = "177906870516842497"
const LOWEREN_ACCOUNT = "acct_5f30b81c646a732ca955b6341b966570"
const REAL_VOTER = "1074367565276643418"
const REAL_PUBLISHER = "514928466307842076"
const CARETAKER_ACCOUNT = "acct_11111111111111111111111111111111"
const sha = (character) => character.repeat(64)

function harness({ admin = true } = {}) {
  const db = iconoplasmDatabase()
  const main = new DatabaseSync(":memory:")
  main.exec(`CREATE TABLE users (discord_id TEXT PRIMARY KEY, account_id TEXT, username TEXT)`)
  const addUser = main.prepare(
    "INSERT INTO users (discord_id, account_id, username) VALUES (?, ?, ?)",
  )
  addUser.run(BRINEDEW_ID, "acct_4c50927d3798f827c7da48673b1cfd2c", "brinedew")
  addUser.run(LOWEREN_ID, LOWEREN_ACCOUNT, "loweren")
  addUser.run(REAL_VOTER, "acct_22222222222222222222222222222222", "jenrm")
  addUser.run(REAL_PUBLISHER, "acct_33333333333333333333333333333333", "voter1")
  addUser.run("999999999999999999", CARETAKER_ACCOUNT, "caretaker1")
  const env = {
    ICONOPLASM_DB: db,
    DB: new SqliteD1(main),
    ICONOPLASM_ADMIN_TOKEN: TOKEN,
  }
  const app = createIconoplasmApp({
    isAdmin: async () => admin,
    legacy: async () => new Response("legacy", { status: 299 }),
  })
  return { app, env, db, main }
}

function seed(db) {
  const run = (sql, ...params) => db.database.prepare(sql).run(...params)

  run(
    `INSERT INTO icono_image_votes
       (candidate_ref, gene_symbol, asset_sha256, user_id, vote_value, created_at, updated_at)
     VALUES ('TP53|a', 'TP53', ?, ?, 1, '2026-11-08 10:00:00', '2026-11-08 10:00:00')`,
    sha("a"),
    REAL_VOTER,
  )
  run(
    `INSERT INTO icono_image_votes
       (candidate_ref, gene_symbol, asset_sha256, user_id, vote_value, created_at, updated_at)
     VALUES ('TP53|b', 'TP53', ?, ?, 1, '2026-11-08 10:11:00', '2026-11-08 10:11:00')`,
    sha("b"),
    BRINEDEW_ID,
  )
  run(
    `INSERT INTO icono_image_votes
       (candidate_ref, gene_symbol, asset_sha256, user_id, vote_value, created_at, updated_at)
     VALUES ('TP53|c', 'TP53', ?, 'local', 1, '2026-11-08 10:14:00', '2026-11-08 10:14:00')`,
    sha("c"),
  )
  run(
    `INSERT INTO icono_gene_comments
       (gene_symbol, user_id, username, body, status, created_at)
     VALUES ('ERBB2', ?, 'jenrm', 'Another name for this gene is HER2.', 'visible',
             '2026-11-08T10:01:00.000Z')`,
    REAL_VOTER,
  )
  run(
    `INSERT INTO icono_generation_requests
       (gene_symbol, requester_user_id, requester_username, request_kind, request_mode,
        status, request_origin, created_at)
     VALUES ('PRL', ?, 'jenrm', 'new_candidate', 'random', 'open', 'user',
             '2026-11-08 10:02:00')`,
    REAL_VOTER,
  )
  run(
    `INSERT INTO icono_generation_requests
       (gene_symbol, requester_user_id, requester_username, request_kind, request_mode,
        status, request_origin, created_at)
     VALUES ('KRAS', ?, 'loweren', 'new_candidate', 'random', 'open', 'user',
             '2026-11-08 10:12:00')`,
    LOWEREN_ID,
  )
  run(
    `INSERT INTO icono_generation_requests
       (gene_symbol, requester_user_id, requester_username, request_kind, request_mode,
        status, request_origin, diagnostic_run_id, created_at)
     VALUES ('KRAS', ?, 'loweren', 'new_candidate', 'random', 'open', 'diagnostic_matrix',
             'run-1', '2026-11-08 10:13:00')`,
    LOWEREN_ID,
  )
  run(
    `INSERT INTO icono_image_edit_jobs
       (id, user_id, provider_id, source_gene_symbol, source_asset_sha256, status, created_at)
     VALUES ('edit-1', ?, 'openai', 'TP53', ?, 'succeeded', '2026-11-08 10:03:00')`,
    REAL_VOTER,
    sha("a"),
  )
  run(
    `INSERT INTO icono_caretaker_text_versions
       (version_id, gene_symbol, line_id, version, account_id, caretaker_assignment_id,
        text, text_sha256, readers_see, created_at)
     VALUES ('version-1', 'TP53', 'line-1', 1, ?, 'assignment-1', 'A text.', ?, 1,
             '2026-11-08T10:04:00.000Z')`,
    LOWEREN_ACCOUNT,
    sha("d"),
  )
  run(
    `INSERT INTO icono_caretaker_supervote_events
       (mutation_id, event_type, gene_id, gene_symbol, caretaker_assignment_id,
        caretaker_account_id, assignment_status, assignment_version, supervote_version, created_at)
     VALUES ('mutation-1', 'supervote_set', 'gene-1', 'TP53', 'assignment-1', ?,
             'active', 1, 1, '2026-11-08 10:05:00')`,
    LOWEREN_ACCOUNT,
  )
  run(
    `INSERT INTO icono_caretaker_gene_requests
       (request_id, gene_symbol, holder_assignment_id, holder_account_id, requester_account_id,
        terms_version_id, status, created_at, expires_at)
     VALUES ('request-1', 'TP53', 'assignment-2', ?, ?, 'terms-1', 'pending',
             '2026-11-08T10:06:00.000Z', '2026-11-15T10:06:00.000Z')`,
    "acct_44444444444444444444444444444444",
    CARETAKER_ACCOUNT,
  )
  run(
    `INSERT INTO icono_artist_blacklist_submissions
       (artist_name_input, normalized_input, requested_by, requested_at)
     VALUES ('Some Artist', 'some_artist', 'artistfan', '2026-11-08 10:07:00')`,
  )
  run(
    `INSERT INTO icono_publish_events (gene_symbol, action, actor, created_at)
     VALUES ('TP53', 'publish', 'vote_authority', '2026-11-08 10:08:00')`,
  )
  run(
    `INSERT INTO icono_publish_events (gene_symbol, action, actor, created_at)
     VALUES ('TP53', 'publish', 'brinedew', '2026-11-08 10:09:00')`,
  )
  run(
    `INSERT INTO icono_publish_events (gene_symbol, action, actor, created_at)
     VALUES ('TP53', 'publish', ?, '2026-11-08 10:10:00')`,
    REAL_PUBLISHER,
  )
}

async function read(app, env, query = "") {
  const response = await app.request(`/api/iconoplasm/admin/activity${query}`, {}, env)
  return { status: response.status, body: await response.json().catch(() => null) }
}

test("the feed shows people's activity, not only publishing", async () => {
  const h = harness()
  seed(h.db)
  const { status, body } = await read(h.app, h.env, "?limit=50")
  assert.equal(status, 200)
  assert.deepEqual(body.events.map((event) => event.kind).sort(), [
    "artist",
    "caretaker_request",
    "comment",
    "edit",
    "publish",
    "request",
    "vote",
  ])
  assert.equal(
    body.events.find((event) => event.kind === "vote").actor,
    "jenrm",
    "the vote's actor name comes from the users table",
  )
  assert.equal(body.events.find((event) => event.kind === "comment").actor, "jenrm")
  assert.equal(body.events.find((event) => event.kind === "publish").actor, "voter1")
  assert.equal(body.events.find((event) => event.kind === "caretaker_request").actor, "caretaker1")
  assert.equal(body.people, 4)
  assert.deepEqual(body.hidden, { admins: true, system: true })
})

test("hiding admin accounts removes both usernames, their IDs and their caretaker account", async () => {
  const h = harness()
  seed(h.db)
  const { body } = await read(h.app, h.env, "?limit=100&hide_admins=1&hide_system=0&kinds=all")
  const actors = body.events.map((event) => event.actor)
  assert.ok(!actors.includes("brinedew"))
  assert.ok(!actors.includes("loweren"))
  assert.ok(!body.events.some((event) => event.actor_id === LOWEREN_ACCOUNT))
  assert.ok(body.events.some((event) => event.actor === "jenrm"))
  assert.ok(body.events.some((event) => event.actor === "caretaker1"))

  const everything = await read(h.app, h.env, "?limit=100&hide_admins=0&hide_system=0&kinds=all")
  assert.ok(everything.body.events.some((event) => event.actor === "brinedew"))
  assert.ok(everything.body.events.some((event) => event.actor === "loweren"))
  assert.ok(
    everything.body.events.some(
      (event) => event.actor === "Drain" || event.actor === "Vote authority",
    ),
  )
})

test("hiding automation keeps people and removes the drain, the vote authority and diagnostics", async () => {
  const h = harness()
  seed(h.db)
  const { body } = await read(h.app, h.env, "?limit=100&hide_admins=0&hide_system=1&kinds=all")
  assert.ok(body.events.some((event) => event.actor === "loweren"))
  assert.ok(body.events.some((event) => event.actor === "brinedew"))
  assert.ok(!body.events.some((event) => event.actor === "Vote authority"))
  assert.ok(!body.events.some((event) => event.actor === "Local test"))
  assert.ok(body.events.some((event) => event.actor === "jenrm"))
  assert.ok(
    !body.events.some((event) => event.created_at === "2026-11-08T10:13:00.000Z"),
    "the diagnostic request is automation",
  )
})

test("a kind filter returns only that kind and paging moves older", async () => {
  const h = harness()
  seed(h.db)
  const votes = await read(h.app, h.env, "?limit=100&kinds=vote&hide_admins=1&hide_system=1")
  assert.deepEqual(
    votes.body.events.map((event) => event.kind),
    ["vote"],
  )
  assert.equal(votes.body.events.length, 1)

  const first = await read(h.app, h.env, "?limit=2")
  assert.equal(first.body.events.length, 2)
  assert.equal(first.body.has_more, true)
  const second = await read(
    h.app,
    h.env,
    `?limit=2&before=${encodeURIComponent(first.body.next_before)}`,
  )
  // A boundary second can repeat an event because the cursor keeps the whole
  // second; the page dedupes by id, so at least one event must be new and the
  // combined list must move into older time.
  assert.ok(second.body.events.length > 0)
  const ids = new Set(first.body.events.map((event) => event.id))
  assert.ok(second.body.events.some((event) => !ids.has(event.id)))
  assert.ok(
    second.body.events.every(
      (event) => Date.parse(event.created_at) <= Date.parse(first.body.next_before),
    ),
  )
})

test("a non-admin request is refused and never reaches the feed", async () => {
  const h = harness({ admin: false })
  seed(h.db)
  const { status, body } = await read(h.app, h.env, "?limit=50")
  assert.equal(status, 403)
  assert.deepEqual(body, { error: "Unauthorized" })
})

test("the activity route names a critical price", () => {
  assert.equal(BATCH_ROUTE_PRICES.admin_activity.criticality, "critical")
  assert.ok(BATCH_ROUTE_PRICES.admin_activity.reason)
})
