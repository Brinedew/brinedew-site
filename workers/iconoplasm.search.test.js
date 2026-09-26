import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./iconoplasm/discovery-compact-store.js"
import { viaStatefulWorker } from "./test-helpers/via-stateful-worker.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
  buildPortraitAwareManifestHash,
  mergePublishedPortraitRefsIntoArtifact,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmPublicationAliasManifestFromPolicy } from "./iconoplasm-publication-aliases.js"
import { iconoplasmPublicationAliasKvKey } from "./iconoplasm-publication-alias-policy.js"
import { iconoplasmRecognitionPairKvKey } from "./iconoplasm-recognition-policy-reconciliation.js"

class FakeKV {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
  }

  async get(key) {
    return this.entries.has(key) ? this.entries.get(key) : null
  }

  async put(key, value) {
    this.entries.set(key, value)
  }

  async list({ prefix = "", limit = 1_000 } = {}) {
    const names = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort()
    return {
      keys: names.slice(0, limit).map((name) => ({ name })),
      list_complete: names.length <= limit,
    }
  }
}

class FakeSearchStatement {
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
    if (
      this.sql.includes("COUNT(*) AS published_count") &&
      this.sql.includes("GROUP_CONCAT(symbol_asset, '|')")
    ) {
      return this.db.getPublishedPortraitFingerprint()
    }
    if (this.sql.includes("FROM icono_gene_discoveries") && this.sql.includes("LIMIT 1")) {
      const [userId, geneSymbol] = this.args
      return this.db.getDiscovery(userId, geneSymbol)
    }
    if (
      this.sql.includes("MIN(first_discovered_at) AS first_non_admin_discovered_at") &&
      this.sql.includes("FROM icono_gene_discoveries")
    ) {
      const [geneSymbol, adminUserId = ""] = this.args
      return this.db.getSharedDiscoveryRollup(geneSymbol, adminUserId)
    }
    throw new Error(`Unexpected SQL in fake search DB first(): ${this.sql}`)
  }

  async all() {
    if (
      this.sql.includes("SELECT gene_symbol AS symbol") &&
      this.sql.includes("current_asset_sha256 AS asset_sha256") &&
      this.sql.includes("ORDER BY gene_symbol ASC")
    ) {
      return {
        results: this.db.listPublishedPortraitRefs().map((row) => ({
          symbol: row.symbol,
          asset_sha256: row.asset_sha256,
        })),
      }
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      return { results: this.db.listPublishedPortraitRefs() }
    }
    if (
      this.sql.includes("SELECT d.gene_symbol") &&
      this.sql.includes("FROM icono_gene_discoveries d")
    ) {
      const [userId] = this.args
      return {
        results: this.db.listDiscoverySymbols(userId),
      }
    }
    if (
      this.sql.includes("SELECT gene_symbol") &&
      this.sql.includes("FROM icono_shared_gene_discoveries")
    ) {
      return {
        results: this.db.listSharedDiscoverySymbols(),
      }
    }
    if (
      this.sql.includes("FROM icono_gene_discoveries") &&
      !this.sql.includes("FROM icono_gene_discoveries d")
    ) {
      const [userId] = this.args
      return {
        results: [...this.db.rows.values()].filter((row) => row.user_id === String(userId)),
      }
    }
    throw new Error(`Unexpected SQL in fake search DB all(): ${this.sql}`)
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_gene_discoveries")) {
      this.db.insertDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    if (this.sql.includes("UPDATE icono_gene_discoveries")) {
      this.db.updateDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    if (this.sql.includes("INSERT INTO icono_shared_gene_discoveries")) {
      this.db.upsertSharedDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    if (this.sql.includes("DELETE FROM icono_shared_gene_discoveries")) {
      this.db.deleteSharedDiscovery(this.args[0])
      return { success: true, meta: { changes: 1 } }
    }
    throw new Error(`Unexpected SQL in fake search DB run(): ${this.sql}`)
  }
}

class FakeSearchCompactStatement {
  constructor(db, sql, args = []) {
    this.db = db
    this.sql = String(sql || "")
    this.args = args
  }
  bind(...args) {
    return new FakeSearchCompactStatement(this.db, this.sql, args)
  }
  async first() {
    return this.db.compactRaw.prepare(this.sql).get(...this.args) ?? null
  }
  async all() {
    return { results: this.db.compactRaw.prepare(this.sql).all(...this.args) }
  }
  async run() {
    const info = this.db.compactRaw.prepare(this.sql).run(...this.args)
    return { success: true, meta: { changes: Number(info.changes || 0) } }
  }
}

const SEARCH_STARTER_SYMBOLS = ["INS", "RHO", "PRL"]

class FakeSearchDb {
  constructor({ publishedPortraits = [] } = {}) {
    this.rows = new Map()
    this.sharedRows = new Map()
    this.tick = 0
    this.publishedPortraits = new Map()
    this.compactRaw = new DatabaseSync(":memory:")
    this.compactRaw.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
    this.compactRaw
      .prepare(
        "UPDATE icono_discovery_compact_activation_v2 SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE singleton = 1",
      )
      .run()
    this.compactDirty = true
    this.setPublishedPortraits(publishedPortraits)
  }

  syncCompactIfDirty() {
    if (!this.compactDirty) return
    this.compactDirty = false
    const raw = this.compactRaw
    raw.exec(`
      DELETE FROM icono_discovery_user_state_v2;
      DELETE FROM icono_discovery_ordinals_v2;
      DELETE FROM icono_discovery_dictionary_meta_v2;
    `)
    const rows = [...this.rows.values()]
    const symbols = [
      ...new Set([
        ...rows.map((row) => String(row.gene_symbol).toUpperCase()),
        ...SEARCH_STARTER_SYMBOLS,
      ]),
    ]
      .filter(Boolean)
      .sort()
    const ordinalBySymbol = new Map(symbols.map((symbol, index) => [symbol, index]))
    const insertOrdinal = raw.prepare(
      "INSERT INTO icono_discovery_ordinals_v2 (name, ordinal, canonical, active) VALUES (?, ?, ?, 1)",
    )
    for (const symbol of symbols) insertOrdinal.run(symbol, ordinalBySymbol.get(symbol), symbol)
    raw
      .prepare(
        "INSERT INTO icono_discovery_dictionary_meta_v2 (singleton, version, updated_at) VALUES (1, 1, CURRENT_TIMESTAMP)",
      )
      .run()

    const users = new Map()
    const byteLength = Math.ceil(symbols.length / 8)
    for (const row of rows) {
      const userId = String(row.user_id)
      const symbol = String(row.gene_symbol).toUpperCase()
      const ordinal = ordinalBySymbol.get(symbol)
      if (ordinal == null) continue
      let user = users.get(userId)
      if (!user) {
        user = { membership: new Uint8Array(byteLength), count: 0, events: [], seq: 1 }
        users.set(userId, user)
      }
      const byte = ordinal >> 3
      const mask = 1 << (ordinal & 7)
      if (!(user.membership[byte] & mask)) {
        user.membership[byte] |= mask
        user.count += 1
      }
      user.events.push({
        seq: user.seq++,
        ordinal,
        symbol,
        at: Math.max(0, Math.floor(Date.parse(String(row.first_discovered_at || "")) / 1000) || 0),
        source: String(row.first_source || ""),
        trigger: String(row.first_trigger || ""),
        dwell_ms: null,
      })
    }
    const insertUser = raw.prepare(
      `INSERT INTO icono_discovery_user_state_v2 (
        user_id, dictionary_version, state_version, membership_b64, member_count,
        next_event_seq, next_chunk_seq, active_events_json, recent_receipts_json, last_batch_id
      ) VALUES (?, 1, 1, ?, ?, ?, 1, ?, '[]', 'migrated')`,
    )
    for (const [userId, user] of users) {
      insertUser.run(
        userId,
        Buffer.from(user.membership).toString("base64"),
        user.count,
        user.seq,
        JSON.stringify(user.events),
      )
    }
  }

  prepare(sql) {
    if (String(sql || "").includes("icono_discovery_")) {
      this.syncCompactIfDirty()
      return new FakeSearchCompactStatement(this, sql)
    }
    return new FakeSearchStatement(this, sql)
  }

  async batch(statements) {
    if (statements.some((statement) => String(statement.sql || "").includes("icono_discovery_"))) {
      this.syncCompactIfDirty()
      const raw = this.compactRaw
      raw.exec("BEGIN IMMEDIATE")
      try {
        const results = statements.map((statement) => {
          const prepared = raw.prepare(statement.sql)
          if (
            /^\s*(SELECT|WITH|PRAGMA)/i.test(statement.sql) ||
            /\bRETURNING\b/i.test(statement.sql)
          ) {
            return { results: prepared.all(...statement.args) }
          }
          const info = prepared.run(...statement.args)
          return { results: [], meta: { changes: Number(info.changes || 0) } }
        })
        raw.exec("COMMIT")
        return results
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
    }
    const [personal, shared] = statements
    const [user, gene, , source, , trigger, , dwell, seedOnly] = personal.args
    const existing = this.getDiscovery(user, gene)
    if (existing && seedOnly) return statements.map(() => ({ results: [], meta: { changes: 0 } }))
    if (existing) this.updateDiscovery([source, trigger, dwell, user, gene])
    else this.insertDiscovery(personal.args)
    const row = this.getDiscovery(user, gene)
    if (shared) {
      const prior = this.sharedRows.get(gene)
      this.upsertSharedDiscovery([
        gene,
        prior?.first_non_admin_discovered_at || row.first_discovered_at,
        row.last_encountered_at,
        (prior?.non_admin_discoverer_count || 0) + (existing && prior ? 0 : 1),
        (prior?.non_admin_encounter_count || 0) + 1,
      ])
    }
    return [
      { results: [row], meta: { changes: 1 } },
      ...(shared ? [{ results: [], meta: { changes: 1 } }] : []),
    ]
  }

  key(userId, geneSymbol) {
    return `${String(userId)}|${String(geneSymbol || "")
      .trim()
      .toUpperCase()}`
  }

  now() {
    this.tick += 1
    return `2026-04-05T00:00:${String(this.tick).padStart(2, "0")}Z`
  }

  getDiscovery(userId, geneSymbol) {
    const row = this.rows.get(this.key(userId, geneSymbol))
    return row ? { ...row } : null
  }

  listDiscoverySymbols(userId) {
    this.syncCompactIfDirty()
    const compact = this.compactRaw
      .prepare("SELECT active_events_json FROM icono_discovery_user_state_v2 WHERE user_id = ?")
      .get(String(userId))
    if (compact) {
      const seen = new Set()
      const rows = []
      for (const event of JSON.parse(compact.active_events_json)) {
        const symbol = String(event.symbol || "")
        if (!symbol || seen.has(symbol)) continue
        seen.add(symbol)
        rows.push({ gene_symbol: symbol })
      }
      return rows
    }
    return Array.from(this.rows.values())
      .filter((row) => row.user_id === String(userId))
      .sort((left, right) => {
        return (
          String(left.first_discovered_at || "").localeCompare(
            String(right.first_discovered_at || ""),
          ) || String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || ""))
        )
      })
      .map((row) => ({ gene_symbol: row.gene_symbol }))
  }

  getSharedDiscoveryRollup(geneSymbol, adminUserId = "") {
    const symbol = String(geneSymbol || "")
      .trim()
      .toUpperCase()
    const admin = String(adminUserId || "")
    const rows = Array.from(this.rows.values()).filter(
      (row) => row.gene_symbol === symbol && (!admin || row.user_id !== admin),
    )
    if (!rows.length) return null
    rows.sort((left, right) => {
      return String(left.first_discovered_at || "").localeCompare(
        String(right.first_discovered_at || ""),
      )
    })
    return {
      gene_symbol: symbol,
      first_non_admin_discovered_at: rows[0].first_discovered_at,
      latest_non_admin_encountered_at: rows.reduce((latest, row) => {
        return String(row.last_encountered_at || "").localeCompare(String(latest || "")) > 0
          ? row.last_encountered_at
          : latest
      }, ""),
      non_admin_discoverer_count: rows.length,
      non_admin_encounter_count: rows.reduce(
        (sum, row) => sum + (Number(row.encounter_count || 0) || 0),
        0,
      ),
    }
  }

  upsertSharedDiscovery(args) {
    const [
      geneSymbol,
      firstNonAdminDiscoveredAt,
      latestNonAdminEncounteredAt,
      nonAdminDiscovererCount,
      nonAdminEncounterCount,
    ] = args
    const symbol = String(geneSymbol || "")
      .trim()
      .toUpperCase()
    this.sharedRows.set(symbol, {
      gene_symbol: symbol,
      first_non_admin_discovered_at: firstNonAdminDiscoveredAt,
      latest_non_admin_encountered_at: latestNonAdminEncounteredAt,
      non_admin_discoverer_count: Number(nonAdminDiscovererCount || 0),
      non_admin_encounter_count: Number(nonAdminEncounterCount || 0),
    })
  }

  deleteSharedDiscovery(geneSymbol) {
    this.sharedRows.delete(
      String(geneSymbol || "")
        .trim()
        .toUpperCase(),
    )
  }

  listSharedDiscoverySymbols() {
    return Array.from(this.sharedRows.values())
      .filter((row) => Number(row.non_admin_discoverer_count || 0) > 0)
      .sort((left, right) =>
        String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || "")),
      )
      .map((row) => ({ gene_symbol: row.gene_symbol }))
  }

  insertDiscovery(args) {
    const [
      userId,
      geneSymbol,
      firstSource,
      lastSource,
      firstTrigger,
      lastTrigger,
      firstDwellMs,
      lastDwellMs,
    ] = args
    this.compactDirty = true
    const timestamp = this.now()
    this.rows.set(this.key(userId, geneSymbol), {
      user_id: String(userId),
      gene_symbol: String(geneSymbol || "")
        .trim()
        .toUpperCase(),
      first_discovered_at: timestamp,
      last_encountered_at: timestamp,
      encounter_count: 1,
      first_source: String(firstSource || ""),
      last_source: String(lastSource || ""),
      first_trigger: String(firstTrigger || ""),
      last_trigger: String(lastTrigger || ""),
      first_dwell_ms: firstDwellMs == null ? null : Number(firstDwellMs),
      last_dwell_ms: lastDwellMs == null ? null : Number(lastDwellMs),
    })
  }

  updateDiscovery(args) {
    const [lastSource, lastTrigger, lastDwellMs, userId, geneSymbol] = args
    this.compactDirty = true
    const key = this.key(userId, geneSymbol)
    const existing = this.rows.get(key)
    if (!existing) {
      throw new Error(`Cannot update missing discovery row for ${key}`)
    }
    this.rows.set(key, {
      ...existing,
      last_encountered_at: this.now(),
      encounter_count: Number(existing.encounter_count || 0) + 1,
      last_source: String(lastSource || ""),
      last_trigger: String(lastTrigger || ""),
      last_dwell_ms: lastDwellMs == null ? null : Number(lastDwellMs),
    })
  }

  seedDiscovery(userId, geneSymbol) {
    this.insertDiscovery([
      userId,
      geneSymbol,
      "extension_hover",
      "extension_hover",
      "hover_dwell",
      "hover_dwell",
      900,
      900,
    ])
  }

  setPublishedPortraits(rows = []) {
    this.publishedPortraits = new Map()
    for (const row of rows) {
      const symbol = String(row?.symbol || row?.gene_symbol || "")
        .trim()
        .toUpperCase()
      if (!symbol) continue
      this.publishedPortraits.set(symbol, {
        symbol,
        asset_sha256: row?.asset_sha256 || null,
        ph: row?.ph || null,
        pt: row?.pt || null,
        updated_at: row?.updated_at || null,
      })
    }
  }

  listPublishedPortraitRefs() {
    return Array.from(this.publishedPortraits.values()).map((row) => ({
      symbol: row.symbol,
      asset_sha256: row.asset_sha256,
      ph: row.ph,
      pt: row.pt,
    }))
  }

  getPublishedPortraitFingerprint() {
    if (this.publishedPortraits.size === 0) {
      return { published_count: 0, published_pairs: "" }
    }
    const publishedPairs = Array.from(this.publishedPortraits.values())
      .sort((left, right) => String(left.symbol || "").localeCompare(String(right.symbol || "")))
      .map((row) => `${row.symbol}:${row.asset_sha256 || ""}`)
      .join("|")
    return {
      published_count: this.publishedPortraits.size,
      published_pairs: publishedPairs,
    }
  }
}

class FakeGameSessions {
  constructor(sessions = {}) {
    this.sessions = sessions
  }

  idFromName(name) {
    return String(name || "")
  }

  get(id) {
    const session = this.sessions[String(id || "")]
    return {
      fetch: async () => {
        if (!session) {
          return new Response("missing", { status: 404 })
        }
        return Response.json(session)
      },
    }
  }
}

class FakeOnlyAllowedGateway {
  constructor(responseFactory) {
    this.responseFactory = responseFactory
    this.calls = []
  }

  async fetch(request) {
    const cloned = request.clone()
    this.calls.push({
      url: cloned.url,
      method: cloned.method,
      headers: Object.fromEntries(cloned.headers.entries()),
    })
    return this.responseFactory(cloned)
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  if (!env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE) {
    env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          gatewayEnv,
          ctx,
        )
      },
    }
  }
  return env
}

function buildCatalogArtifact() {
  const genes = [
    { s: "INS", n: "Insulin", c: "#d85c57", tmh: false, a: ["INSULIN"] },
    { s: "RHO", n: "Rhodopsin", c: "#4b5b7c", tmh: true, a: ["OPN2"] },
    {
      s: "PRL",
      n: "Prolactin",
      c: "#7a5861",
      tmh: false,
      a: [],
      pt: "https://iconoplasm.brinedew.bio/portraits/v1/stale/stale-prl/medium.webp",
      ph: "https://iconoplasm.brinedew.bio/portraits/v1/stale/stale-prl/full.webp",
    },
    { s: "TP53", n: "Tumor protein p53", c: "#5f6e52", tmh: false, a: ["P53"] },
    { s: "GUARDIAN1", n: "Cell cycle regulator", c: "#856b47", tmh: false, a: [] },
    { s: "BAX", n: "Guardian pathway effector", c: "#556b2f", tmh: false, a: [] },
    { s: "MDM2", n: "Mouse double minute 2 homolog", c: "#8a7d5c", tmh: false, a: ["GUARDIAN"] },
  ]
  return {
    schema_version: 4,
    generated_at: "2026-04-05T00:00:00Z",
    gene_count: genes.length,
    genes,
  }
}

function publishPortraitFixture(kv, rows = []) {
  const refs = (Array.isArray(rows) ? rows : []).map((row) => ({
    symbol: String(row?.symbol || row?.gene_symbol || "")
      .trim()
      .toUpperCase(),
    asset_sha256: String(row?.asset_sha256 || ""),
  }))
  const latest = refs.map((row) => row.asset_sha256.slice(0, 12)).join("") || "emptypublication"
  const fingerprint = { published_count: refs.length, latest }
  kv.entries.set(
    "iconoplasm:published-portrait-fingerprint:v3",
    JSON.stringify({
      schema: "iconoplasm.publishedPortraitFingerprint.v1",
      published_at: "2026-04-05T00:00:00.000Z",
      fingerprint,
    }),
  )
  kv.entries.set(
    `iconoplasm:published-portrait-refs:v3-${fingerprint.published_count}-${fingerprint.latest}`,
    JSON.stringify(refs),
  )
  const { current_hash: base } = JSON.parse(kv.entries.get("iconoplasm:catalog-manifest"))
  const artifact = mergePublishedPortraitRefsIntoArtifact(
    JSON.parse(kv.entries.get(`iconoplasm:catalog:${base}`)),
    refs,
  )
  kv.entries.set(
    `iconoplasm:hydrated-catalog-artifact:a${artifact.schema_version}c${artifact.contract_revision}:${buildPortraitAwareManifestHash(base, fingerprint)}`,
    JSON.stringify(artifact),
  )
}

function buildEnv({
  sessions = {},
  publishedPortraits = [],
  artifact = null,
  kvEntries = {},
  overrides = {},
} = {}) {
  const hash = "searchfixture01"
  const catalogArtifact = artifact || buildCatalogArtifact()
  const gatewayDb =
    overrides.ICONOPLASM_DB === undefined
      ? new FakeSearchDb({ publishedPortraits })
      : overrides.ICONOPLASM_DB
  const gatewayEnv = {
    KV: new FakeKV({
      "iconoplasm:catalog-manifest": JSON.stringify({
        current_hash: hash,
        filename: `catalog.${hash}.json`,
        generated_at: catalogArtifact.generated_at,
        schema_version: catalogArtifact.schema_version,
        canonical_key: "symbol",
        gene_count: catalogArtifact.gene_count,
      }),
      [`iconoplasm:catalog:${hash}`]: JSON.stringify(catalogArtifact),
      ...kvEntries,
    }),
    ICONOPLASM_DB: gatewayDb,
    GAME_SESSIONS: new FakeGameSessions(sessions),
    ...overrides,
  }
  publishPortraitFixture(gatewayEnv.KV, publishedPortraits)
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindOnlyAllowedGateway(env, gatewayEnv)
}

function buildRequest(path, { cookie = "" } = {}) {
  return new Request(`https://iconoplasm.brinedew.bio${path}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  })
}

test.beforeEach(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test.after(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test("catalog search changes portraits only after the publisher replaces its snapshot", async () => {
  const env = buildEnv({
    publishedPortraits: [
      {
        symbol: "PRL",
        asset_sha256: "a".repeat(64),
        ph: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/full.webp`,
        pt: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/medium.webp`,
        updated_at: "2026-04-05T00:00:01Z",
      },
    ],
  })

  const firstResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=prl&scope=catalog&limit=5"),
    env,
    {},
  )
  const firstPayload = await firstResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.match(firstPayload?.genes?.[0]?.pt || "", /a{64}\/medium\.webp$/)
  assert.match(firstPayload?.genes?.[0]?.ph || "", /a{64}\/full\.webp$/)

  env.gatewayDb.setPublishedPortraits([
    {
      symbol: "PRL",
      asset_sha256: "b".repeat(64),
      ph: `portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/full.webp`,
      pt: `portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/medium.webp`,
      updated_at: "2026-04-05T00:00:01Z",
    },
  ])

  publishPortraitFixture(env.KV, Array.from(env.gatewayDb.publishedPortraits.values()))

  resetIconoplasmRuntimeCachesForTest()

  const secondResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=prl&scope=catalog&limit=5"),
    env,
    {},
  )
  const secondPayload = await secondResponse.json()

  assert.equal(secondResponse.status, 200)
  assert.match(secondPayload?.genes?.[0]?.pt || "", /b{64}\/medium\.webp$/)
  assert.match(secondPayload?.genes?.[0]?.ph || "", /b{64}\/full\.webp$/)
})

// Match strength comes first (exact, then prefix, then substring), and the
// field only breaks ties within a strength (symbol, then alias, then full
// name). The old rule ranked by field first, so any partial symbol hit beat
// an exact alias: on 25 Sep "p53" listed CFAP53 and NOP53 above TP53.
test("catalog search ranks exact matches before prefixes before substrings, then by field", async () => {
  const env = buildEnv()
  const response = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=guardian&scope=catalog&limit=10"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.scope_applied, "catalog")
  assert.deepEqual(
    payload?.genes?.slice(0, 3).map((gene) => [gene.symbol, gene.matched_by]),
    [
      ["MDM2", "alias"], // alias GUARDIAN is exact
      ["GUARDIAN1", "symbol"], // symbol prefix
      ["BAX", "full_name"], // full-name prefix
    ],
  )
})

test("an exact literature alias outranks symbols that merely contain the query", async () => {
  const artifact = buildCatalogArtifact()
  artifact.genes.push(
    { s: "CFAP53", n: "Cilia and flagella associated protein 53", c: "#777777", a: [] },
    { s: "NOP53", n: "NOP53 ribosome biogenesis factor", c: "#777777", a: [] },
    { s: "TP53BP1", n: "Tumor protein p53 binding protein 1", c: "#777777", a: ["53BP1"] },
  )
  artifact.gene_count = artifact.genes.length
  const env = buildEnv({ artifact })
  const response = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=p53&scope=catalog&limit=10"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload?.genes?.slice(0, 2).map((gene) => [gene.symbol, gene.matched_by]),
    [
      ["TP53", "alias"],
      ["CFAP53", "symbol"],
    ],
  )
  // TP53 appears once, at its best match, not again for its symbol substring.
  assert.equal(payload.genes.filter((gene) => gene.symbol === "TP53").length, 1)
})

test("catalog search resolves bootstrap publication aliases", async () => {
  const artifact = buildCatalogArtifact()
  artifact.genes.push(
    {
      s: "RELA",
      n: "RELA proto-oncogene, NF-kB subunit",
      c: "#4f6457",
      tmh: false,
      a: [],
    },
    {
      s: "CCNH",
      n: "CDK-activating cyclin component",
      c: "#6b705c",
      tmh: false,
      a: [],
    },
  )
  artifact.gene_count = artifact.genes.length
  const env = buildEnv({ artifact })

  for (const [query, expectedSymbol] of [
    ["p65", "RELA"],
    ["Cyclin%20H", "CCNH"],
  ]) {
    const response = await viaStatefulWorker(
      buildRequest(`/api/public/v1/genes/search?q=${query}&scope=catalog&limit=5`),
      env,
      {},
    )
    const payload = await response.json()

    assert.equal(response.status, 200)
    assert.equal(payload?.genes?.[0]?.symbol, expectedSymbol)
    assert.equal(payload?.genes?.[0]?.matched_by, "alias")
  }
})

test("catalog search resolves an administrator-published alias KV revision", async () => {
  const artifact = buildCatalogArtifact()
  artifact.genes.push({
    s: "CXCL8",
    n: "C-X-C motif chemokine ligand 8",
    c: "#89685f",
    tmh: false,
    a: [],
  })
  artifact.gene_count = artifact.genes.length
  const aliases = await iconoplasmPublicationAliasManifestFromPolicy({
    by_symbol: { CXCL8: ["IL8"] },
    remove_by_symbol: {},
  })
  const blocklistVersion = `ebl1-${createHash("sha256")
    .update(JSON.stringify([]))
    .digest("hex")
    .slice(0, 16)}`
  const env = buildEnv({
    artifact,
    kvEntries: {
      [iconoplasmPublicationAliasKvKey(2)]: JSON.stringify(aliases),
      [iconoplasmRecognitionPairKvKey(2, 1)]: JSON.stringify({
        schema_version: 1,
        alias_revision: 2,
        blocklist_revision: 1,
        alias_depends_on_blocklist_revision: null,
        blocklist_depends_on_alias_revision: null,
        publication_aliases: aliases,
        extension_blocklist: {
          schema_version: 1,
          revision: 1,
          version: blocklistVersion,
          term_count: 0,
          terms: [],
        },
      }),
    },
  })
  const response = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=IL8&scope=catalog&limit=5"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.genes?.[0]?.symbol, "CXCL8")
  assert.equal(payload?.genes?.[0]?.matched_by, "alias")
})

test("guest discovery search falls back to the starter trio instead of the full catalog", async () => {
  const env = buildEnv()

  const starterResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=rho&scope=discoveries&limit=10"),
    env,
    {},
  )
  const starterPayload = await starterResponse.json()

  assert.equal(starterResponse.status, 200)
  assert.equal(starterPayload?.scope_applied, "starter")
  assert.deepEqual(
    starterPayload?.genes?.map((gene) => gene.symbol),
    ["RHO"],
  )
  assert.equal(starterResponse.headers.get("Cache-Control"), "no-store")

  const hiddenResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=tp53&scope=discoveries&limit=10"),
    env,
    {},
  )
  const hiddenPayload = await hiddenResponse.json()

  assert.equal(hiddenResponse.status, 200)
  assert.deepEqual(hiddenPayload?.genes, [])
})

test("signed-in discovery search uses virtual starters without mutating an empty account", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })

  const starterResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=rho&scope=discoveries&limit=10", {
      cookie: "session=abc",
    }),
    env,
    {},
  )
  const starterPayload = await starterResponse.json()

  assert.equal(starterResponse.status, 200)
  assert.equal(starterPayload?.scope_applied, "discoveries")
  assert.deepEqual(
    starterPayload?.genes?.map((gene) => gene.symbol),
    ["RHO"],
  )
  assert.deepEqual(
    env.gatewayDb.listDiscoverySymbols("user-123").map((row) => row.gene_symbol),
    [],
  )

  env.gatewayDb.seedDiscovery("user-123", "TP53")

  const discoveredResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=tp53&scope=discoveries&limit=10", {
      cookie: "session=abc",
    }),
    env,
    {},
  )
  const discoveredPayload = await discoveredResponse.json()

  assert.equal(discoveredResponse.status, 200)
  assert.deepEqual(
    discoveredPayload?.genes?.map((gene) => gene.symbol),
    ["TP53"],
  )

  const hiddenResponse = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=guardian&scope=discoveries&limit=10", {
      cookie: "session=abc",
    }),
    env,
    {},
  )
  const hiddenPayload = await hiddenResponse.json()

  assert.equal(hiddenResponse.status, 200)
  assert.deepEqual(hiddenPayload?.genes, [])
  assert.equal(hiddenResponse.headers.get("Cache-Control"), "no-store")
})

test("shared discovery search is public and reads the shared symbol cache", async () => {
  const env = buildEnv({
    kvEntries: {
      "iconoplasm:shared-gene-discovery-symbols:v1": JSON.stringify({
        schema: "iconoplasm.sharedGeneDiscoverySymbols.v1",
        symbols: ["TP53", "PRL"],
      }),
    },
  })

  const response = await viaStatefulWorker(
    buildRequest("/api/public/v1/genes/search?q=tp53&scope=shared&limit=10"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.scope_applied, "shared")
  assert.deepEqual(
    payload?.genes?.map((gene) => gene.symbol),
    ["TP53"],
  )
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=30")
})

test("unavailable shared publications never perform reader-triggered database repair or KV writes", async () => {
  for (const value of [null, "invalid-json", JSON.stringify({ symbols: [] })]) {
    const env = buildEnv({
      kvEntries: value === null ? {} : { "iconoplasm:shared-gene-discovery-symbols:v1": value },
    })
    const before = new Map(env.KV.entries)
    const queries = []
    const prepare = env.gatewayDb.prepare.bind(env.gatewayDb)
    env.gatewayDb.prepare = (sql) => {
      queries.push(sql)
      return prepare(sql)
    }
    const response = await viaStatefulWorker(
      buildRequest("/api/public/v1/genes/search?q=tp53&scope=shared"),
      env,
      {},
    )
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.equal((await response.json()).code, "SHARED_DISCOVERY_PUBLICATION_UNAVAILABLE")
    assert.deepEqual(env.KV.entries, before)
    assert.equal(
      queries.some((sql) => /icono_shared_gene_discoveries/.test(sql)),
      false,
    )
  }
})
