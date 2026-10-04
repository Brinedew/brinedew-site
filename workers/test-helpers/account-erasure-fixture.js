// B-987: real databases for the account erasure integration test, and a person who has used
// everything. The databases are SQLite with every production migration applied (triggers,
// foreign keys and CHECK constraints included); the adapter gives them D1's async surface, its
// 100-bound-parameter limit and a call counter. Durable Objects are the real GameSession class on
// in-memory storage; KV is a Map.
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { TestD1 } from "../iconoplasm/caretaker/manifestation-authority-test-support.js"
import { GameSession } from "../the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { setGeneVote } from "../iconoplasm/votes/gene-votes.js"
import { readLeaderboard } from "../lib/leaderboard-streaks.js"
import { resolveBrinedewAccountIdentity } from "../lib/brinedew-account-identity.js"
import {
  BOT_TOKEN,
  CHANNEL_ID,
  FakeNetwork,
  STORAGE_PASSWORD,
  STORAGE_ZONE,
} from "./fake-discord-and-bunny.js"

const MIGRATION_ROOT = new URL("../../", import.meta.url)

export const ERASED_USER = "100000000000000001"
export const OTHER_USER = "200000000000000002"
export const ERASED_NAME = "AliceTestName"
export const OTHER_NAME = "BobTestName"
export const ADMIN_TOKEN = "secret-admin-token"

const sha = (character) => character.repeat(64)
export const ASSET = { alice: sha("a"), bob: sha("b"), alice2: sha("c"), workstation: sha("d") }
// Result images of unpublished jobs (B-993): the erased person's, and the other person's.
export const IMAGE = { candidate: sha("1"), edit: sha("2"), oddKey: sha("3"), bob: sha("4") }

/** The three renditions the portrait storage keeps for one image hash. */
export function renditionKeys(hash) {
  return ["full", "medium", "thumb"].map(
    (rendition) => `portraits/v1/${hash.slice(0, 2)}/${hash}/${rendition}.webp`,
  )
}

// --- D1 surface -------------------------------------------------------------------------------

const READS = /^\s*(select|with|pragma)\b/i

class Statement {
  constructor(adapter, sql, args = []) {
    this.adapter = adapter
    this.sql = sql
    this.args = args
  }

  bind(...args) {
    if (args.length > 100) throw new Error("D1: too many bound parameters (limit 100)")
    return new Statement(this.adapter, this.sql, args)
  }

  async first() {
    this.adapter.calls += 1
    return this.adapter.database.prepare(this.sql).get(...this.args) || null
  }

  async all() {
    this.adapter.calls += 1
    return { results: this.adapter.database.prepare(this.sql).all(...this.args), meta: {} }
  }

  async run() {
    this.adapter.calls += 1
    return this.execute()
  }

  execute() {
    if (READS.test(this.sql)) {
      const results = this.adapter.database.prepare(this.sql).all(...this.args)
      return { success: true, results, meta: { changes: 0 } }
    }
    const result = this.adapter.database.prepare(this.sql).run(...this.args)
    const changes = Number(result.changes || 0)
    this.adapter.changes += changes
    return { success: true, results: [], meta: { changes } }
  }
}

export class SqliteD1 {
  constructor(database) {
    this.database = database
    this.calls = 0
    this.changes = 0
  }

  prepare(sql) {
    return new Statement(this, sql)
  }

  // One call, one transaction, results in order: what a D1 batch is.
  async batch(statements) {
    this.calls += 1
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const results = statements.map((statement) => statement.execute())
      this.database.exec("COMMIT")
      return results
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }
}

function sortedMigrations(directory) {
  return readdirSync(new URL(directory, MIGRATION_ROOT))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))
}

function applyMigrations(database, directory, names = sortedMigrations(directory)) {
  for (const name of names) {
    database.exec(readFileSync(new URL(`${directory}${name}`, MIGRATION_ROOT), "utf8"))
  }
}

// The accounts database: the GeneGuessr and account migrations the erasure touches. The
// leaderboard table and its triggers are created by code on first use, as in production.
export async function accountsDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  applyMigrations(database, "migrations/", [
    "001_init.sql",
    "0016_add_leaderboard_opt_in.sql",
    "0019_add_iconoplasm_user_emulsion.sql",
    "0020_iconoplasm_user_emulsion_picker_index.sql",
    "0021_iconoplasm_user_emulsion_history.sql",
    "0022_drop_dead_games_table.sql",
    "0026_iconoplasm_user_emulsion_public_slots.sql",
    "0027_brinedew_account_identity.sql",
    "0028_brinedew_account_lifecycle.sql",
  ])
  const adapter = new SqliteD1(database)
  await readLeaderboard(adapter, 1)
  return adapter
}

export function iconoplasmDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  applyMigrations(database, "migrations-iconoplasm/")
  return new SqliteD1(database)
}

// The cold audit copy of publish events: created by code (iconoplasm-publish-event-archive.js)
// on the first archive run.
export function auditDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec(`CREATE TABLE icono_publish_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, gene_symbol TEXT NOT NULL, from_asset_sha256 TEXT,
    to_asset_sha256 TEXT, action TEXT NOT NULL, actor TEXT, reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
  return new SqliteD1(database)
}

export class MemoryKv {
  constructor() {
    this.map = new Map()
    this.operations = { deletes: 0, lists: 0 }
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }

  async put(key, value) {
    this.map.set(key, String(value))
  }

  async delete(key) {
    this.operations.deletes += 1
    this.map.delete(key)
  }

  async list({ prefix = "", limit = 1000 } = {}) {
    this.operations.lists += 1
    const names = [...this.map.keys()].filter((name) => name.startsWith(prefix)).sort()
    return {
      keys: names.slice(0, limit).map((name) => ({ name })),
      list_complete: names.length <= limit,
    }
  }
}

class MemoryStorage {
  constructor() {
    this.map = new Map()
  }

  async get(key) {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined
  }

  async put(key, value) {
    this.map.set(key, structuredClone(value))
  }

  async delete(key) {
    return this.map.delete(key)
  }

  async deleteAll() {
    this.map.clear()
  }

  async transaction(callback) {
    return callback(this)
  }

  async setAlarm() {}
}

// The real GameSession class (game state, completed-result ledger, auth session) behind the
// Durable Object namespace surface.
export function gameSessionNamespace(env) {
  const objects = new Map()
  const stateFor = (name) => {
    if (!objects.has(name)) {
      const storage = new MemoryStorage()
      objects.set(name, {
        storage,
        instance: new GameSession({ storage, blockConcurrencyWhile: (work) => work() }, env),
      })
    }
    return objects.get(name)
  }
  return {
    objects,
    idFromName: (name) => name,
    get: (name) => ({
      fetch: (url, init) => stateFor(name).instance.fetch(new Request(url, init)),
    }),
  }
}

export async function storeGameState(namespace, name, state) {
  await namespace.get(name).fetch("https://sessions/game/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  })
}

async function storeSession(namespace, name, data) {
  await namespace.get(name).fetch("http://internal/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

// --- The world ---------------------------------------------------------------------------------

function run(db, sql, ...args) {
  return db.database.prepare(sql).run(...args)
}

function insert(db, table, row) {
  const columns = Object.keys(row)
  run(
    db,
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ...columns.map((column) => row[column]),
  )
}

async function createUser(accounts, { discordId, username, email, optIn, emulsionIds }) {
  const identity = await resolveBrinedewAccountIdentity(accounts, {
    provider: "discord",
    providerSubject: discordId,
    now: 1_000,
  })
  insert(accounts, "users", {
    discord_id: discordId,
    username,
    email,
    avatar_url: `https://cdn.discordapp.com/avatars/${discordId}/abcdef.png`,
    tier: "registered",
    leaderboard_opt_in: optIn,
    created_at: 1_000,
    updated_at: 1_000,
    account_id: identity.account_id,
    iconoplasm_emulsion_text: "a glowing blot",
    iconoplasm_emulsion_revision: emulsionIds.length,
    iconoplasm_emulsion_public_id: emulsionIds.at(-1),
  })
  insert(accounts, "stats", {
    user_id: discordId,
    total_played: 9,
    total_wins: 7,
    current_streak: 4,
    best_streak: 6,
    last_played_date: new Date().toISOString().slice(0, 10),
  })
  emulsionIds.forEach((publicId, index) => {
    insert(accounts, "iconoplasm_user_emulsion_versions", {
      user_id: discordId,
      username,
      public_id: publicId,
      revision: index + 1,
      emulsion_text: `emulsion ${index + 1}`,
      created_at: 2_000 + index,
    })
    insert(accounts, "iconoplasm_user_emulsion_public_slots", {
      user_id: discordId,
      revision: index + 1,
      public_id: publicId,
      created_at: 2_000 + index,
    })
  })
  return identity.account_id
}

function seedAsset(iconoplasm, gene, sha256, createdBy, emulsionId = "0-255") {
  insert(iconoplasm, "icono_portrait_assets", {
    gene_symbol: gene,
    asset_sha256: sha256,
    r2_key_full: `portraits/${gene}/${sha256}.webp`,
    r2_key_thumb: `portraits/${gene}/${sha256}-thumb.webp`,
    status: "approved",
    created_by: createdBy,
    emulsion_id: emulsionId,
  })
}

function seedRequest(iconoplasm, row) {
  insert(iconoplasm, "icono_generation_requests", row)
  return Number(iconoplasm.database.prepare("SELECT last_insert_rowid() AS id").get().id)
}

function seedNotification(iconoplasm, { key, requestId, user, gene, asset, status, publication }) {
  insert(iconoplasm, "icono_request_notifications", {
    notification_key: key,
    request_id: requestId,
    requester_user_id: user,
    gene_symbol: gene,
    fulfilled_asset_sha256: asset,
    fulfillment_publication_id: publication,
    discord_status: status,
    discord_channel_id: `dm-channel-${user}`,
    discord_message_id: `dm-message-${key}`,
  })
}

function seedDiscovery(iconoplasm, user, genes) {
  insert(iconoplasm, "icono_discovery_user_state_v2", {
    user_id: user,
    dictionary_version: 1,
    state_version: 3,
    membership_b64: "AQID",
    member_count: genes.length,
    next_event_seq: 4,
    next_chunk_seq: 3,
    active_events_json: "[]",
    recent_receipts_json: "[]",
    last_batch_id: "batch-3",
  })
  for (const chunk of [1, 2]) {
    insert(iconoplasm, "icono_discovery_chronology_v2", {
      user_id: user,
      chunk_seq: chunk,
      first_event_seq: chunk * 10,
      last_event_seq: chunk * 10 + 5,
      events_json: "[]",
    })
  }
  insert(iconoplasm, "icono_discovery_shared_delivery_outbox_v2", {
    delivery_id: `${user}:batch-3`,
    user_id: user,
    batch_id: "batch-3",
    user_state_version: 3,
    dictionary_version: 1,
    payload_json: "{}",
  })
  for (const batch of ["batch-1", "batch-2"]) {
    insert(iconoplasm, "icono_discovery_shared_delivery_receipts_v2", {
      delivery_id: `${user}:${batch}`,
      user_id: user,
      batch_id: batch,
      user_state_version: 1,
      dictionary_version: 1,
      payload_sha256: sha("e"),
    })
  }
  for (const gene of genes) {
    insert(iconoplasm, "icono_gene_discoveries", { user_id: user, gene_symbol: gene })
  }
}

/**
 * Two people, each with a full footprint. The erased person is the heavier one; the other person
 * is the control that must come through untouched.
 */
export async function seedWorld() {
  const accounts = await accountsDatabase()
  const iconoplasm = iconoplasmDatabase()
  const audit = auditDatabase()
  const kv = new MemoryKv()
  // The caretaker authority's own database; the erasure only tells it the account is pending.
  const authoring = new TestD1()
  const env = {
    DB: accounts,
    ICONOPLASM_DB: iconoplasm,
    ICONOPLASM_AUDIT_DB: audit,
    ICONOPLASM_AUTHORING_DB: authoring,
    KV: kv,
    // The Discord bot and the Bunny storage the erasure reaches through the fake network below.
    DISCORD_BOT_TOKEN: BOT_TOKEN,
    DISCORD_ICONOPLASM_CHANNEL_ID: CHANNEL_ID,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: STORAGE_ZONE,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: STORAGE_PASSWORD,
  }
  const network = new FakeNetwork()
  const sessions = gameSessionNamespace(env)
  env.GAME_SESSIONS = sessions

  const erasedAccount = await createUser(accounts, {
    discordId: ERASED_USER,
    username: ERASED_NAME,
    email: "alice@example.test",
    optIn: 1,
    emulsionIds: ["ALICETESTNAME-1", "ALICETESTNAME-2"],
  })
  const otherAccount = await createUser(accounts, {
    discordId: OTHER_USER,
    username: OTHER_NAME,
    email: null,
    optIn: 1,
    emulsionIds: ["BOBTESTNAME-1"],
  })

  // Published portraits: two by the erased person, one by the other person, one by the workstation.
  seedAsset(iconoplasm, "TP53", ASSET.alice, ERASED_USER, "ALICETESTNAME-1")
  seedAsset(iconoplasm, "TP53", ASSET.bob, OTHER_USER)
  seedAsset(iconoplasm, "SOX11", ASSET.alice2, ERASED_USER)
  seedAsset(iconoplasm, "SOX11", ASSET.workstation, "workstation")

  // Votes through the real vote path: summaries, events and gene versions are real.
  for (const [user, gene, asset, value] of [
    [ERASED_USER, "TP53", ASSET.alice, 1],
    [ERASED_USER, "TP53", ASSET.bob, -1],
    [ERASED_USER, "SOX11", ASSET.alice2, 1],
    [OTHER_USER, "TP53", ASSET.alice, 1],
    [OTHER_USER, "TP53", ASSET.bob, 1],
    [OTHER_USER, "SOX11", ASSET.workstation, 1],
  ]) {
    const vote = await setGeneVote(iconoplasm, {
      symbol: gene,
      assetSha256: asset,
      userId: user,
      voteValue: value,
      admit: false,
    })
    if (!vote.ok) throw new Error(`seed vote failed: ${vote.code}`)
  }

  // Comments: two visible and one the author removed, and the other person's.
  // Each comment has the time it was written, so the Discord channel (seedDiscordMirror) can hold
  // the posts the way the poster left them: a few seconds after the row. Alice's second TP53
  // comment is written seconds after the first, and she removed it: the erasure has to tell her two
  // posts apart.
  const commentColumns = (user, name, body, status, gene, createdAt) => ({
    gene_symbol: gene,
    user_id: user,
    username: name,
    body,
    status,
    avatar_url: `https://cdn.discordapp.com/avatars/${user}/abcdef.png`,
    created_at: createdAt,
    updated_at: "",
  })
  for (const comment of [
    [ERASED_USER, ERASED_NAME, "Alice on TP53", "visible", "TP53", "2026-09-01T10:00:00.000Z"],
    [ERASED_USER, ERASED_NAME, "Alice on SOX11", "visible", "SOX11", "2026-09-01T11:00:00.000Z"],
    [ERASED_USER, ERASED_NAME, "Alice removed this", "deleted", "TP53", "2026-09-01T10:00:20.000Z"],
    [OTHER_USER, OTHER_NAME, "Bob on TP53", "visible", "TP53", "2026-09-01T10:00:10.000Z"],
    // Her post says "first draft"; she edited the comment afterwards.
    [
      ERASED_USER,
      ERASED_NAME,
      "Alice on EZH2, edited",
      "visible",
      "EZH2",
      "2026-09-01T12:00:00.000Z",
    ],
    // From before the mirror existed: there is no post of it in the channel.
    [
      ERASED_USER,
      ERASED_NAME,
      "Alice before the mirror",
      "visible",
      "TP53",
      "2026-05-01T09:00:00.000Z",
    ],
  ]) {
    insert(iconoplasm, "icono_gene_comments", commentColumns(...comment))
  }
  for (const gene of ["TP53", "SOX11"]) {
    kv.map.set(
      `iconoplasm:gene-comments:${gene}`,
      JSON.stringify([{ user_id: ERASED_USER, username: ERASED_NAME, body: "cached" }]),
    )
  }

  // Requests: one with no output, one cancelled, one fulfilled, one delivering, one quarantined.
  const open = seedRequest(iconoplasm, {
    gene_symbol: "TP53",
    requester_user_id: ERASED_USER,
    requester_username: ERASED_NAME,
    status: "open",
    client_request_id: "client-open",
  })
  seedRequest(iconoplasm, {
    gene_symbol: "SOX11",
    requester_user_id: ERASED_USER,
    requester_username: ERASED_NAME,
    status: "cancelled",
    client_request_id: "client-cancelled",
  })
  const fulfilled = seedRequest(iconoplasm, {
    gene_symbol: "TP53",
    requester_user_id: ERASED_USER,
    requester_username: ERASED_NAME,
    status: "fulfilled",
    fulfilled_asset_sha256: ASSET.alice,
    client_request_id: "client-fulfilled",
  })
  const delivering = seedRequest(iconoplasm, {
    gene_symbol: "SOX11",
    requester_user_id: ERASED_USER,
    requester_username: ERASED_NAME,
    status: "delivery_pending",
    fulfilled_asset_sha256: ASSET.alice2,
    client_request_id: "client-delivering",
    fulfillment_publication_id: "publication-1",
  })
  const quarantined = seedRequest(iconoplasm, {
    gene_symbol: "TP53",
    requester_user_id: ERASED_USER,
    requester_username: ERASED_NAME,
    status: "open",
    client_request_id: "client-quarantined",
  })
  insert(iconoplasm, "icono_generation_request_quarantine", {
    request_row_id: quarantined,
    generation_request_id: "quarantined-request-0001",
    failure_code: "bad_source",
    failure_message: "The source manifestation is gone",
    quarantined_at: "2026-10-01T00:00:00.000Z",
  })
  const otherFulfilled = seedRequest(iconoplasm, {
    gene_symbol: "TP53",
    requester_user_id: OTHER_USER,
    requester_username: OTHER_NAME,
    status: "fulfilled",
    fulfilled_asset_sha256: ASSET.bob,
    client_request_id: "client-open",
  })
  seedRequest(iconoplasm, {
    gene_symbol: "SOX11",
    requester_user_id: OTHER_USER,
    requester_username: OTHER_NAME,
    status: "open",
    client_request_id: "client-bob-open",
  })
  seedNotification(iconoplasm, {
    key: "n-alice-1",
    requestId: fulfilled,
    user: ERASED_USER,
    gene: "TP53",
    asset: ASSET.alice,
    status: "sent",
    publication: "",
  })
  seedNotification(iconoplasm, {
    key: "n-alice-2",
    requestId: delivering,
    user: ERASED_USER,
    gene: "SOX11",
    asset: ASSET.alice2,
    status: "pending",
    publication: "publication-1",
  })
  seedNotification(iconoplasm, {
    key: "n-bob-1",
    requestId: otherFulfilled,
    user: OTHER_USER,
    gene: "TP53",
    asset: ASSET.bob,
    status: "sent",
    publication: "",
  })

  // Jobs: one published and one unpublished of each kind; provider keys; favourites.
  for (const [id, user, publishedAt] of [
    ["cand-alice-published", ERASED_USER, "2026-10-01T00:00:00Z"],
    ["cand-alice-queued", ERASED_USER, null],
    ["cand-bob-queued", OTHER_USER, null],
  ]) {
    insert(iconoplasm, "icono_candidate_generation_jobs", {
      id,
      user_id: user,
      provider_id: "openai",
      gene_symbol: "TP53",
      status: publishedAt ? "succeeded" : "queued",
      result_asset_sha256: publishedAt ? ASSET.alice : "",
      published_at: publishedAt,
    })
  }
  for (const [id, user, publishedAt] of [
    ["edit-alice-published", ERASED_USER, "2026-10-01T00:00:00Z"],
    ["edit-alice-failed", ERASED_USER, null],
    ["edit-bob-queued", OTHER_USER, null],
  ]) {
    insert(iconoplasm, "icono_image_edit_jobs", {
      id,
      user_id: user,
      provider_id: "openai",
      source_gene_symbol: "TP53",
      source_asset_sha256: ASSET.bob,
      status: publishedAt ? "succeeded" : "failed",
      result_asset_sha256: publishedAt ? ASSET.alice2 : "",
      published_at: publishedAt,
    })
  }
  // Jobs that wrote an image nobody published (B-993). The result images of a job are three
  // objects under the hash's canonical keys; every job below has them in the storage.
  const imageKeys = (hash) => ({
    result_asset_sha256: hash,
    result_r2_key_full: renditionKeys(hash)[0],
    result_r2_key_medium: renditionKeys(hash)[1],
    result_r2_key_thumb: renditionKeys(hash)[2],
  })
  insert(iconoplasm, "icono_candidate_generation_jobs", {
    id: "cand-alice-image",
    user_id: ERASED_USER,
    provider_id: "openai",
    gene_symbol: "TP53",
    status: "succeeded",
    ...imageKeys(IMAGE.candidate),
  })
  insert(iconoplasm, "icono_image_edit_jobs", {
    id: "edit-alice-image",
    user_id: ERASED_USER,
    provider_id: "openai",
    source_gene_symbol: "TP53",
    source_asset_sha256: ASSET.bob,
    status: "succeeded",
    ...imageKeys(IMAGE.edit),
  })
  // The same bytes were published for SOX11 (the hash of alice2): the objects are the published
  // portrait's and must survive the job.
  insert(iconoplasm, "icono_image_edit_jobs", {
    id: "edit-alice-same-bytes-as-published",
    user_id: ERASED_USER,
    provider_id: "openai",
    source_gene_symbol: "SOX11",
    source_asset_sha256: ASSET.workstation,
    status: "succeeded",
    ...imageKeys(ASSET.alice2),
  })
  // A row that names a path that is not its own hash's canonical key (here a gene's published
  // object) must never make the erasure delete that path.
  insert(iconoplasm, "icono_candidate_generation_jobs", {
    id: "cand-alice-foreign-key",
    user_id: ERASED_USER,
    provider_id: "openai",
    gene_symbol: "TP53",
    status: "succeeded",
    ...imageKeys(IMAGE.oddKey),
    result_r2_key_full: "genes/v3/TP53.json",
  })
  insert(iconoplasm, "icono_candidate_generation_jobs", {
    id: "cand-bob-image",
    user_id: OTHER_USER,
    provider_id: "openai",
    gene_symbol: "TP53",
    status: "succeeded",
    ...imageKeys(IMAGE.bob),
  })
  for (const key of [
    ...renditionKeys(IMAGE.candidate),
    ...renditionKeys(IMAGE.edit),
    ...renditionKeys(IMAGE.oddKey),
    ...renditionKeys(IMAGE.bob),
    // The published portraits' objects, and a gene's published object.
    ...renditionKeys(ASSET.alice),
    ...renditionKeys(ASSET.alice2),
    ...renditionKeys(ASSET.bob),
    "genes/v3/TP53.json",
  ]) {
    network.storeObject(key)
  }
  for (const [user, provider] of [
    [ERASED_USER, "openai"],
    [ERASED_USER, "krea"],
    [OTHER_USER, "openai"],
  ]) {
    insert(iconoplasm, "icono_user_image_provider_keys", {
      user_id: user,
      provider_id: provider,
      encrypted_api_key: `ciphertext-${user}-${provider}`,
      encryption_iv: "iv",
    })
  }
  for (const [user, family] of [
    [ERASED_USER, "0-255"],
    [ERASED_USER, "0-343"],
    [OTHER_USER, "0-255"],
    [OTHER_USER, "ALICETESTNAME-1"],
  ]) {
    insert(iconoplasm, "icono_user_emulsion_favorites", {
      user_id: user,
      emulsion_family_id: family,
    })
  }
  for (const emulsion of ["ALICETESTNAME-1", "BOBTESTNAME-1"]) {
    insert(iconoplasm, "icono_user_emulsion_option_rollup", {
      emulsion_id: emulsion,
      image_count: 1,
      live_count: 1,
    })
  }

  // Discoveries, compact and legacy, with the migration cursor parked on the erased person.
  seedDiscovery(iconoplasm, ERASED_USER, ["TP53", "SOX11", "EZH2"])
  seedDiscovery(iconoplasm, OTHER_USER, ["TP53"])
  run(
    iconoplasm,
    "UPDATE icono_discovery_compact_activation_v2 SET status = 'complete', cursor_user_id = ?",
    ERASED_USER,
  )

  // Caretaker delivery outbox: Alice as the recipient, Alice as the author of a comment Bob's
  // caretaker was told about, and a supervote notice.
  const caretakerRow = (key, caretaker, discordId, author, authorName) => ({
    notification_key: key,
    caretaker_assignment_id: "assignment-1",
    caretaker_account_id: caretaker,
    caretaker_discord_user_id: discordId,
    gene_symbol: "TP53",
    comment_author_account_id: author,
    comment_author_name: authorName,
    comment_body: "Hello caretaker",
    discord_channel_id: `dm-channel-${discordId}`,
  })
  insert(
    iconoplasm,
    "icono_caretaker_comment_notifications",
    caretakerRow("cc-1", erasedAccount, ERASED_USER, otherAccount, OTHER_NAME),
  )
  insert(
    iconoplasm,
    "icono_caretaker_comment_notifications",
    caretakerRow("cc-2", otherAccount, OTHER_USER, erasedAccount, ERASED_NAME),
  )
  insert(iconoplasm, "icono_caretaker_supervote_notifications", {
    notification_key: "sv-1",
    caretaker_assignment_id: "assignment-1",
    caretaker_account_id: erasedAccount,
    gene_symbol: "TP53",
    preferred_asset_sha256: ASSET.alice,
    canonical_asset_sha256: ASSET.bob,
    supervote_version: 1,
    discord_channel_id: `dm-channel-${ERASED_USER}`,
  })

  // Publish events, hot and cold.
  for (const actor of [ERASED_USER, ERASED_USER, OTHER_USER, "vote_authority"]) {
    insert(iconoplasm, "icono_publish_events", { gene_symbol: "TP53", action: "publish", actor })
  }
  for (const actor of [ERASED_USER, OTHER_USER]) {
    insert(audit, "icono_publish_events", { gene_symbol: "TP53", action: "publish", actor })
  }

  // KV keys that embed a Discord id, and an unrelated one.
  return {
    env,
    accounts,
    iconoplasm,
    audit,
    authoring,
    kv,
    sessions,
    network,
    erasedAccount,
    otherAccount,
  }
}

/**
 * The public #iconoplasm channel as the real poster leaves it: every comment row has its post, a
 * few seconds after the row, between other people's messages. `postComment` is the production
 * poster (postIconoplasmGeneCommentToDiscord). The "before the mirror" comment has no post; the
 * post of the edited comment carries the text it had when it was posted.
 */
export async function seedDiscordMirror(world, postComment) {
  const { network } = world
  const comments = world.iconoplasm.database
    .prepare("SELECT gene_symbol, username, body, created_at FROM icono_gene_comments")
    .all()
    .filter((comment) => comment.body !== "Alice before the mirror")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const comment of comments) {
    const at = Date.parse(comment.created_at) + 4_000
    // Somebody else talks in the channel, and the bot posts something that is not a comment.
    network.addMessage({ content: `morning, ${comment.gene_symbol}?`, at: at - 3_000, bot: false })
    network.addMessage({ content: "GeneGuessr recap: nobody solved it", at: at - 2_000 })
    network.clock = at
    await postComment(world.env, {
      symbol: comment.gene_symbol,
      username: comment.username,
      body: comment.body === "Alice on EZH2, edited" ? "Alice on EZH2, first draft" : comment.body,
    })
  }
  // A person copying a post by hand is not the bot's post and is never touched.
  const copied = network.messages.find((message) => message.content.includes("**Alice"))
  network.addMessage({ content: copied.content, at: network.clock + 60_000, bot: false })
}

/** Game state and sessions need the KV key builder of the runtime, so the test seeds them. */
export async function seedSessionsAndKv(world, userKvKeyScopes) {
  const { sessions, kv, erasedAccount, otherAccount } = world
  const game = (user) => ({
    date: "2026-10-03",
    guesses: [{ uniprot: "P04637", by: user }],
    won: false,
    maxGuesses: 10,
  })
  await storeGameState(sessions, `user_${ERASED_USER}`, game(ERASED_USER))
  await storeGameState(sessions, `practice_user_${ERASED_USER}`, {
    ...game(ERASED_USER),
    practiceMode: true,
  })
  await storeGameState(sessions, `user_${OTHER_USER}`, game(OTHER_USER))
  await storeSession(sessions, "session:alice-session", {
    user_id: ERASED_USER,
    account_id: erasedAccount,
    username: ERASED_NAME,
    access_token: "alice-token",
  })
  await storeSession(sessions, "session:bob-session", {
    user_id: OTHER_USER,
    account_id: otherAccount,
    username: OTHER_NAME,
    access_token: "bob-token",
  })
  for (const user of [ERASED_USER, OTHER_USER]) {
    const scopes = userKvKeyScopes(user)
    for (const key of scopes.exact) kv.map.set(key, "openai:gpt-image-1")
    for (const sourceSha of ["s1", "s2", "s3"])
      kv.map.set(`${scopes.prefixes[0]}fingerprint:${sourceSha}`, "{}")
  }
  kv.map.set("iconoplasm:catalog:v1:abc", "{}")
}

// --- Looking for a person ------------------------------------------------------------------------

const sqliteOf = (db) => db.database || db.raw

function tablesOf(db) {
  return sqliteOf(db)
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
}

/** Every table row of a database as a JSON string, by table. */
export function dumpDatabase(db) {
  const dump = {}
  for (const table of tablesOf(db)) {
    dump[table] = sqliteOf(db)
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .map((row) => JSON.stringify(row))
      .sort()
  }
  return dump
}

/** Where any of the needles still appears: tables, KV keys and values, Durable Object storage. */
export function findTraces(world, needles) {
  const hits = []
  const has = (text) => needles.some((needle) => String(text).includes(needle))
  for (const [label, db] of [
    ["accounts", world.accounts],
    ["iconoplasm", world.iconoplasm],
    ["audit", world.audit],
    ["authoring", world.authoring],
  ]) {
    for (const [table, rows] of Object.entries(dumpDatabase(db))) {
      if (rows.some(has)) hits.push(`${label}.${table}`)
    }
  }
  for (const [key, value] of world.kv.map) if (has(key) || has(value)) hits.push(`kv:${key}`)
  for (const [name, object] of world.sessions.objects) {
    for (const [key, value] of object.storage.map) {
      if (has(name) || has(JSON.stringify(value))) hits.push(`do:${name}:${key}`)
    }
  }
  return hits.sort()
}
