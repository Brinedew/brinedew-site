import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import test from "node:test"

// ARCHITECTURE FENCE [IPD-005]: desired alias history and immutable projections
// stay bounded under administrator edits.
// ARCHITECTURE FENCE [IPD-008]: desired alias state and its cross-policy
// dependency live in D1; anonymous consumers use only immutable KV projections.
import { createIconoplasmAdminPublicationAliasHandlers } from "./iconoplasm-admin-publication-alias-routes.js"
import { iconoplasmExtensionBlocklistKvKey } from "./iconoplasm-extension-blocklist-policy.js"
import { ICONOPLASM_DEFAULT_PUBLICATION_ALIASES } from "./iconoplasm-publication-aliases.js"
import {
  iconoplasmPublicationAliasKvKey,
  resetIconoplasmPublicationAliasPublicCacheForTests,
} from "./iconoplasm-publication-alias-policy.js"

import { buildIconoplasmRecognitionValidationIndex } from "./iconoplasm-recognition-validation-index.js"
import {
  ICONOPLASM_RECOGNITION_PAIR_CURRENT_KV_KEY,
  ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION,
  iconoplasmRecognitionPairKvKey,
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
    this.validationRow = recognitionValidationRow(this.aliasRow, this.blocklistRow)
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
    if (statement.sql.includes("FROM icono_recognition_policy_validation")) {
      return { ...this.validationRow }
    }
    throw new Error(`Unexpected first(): ${statement.sql}`)
  }

  async run(statement) {
    const result = (changes) => ({ meta: { changes } })
    const sql = statement.sql

    if (sql.startsWith("INSERT INTO icono_recognition_policy_validation")) {
      const [
        validatorRevision,
        scannerVersion,
        validatedAt,
        aliasRevision,
        aliasVersion,
        blocklistRevision,
        blocklistVersion,
      ] = statement.values
      if (
        this.aliasRow.revision !== aliasRevision ||
        this.aliasRow.version !== aliasVersion ||
        this.blocklistRow.revision !== blocklistRevision ||
        this.blocklistRow.version !== blocklistVersion
      )
        return result(0)
      Object.assign(this.validationRow, {
        state: "valid",
        validator_revision: validatorRevision,
        scanner_version: scannerVersion,
        alias_revision: aliasRevision,
        alias_version: aliasVersion,
        blocklist_revision: blocklistRevision,
        blocklist_version: blocklistVersion,
        validated_at: validatedAt,
        validation_lease_token: null,
        validation_lease_expires_at: null,
        last_validation_error: null,
      })
      return result(1)
    }

    if (sql.includes("SET state = 'unvalidated'")) {
      const [
        validatorRevision,
        scannerVersion,
        aliasRevision,
        aliasVersion,
        blocklistRevision,
        blocklistVersion,
        token,
        expiresAt,
      ] = statement.values
      if (
        this.aliasRow.revision !== aliasRevision ||
        this.aliasRow.version !== aliasVersion ||
        this.blocklistRow.revision !== blocklistRevision ||
        this.blocklistRow.version !== blocklistVersion
      )
        return result(0)
      Object.assign(this.validationRow, {
        state: "unvalidated",
        validator_revision: validatorRevision,
        scanner_version: scannerVersion,
        alias_revision: aliasRevision,
        alias_version: aliasVersion,
        blocklist_revision: blocklistRevision,
        blocklist_version: blocklistVersion,
        validated_at: null,
        validation_lease_token: token,
        validation_lease_expires_at: expiresAt,
        last_validation_error: null,
      })
      return result(1)
    }

    if (sql.includes("SET state = ?1")) {
      const [
        state,
        validatedAt,
        errorMessage,
        ,
        validatorRevision,
        scannerVersion,
        aliasRevision,
        aliasVersion,
        blocklistRevision,
        blocklistVersion,
        token,
      ] = statement.values
      if (
        this.validationRow.validation_lease_token !== token ||
        this.aliasRow.revision !== aliasRevision ||
        this.aliasRow.version !== aliasVersion ||
        this.blocklistRow.revision !== blocklistRevision ||
        this.blocklistRow.version !== blocklistVersion
      )
        return result(0)
      Object.assign(this.validationRow, {
        state,
        validator_revision: validatorRevision,
        scanner_version: scannerVersion,
        alias_revision: aliasRevision,
        alias_version: aliasVersion,
        blocklist_revision: blocklistRevision,
        blocklist_version: blocklistVersion,
        validated_at: validatedAt,
        validation_lease_token: null,
        validation_lease_expires_at: null,
        last_validation_error: errorMessage,
      })
      return result(1)
    }

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
    this.hiddenListPrefixes = new Set()
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
    const names = [...this.entries.keys()]
      .filter((key) => key.startsWith(prefix))
      .filter(
        (key) => ![...this.hiddenListPrefixes].some((hiddenPrefix) => key.startsWith(hiddenPrefix)),
      )
      .sort()
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

function recognitionValidationRow(aliasRow, blocklistRow) {
  return {
    policy_key: "shared",
    state: "valid",
    validator_revision: 1,
    scanner_version: "alias-scanner-fixture",
    alias_revision: aliasRow.revision,
    alias_version: aliasRow.version,
    blocklist_revision: blocklistRow.revision,
    blocklist_version: blocklistRow.version,
    validated_at: "2026-08-11T00:00:30.000Z",
    validation_lease_token: null,
    validation_lease_expires_at: null,
    last_validation_error: null,
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

function recognitionPairPointerProjection({ aliasRevision = 1, blocklistRevision = 1 } = {}) {
  return JSON.stringify({
    schema_version: 1,
    alias_revision: aliasRevision,
    blocklist_revision: blocklistRevision,
    pair_key: iconoplasmRecognitionPairKvKey(aliasRevision, blocklistRevision),
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

function scannerEntries({
  cxcl8Aliases = [],
  includeCadherin = true,
  p130Owner = null,
  hash = "alias-scanner-fixture",
} = {}) {
  const symbols = new Set([
    ...Object.keys(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol),
    ...Object.keys(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.remove_by_symbol),
    "AIFM2",
    "APC",
    "CXCL8",
    "NOLC1",
    "OTHER",
    "RBL2",
  ])
  const genes = Object.fromEntries([...symbols].map((symbol) => [symbol, {}]))
  genes.AIFM2 = { a: ["AMID"] }
  genes.CXCL8 = { a: cxcl8Aliases }
  genes.NOLC1 = p130Owner === "NOLC1" ? { a: ["P130"] } : {}
  genes.OTHER = { a: ["TAKEN"] }
  genes.CDH17 = includeCadherin ? { a: ["cadherin"] } : {}
  const recognitionIndex = buildIconoplasmRecognitionValidationIndex(genes, {
    scannerVersion: hash,
  })
  return {
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      scanner_artifact: { build_version: hash },
    }),
    [`iconoplasm:scanner-catalog:${hash}`]: JSON.stringify({ schema_version: 1, genes }),
    ...Object.fromEntries(recognitionIndex.shards.map((shard) => [shard.key, shard.value])),
    [recognitionIndex.manifestKey]: recognitionIndex.manifestValue,
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
  entries[ICONOPLASM_RECOGNITION_PAIR_CURRENT_KV_KEY] = recognitionPairPointerProjection({
    aliasRevision: ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION,
  })
  const kv = new FakeKv(entries)
  const pair = await readCoherentPublishedIconoplasmRecognitionPolicies(kv, { fresh: true })

  assert.equal(pair.alias_revision, ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION)
  assert.equal(pair.blocklist_revision, 1)
  assert.equal(kv.lists.length, 0)
  assert.deepEqual(kv.gets, [
    ICONOPLASM_RECOGNITION_PAIR_CURRENT_KV_KEY,
    iconoplasmRecognitionPairKvKey(ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION, 1),
  ])
  assert.throws(() => pair.extension_blocklist.terms.push("ARCH"), TypeError)
})

test("pointer publication completes despite KV list lag and never reads the scanner artifact", async () => {
  resetIconoplasmPublicationAliasPublicCacheForTests()
  resetIconoplasmRecognitionPolicyPublicCacheForTests()
  const db = new FakeDb()
  const kv = new FakeKv(publicEntries())
  const scannerArtifactKey = "iconoplasm:scanner-catalog:alias-scanner-fixture"
  const aliasRevisionPrefix = iconoplasmPublicationAliasKvKey(2)
  const pairKey = iconoplasmRecognitionPairKvKey(2, 1)
  kv.hiddenListPrefixes.add(aliasRevisionPrefix)
  kv.hiddenListPrefixes.add(pairKey)
  const handler = createIconoplasmAdminPublicationAliasHandlers({
    actor: async () => "vladimir",
    isAdmin: async () => true,
    json,
  })["admin_publication_aliases.policy"]
  const candidate = candidateWithIl8()
  const post = async (expectedRevision) => {
    const response = await handler({
      request: new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication-aliases",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_revision: expectedRevision,
            by_symbol: candidate.by_symbol,
            remove_by_symbol: candidate.remove_by_symbol,
          }),
        },
      ),
      env: { ICONOPLASM_DB: db, KV: kv },
      done: async (_route, result) => result,
    })
    return { response, payload: await response.json() }
  }

  const first = await post(1)
  assert.equal(first.response.status, 200)
  assert.equal(first.payload.publication.in_sync, true)
  assert.deepEqual(first.payload.policy.by_symbol.CXCL8, ["IL8"])
  assert.equal(kv.entries.has(aliasRevisionPrefix), false)
  assert.ok([...kv.entries.keys()].some((key) => key.startsWith(aliasRevisionPrefix)))
  assert.equal(kv.entries.has(pairKey), true)
  assert.equal(
    kv.entries.get(ICONOPLASM_RECOGNITION_PAIR_CURRENT_KV_KEY),
    recognitionPairPointerProjection({ aliasRevision: 2 }),
  )
  assert.equal(db.aliasRow.revision, 2)
  assert.equal(db.aliasHistory.length, 1)
  assert.equal(kv.gets.filter((key) => key === scannerArtifactKey).length, 0)
  assert.equal(kv.puts.filter(({ key }) => key === pairKey).length, 1)
})

test("exact pair and valid receipt bypass every history list even at retention bounds", async () => {
  const db = new FakeDb()
  Object.assign(db.validationRow, {
    state: "valid",
    scanner_version: "alias-scanner-fixture",
    validated_at: "2026-08-11T00:02:00.000Z",
    validation_lease_token: null,
    validation_lease_expires_at: null,
    last_validation_error: null,
  })
  const entries = { ...scannerEntries() }
  for (let revision = 1; revision <= 100; revision += 1) {
    entries[iconoplasmPublicationAliasKvKey(revision)] = aliasProjection()
    entries[iconoplasmExtensionBlocklistKvKey(revision)] = blocklistProjection({ revision })
    entries[iconoplasmRecognitionPairKvKey(revision, revision)] = recognitionPairProjection({
      aliasRevision: revision,
      blocklistRevision: revision,
    })
  }
  const kv = new FakeKv(entries)
  kv.failList = true

  const result = await reconcileIconoplasmRecognitionPolicies(
    { ICONOPLASM_DB: db, KV: kv },
    { cleanup: false },
  )
  assert.equal(result.pair.status, "fulfilled")
  assert.equal(result.pair.value.reason, "already_published")
  assert.equal(kv.lists.length, 0)
  assert.equal(kv.gets.filter((key) => key === "iconoplasm:catalog-manifest").length, 2)
  assert.equal(kv.gets.filter((key) => key.startsWith("iconoplasm:scanner-catalog:")).length, 0)
})

test("scheduled exact-pair reconciliation repairs the pointer without list quota or scanner work", async () => {
  const revision = 101
  const db = new FakeDb({
    aliasRow: publicationAliasRow({ revision }),
    blocklistRow: blocklistPolicyRow({ revision }),
  })
  Object.assign(db.validationRow, {
    state: "valid",
    scanner_version: "alias-scanner-fixture",
    validated_at: "2026-08-11T00:02:00.000Z",
    validation_lease_token: null,
    validation_lease_expires_at: null,
    last_validation_error: null,
  })
  const entries = { ...scannerEntries() }
  for (let historyRevision = 1; historyRevision <= revision; historyRevision += 1) {
    entries[iconoplasmPublicationAliasKvKey(historyRevision, SEED_ALIAS_VERSION)] =
      aliasProjection()
    entries[iconoplasmExtensionBlocklistKvKey(historyRevision)] = blocklistProjection({
      revision: historyRevision,
    })
    entries[iconoplasmRecognitionPairKvKey(historyRevision, historyRevision)] =
      recognitionPairProjection({
        aliasRevision: historyRevision,
        blocklistRevision: historyRevision,
      })
  }
  const kv = new FakeKv(entries)

  const result = await reconcileIconoplasmRecognitionPolicies({ ICONOPLASM_DB: db, KV: kv })
  assert.equal(result.pair.status, "fulfilled")
  assert.equal(result.pair.value.reason, "already_published")
  assert.equal(result.publication_aliases.value.cleanup.reason, "no_new_publication")
  assert.equal(result.extension_blocklist.value.cleanup.reason, "no_new_publication")
  assert.equal(result.pair.value.cleanup.reason, "no_new_publication")
  assert.equal(kv.lists.length, 0)
  assert.equal(
    kv.entries.get(ICONOPLASM_RECOGNITION_PAIR_CURRENT_KV_KEY),
    recognitionPairPointerProjection({ aliasRevision: revision, blocklistRevision: revision }),
  )
  assert.equal(kv.gets.filter((key) => key.startsWith("iconoplasm:scanner-catalog:")).length, 0)
})
