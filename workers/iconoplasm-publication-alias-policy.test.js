import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

// ARCHITECTURE FENCE [IPD-005]: desired alias history and immutable projections
// stay bounded under administrator edits.
// ARCHITECTURE FENCE [IPD-008]: desired alias state and its cross-policy
// dependency live in D1; anonymous consumers use only immutable KV projections.
import { createIconoplasmAdminPublicationAliasHandlers } from "./iconoplasm-admin-publication-alias-routes.js"
import {
  ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX,
  iconoplasmExtensionBlocklistKvKey,
  saveIconoplasmExtensionBlocklistPolicy,
} from "./iconoplasm-extension-blocklist-policy.js"
import {
  ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  iconoplasmPublicationAliasManifest,
  iconoplasmPublicationAliasManifestFromPolicy,
  normalizePublicationAlias,
} from "./iconoplasm-publication-aliases.js"
import {
  ICONOPLASM_PUBLICATION_ALIAS_HISTORY_RETENTION,
  ICONOPLASM_PUBLICATION_ALIAS_KV_RETENTION,
  ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES,
  iconoplasmPublicationAliasKvKey,
  iconoplasmPublicationAliasVersionKvKey,
  publishIconoplasmPublicationAliasPolicy,
  readAuthoritativePublishedIconoplasmPublicationAliases,
  readPublishedIconoplasmPublicationAliases,
  readPublishedIconoplasmPublicationAliasesByVersionToken,
  resetIconoplasmPublicationAliasPublicCacheForTests,
  saveIconoplasmPublicationAliasPolicy,
  validateIconoplasmPublicationAliasesAgainstPublishedScanner,
} from "./iconoplasm-publication-alias-policy.js"
import {
  ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION,
  ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX,
  iconoplasmRecognitionPairKvKey,
  publishIconoplasmRecognitionPolicyPair,
  readCoherentPublishedIconoplasmRecognitionPolicies,
  reconcileIconoplasmRecognitionPolicies,
  resetIconoplasmRecognitionPolicyPublicCacheForTests,
} from "./iconoplasm-recognition-policy-reconciliation.js"

const SEED_ALIAS_VERSION = "v1-bf7d4149d6b2df6c"
const SEED_BLOCKLIST_VERSION = `ebl1-${createHash("sha256")
  .update(JSON.stringify(["AMID"]))
  .digest("hex")
  .slice(0, 16)}`

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql.replace(/\s+/g, " ").trim()
    this.values = []
  }

  bind(...values) {
    this.values = values
    return this
  }

  first() {
    return this.db.first(this)
  }

  run() {
    return this.db.run(this)
  }
}

class FakeDb {
  constructor({ aliasRow = publicationAliasRow(), blocklistRow = blocklistPolicyRow() } = {}) {
    this.aliasRow = { ...aliasRow }
    this.blocklistRow = { ...blocklistRow }
    this.aliasHistory = []
    this.blocklistHistory = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    const results = []
    for (const statement of statements) results.push(await statement.run())
    return results
  }

  async first(statement) {
    if (statement.sql.includes("FROM icono_publication_alias_policy")) {
      return { ...this.aliasRow }
    }
    if (statement.sql.includes("FROM icono_extension_blocklist_policy")) {
      return { ...this.blocklistRow }
    }
    throw new Error(`Unexpected first(): ${statement.sql}`)
  }

  async run(statement) {
    const result = (changes) => ({ meta: { changes } })
    const sql = statement.sql

    if (sql.includes("SET policy_json = ?1")) {
      const [
        policyJson,
        revision,
        version,
        updatedAt,
        updatedBy,
        dependency,
        key,
        expectedRevision,
        expectedDependency,
      ] = statement.values
      if (
        key !== "curated" ||
        this.aliasRow.revision !== expectedRevision ||
        (expectedDependency != null && this.blocklistRow.revision !== expectedDependency)
      ) {
        return result(0)
      }
      Object.assign(this.aliasRow, {
        policy_json: policyJson,
        revision,
        version,
        updated_at: updatedAt,
        updated_by: updatedBy,
        depends_on_blocklist_revision: dependency,
        last_projection_error: null,
      })
      return result(1)
    }

    if (sql.includes("SET terms_json = ?1")) {
      const [
        termsJson,
        revision,
        version,
        updatedAt,
        updatedBy,
        dependency,
        key,
        expectedRevision,
        expectedDependency,
      ] = statement.values
      if (
        key !== "shared" ||
        this.blocklistRow.revision !== expectedRevision ||
        (expectedDependency != null && this.aliasRow.revision !== expectedDependency)
      ) {
        return result(0)
      }
      Object.assign(this.blocklistRow, {
        terms_json: termsJson,
        revision,
        version,
        updated_at: updatedAt,
        updated_by: updatedBy,
        depends_on_alias_revision: dependency,
        last_projection_error: null,
      })
      return result(1)
    }

    if (sql.startsWith("INSERT OR IGNORE INTO icono_publication_alias_policy_history")) {
      const [, revision] = statement.values
      if (this.aliasHistory.some((entry) => entry.revision === revision)) return result(0)
      this.aliasHistory.push({ revision })
      return result(1)
    }
    if (sql.startsWith("INSERT OR IGNORE INTO icono_extension_blocklist_policy_history")) {
      const [, revision] = statement.values
      if (this.blocklistHistory.some((entry) => entry.revision === revision)) return result(0)
      this.blocklistHistory.push({ revision })
      return result(1)
    }
    if (sql.startsWith("DELETE FROM icono_publication_alias_policy_history")) {
      const retention = statement.values[1]
      this.aliasHistory.sort((left, right) => right.revision - left.revision)
      this.aliasHistory = this.aliasHistory.slice(0, retention)
      return result(0)
    }
    if (sql.startsWith("DELETE FROM icono_extension_blocklist_policy_history")) {
      const retention = statement.values[1]
      this.blocklistHistory.sort((left, right) => right.revision - left.revision)
      this.blocklistHistory = this.blocklistHistory.slice(0, retention)
      return result(0)
    }

    if (sql.includes("SET projection_lease_token = ?1")) {
      const [token, expiresAt, key, now] = statement.values
      const row = key === "curated" ? this.aliasRow : this.blocklistRow
      const canClaim =
        !row.projection_lease_token ||
        !row.projection_lease_expires_at ||
        row.projection_lease_expires_at <= now
      if (!canClaim) return result(0)
      row.projection_lease_token = token
      row.projection_lease_expires_at = expiresAt
      return result(1)
    }

    if (sql.includes("SET published_revision = ?1")) {
      const [revision, version, publishedAt, key, expectedRevision, expectedVersion, token] =
        statement.values
      const row = key === "curated" ? this.aliasRow : this.blocklistRow
      if (
        row.revision !== expectedRevision ||
        row.version !== expectedVersion ||
        row.projection_lease_token !== token
      ) {
        return result(0)
      }
      Object.assign(row, {
        published_revision: revision,
        published_version: version,
        published_at: publishedAt,
        projection_lease_token: null,
        projection_lease_expires_at: null,
        last_projection_error: null,
      })
      return result(1)
    }

    if (sql.includes("SET projection_lease_token = NULL")) {
      const [errorMessage, key, token] = statement.values
      const row = key === "curated" ? this.aliasRow : this.blocklistRow
      if (row.projection_lease_token !== token) return result(0)
      row.projection_lease_token = null
      row.projection_lease_expires_at = null
      row.last_projection_error = errorMessage
      return result(1)
    }

    throw new Error(`Unexpected run(): ${sql}`)
  }
}

class FakeKv {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
    this.puts = []
    this.deletes = []
    this.gets = []
    this.lists = []
    this.failList = false
    this.failListPrefix = null
    this.pausedGet = null
  }

  async get(key) {
    this.gets.push(key)
    if (this.pausedGet?.key === key && !this.pausedGet.started) {
      this.pausedGet.started = true
      this.pausedGet.reached()
      await this.pausedGet.wait
    }
    return this.entries.get(key) ?? null
  }

  pauseNextGet(key) {
    let reached
    let release
    const reachedPromise = new Promise((resolve) => {
      reached = resolve
    })
    const wait = new Promise((resolve) => {
      release = resolve
    })
    this.pausedGet = { key, reached, wait, started: false }
    return { reached: reachedPromise, release }
  }

  async put(key, value) {
    this.puts.push({ key, value })
    this.entries.set(key, value)
  }

  async list({ prefix = "", limit = 1_000 } = {}) {
    this.lists.push(prefix)
    if (this.failList || prefix === this.failListPrefix) {
      throw new Error("simulated KV list outage")
    }
    const names = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort()
    return {
      keys: names.slice(0, limit).map((name) => ({ name })),
      list_complete: names.length <= limit,
    }
  }

  async delete(key) {
    this.deletes.push(key)
    this.entries.delete(key)
  }
}

function publicationAliasRow({
  revision = 1,
  policy = ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  version = SEED_ALIAS_VERSION,
  dependency = null,
  publishedRevision = revision,
  publishedVersion = version,
} = {}) {
  const policyJson = {
    schema_version: policy.schema_version,
    alias_count: policy.alias_count,
    removal_count: policy.removal_count,
    by_symbol: policy.by_symbol,
    remove_by_symbol: policy.remove_by_symbol,
  }
  return {
    policy_key: "curated",
    policy_json: JSON.stringify(policyJson),
    revision,
    version,
    updated_at: "2026-08-11T00:00:00.000Z",
    updated_by: "migration:0066",
    depends_on_blocklist_revision: dependency,
    published_revision: publishedRevision,
    published_version: publishedVersion,
    published_at: publishedRevision ? "2026-08-11T00:01:00.000Z" : null,
    projection_lease_token: null,
    projection_lease_expires_at: null,
    last_projection_error: null,
  }
}

function blocklistPolicyRow({
  revision = 1,
  terms = ["AMID"],
  version = SEED_BLOCKLIST_VERSION,
  dependency = null,
  publishedRevision = revision,
  publishedVersion = version,
} = {}) {
  return {
    policy_key: "shared",
    terms_json: JSON.stringify(terms),
    revision,
    version,
    updated_at: "2026-08-09T00:00:00.000Z",
    updated_by: "migration:0065",
    depends_on_alias_revision: dependency,
    published_revision: publishedRevision,
    published_version: publishedVersion,
    published_at: publishedRevision ? "2026-08-09T00:01:00.000Z" : null,
    projection_lease_token: null,
    projection_lease_expires_at: null,
    last_projection_error: null,
  }
}

function aliasProjection(
  policy = ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  version = SEED_ALIAS_VERSION,
) {
  return JSON.stringify({ ...policy, version })
}

function aliasManifest(
  policy = ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  version = SEED_ALIAS_VERSION,
) {
  return { ...policy, version }
}

function blocklistProjection({
  revision = 1,
  version = SEED_BLOCKLIST_VERSION,
  terms = ["AMID"],
} = {}) {
  return JSON.stringify({
    schema_version: 1,
    revision,
    version,
    term_count: terms.length,
    terms,
  })
}

function recognitionPairProjection({
  aliasRevision = 1,
  blocklistRevision = 1,
  aliases = aliasManifest(),
  terms = ["AMID"],
  blocklistVersion = SEED_BLOCKLIST_VERSION,
  aliasDependency = null,
  blocklistDependency = null,
  blocklistSchemaVersion = 1,
} = {}) {
  return JSON.stringify({
    schema_version: 1,
    alias_revision: aliasRevision,
    blocklist_revision: blocklistRevision,
    alias_depends_on_blocklist_revision: aliasDependency,
    blocklist_depends_on_alias_revision: blocklistDependency,
    publication_aliases: aliases,
    extension_blocklist: {
      schema_version: blocklistSchemaVersion,
      revision: blocklistRevision,
      version: blocklistVersion,
      term_count: terms.length,
      terms,
    },
  })
}

function candidateWithIl8() {
  return {
    ...ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
    alias_count: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.alias_count + 1,
    by_symbol: {
      ...ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol,
      CXCL8: ["IL8"],
    },
  }
}

function scannerEntries({ cxcl8Aliases = [], includeCadherin = true } = {}) {
  const hash = "alias-scanner-fixture"
  const symbols = new Set([
    ...Object.keys(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol),
    ...Object.keys(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.remove_by_symbol),
    "AIFM2",
    "CXCL8",
    "OTHER",
  ])
  const genes = Object.fromEntries([...symbols].map((symbol) => [symbol, {}]))
  genes.AIFM2 = { a: ["AMID"] }
  genes.CXCL8 = { a: cxcl8Aliases }
  genes.OTHER = { a: ["TAKEN"] }
  genes.CDH17 = includeCadherin ? { a: ["cadherin"] } : {}
  return {
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      scanner_artifact: { build_version: hash },
    }),
    [`iconoplasm:scanner-catalog:${hash}`]: JSON.stringify({ schema_version: 1, genes }),
  }
}

function publicEntries() {
  return {
    ...scannerEntries(),
    [iconoplasmPublicationAliasKvKey(1)]: aliasProjection(),
    [iconoplasmExtensionBlocklistKvKey(1)]: blocklistProjection(),
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

test("migration 0066 seeds the exact 45/1 bootstrap policy and dependency columns", async () => {
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0066_publication_alias_policy.sql", import.meta.url),
    "utf8",
  )
  const seededJson = migration.match(/VALUES\s*\(\s*'curated',\s*'(\{[^']+\})'/)?.[1]
  const seeded = JSON.parse(seededJson)
  const expected = await iconoplasmPublicationAliasManifest()
  const version = `v1-${createHash("sha256")
    .update(JSON.stringify(seeded))
    .digest("hex")
    .slice(0, 16)}`

  assert.deepEqual(seeded, ICONOPLASM_DEFAULT_PUBLICATION_ALIASES)
  assert.equal(seeded.alias_count, 45)
  assert.equal(seeded.removal_count, 1)
  assert.equal(version, expected.version)
  assert.match(migration, /depends_on_blocklist_revision/)
  assert.match(migration, /depends_on_alias_revision/)
  assert.equal(ICONOPLASM_PUBLICATION_ALIAS_HISTORY_RETENTION, 100)
  assert.equal(ICONOPLASM_PUBLICATION_ALIAS_KV_RETENTION, 100)
})

test("server normalization rejects controls while preserving intentional same-owner forms", () => {
  assert.equal(normalizePublicationAlias("IL8\u0000"), "")
  assert.equal(normalizePublicationAlias("IL8\n"), "IL8")
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.CDH1.slice(0, 2), [
    "E-cadherin",
    "E-Cadherin",
  ])
})

test("scanner validation accepts IL8 to CXCL8 and protects desired blocklist terms", async () => {
  const candidate = candidateWithIl8()
  const accepted = await validateIconoplasmPublicationAliasesAgainstPublishedScanner(
    new FakeKv(scannerEntries()),
    candidate.by_symbol,
    candidate.remove_by_symbol,
    { baselinePolicy: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES, requiredAliasTerms: ["IL8"] },
  )
  assert.deepEqual(accepted.by_symbol.CXCL8, ["IL8"])

  await assert.rejects(
    validateIconoplasmPublicationAliasesAgainstPublishedScanner(
      new FakeKv(scannerEntries()),
      ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol,
      ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.remove_by_symbol,
      { baselinePolicy: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES, requiredAliasTerms: ["IL8"] },
    ),
    (error) => {
      assert.equal(error.code, "publication_alias_policy_invalidates_blocklist")
      assert.equal(error.details.invalid_terms[0].reason, "not_published_alias")
      return true
    },
  )
})

test("scanner evolution grandfathers persisted additions and removals but rejects new redundancies", async () => {
  const candidate = candidateWithIl8()
  const evolvedKv = new FakeKv(scannerEntries({ cxcl8Aliases: ["IL8"], includeCadherin: false }))
  await assert.rejects(
    validateIconoplasmPublicationAliasesAgainstPublishedScanner(
      evolvedKv,
      candidate.by_symbol,
      candidate.remove_by_symbol,
      { baselinePolicy: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES },
    ),
    (error) => {
      assert.equal(error.details.invalid_operations[0].reason, "already_generated_for_target")
      return true
    },
  )
  const grandfathered = await validateIconoplasmPublicationAliasesAgainstPublishedScanner(
    evolvedKv,
    candidate.by_symbol,
    candidate.remove_by_symbol,
    { baselinePolicy: candidate },
  )
  assert.deepEqual(grandfathered.by_symbol.CXCL8, ["IL8"])
  assert.deepEqual(grandfathered.remove_by_symbol.CDH17, ["cadherin"])
})

test("save persists the exact blocklist dependency and rejects a stale cross-policy CAS", async () => {
  const db = new FakeDb()
  const candidate = candidateWithIl8()
  const saved = await saveIconoplasmPublicationAliasPolicy(db, {
    bySymbol: candidate.by_symbol,
    removeBySymbol: candidate.remove_by_symbol,
    expectedRevision: 1,
    expectedBlocklistRevision: 1,
    actor: "vladimir",
  })
  assert.equal(saved.policy.revision, 2)
  assert.equal(saved.policy.depends_on_blocklist_revision, 1)

  db.blocklistRow.revision = 2
  await assert.rejects(
    saveIconoplasmPublicationAliasPolicy(db, {
      bySymbol: { ...candidate.by_symbol, CXCL8: ["IL8", "IL-8"] },
      removeBySymbol: candidate.remove_by_symbol,
      expectedRevision: 2,
      expectedBlocklistRevision: 1,
    }),
    (error) =>
      error.status === 409 && error.code === "publication_alias_dependency_revision_conflict",
  )
})

test("publication waits for its persisted dependency and writes the unchanged sub-4KiB manifest shape", async () => {
  resetIconoplasmPublicationAliasPublicCacheForTests()
  const candidate = candidateWithIl8()
  const savedManifest = await validateIconoplasmPublicationAliasesAgainstPublishedScanner(
    new FakeKv(scannerEntries()),
    candidate.by_symbol,
    candidate.remove_by_symbol,
    { baselinePolicy: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES },
  )
  const db = new FakeDb({
    aliasRow: publicationAliasRow({
      revision: 2,
      policy: savedManifest,
      version: savedManifest.version,
      dependency: 2,
      publishedRevision: 1,
      publishedVersion: SEED_ALIAS_VERSION,
    }),
  })
  const kv = new FakeKv(publicEntries())
  await assert.rejects(
    publishIconoplasmPublicationAliasPolicy(db, kv, {
      readPublishedBlocklist: async () => ({ revision: 1, terms: ["AMID"] }),
    }),
    (error) => error.code === "publication_alias_blocklist_dependency_not_published",
  )
  db.aliasRow.depends_on_blocklist_revision = 1
  const published = await publishIconoplasmPublicationAliasPolicy(db, kv, {
    readPublishedBlocklist: async () => ({ revision: 1, terms: ["AMID"] }),
  })
  assert.equal(published.projection.revision, 2)
  const raw = kv.entries.get(iconoplasmPublicationAliasKvKey(2, savedManifest.version))
  const payload = JSON.parse(raw)
  assert.deepEqual(Object.keys(payload).sort(), [
    "depends_on_blocklist_revision",
    "publication_aliases",
    "revision",
    "schema_version",
  ])
  assert.equal(payload.revision, 2)
  assert.deepEqual(Object.keys(payload.publication_aliases).sort(), [
    "alias_count",
    "by_symbol",
    "removal_count",
    "remove_by_symbol",
    "schema_version",
    "version",
  ])
  assert.ok(
    new TextEncoder().encode(JSON.stringify(payload.publication_aliases)).byteLength <
      ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES,
  )
})

test("anonymous reads retain last-known-good aliases through KV failure while authoritative reads fail loud", async () => {
  resetIconoplasmPublicationAliasPublicCacheForTests()
  const kv = new FakeKv({
    [iconoplasmPublicationAliasKvKey(1)]: aliasProjection(),
  })
  const first = await readPublishedIconoplasmPublicationAliases(kv, { nowMs: 0 })
  kv.failList = true
  const retained = await readPublishedIconoplasmPublicationAliases(kv, { nowMs: 6_000 })
  assert.equal(retained.version, first.version)
  await assert.rejects(readPublishedIconoplasmPublicationAliases(kv, { fresh: true }))
  await assert.rejects(readAuthoritativePublishedIconoplasmPublicationAliases(kv))

  resetIconoplasmPublicationAliasPublicCacheForTests()
  const bootstrap = await readPublishedIconoplasmPublicationAliases(new FakeKv())
  assert.equal(bootstrap.version, SEED_ALIAS_VERSION)
})

test("historical alias version lookup is one direct GET and keeps bootstrap independent of KV history", async () => {
  const candidate = await iconoplasmPublicationAliasManifestFromPolicy(candidateWithIl8())
  const entries = Object.fromEntries(
    Array.from({ length: ICONOPLASM_PUBLICATION_ALIAS_KV_RETENTION }, (_, index) => [
      iconoplasmPublicationAliasKvKey(index + 1),
      aliasProjection(),
    ]),
  )
  entries[iconoplasmPublicationAliasVersionKvKey(candidate.version.replace(/-/g, ""))] =
    JSON.stringify(candidate)
  const kv = new FakeKv(entries)

  const bootstrap = await readPublishedIconoplasmPublicationAliasesByVersionToken(
    kv,
    SEED_ALIAS_VERSION.replace(/-/g, ""),
  )
  assert.equal(bootstrap.overlay.version, SEED_ALIAS_VERSION)
  assert.equal(kv.gets.length, 0)
  assert.equal(kv.lists.length, 0)

  const historical = await readPublishedIconoplasmPublicationAliasesByVersionToken(
    kv,
    candidate.version.replace(/-/g, ""),
  )
  assert.equal(historical.overlay.version, candidate.version)
  assert.equal(kv.gets.length, 1)
  assert.equal(kv.lists.length, 0)
})

test("coherent public reader is O(1) at max history and never mixes or mutates pair state", async () => {
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const entries = Object.fromEntries(
    Array.from({ length: ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION }, (_, index) => {
      const aliasRevision = index + 1
      return [
        iconoplasmRecognitionPairKvKey(aliasRevision, 1),
        recognitionPairProjection({ aliasRevision }),
      ]
    }),
  )
  const kv = new FakeKv(entries)
  const pair = await readCoherentPublishedIconoplasmRecognitionPolicies(kv, { fresh: true })

  assert.equal(pair.alias_revision, ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION)
  assert.equal(pair.blocklist_revision, 1)
  assert.equal(kv.lists.length, 1)
  assert.equal(kv.gets.length, 1)
  assert.throws(() => pair.extension_blocklist.terms.push("ARCH"), TypeError)
})

test("coherent reader skips lagging or malformed newest bundles and fails closed if none are valid", async () => {
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const kv = new FakeKv({
    [iconoplasmRecognitionPairKvKey(4, 1)]: undefined,
    [iconoplasmRecognitionPairKvKey(3, 1)]: "{not json",
    [iconoplasmRecognitionPairKvKey(2, 1)]: recognitionPairProjection({
      aliasRevision: 2,
      aliasDependency: "1",
    }),
    [iconoplasmRecognitionPairKvKey(1, 1)]: recognitionPairProjection(),
  })
  const retained = await readCoherentPublishedIconoplasmRecognitionPolicies(kv, { fresh: true })
  assert.equal(retained.alias_revision, 1)
  assert.equal(kv.gets.length, 4)

  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const corrupt = new FakeKv({
    [iconoplasmRecognitionPairKvKey(2, 1)]: recognitionPairProjection({
      aliasRevision: 2,
      blocklistSchemaVersion: 2,
    }),
    [iconoplasmRecognitionPairKvKey(1, 1)]: recognitionPairProjection({
      terms: ["ARCH"],
      blocklistVersion: SEED_BLOCKLIST_VERSION,
    }),
  })
  await assert.rejects(
    readCoherentPublishedIconoplasmRecognitionPolicies(corrupt, { fresh: true }),
    (error) => error.code === "recognition_pair_unavailable",
  )

  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const malformedKeyOnly = new FakeKv({
    [`${ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX}not-a-pair-key`]: recognitionPairProjection(),
  })
  await assert.rejects(
    readCoherentPublishedIconoplasmRecognitionPolicies(malformedKeyOnly, { fresh: true }),
    (error) => error.code === "recognition_pair_unavailable",
  )
})

test("an older pair publisher finishing last cannot regress the isolate cache", async () => {
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const kv = new FakeKv({
    ...scannerEntries(),
    [iconoplasmPublicationAliasKvKey(2)]: aliasProjection(),
    [iconoplasmExtensionBlocklistKvKey(1)]: blocklistProjection(),
  })
  const oldPairKey = iconoplasmRecognitionPairKvKey(2, 1)
  const gate = kv.pauseNextGet(oldPairKey)
  const olderPublication = publishIconoplasmRecognitionPolicyPair(kv)
  await gate.reached

  const newerAliases = await iconoplasmPublicationAliasManifestFromPolicy(candidateWithIl8())
  kv.entries.set(iconoplasmPublicationAliasKvKey(3), JSON.stringify(newerAliases))
  const newerPublication = await publishIconoplasmRecognitionPolicyPair(kv)
  assert.equal(newerPublication.pair.alias_revision, 3)

  gate.release()
  const olderResult = await olderPublication
  assert.equal(olderResult.pair.alias_revision, 2)
  const cached = await readCoherentPublishedIconoplasmRecognitionPolicies(kv)
  assert.equal(cached.alias_revision, 3)
})

test("first-deploy bootstrap preserves the newest dependency-free legacy blocklist and fails loud on KV errors", async () => {
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const healthy = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(10)]: JSON.stringify({
      schema_version: 1,
      revision: 10,
      version: SEED_BLOCKLIST_VERSION,
      term_count: 1,
      terms: ["AMID"],
      depends_on_alias_revision: null,
    }),
  })
  const healthyFallback = await readCoherentPublishedIconoplasmRecognitionPolicies(healthy, {
    fresh: true,
  })
  assert.equal(healthyFallback.extension_blocklist.revision, 10)
  assert.equal(healthy.gets.length, 1)

  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const kv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(10)]: JSON.stringify({
      schema_version: 1,
      revision: 10,
      version: SEED_BLOCKLIST_VERSION,
      term_count: 1,
      terms: ["AMID"],
      depends_on_alias_revision: null,
    }),
    [iconoplasmExtensionBlocklistKvKey(11)]: JSON.stringify({
      schema_version: 1,
      revision: 11,
      version: SEED_BLOCKLIST_VERSION,
      term_count: 1,
      terms: ["AMID"],
      depends_on_alias_revision: 2,
    }),
  })
  const fallback = await readCoherentPublishedIconoplasmRecognitionPolicies(kv, { fresh: true })
  assert.equal(fallback.alias_revision, 0)
  assert.equal(fallback.extension_blocklist.revision, 10)

  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const failing = new FakeKv()
  failing.failListPrefix = ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX
  await assert.rejects(
    readCoherentPublishedIconoplasmRecognitionPolicies(failing, { fresh: true }),
    /simulated KV list outage/,
  )
})

test("admin POST saves IL8 to CXCL8 against desired blocklist state and publishes it", async () => {
  resetIconoplasmPublicationAliasPublicCacheForTests()
  const db = new FakeDb()
  const kv = new FakeKv(publicEntries())
  const handler = createIconoplasmAdminPublicationAliasHandlers({
    actor: async () => "vladimir",
    isAdmin: async () => true,
    json,
  })["admin_publication_aliases.policy"]
  const candidate = candidateWithIl8()
  const response = await handler({
    request: new Request(
      "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication-aliases",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_revision: 1,
          by_symbol: candidate.by_symbol,
          remove_by_symbol: candidate.remove_by_symbol,
        }),
      },
    ),
    env: { ICONOPLASM_DB: db, KV: kv },
    done: async (_route, result) => result,
  })
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.policy.revision, 2)
  assert.deepEqual(payload.policy.by_symbol.CXCL8, ["IL8"])
  assert.equal(payload.publication.in_sync, true)
})

test("alias admin route rejects unsupported methods before auth or bindings", async () => {
  let authChecks = 0
  const handler = createIconoplasmAdminPublicationAliasHandlers({
    actor: async () => "unused",
    isAdmin: async () => {
      authChecks += 1
      return true
    },
    json,
  })["admin_publication_aliases.policy"]
  const env = new Proxy({}, { get: () => assert.fail("unsupported method touched bindings") })
  for (const method of ["PUT", "DELETE"]) {
    const response = await handler({
      request: new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication-aliases",
        { method },
      ),
      env,
      done: async (_route, result) => result,
    })
    const payload = await response.json()
    assert.equal(response.status, 405)
    assert.equal(payload.code, "method_not_allowed")
    assert.equal(response.headers.get("Allow"), "GET, HEAD, POST")
    assert.equal(response.headers.get("Cache-Control"), "no-store")
  }
  assert.equal(authChecks, 0)
})

test("alias admin returns saved policy state when the new pair key is listed before its value", async () => {
  resetIconoplasmPublicationAliasPublicCacheForTests()
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const db = new FakeDb()
  const kv = new FakeKv(publicEntries())
  const get = kv.get.bind(kv)
  kv.get = async (key) =>
    String(key).startsWith(ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX) ? null : get(key)
  const handler = createIconoplasmAdminPublicationAliasHandlers({
    actor: async () => "vladimir",
    isAdmin: async () => true,
    json,
  })["admin_publication_aliases.policy"]
  const candidate = candidateWithIl8()
  const response = await handler({
    request: new Request(
      "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication-aliases",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_revision: 1,
          by_symbol: candidate.by_symbol,
          remove_by_symbol: candidate.remove_by_symbol,
        }),
      },
    ),
    env: { ICONOPLASM_DB: db, KV: kv },
    done: async (_route, result) => result,
  })
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload.code, "recognition_pair_not_visible")
  assert.equal(payload.saved, true)
  assert.equal(payload.policy.revision, 2)
  assert.equal(payload.publication.in_sync, false)
})

test("ordered reconciliation resolves a pending alias then blocklist dependency in one tick", async () => {
  resetIconoplasmPublicationAliasPublicCacheForTests()
  const db = new FakeDb()
  const kv = new FakeKv(publicEntries())
  const candidate = candidateWithIl8()
  await saveIconoplasmPublicationAliasPolicy(db, {
    bySymbol: candidate.by_symbol,
    removeBySymbol: candidate.remove_by_symbol,
    expectedRevision: 1,
    expectedBlocklistRevision: 1,
  })
  await saveIconoplasmExtensionBlocklistPolicy(db, {
    terms: ["AMID", "IL8"],
    expectedRevision: 1,
    expectedPublicationAliasRevision: 2,
  })

  const result = await reconcileIconoplasmRecognitionPolicies({ ICONOPLASM_DB: db, KV: kv })
  assert.equal(result.passes.blocklist_first.status, "rejected")
  assert.equal(
    result.passes.blocklist_first.reason.code,
    "extension_blocklist_alias_dependency_not_published",
  )
  assert.equal(result.publication_aliases.status, "fulfilled")
  assert.equal(result.extension_blocklist.status, "fulfilled")
  assert.equal(db.aliasRow.published_revision, 2)
  assert.equal(db.blocklistRow.published_revision, 2)
})
