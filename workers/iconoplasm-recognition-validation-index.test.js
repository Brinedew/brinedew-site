import assert from "node:assert/strict"
import test from "node:test"

// ARCHITECTURE FENCE [IPD-008]: a foreground recognition mutation reads only
// immutable lookup shards touched by the change, never the full scanner.
import {
  buildIconoplasmRecognitionValidationIndex,
  iconoplasmRecognitionIndexCanonicalKey,
  iconoplasmRecognitionIndexCollisionKey,
  readIconoplasmRecognitionValidationIndexRecords,
} from "./iconoplasm-recognition-validation-index.js"
import {
  validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex,
  validateIconoplasmRequiredAliasTermsAgainstPublishedIndex,
} from "./iconoplasm-publication-alias-policy.js"

class FakeKv {
  constructor(entries) {
    this.entries = new Map(Object.entries(entries))
    this.gets = []
  }

  async get(key) {
    this.gets.push(key)
    return this.entries.get(key) ?? null
  }
}

function fixture() {
  const scannerVersion = "scanner-v1"
  const genes = {
    APC: {},
    CCNP: {},
    CDH17: { a: ["cadherin"] },
    OTHER: { a: ["cyclin Q"] },
  }
  const index = buildIconoplasmRecognitionValidationIndex(genes, { scannerVersion })
  const entries = Object.fromEntries(index.shards.map((shard) => [shard.key, shard.value]))
  entries[index.manifestKey] = index.manifestValue
  return { scannerVersion, index, kv: new FakeKv(entries) }
}

test("recognition index targets only the shards touched by a lookup", async () => {
  const { scannerVersion, kv } = fixture()
  const keys = [
    iconoplasmRecognitionIndexCanonicalKey("CCNP"),
    iconoplasmRecognitionIndexCollisionKey("cyclin P"),
  ]
  const records = await readIconoplasmRecognitionValidationIndexRecords(kv, scannerVersion, keys)
  assert.equal(records.get(keys[0]), 1)
  assert.equal(records.get(keys[1]), null)
  assert.ok(kv.gets.length <= 3, `expected manifest plus at most two shards, got ${kv.gets.length}`)
  assert.equal(
    kv.gets.some((key) => key.startsWith("iconoplasm:scanner-catalog:")),
    false,
  )
})

test("cyclin P to CCNP validates from bounded lookup shards without a scanner read", async () => {
  const { scannerVersion, kv } = fixture()
  const baselinePolicy = {
    schema_version: 1,
    alias_count: 0,
    removal_count: 0,
    version: "v1-empty",
    by_symbol: {},
    remove_by_symbol: {},
  }
  const candidate = {
    by_symbol: { CCNP: ["cyclin P"] },
    remove_by_symbol: {},
  }
  const validated = await validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex(
    kv,
    candidate,
    { baselinePolicy, requiredAliasTerms: ["APC/C"], scannerVersion },
  )
  assert.deepEqual(validated.by_symbol, { CCNP: ["cyclin P"] })
  assert.equal(
    kv.gets.some((key) => key.startsWith("iconoplasm:scanner-catalog:")),
    false,
  )
  assert.ok(
    kv.gets.length <= 4,
    `expected one manifest and at most three shards, got ${kv.gets.length}`,
  )
})

test("targeted validation rejects generated collisions and preserves protected phrases", async () => {
  const { scannerVersion, kv } = fixture()
  await assert.rejects(
    validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex(
      kv,
      { by_symbol: { CCNP: ["cyclin Q"] }, remove_by_symbol: {} },
      {
        baselinePolicy: { by_symbol: {}, remove_by_symbol: {} },
        requiredAliasTerms: [],
        scannerVersion,
      },
    ),
    (error) =>
      error.status === 422 && error.details.invalid_operations[0].reason === "owned_by_other_gene",
  )
  assert.deepEqual(
    await validateIconoplasmRequiredAliasTermsAgainstPublishedIndex(
      kv,
      { by_symbol: {}, remove_by_symbol: {} },
      ["APC/C"],
      { scannerVersion },
    ),
    ["APC/C"],
  )
})

test("missing or incomplete recognition index fails loud instead of rebuilding the scanner", async () => {
  const kv = new FakeKv({})
  await assert.rejects(
    readIconoplasmRecognitionValidationIndexRecords(kv, "scanner-v1", ["s:CCNP"]),
    (error) => error.code === "published_recognition_index_unavailable" && error.status === 503,
  )
  assert.equal(
    kv.gets.some((key) => key.startsWith("iconoplasm:scanner-catalog:")),
    false,
  )
})
