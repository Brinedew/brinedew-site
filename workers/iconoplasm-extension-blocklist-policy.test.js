import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: these tests keep policy mutation on D1 and
// public consumption on the separately revisioned, bounded KV projection.

import { createIconoplasmAdminExtensionBlocklistHandlers } from "./iconoplasm-admin-extension-blocklist-routes.js"
import {
  ICONOPLASM_EXTENSION_BLOCKLIST_HISTORY_RETENTION,
  ICONOPLASM_EXTENSION_BLOCKLIST_CONTRACT_REVISION,
  ICONOPLASM_EXTENSION_BLOCKLIST_KV_RETENTION,
  ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES,
  ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES,
  iconoplasmExtensionBlocklistKvKey,
  reconcileIconoplasmExtensionBlocklistPolicy,
  resetIconoplasmExtensionBlocklistPublicCacheForTests,
  publishIconoplasmExtensionBlocklistPolicy,
  readIconoplasmExtensionBlocklistPolicy,
  readPublishedIconoplasmExtensionBlocklist,
  saveIconoplasmExtensionBlocklistPolicy,
  validateIconoplasmExtensionBlocklistAgainstPublishedScanner,
} from "./iconoplasm-extension-blocklist-policy.js"

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
  constructor(row, history = []) {
    this.row = { ...row }
    this.history = history.map((entry) => ({ ...entry }))
    this.calls = []
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
    this.calls.push({ kind: "first", sql: statement.sql, values: statement.values })
    if (statement.sql.includes("FROM icono_extension_blocklist_policy")) {
      return { ...this.row }
    }
    throw new Error(`Unexpected first(): ${statement.sql}`)
  }

  async run(statement) {
    this.calls.push({ kind: "run", sql: statement.sql, values: statement.values })
    const result = (changes) => ({ meta: { changes } })

    if (statement.sql.includes("SET terms_json = ?1")) {
      const [termsJson, revision, version, updatedAt, updatedBy, key, expectedRevision] =
        statement.values
      if (key !== "shared" || this.row.revision !== expectedRevision) return result(0)
      Object.assign(this.row, {
        terms_json: termsJson,
        revision,
        version,
        updated_at: updatedAt,
        updated_by: updatedBy,
        last_projection_error: null,
      })
      return result(1)
    }

    if (statement.sql.startsWith("INSERT OR IGNORE INTO icono_extension_blocklist_policy_history")) {
      const [key, revision, version] = statement.values
      if (
        key !== "shared" ||
        this.row.revision !== revision ||
        this.row.version !== version ||
        this.history.some((entry) => entry.revision === revision)
      ) {
        return result(0)
      }
      this.history.push({
        policy_key: "shared",
        revision,
        version,
        terms_json: this.row.terms_json,
        changed_at: this.row.updated_at,
        changed_by: this.row.updated_by,
      })
      return result(1)
    }

    if (statement.sql.startsWith("DELETE FROM icono_extension_blocklist_policy_history")) {
      const [key, retention] = statement.values
      if (key !== "shared") return result(0)
      const before = this.history.length
      this.history.sort((left, right) => right.revision - left.revision)
      this.history = this.history.slice(0, retention)
      return result(before - this.history.length)
    }

    if (statement.sql.includes("SET projection_lease_token = ?1")) {
      const [token, expiresAt, key, now] = statement.values
      const canClaim =
        !this.row.projection_lease_token ||
        !this.row.projection_lease_expires_at ||
        this.row.projection_lease_expires_at <= now
      if (key !== "shared" || !canClaim) return result(0)
      this.row.projection_lease_token = token
      this.row.projection_lease_expires_at = expiresAt
      return result(1)
    }

    if (statement.sql.includes("SET published_revision = ?1")) {
      const [revision, version, publishedAt, key, expectedRevision, expectedVersion, token] =
        statement.values
      if (
        key !== "shared" ||
        this.row.revision !== expectedRevision ||
        this.row.version !== expectedVersion ||
        this.row.projection_lease_token !== token
      ) {
        return result(0)
      }
      Object.assign(this.row, {
        published_revision: revision,
        published_version: version,
        published_at: publishedAt,
        projection_lease_token: null,
        projection_lease_expires_at: null,
        last_projection_error: null,
      })
      return result(1)
    }

    if (statement.sql.includes("SET projection_lease_token = NULL")) {
      const [errorMessage, key, token] = statement.values
      if (key !== "shared" || this.row.projection_lease_token !== token) return result(0)
      this.row.projection_lease_token = null
      this.row.projection_lease_expires_at = null
      this.row.last_projection_error = errorMessage
      return result(1)
    }

    throw new Error(`Unexpected run(): ${statement.sql}`)
  }
}

class FakeKv {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
    this.puts = []
    this.deletes = []
    this.failPut = false
    this.onPut = null
  }

  async get(key) {
    return this.entries.get(key) ?? null
  }

  async put(key, value) {
    if (this.failPut) throw new Error("simulated KV write failure")
    this.puts.push({ key, value })
    if (this.onPut) await this.onPut(key, value)
    this.entries.set(key, value)
  }

  async list({ prefix = "", limit = 1_000 } = {}) {
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

function projection({ revision, version, terms }) {
  return JSON.stringify({
    schema_version: 1,
    revision,
    version,
    term_count: terms.length,
    terms,
  })
}

function policyRow({
  revision = 1,
  version = "ebl1-1111111111111111",
  terms = ["AMID"],
  publishedRevision = revision,
  publishedVersion = version,
  leaseToken = null,
  leaseExpiresAt = null,
} = {}) {
  return {
    policy_key: "shared",
    terms_json: JSON.stringify(terms),
    revision,
    version,
    updated_at: "2026-08-09T00:00:00.000Z",
    updated_by: "migration:0065",
    published_revision: publishedRevision,
    published_version: publishedVersion,
    published_at: publishedRevision ? "2026-08-09T00:01:00.000Z" : null,
    projection_lease_token: leaseToken,
    projection_lease_expires_at: leaseExpiresAt,
    last_projection_error: null,
  }
}

function scannerEntries() {
  const hash = "scannerfixture01"
  return {
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      scanner_artifact: { build_version: hash },
    }),
    [`iconoplasm:scanner-catalog:${hash}`]: JSON.stringify({
      schema_version: 1,
      genes: {
        AIFM2: { a: ["AMID"] },
        ZBTB8OS: { a: ["ARCH"] },
        NOTCH1: {},
        CDH17: { a: ["cadherin"] },
        OWNER1: { a: ["SHARED"] },
        OWNER2: { a: ["SHARED"] },
        OWNER3: { a: ["SHARED"] },
      },
    }),
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function handlers(isAdmin = async () => true) {
  return createIconoplasmAdminExtensionBlocklistHandlers({
    actor: async () => "vladimir",
    isAdmin,
    json,
  })["admin_extension_blocklist.policy"]
}

async function callHandler(handler, request, env) {
  return handler({ request, env, done: async (_route, response) => response })
}

test("migration 0065 seeds the exact 76 packaged defaults and bounded history", () => {
  const defaultsSource = readFileSync(
    new URL("../iconoplasm-extension/blocklist-defaults.js", import.meta.url),
    "utf8",
  )
  const context = {}
  vm.createContext(context)
  vm.runInContext(`${defaultsSource};globalThis.defaults=ICONOPLASM_DEFAULT_BLOCKLIST`, context)
  const packagedDefaults = [...context.defaults].map((term) => term.trim().toUpperCase()).sort()
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0065_extension_blocklist_policy.sql", import.meta.url),
    "utf8",
  )
  const seededJson = migration.match(/VALUES\s*\(\s*'shared',\s*'(\[[^']+\])'/)?.[1]
  const seededTerms = JSON.parse(seededJson)
  const seededVersion = `ebl1-${createHash("sha256")
    .update(JSON.stringify(seededTerms))
    .digest("hex")
    .slice(0, 16)}`

  assert.equal(packagedDefaults.length, 76)
  assert.deepEqual(seededTerms, packagedDefaults)
  assert.match(migration, /icono_extension_blocklist_policy_history/)
  assert.match(migration, new RegExp(seededVersion))
  assert.equal(ICONOPLASM_EXTENSION_BLOCKLIST_HISTORY_RETENTION, 100)
  assert.equal(ICONOPLASM_EXTENSION_BLOCKLIST_KV_RETENTION, 100)
  assert.equal(ICONOPLASM_EXTENSION_BLOCKLIST_CONTRACT_REVISION, 1)
})

test("published scanner validation accepts aliases only and rejects canonical, missing, or ambiguous terms", async () => {
  const kv = new FakeKv(scannerEntries())
  assert.deepEqual(
    await validateIconoplasmExtensionBlocklistAgainstPublishedScanner(new FakeKv(), []),
    [],
  )
  assert.deepEqual(
    await validateIconoplasmExtensionBlocklistAgainstPublishedScanner(kv, [" arch ", "amid"]),
    ["AMID", "ARCH"],
  )
  assert.deepEqual(
    await validateIconoplasmExtensionBlocklistAgainstPublishedScanner(kv, ["N1ICD"]),
    ["N1ICD"],
  )

  for (const [term, reason] of [
    ["AIFM2", "canonical_symbol"],
    ["UNKNOWN", "not_published_alias"],
    ["SHARED", "ambiguous_alias"],
    ["cadherin", "not_published_alias"],
  ]) {
    await assert.rejects(
      validateIconoplasmExtensionBlocklistAgainstPublishedScanner(kv, [term]),
      (error) => {
        assert.equal(error.status, 422)
        assert.equal(error.details.invalid_terms[0].reason, reason)
        return true
      },
    )
  }
})

test("save uses expected_revision CAS, records actor audit, and retains only the newest 100 revisions", async () => {
  const history = Array.from({ length: 105 }, (_, index) => ({ revision: index + 1 }))
  const db = new FakeDb(policyRow({ revision: 105 }), history)
  const saved = await saveIconoplasmExtensionBlocklistPolicy(db, {
    terms: ["ARCH"],
    expectedRevision: 105,
    actor: "vladimir",
    now: new Date("2026-08-09T02:00:00.000Z"),
  })

  assert.equal(saved.changed, true)
  assert.equal(saved.policy.revision, 106)
  assert.equal(saved.policy.updated_by, "vladimir")
  assert.equal(db.history.length, 100)
  assert.equal(Math.min(...db.history.map((entry) => entry.revision)), 7)
  assert.equal(Math.max(...db.history.map((entry) => entry.revision)), 106)

  await assert.rejects(
    saveIconoplasmExtensionBlocklistPolicy(db, {
      terms: ["AMID"],
      expectedRevision: 105,
      actor: "stale-editor",
    }),
    (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.details.current.revision, 106)
      return true
    },
  )
})

test("KV failure preserves the newer desired policy and old public projection, then idempotent publication repairs it", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const oldVersion = "ebl1-1111111111111111"
  const db = new FakeDb(policyRow({ version: oldVersion }))
  const kv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version: oldVersion,
      terms: ["AMID"],
    }),
  })
  const saved = await saveIconoplasmExtensionBlocklistPolicy(db, {
    terms: ["ARCH"],
    expectedRevision: 1,
    actor: "vladimir",
  })
  kv.failPut = true
  await assert.rejects(
    publishIconoplasmExtensionBlocklistPolicy(db, kv),
    (error) => error.status === 503 && error.code === "extension_blocklist_projection_failed",
  )

  const desired = await readIconoplasmExtensionBlocklistPolicy(db)
  assert.equal(saved.policy.revision, 2)
  assert.equal(desired.revision, 2)
  assert.equal(desired.published_revision, 1)
  assert.match(desired.last_projection_error, /simulated KV write failure/)
  assert.equal(JSON.parse(kv.entries.get(iconoplasmExtensionBlocklistKvKey(1))).revision, 1)

  kv.failPut = false
  const repaired = await publishIconoplasmExtensionBlocklistPolicy(db, kv)
  assert.equal(repaired.ok, true)
  assert.equal(repaired.projection.revision, 2)
  const putCount = kv.puts.length
  const idempotent = await publishIconoplasmExtensionBlocklistPolicy(db, kv)
  assert.equal(idempotent.skipped, true)
  assert.equal(kv.puts.length, putCount)
})

test("immutable projection publication refuses a valid revision ahead of D1 and a same-revision content collision", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const db = new FakeDb(
    policyRow({
      revision: 2,
      version: "ebl1-2222222222222222",
      terms: ["ARCH"],
      publishedRevision: 1,
      publishedVersion: "ebl1-1111111111111111",
    }),
  )
  const kv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(3)]: projection({
      revision: 3,
      version: "ebl1-3333333333333333",
      terms: ["AMID"],
    }),
  })

  await assert.rejects(publishIconoplasmExtensionBlocklistPolicy(db, kv), (error) => {
    assert.equal(error.code, "extension_blocklist_public_projection_ahead")
    return true
  })
  assert.equal(kv.puts.length, 0)
  assert.equal(kv.entries.has(iconoplasmExtensionBlocklistKvKey(2)), false)
  assert.equal(db.row.published_revision, 1)
  assert.equal(db.row.projection_lease_token, null)
  assert.equal((await readPublishedIconoplasmExtensionBlocklist(kv, { fresh: true })).revision, 3)

  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const collisionDb = new FakeDb(
    policyRow({
      revision: 2,
      version: "ebl1-2222222222222222",
      terms: ["ARCH"],
      publishedRevision: 1,
      publishedVersion: "ebl1-1111111111111111",
    }),
  )
  const conflictingRaw = projection({
    revision: 2,
    version: "ebl1-9999999999999999",
    terms: ["AMID"],
  })
  const collisionKv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(2)]: conflictingRaw,
  })
  await assert.rejects(
    publishIconoplasmExtensionBlocklistPolicy(collisionDb, collisionKv),
    (error) => {
      assert.equal(error.code, "extension_blocklist_projection_revision_collision")
      return true
    },
  )
  assert.equal(collisionKv.puts.length, 0)
  assert.equal(collisionKv.entries.get(iconoplasmExtensionBlocklistKvKey(2)), conflictingRaw)
})

test("an expired stale lease holder cannot hide a newer immutable projection", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const version1 = "ebl1-1111111111111111"
  const db = new FakeDb(
    policyRow({
      revision: 2,
      version: "ebl1-2222222222222222",
      terms: ["ARCH"],
      publishedRevision: 1,
      publishedVersion: version1,
    }),
  )
  const kv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version: version1,
      terms: ["AMID"],
    }),
  })
  let nestedPublication = null
  kv.onPut = async (key) => {
    if (key !== iconoplasmExtensionBlocklistKvKey(2)) return
    kv.onPut = null
    db.row.projection_lease_expires_at = "2026-08-09T00:01:00.000Z"
    await saveIconoplasmExtensionBlocklistPolicy(db, {
      terms: ["AMID"],
      expectedRevision: 2,
      actor: "newer-editor",
      now: new Date("2026-08-09T00:01:01.000Z"),
    })
    nestedPublication = await publishIconoplasmExtensionBlocklistPolicy(db, kv, {
      now: new Date("2026-08-09T00:01:01.000Z"),
    })
  }

  await assert.rejects(
    publishIconoplasmExtensionBlocklistPolicy(db, kv, {
      now: new Date("2026-08-09T00:00:00.000Z"),
    }),
    (error) => {
      assert.equal(error.code, "extension_blocklist_public_projection_ahead")
      return true
    },
  )

  assert.equal(nestedPublication?.projection?.revision, 3)
  assert.equal(db.row.revision, 3)
  assert.equal(db.row.published_revision, 3)
  assert.equal(db.row.projection_lease_token, null)
  assert.equal(kv.entries.has(iconoplasmExtensionBlocklistKvKey(2)), true)
  assert.equal((await readPublishedIconoplasmExtensionBlocklist(kv, { fresh: true })).revision, 3)
})

test("projection lease holder loops to the newest revision when a save races its KV write", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const db = new FakeDb(
    policyRow({
      publishedRevision: null,
      publishedVersion: null,
    }),
  )
  const kv = new FakeKv()
  kv.onPut = async () => {
    kv.onPut = null
    await saveIconoplasmExtensionBlocklistPolicy(db, {
      terms: ["ARCH"],
      expectedRevision: 1,
      actor: "racing-editor",
    })
  }

  const published = await publishIconoplasmExtensionBlocklistPolicy(db, kv)
  const writtenRevisions = kv.puts.map((entry) => JSON.parse(entry.value).revision)
  const finalProjection = JSON.parse(kv.entries.get(iconoplasmExtensionBlocklistKvKey(2)))

  assert.deepEqual(writtenRevisions, [1, 2])
  assert.equal(published.policy.revision, 2)
  assert.equal(published.policy.published_revision, 2)
  assert.equal(published.policy.published_version, published.policy.version)
  assert.equal(published.policy.projection_lease_token, null)
  assert.equal(finalProjection.revision, 2)
  assert.equal(finalProjection.version, published.policy.version)
  assert.deepEqual(finalProjection.terms, ["ARCH"])
})

test("scheduled reconciliation repairs stale projection and clears an expired in-sync lease", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const oldVersion = "ebl1-1111111111111111"
  const newVersion = "ebl1-2222222222222222"
  const db = new FakeDb(
    policyRow({
      revision: 2,
      version: newVersion,
      terms: ["ARCH"],
      publishedRevision: 1,
      publishedVersion: oldVersion,
      leaseToken: "expired-owner",
      leaseExpiresAt: "2026-08-09T00:00:00.000Z",
    }),
  )
  const kv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version: oldVersion,
      terms: ["AMID"],
    }),
  })
  const now = new Date("2026-08-09T03:00:00.000Z")
  const reconciled = await reconcileIconoplasmExtensionBlocklistPolicy(
    { ICONOPLASM_DB: db, KV: kv },
    { now },
  )
  assert.equal(reconciled.projection.revision, 2)
  assert.equal(db.row.projection_lease_token, null)

  kv.entries.delete(iconoplasmExtensionBlocklistKvKey(2))
  const putsBeforeMissingRepair = kv.puts.length
  const repairedMissingProjection = await reconcileIconoplasmExtensionBlocklistPolicy(
    { ICONOPLASM_DB: db, KV: kv },
    { now },
  )
  assert.equal(repairedMissingProjection.projection.revision, 2)
  assert.equal(kv.puts.length, putsBeforeMissingRepair + 1)
  assert.equal(kv.entries.has(iconoplasmExtensionBlocklistKvKey(2)), true)

  db.row.projection_lease_token = "abandoned-after-ack"
  db.row.projection_lease_expires_at = "2026-08-09T02:00:00.000Z"
  const putsBeforeCleanup = kv.puts.length
  const cleaned = await reconcileIconoplasmExtensionBlocklistPolicy(
    { ICONOPLASM_DB: db, KV: kv },
    { now },
  )
  assert.equal(cleaned.cleaned_expired_lease, true)
  assert.equal(db.row.projection_lease_token, null)
  assert.equal(kv.puts.length, putsBeforeCleanup)

  const cronSource = readFileSync(
    new URL("./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js", import.meta.url),
    "utf8",
  )
  assert.match(
    cronSource,
    /cronExpr === "\*\/15 \* \* \* \*"[\s\S]*reconcileIconoplasmExtensionBlocklistPolicy\(env\)/,
  )
})

test("scheduled reconciliation bounds immutable KV history while retaining the current revision", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const revision = ICONOPLASM_EXTENSION_BLOCKLIST_KV_RETENTION + 5
  const version = `ebl1-${String(revision).padStart(16, "0")}`
  const entries = {}
  for (let candidate = 1; candidate <= revision; candidate += 1) {
    entries[iconoplasmExtensionBlocklistKvKey(candidate)] = projection({
      revision: candidate,
      version: `ebl1-${String(candidate).padStart(16, "0")}`,
      terms: ["AMID"],
    })
  }
  const kv = new FakeKv(entries)
  const db = new FakeDb(policyRow({ revision, version, terms: ["AMID"] }))

  const result = await reconcileIconoplasmExtensionBlocklistPolicy({ ICONOPLASM_DB: db, KV: kv })

  assert.equal(result.cleanup.deleted, 5)
  assert.equal(result.cleanup.pending, 0)
  assert.equal(kv.deletes.length, 5)
  assert.equal(kv.entries.has(iconoplasmExtensionBlocklistKvKey(revision)), true)
  assert.equal(
    [...kv.entries.keys()].filter((key) => key.startsWith("iconoplasm:extension-blocklist-policy"))
      .length,
    ICONOPLASM_EXTENSION_BLOCKLIST_KV_RETENTION,
  )
})

test("admin route enforces auth, body bound, CAS, scanner validation, and identical-policy republish", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const version = "ebl1-1111111111111111"
  const db = new FakeDb(policyRow({ version }))
  const kv = new FakeKv({
    ...scannerEntries(),
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version,
      terms: ["AMID"],
    }),
  })
  const env = { ICONOPLASM_DB: db, KV: kv }
  const unauthorized = await callHandler(
    handlers(async () => false),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist"),
    new Proxy({}, { get: () => assert.fail("unauthorized request touched env") }),
  )
  assert.equal(unauthorized.status, 403)

  const getResponse = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist"),
    env,
  )
  const getPayload = await getResponse.json()
  assert.equal(getResponse.status, 200)
  assert.equal(getPayload.policy.schema_version, 1)
  assert.equal(getPayload.policy.revision, 1)
  assert.equal(getPayload.publication.in_sync, true)
  assert.equal(getPayload.limits.max_terms, 500)

  const oversized = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES + 1),
      },
      body: "{}",
    }),
    env,
  )
  assert.equal(oversized.status, 413)

  const missingRevision = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: ["AMID"] }),
    }),
    env,
  )
  assert.equal(missingRevision.status, 428)
  assert.equal((await missingRevision.json()).code, "expected_revision_required")

  const canonical = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: ["AIFM2"], expected_revision: 1 }),
    }),
    env,
  )
  assert.equal(canonical.status, 422)
  assert.equal((await canonical.json()).invalid_terms[0].reason, "canonical_symbol")

  const stale = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: ["ARCH"], expected_revision: 2 }),
    }),
    env,
  )
  const stalePayload = await stale.json()
  assert.equal(stale.status, 409)
  assert.equal(stalePayload.policy.revision, 1)
  assert.equal(stalePayload.code, "extension_blocklist_revision_conflict")
  assert.equal(Object.hasOwn(stalePayload, "projection_lease_token"), false)

  await readPublishedIconoplasmExtensionBlocklist(kv)
  kv.entries.delete(iconoplasmExtensionBlocklistKvKey(1))
  const missingProjectionStatus = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist"),
    env,
  )
  const missingProjectionPayload = await missingProjectionStatus.json()
  assert.equal(missingProjectionStatus.status, 200)
  assert.equal(missingProjectionPayload.publication.in_sync, false)
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const republished = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: ["AMID"], expected_revision: 1 }),
    }),
    env,
  )
  const republishedPayload = await republished.json()
  assert.equal(republished.status, 200)
  assert.equal(republishedPayload.changed, false)
  assert.equal(republishedPayload.republished, true)
  assert.equal(republishedPayload.publication.in_sync, true)
})

test("admin rejects an exact 500-term projection over 48 KiB before the D1 CAS", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const terms = Array.from(
    { length: 500 },
    (_, index) => `${"界".repeat(31)}-${String(index).padStart(3, "0")}`,
  )
  const body = JSON.stringify({ terms, expected_revision: 1 })
  const projected = JSON.stringify({
    schema_version: 1,
    revision: 2,
    version: "ebl1-2222222222222222",
    term_count: terms.length,
    terms,
  })
  assert.equal(terms.length, 500)
  assert.ok(new TextEncoder().encode(body).byteLength < ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES)
  assert.ok(
    new TextEncoder().encode(projected).byteLength >
      ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES,
  )

  const hash = "scannerlargefixture"
  const genes = Object.fromEntries(
    terms.map((term, index) => [`GENE${String(index).padStart(3, "0")}`, { a: [term] }]),
  )
  const version = "ebl1-1111111111111111"
  const db = new FakeDb(policyRow({ version }))
  const kv = new FakeKv({
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      scanner_artifact: { build_version: hash },
    }),
    [`iconoplasm:scanner-catalog:${hash}`]: JSON.stringify({ schema_version: 1, genes }),
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version,
      terms: ["AMID"],
    }),
  })
  const response = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { ICONOPLASM_DB: db, KV: kv },
  )
  const payload = await response.json()

  assert.equal(response.status, 422)
  assert.equal(payload.code, "extension_blocklist_projection_too_large")
  assert.equal(Object.hasOwn(payload, "saved"), false)
  assert.equal(Object.hasOwn(payload, "policy_saved"), false)
  assert.equal(db.row.revision, 1)
  assert.equal(db.history.length, 0)
  assert.equal(kv.puts.length, 0)
})

test("admin distinguishes pre-save scanner failure from post-save publication busy", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const version = "ebl1-1111111111111111"
  const unavailableDb = new FakeDb(policyRow({ version }))
  const unavailableKv = new FakeKv({
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version,
      terms: ["AMID"],
    }),
  })
  const request = () =>
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: ["ARCH"], expected_revision: 1 }),
    })
  const unavailable = await callHandler(handlers(), request(), {
    ICONOPLASM_DB: unavailableDb,
    KV: unavailableKv,
  })
  const unavailablePayload = await unavailable.json()
  assert.equal(unavailable.status, 503)
  assert.equal(unavailablePayload.code, "published_scanner_unavailable")
  assert.equal(Object.hasOwn(unavailablePayload, "saved"), false)
  assert.equal(Object.hasOwn(unavailablePayload, "policy_saved"), false)
  assert.equal(unavailableDb.row.revision, 1)
  assert.equal(unavailableDb.history.length, 0)
  assert.equal(unavailableKv.puts.length, 0)

  const busyDb = new FakeDb(
    policyRow({
      version,
      leaseToken: "active-publisher",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    }),
  )
  const busyKv = new FakeKv({
    ...scannerEntries(),
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version,
      terms: ["AMID"],
    }),
  })
  const busy = await callHandler(handlers(), request(), {
    ICONOPLASM_DB: busyDb,
    KV: busyKv,
  })
  const busyPayload = await busy.json()
  assert.equal(busy.status, 503)
  assert.equal(busyPayload.code, "extension_blocklist_projection_busy")
  assert.equal(busyPayload.saved, true)
  assert.equal(busyPayload.policy_saved, true)
  assert.equal(busyPayload.changed, true)
  assert.equal(busyDb.row.revision, 2)
})

test("admin mutation admission blocks CSRF before D1 or KV and allows trusted browser and token requests", async () => {
  let authChecks = 0
  const trustedAdmin = async (request) => {
    authChecks += 1
    return (
      String(request.headers.get("Cookie") || "").includes("session=admin") ||
      request.headers.get("x-iconoplasm-admin-token") === "founder-secret"
    )
  }
  const handler = handlers(trustedAdmin)
  const internalUrl =
    "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/extension-blocklist"
  const blockedCases = [
    {
      expectedCode: "cross_site_request_forbidden",
      headers: {
        "Content-Type": "text/plain",
        Cookie: "session=admin",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
    },
    {
      expectedCode: "untrusted_origin",
      headers: {
        "Content-Type": "application/json",
        Cookie: "session=admin",
        Origin: "https://brinedew.bio.evil.example",
      },
    },
    {
      expectedCode: "application_json_required",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Cookie: "session=admin",
        Origin: "https://iconoplasm.brinedew.bio",
        "Sec-Fetch-Site": "same-origin",
      },
    },
  ]

  for (const blockedCase of blockedCases) {
    let bindingReads = 0
    const blockedEnv = {}
    Object.defineProperties(blockedEnv, {
      ICONOPLASM_DB: {
        get() {
          bindingReads += 1
          throw new Error("blocked request touched D1")
        },
      },
      KV: {
        get() {
          bindingReads += 1
          throw new Error("blocked request touched KV")
        },
      },
    })
    const response = await callHandler(
      handler,
      new Request(internalUrl, {
        method: "POST",
        headers: blockedCase.headers,
        body: JSON.stringify({ terms: ["AMID"], expected_revision: 1 }),
      }),
      blockedEnv,
    )
    const payload = await response.json()
    assert.equal(response.status, blockedCase.expectedCode === "application_json_required" ? 415 : 403)
    assert.equal(payload.code, blockedCase.expectedCode)
    assert.equal(bindingReads, 0)
    assert.equal(authChecks, 0)
  }

  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const version = "ebl1-1111111111111111"
  const db = new FakeDb(policyRow({ version }))
  const kv = new FakeKv({
    ...scannerEntries(),
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version,
      terms: ["AMID"],
    }),
  })
  const env = { ICONOPLASM_DB: db, KV: kv }
  const body = JSON.stringify({ terms: ["AMID"], expected_revision: 1 })
  const sameOriginCookie = await callHandler(
    handler,
    new Request(internalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Cookie: "session=admin",
        Origin: "https://iconoplasm.brinedew.bio",
        "Sec-Fetch-Site": "same-origin",
      },
      body,
    }),
    env,
  )
  assert.equal(sameOriginCookie.status, 200)

  const originlessToken = await callHandler(
    handler,
    new Request(internalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iconoplasm-admin-token": "founder-secret",
      },
      body,
    }),
    env,
  )
  assert.equal(originlessToken.status, 200)
})

test("admin route returns the newer saved policy when KV projection fails", async () => {
  resetIconoplasmExtensionBlocklistPublicCacheForTests()
  const version = "ebl1-1111111111111111"
  const db = new FakeDb(policyRow({ version }))
  const kv = new FakeKv({
    ...scannerEntries(),
    [iconoplasmExtensionBlocklistKvKey(1)]: projection({
      revision: 1,
      version,
      terms: ["AMID"],
    }),
  })
  kv.failPut = true
  const response = await callHandler(
    handlers(),
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/extension-blocklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: ["ARCH"], expected_revision: 1 }),
    }),
    { ICONOPLASM_DB: db, KV: kv },
  )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload.saved, true)
  assert.equal(payload.policy_saved, true)
  assert.equal(payload.policy.revision, 2)
  assert.equal(payload.policy.terms[0], "ARCH")
  assert.equal(payload.publication.in_sync, false)
  assert.equal(JSON.parse(kv.entries.get(iconoplasmExtensionBlocklistKvKey(1))).revision, 1)
})
