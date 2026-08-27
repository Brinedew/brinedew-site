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
  validateIconoplasmPublicationAliasesAgainstPublishedScanner,
  validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex,
  validateIconoplasmRequiredAliasTermsAgainstPublishedIndex,
} from "./iconoplasm-publication-alias-policy.js"
import { buildIconoplasmPublishedAliasRecognitionContext } from "./iconoplasm-publication-aliases.js"

await import("../iconoplasm-extension/publication-alias-overlay.js")
await import("../iconoplasm-extension/content-matcher.js")

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

test("incremental alias validation agrees with full validation and the matcher on casing", async (t) => {
  const scannerVersion = "case-sensitive-scanner"
  const genes = {
    CDK1: { a: ["Cdc2"] },
    OTHER: {},
    NOLC1: { a: ["P130"] },
    RBL2: {},
  }
  const index = buildIconoplasmRecognitionValidationIndex(genes, { scannerVersion })
  const entries = Object.fromEntries(index.shards.map((shard) => [shard.key, shard.value]))
  entries[index.manifestKey] = index.manifestValue
  const scannerContext = {
    scanner_version: scannerVersion,
    ...buildIconoplasmPublishedAliasRecognitionContext(genes),
  }
  const baselinePolicy = { by_symbol: { CDK1: ["Cdk1"] }, remove_by_symbol: {} }
  const cases = [
    { alias: "cdk1", symbol: "CDK1", valid: true },
    { alias: "cdK1", symbol: "CDK1", valid: true },
    { alias: "cdk1", symbol: "OTHER", valid: true },
    { alias: "cdc2", symbol: "CDK1", valid: true },
    { alias: "cdc2", symbol: "OTHER", valid: true },
    { alias: "p130", symbol: "RBL2", valid: true },
    { alias: "CDK1", symbol: "OTHER", valid: false },
    { alias: "Cdc2", symbol: "OTHER", valid: false },
    { alias: "Cdc2", symbol: "CDK1", valid: false },
    { alias: "P130", symbol: "RBL2", valid: false },
  ]
  for (const { alias, symbol, valid } of cases) {
    await t.test(`${alias} to ${symbol}: ${valid ? "accepted" : "rejected"}`, async () => {
      const kv = new FakeKv(entries)
      const candidate = {
        by_symbol: {
          ...baselinePolicy.by_symbol,
          [symbol]: [...(baselinePolicy.by_symbol[symbol] || []), alias],
        },
        remove_by_symbol: {},
      }
      const full = validateIconoplasmPublicationAliasesAgainstPublishedScanner(
        kv,
        candidate.by_symbol,
        candidate.remove_by_symbol,
        { baselinePolicy, requiredAliasTerms: [], scannerContext },
      )
      const incremental = validateIconoplasmPublicationAliasesIncrementallyAgainstPublishedIndex(
        kv,
        candidate,
        { baselinePolicy, requiredAliasTerms: [], scannerVersion },
      )
      const results = await Promise.allSettled([full, incremental])
      assert.equal(results[0].status, valid ? "fulfilled" : "rejected", "full validator")
      assert.equal(results[1].status, results[0].status, "incremental must match full validator")
      assert.ok(kv.gets.length <= 4, `bounded index reads: ${kv.gets.length}`)
      assert.equal(
        kv.gets.some((key) => key.startsWith("iconoplasm:scanner-catalog:")),
        false,
      )
      if (valid) {
        assert.deepEqual(results[1].value.by_symbol, results[0].value.by_symbol)
        const overlay = globalThis.IconoplasmPublicationAliasOverlay.normalizePublishedAliasOverlay(
          results[1].value,
        )
        const applied = globalThis.IconoplasmPublicationAliasOverlay.applyPublishedAliasOverlay(
          structuredClone(genes),
          overlay,
        )
        assert.deepEqual(applied.errors, [])
        const matcher = globalThis.IconoplasmContentMatcher.createGeneMatcher(applied.genes)
        assert.deepEqual(
          matcher.findMatches(`before ${alias} after`).map((match) => match.symbol),
          [symbol],
        )
        assert.deepEqual(
          matcher.findMatches("before CDK1 after").map((match) => match.symbol),
          ["CDK1"],
        )
        assert.deepEqual(
          matcher.findMatches("before Cdk1 after").map((match) => match.symbol),
          ["CDK1"],
        )
      }
    })
  }
})
