// ARCHITECTURE FENCE [IPD-008]: keep the live recognition-pair verifier strict,
// repository-independent, batched, and safe for owner-scoped alias retractions.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildExpectedBlocklistOperations,
  buildExpectedAliasOperations,
  expectedExtensionBlocklistVersion,
  expectedPublicationAliasVersion,
  MAX_PUBLICATION_ALIAS_BYTES,
  PUBLIC_RESOLVE_BATCH_LIMIT,
  resolutionMismatches,
  validateExtensionBlocklistProjection,
  validatePublicationAliasOverlay,
  verifyPublishedAliasState,
} from "./verify-iconoplasm-publication-aliases.mjs"

function signedOverlay({ bySymbol, removeBySymbol = {} }) {
  const aliasCount = Object.values(bySymbol).reduce((total, aliases) => total + aliases.length, 0)
  const removalCount = Object.values(removeBySymbol).reduce(
    (total, aliases) => total + aliases.length,
    0,
  )
  const body = {
    schema_version: 1,
    alias_count: aliasCount,
    removal_count: removalCount,
    by_symbol: bySymbol,
    remove_by_symbol: removeBySymbol,
  }
  return {
    ...body,
    version: expectedPublicationAliasVersion(body),
  }
}

function signedBlocklist(terms = ["AMID"], revision = 1) {
  return {
    schema_version: 1,
    revision,
    version: expectedExtensionBlocklistVersion(terms),
    term_count: terms.length,
    terms,
  }
}

test("manifest alias validation checks the stable v1 content hash and normalizes symbol order", () => {
  const overlay = signedOverlay({
    bySymbol: { RELA: ["p65"], CXCL8: ["IL8"] },
    removeBySymbol: { CDH17: ["cadherin"] },
  })
  const validated = validatePublicationAliasOverlay(overlay)
  const independentlyHashed = createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 1,
        alias_count: 2,
        removal_count: 1,
        by_symbol: { CXCL8: ["IL8"], RELA: ["p65"] },
        remove_by_symbol: { CDH17: ["cadherin"] },
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 16)

  assert.equal(validated.overlay.version, `v1-${independentlyHashed}`)
  assert.deepEqual(Object.keys(validated.overlay.by_symbol), ["CXCL8", "RELA"])
  assert.equal(validated.overlayBytes, Buffer.byteLength(JSON.stringify(overlay), "utf8"))
})

test("manifest alias validation rejects malformed counts, hashes, ambiguity, conflicts, and size", () => {
  const valid = signedOverlay({ bySymbol: { CXCL8: ["IL8"] } })
  assert.throws(
    () => validatePublicationAliasOverlay({ ...valid, alias_count: 2 }),
    /alias_count.*counted 1/,
  )
  assert.throws(
    () => validatePublicationAliasOverlay({ ...valid, version: "v1-0000000000000000" }),
    /content hashes to/,
  )
  assert.throws(
    () => validatePublicationAliasOverlay({ ...valid, revision: 2 }),
    /fields must be exactly.*received.*revision/,
  )
  assert.throws(
    () => validatePublicationAliasOverlay({ ...valid, updated_at: "2026-08-11T00:00:00Z" }),
    /fields must be exactly.*updated_at/,
  )
  assert.throws(
    () =>
      validatePublicationAliasOverlay(
        signedOverlay({ bySymbol: { CXCL8: ["IL8"], RELA: ["il8"] } }),
      ),
    /ambiguous between CXCL8 and RELA/,
  )
  assert.throws(
    () =>
      validatePublicationAliasOverlay(
        signedOverlay({
          bySymbol: { CXCL8: ["IL8"] },
          removeBySymbol: { CXCL8: ["il8"] },
        }),
      ),
    /cannot be added and removed/,
  )
  assert.throws(
    () => validatePublicationAliasOverlay(signedOverlay({ bySymbol: { CXCL8: ["IL\u00008"] } })),
    /contains invalid alias/,
  )

  const oversized = signedOverlay({
    bySymbol: {
      TP53: Array.from(
        { length: 160 },
        (_, index) => `ALIAS-${index.toString(36).toUpperCase()}-${"X".repeat(24)}`,
      ),
    },
  })
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), "utf8") >= MAX_PUBLICATION_ALIAS_BYTES)
  assert.throws(() => validatePublicationAliasOverlay(oversized), /expected less than 4096/)
})

test("manifest blocklist validation requires the exact nonempty hashed public projection", () => {
  const projection = signedBlocklist(["AMID", "P53"], 7)
  assert.deepEqual(validateExtensionBlocklistProjection(projection), projection)
  assert.throws(
    () => validateExtensionBlocklistProjection({ ...projection, depends_on_alias_revision: 3 }),
    /fields must be exactly/,
  )
  assert.throws(
    () => validateExtensionBlocklistProjection({ ...projection, revision: 0 }),
    /positive integer/,
  )
  assert.throws(() => validateExtensionBlocklistProjection(signedBlocklist([])), /non-empty array/)
  assert.throws(
    () => validateExtensionBlocklistProjection({ ...projection, term_count: 1 }),
    /term_count.*counted 2/,
  )
  assert.throws(
    () => validateExtensionBlocklistProjection({ ...projection, terms: ["P53", "AMID"] }),
    /terms must be sorted/,
  )
  assert.throws(
    () => validateExtensionBlocklistProjection({ ...projection, terms: ["AMID", "AMID"] }),
    /repeats term/,
  )
  assert.throws(
    () => validateExtensionBlocklistProjection({ ...projection, version: "ebl1-0000000000000000" }),
    /content hashes to/,
  )
})

test("blocklist resolver checks require a distinct canonical alias owner", () => {
  const expected = buildExpectedBlocklistOperations(signedBlocklist(["IL8"]))
  assert.deepEqual(
    resolutionMismatches(
      { results: [{ requested: "IL8", canonical_symbol: "CXCL8", found: true }] },
      expected,
    ),
    [],
  )
  assert.match(
    resolutionMismatches(
      { results: [{ requested: "IL8", canonical_symbol: "IL8", found: true }] },
      expected,
    )[0],
    /expected one non-canonical alias owner/,
  )
  assert.match(
    resolutionMismatches(
      { results: [{ requested: "IL8", canonical_symbol: null, found: false }] },
      expected,
    )[0],
    /expected one non-canonical alias owner/,
  )
})

test("owner-scoped retractions reject the removed owner but allow unresolved or reassigned labels", () => {
  const overlay = validatePublicationAliasOverlay(
    signedOverlay({
      bySymbol: { CDH1: ["Cadherin"], CXCL8: ["IL8"] },
      removeBySymbol: { CDH17: ["cadherin"], RELA: ["NFKB3"] },
    }),
  ).overlay
  const expected = buildExpectedAliasOperations(overlay)

  assert.deepEqual(expected.removals, [
    {
      alias: "cadherin",
      kind: "removal",
      policySymbol: "CDH17",
    },
    {
      alias: "NFKB3",
      kind: "removal",
      policySymbol: "RELA",
    },
  ])
  assert.deepEqual(
    resolutionMismatches(
      {
        results: [
          { requested: "cadherin", canonical_symbol: "CDH1", found: true },
          { requested: "NFKB3", canonical_symbol: null, found: false },
        ],
      },
      expected.removals,
    ),
    [],
  )
  const stillOwned = resolutionMismatches(
    {
      results: [
        { requested: "cadherin", canonical_symbol: "CDH17", found: true },
        { requested: "NFKB3", canonical_symbol: null, found: false },
      ],
    },
    expected.removals,
  )
  assert.equal(stillOwned.length, 1)
  assert.match(stillOwned[0], /expected no resolution to CDH17/)
  assert.equal(
    resolutionMismatches(
      { results: [{ requested: "Cadherin", canonical_symbol: "CDH1", found: 1 }] },
      expected.additions.slice(0, 1),
    ).length,
    1,
  )
  assert.equal(
    resolutionMismatches(
      {
        results: [
          { requested: "cadherin", canonical_symbol: "CDH1", found: 1 },
          { requested: "NFKB3", canonical_symbol: null },
        ],
      },
      expected.removals,
    ).length,
    2,
  )
})

test("live verification retries invalid manifests and inconsistent resolver batches", async () => {
  const aliases = Array.from(
    { length: PUBLIC_RESOLVE_BATCH_LIMIT },
    (_, index) => `X${index.toString(36).toUpperCase()}`,
  )
  const overlay = signedOverlay({
    bySymbol: { TP53: aliases },
    removeBySymbol: { RELA: ["LEGACY"] },
  })
  const invalidOverlay = { ...overlay, version: "v1-0000000000000000" }
  const blocklist = signedBlocklist([aliases[0]])
  const resolverBatchSizes = []
  let manifestCalls = 0
  let resolverCalls = 0
  let sleepCalls = 0

  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(String(rawUrl))
    if (url.pathname.endsWith("/catalog/manifest")) {
      manifestCalls += 1
      return Response.json(
        {
          publication_aliases: manifestCalls === 1 ? invalidOverlay : overlay,
          extension_blocklist: blocklist,
        },
        { headers: { ETag: '"manifest-aliases-v1"' } },
      )
    }
    if (url.pathname.endsWith("/resolve")) {
      resolverCalls += 1
      const identifiers = JSON.parse(String(options.body || "{}"))?.identifiers || []
      resolverBatchSizes.push(identifiers.length)
      const firstAttempt = resolverCalls <= 2
      return Response.json({
        results: identifiers.map((requested) => ({
          requested,
          canonical_symbol: requested === "LEGACY" || firstAttempt ? null : "TP53",
          matched_by: requested === "LEGACY" || firstAttempt ? null : "alias",
          found: requested !== "LEGACY" && !firstAttempt,
        })),
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  const result = await verifyPublishedAliasState({
    baseUrl: "https://iconoplasm.example",
    fetchImpl,
    sleep: async () => {
      sleepCalls += 1
    },
    maxAttempts: 3,
    retryDelayMs: 0,
    requestTimeoutMs: 1_000,
    now: () => 1234,
  })

  assert.equal(result.ok, true)
  assert.equal(result.alias_count, PUBLIC_RESOLVE_BATCH_LIMIT)
  assert.equal(result.removal_count, 1)
  assert.equal(result.resolved_count, PUBLIC_RESOLVE_BATCH_LIMIT)
  assert.equal(result.removed_mapping_count, 1)
  assert.equal(result.extension_blocklist_revision, 1)
  assert.equal(result.extension_blocklist_version, blocklist.version)
  assert.equal(result.extension_blocklist_term_count, 1)
  assert.equal(result.blocklist_resolved_count, 1)
  assert.equal(result.manifest_attempts, 2)
  assert.equal(result.resolution_attempts, 2)
  assert.equal(result.manifest_etag, '"manifest-aliases-v1"')
  assert.deepEqual(resolverBatchSizes, [
    PUBLIC_RESOLVE_BATCH_LIMIT,
    2,
    PUBLIC_RESOLVE_BATCH_LIMIT,
    2,
  ])
  assert.equal(sleepCalls, 2)
})

test("the live verifier has no repository-owned alias dictionary dependency", () => {
  const source = readFileSync("scripts/verify-iconoplasm-publication-aliases.mjs", "utf8")
  assert.doesNotMatch(source, /iconoplasmPublicationAliasManifest/)
  assert.doesNotMatch(source, /workers\/iconoplasm-publication-aliases/)
})
