// ARCHITECTURE FENCE [IPD-008]: production verification must prove the exact
// atomic public alias + blocklist recognition pair and every resolver invariant.
import { createHash } from "node:crypto"
import { resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"

import extensionManifest from "../iconoplasm-extension/manifest.json" with { type: "json" }

const DEFAULT_PUBLIC_BASE_URL = "https://iconoplasm.brinedew.bio"
const EXTENSION_VERSION = String(extensionManifest.version || "").trim()

export const PUBLICATION_ALIAS_SCHEMA_VERSION = 1
export const MAX_PUBLICATION_ALIAS_OPERATIONS = 500
export const MAX_PUBLICATION_ALIAS_LENGTH = 64
export const MAX_PUBLICATION_ALIAS_BYTES = 4 * 1024
export const EXTENSION_BLOCKLIST_SCHEMA_VERSION = 1
export const MAX_EXTENSION_BLOCKLIST_TERMS = 500
export const MAX_EXTENSION_BLOCKLIST_TERM_LENGTH = 64
export const PUBLIC_RESOLVE_BATCH_LIMIT = 250
export const DEFAULT_MAX_ATTEMPTS = 6
export const DEFAULT_RETRY_DELAY_MS = 10_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

const UNICODE_DASH_RE = /[\u2010-\u2015\u2212]/g
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u
const VERSION_RE = /^v1-[a-f0-9]{16}$/
const EXTENSION_BLOCKLIST_VERSION_RE = /^ebl1-[a-f0-9]{16}$/
const PUBLICATION_ALIAS_FIELDS = Object.freeze([
  "alias_count",
  "by_symbol",
  "removal_count",
  "remove_by_symbol",
  "schema_version",
  "version",
])
const EXTENSION_BLOCKLIST_FIELDS = Object.freeze([
  "revision",
  "schema_version",
  "term_count",
  "terms",
  "version",
])

export class PublicationAliasVerificationError extends Error {
  constructor(message) {
    super(`[verify-iconoplasm-publication-aliases] ${message}`)
    this.name = "PublicationAliasVerificationError"
  }
}

function fail(message) {
  throw new PublicationAliasVerificationError(message)
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
}

function normalizeAlias(value) {
  const alias = String(value || "")
    .trim()
    .replace(UNICODE_DASH_RE, "-")
    .replace(/\s+/g, " ")
  if (!alias || alias.length > MAX_PUBLICATION_ALIAS_LENGTH) return ""
  if (CONTROL_CHARACTER_RE.test(alias)) return ""
  if (!/[A-Za-z\u0370-\u03ff]/u.test(alias)) return ""
  return alias
}

export function publicationAliasCollisionKey(value) {
  return normalizeAlias(value)
}

function sortedDictionary(rawDictionary) {
  return Object.fromEntries(
    Object.keys(rawDictionary)
      .sort()
      .map((symbol) => [symbol, [...rawDictionary[symbol]]]),
  )
}

export function publicationAliasVersionPayload(overlay) {
  return {
    schema_version: Number(overlay?.schema_version),
    alias_count: Number(overlay?.alias_count),
    removal_count: Number(overlay?.removal_count),
    by_symbol: sortedDictionary(overlay?.by_symbol || {}),
    remove_by_symbol: sortedDictionary(overlay?.remove_by_symbol || {}),
  }
}

export function expectedPublicationAliasVersion(overlay) {
  const payload = publicationAliasVersionPayload(overlay)
  const digest = createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex")
  return `v${payload.schema_version}-${digest.slice(0, 16)}`
}

function normalizeExtensionBlocklistTerm(value) {
  if (typeof value !== "string") return ""
  const term = value.trim().replace(UNICODE_DASH_RE, "-").toUpperCase()
  if (!term || term.length > MAX_EXTENSION_BLOCKLIST_TERM_LENGTH) return ""
  if (CONTROL_CHARACTER_RE.test(term)) return ""
  return term
}

export function expectedExtensionBlocklistVersion(terms) {
  const digest = createHash("sha256").update(JSON.stringify(terms), "utf8").digest("hex")
  return `ebl${EXTENSION_BLOCKLIST_SCHEMA_VERSION}-${digest.slice(0, 16)}`
}

export function validateExtensionBlocklistProjection(rawProjection) {
  if (!isPlainObject(rawProjection)) fail("manifest extension_blocklist must be an object")

  const fields = Object.keys(rawProjection).sort()
  if (JSON.stringify(fields) !== JSON.stringify(EXTENSION_BLOCKLIST_FIELDS)) {
    fail(
      `manifest extension_blocklist fields must be exactly ${EXTENSION_BLOCKLIST_FIELDS.join(", ")}; received ${fields.join(", ")}`,
    )
  }
  if (rawProjection.schema_version !== EXTENSION_BLOCKLIST_SCHEMA_VERSION) {
    fail(
      `manifest extension_blocklist schema_version must be ${EXTENSION_BLOCKLIST_SCHEMA_VERSION}`,
    )
  }
  if (!Number.isSafeInteger(rawProjection.revision) || rawProjection.revision < 1) {
    fail("manifest extension_blocklist revision must be a positive integer")
  }
  if (!Array.isArray(rawProjection.terms) || rawProjection.terms.length === 0) {
    fail("manifest extension_blocklist terms must be a non-empty array")
  }
  if (rawProjection.terms.length > MAX_EXTENSION_BLOCKLIST_TERMS) {
    fail(`manifest extension_blocklist exceeds ${MAX_EXTENSION_BLOCKLIST_TERMS} terms`)
  }

  const normalizedTerms = []
  const seen = new Set()
  for (const rawTerm of rawProjection.terms) {
    const term = normalizeExtensionBlocklistTerm(rawTerm)
    if (!term || term !== rawTerm) {
      fail(`manifest extension_blocklist contains invalid term ${JSON.stringify(rawTerm)}`)
    }
    if (seen.has(term)) {
      fail(`manifest extension_blocklist repeats term ${JSON.stringify(term)}`)
    }
    seen.add(term)
    normalizedTerms.push(term)
  }
  const sortedTerms = [...normalizedTerms].sort()
  if (JSON.stringify(normalizedTerms) !== JSON.stringify(sortedTerms)) {
    fail("manifest extension_blocklist terms must be sorted")
  }
  if (
    !Number.isSafeInteger(rawProjection.term_count) ||
    rawProjection.term_count !== normalizedTerms.length
  ) {
    fail(
      `manifest extension_blocklist term_count is ${JSON.stringify(rawProjection.term_count)}; counted ${normalizedTerms.length}`,
    )
  }
  const version = String(rawProjection.version || "").trim()
  if (!EXTENSION_BLOCKLIST_VERSION_RE.test(version)) {
    fail(`manifest extension_blocklist has invalid version ${JSON.stringify(version)}`)
  }
  const expectedVersion = expectedExtensionBlocklistVersion(normalizedTerms)
  if (version !== expectedVersion) {
    fail(`manifest extension_blocklist version is ${version}; content hashes to ${expectedVersion}`)
  }

  return {
    schema_version: EXTENSION_BLOCKLIST_SCHEMA_VERSION,
    revision: rawProjection.revision,
    version,
    term_count: normalizedTerms.length,
    terms: normalizedTerms,
  }
}

function normalizedDictionary(rawDictionary, { kind, additionKeysBySymbol, aliasOwners }) {
  if (!isPlainObject(rawDictionary)) {
    fail(`publication_aliases.${kind} must be an object`)
  }

  const normalized = {}
  let count = 0
  for (const rawSymbol of Object.keys(rawDictionary).sort()) {
    const symbol = normalizeSymbol(rawSymbol)
    if (!symbol || symbol !== rawSymbol) {
      fail(`publication_aliases.${kind} has invalid canonical symbol ${JSON.stringify(rawSymbol)}`)
    }

    const rawAliases = rawDictionary[rawSymbol]
    if (!Array.isArray(rawAliases) || rawAliases.length === 0) {
      fail(`publication_aliases.${kind}.${symbol} must be a non-empty array`)
    }

    const aliases = []
    const localExactAliases = new Set()
    const localCollisionKeys = new Set()
    for (const rawAlias of rawAliases) {
      if (typeof rawAlias !== "string") {
        fail(`publication_aliases.${kind}.${symbol} contains a non-string alias`)
      }
      const alias = normalizeAlias(rawAlias)
      const collisionKey = publicationAliasCollisionKey(alias)
      if (!alias || alias !== rawAlias || !collisionKey) {
        fail(
          `publication_aliases.${kind}.${symbol} contains invalid alias ${JSON.stringify(rawAlias)}`,
        )
      }
      if (localExactAliases.has(alias)) {
        fail(`publication_aliases.${kind}.${symbol} repeats alias ${JSON.stringify(alias)}`)
      }
      if (kind === "remove_by_symbol" && localCollisionKeys.has(collisionKey)) {
        fail(
          `publication_aliases.${kind}.${symbol} repeats normalized alias ${JSON.stringify(alias)}`,
        )
      }

      if (kind === "by_symbol") {
        if (collisionKey === symbol && alias === symbol) {
          fail(`publication alias ${JSON.stringify(alias)} duplicates canonical symbol ${symbol}`)
        }
        const existingOwner = aliasOwners.get(collisionKey)
        if (existingOwner && existingOwner !== symbol) {
          fail(
            `publication alias ${JSON.stringify(alias)} is ambiguous between ${existingOwner} and ${symbol}`,
          )
        }
        aliasOwners.set(collisionKey, symbol)
      } else if (additionKeysBySymbol.get(symbol)?.has(collisionKey)) {
        fail(`publication alias ${JSON.stringify(alias)} cannot be added and removed for ${symbol}`)
      }

      localExactAliases.add(alias)
      localCollisionKeys.add(collisionKey)
      aliases.push(alias)
      count += 1
      if (count > MAX_PUBLICATION_ALIAS_OPERATIONS) {
        fail(`publication_aliases.${kind} exceeds ${MAX_PUBLICATION_ALIAS_OPERATIONS} entries`)
      }
    }
    normalized[symbol] = aliases
    if (kind === "by_symbol") additionKeysBySymbol.set(symbol, localCollisionKeys)
  }
  return { count, dictionary: normalized }
}

export function validatePublicationAliasOverlay(rawOverlay) {
  if (!isPlainObject(rawOverlay)) fail("manifest publication_aliases must be an object")

  const fields = Object.keys(rawOverlay).sort()
  if (JSON.stringify(fields) !== JSON.stringify(PUBLICATION_ALIAS_FIELDS)) {
    fail(
      `manifest publication_aliases fields must be exactly ${PUBLICATION_ALIAS_FIELDS.join(", ")}; received ${fields.join(", ")}`,
    )
  }

  let overlayBytes
  try {
    overlayBytes = Buffer.byteLength(JSON.stringify(rawOverlay), "utf8")
  } catch {
    fail("manifest publication_aliases is not JSON serializable")
  }
  if (overlayBytes >= MAX_PUBLICATION_ALIAS_BYTES) {
    fail(
      `manifest publication_aliases is ${overlayBytes} bytes; expected less than ${MAX_PUBLICATION_ALIAS_BYTES}`,
    )
  }

  if (rawOverlay.schema_version !== PUBLICATION_ALIAS_SCHEMA_VERSION) {
    fail(`manifest publication_aliases schema_version must be ${PUBLICATION_ALIAS_SCHEMA_VERSION}`)
  }
  const version = String(rawOverlay.version || "").trim()
  if (!VERSION_RE.test(version)) {
    fail(`manifest publication_aliases has invalid version ${JSON.stringify(version)}`)
  }

  const additionKeysBySymbol = new Map()
  const aliasOwners = new Map()
  const additions = normalizedDictionary(rawOverlay.by_symbol, {
    kind: "by_symbol",
    additionKeysBySymbol,
    aliasOwners,
  })
  const removals = normalizedDictionary(rawOverlay.remove_by_symbol, {
    kind: "remove_by_symbol",
    additionKeysBySymbol,
    aliasOwners,
  })
  const operationCount = additions.count + removals.count
  if (operationCount > MAX_PUBLICATION_ALIAS_OPERATIONS) {
    fail(
      `manifest publication_aliases has ${operationCount} operations; maximum is ${MAX_PUBLICATION_ALIAS_OPERATIONS}`,
    )
  }

  if (!Number.isSafeInteger(rawOverlay.alias_count) || rawOverlay.alias_count !== additions.count) {
    fail(
      `manifest publication_aliases alias_count is ${JSON.stringify(rawOverlay.alias_count)}; counted ${additions.count}`,
    )
  }
  if (
    !Number.isSafeInteger(rawOverlay.removal_count) ||
    rawOverlay.removal_count !== removals.count
  ) {
    fail(
      `manifest publication_aliases removal_count is ${JSON.stringify(rawOverlay.removal_count)}; counted ${removals.count}`,
    )
  }

  const overlay = {
    schema_version: PUBLICATION_ALIAS_SCHEMA_VERSION,
    version,
    alias_count: additions.count,
    removal_count: removals.count,
    by_symbol: additions.dictionary,
    remove_by_symbol: removals.dictionary,
  }
  const expectedVersion = expectedPublicationAliasVersion(overlay)
  if (version !== expectedVersion) {
    fail(`manifest publication_aliases version is ${version}; content hashes to ${expectedVersion}`)
  }

  return { overlay, overlayBytes }
}

export function buildExpectedAliasOperations(overlay) {
  const additions = Object.entries(overlay.by_symbol).flatMap(([symbol, aliases]) =>
    aliases.map((alias) => ({
      alias,
      expectedSymbol: symbol,
      kind: "addition",
      policySymbol: symbol,
    })),
  )
  const removals = Object.entries(overlay.remove_by_symbol).flatMap(([policySymbol, aliases]) =>
    aliases.map((alias) => ({
      alias,
      kind: "removal",
      policySymbol,
    })),
  )
  return { additions, removals, operations: [...additions, ...removals] }
}

export function buildExpectedBlocklistOperations(blocklist) {
  return blocklist.terms.map((term) => ({
    alias: term,
    kind: "blocklist",
    policySymbol: term,
  }))
}

export function resolutionMismatches(payload, expectedOperations) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  if (results.length !== expectedOperations.length) {
    return [
      `received ${results.length} results for ${expectedOperations.length} publication-alias operations`,
    ]
  }

  return expectedOperations.flatMap((expected, index) => {
    const result = results[index]
    const requestedMatches = String(result?.requested || "") === expected.alias
    const actualSymbol = String(result?.canonical_symbol || "")
    if (expected.kind === "blocklist") {
      const found = result?.found === true
      const canonicalSymbolIsValid =
        Boolean(actualSymbol) && normalizeSymbol(actualSymbol) === actualSymbol
      const unresolved = result?.found === false && !actualSymbol
      if (
        requestedMatches &&
        (unresolved || (found && canonicalSymbolIsValid && actualSymbol !== expected.alias))
      ) {
        return []
      }
      return [
        `blocklist term ${JSON.stringify(expected.alias)} expected either no exact-case resolution or one non-canonical alias owner, received ${JSON.stringify(result || null)}`,
      ]
    }
    if (expected.kind === "removal") {
      const found = result?.found
      const resultIsCoherent =
        (found === true && Boolean(actualSymbol)) || (found === false && !actualSymbol)
      const reassignedSymbolIsCanonical =
        !actualSymbol || normalizeSymbol(actualSymbol) === actualSymbol
      const retractedOwnerIsAbsent = actualSymbol !== expected.policySymbol
      if (
        requestedMatches &&
        resultIsCoherent &&
        reassignedSymbolIsCanonical &&
        retractedOwnerIsAbsent
      ) {
        return []
      }
      return [
        `removal ${JSON.stringify(expected.alias)} for ${expected.policySymbol} expected no resolution to ${expected.policySymbol}, received ${JSON.stringify(result || null)}`,
      ]
    }
    const symbolMatches = actualSymbol === expected.expectedSymbol
    const foundMatches = result?.found === true
    if (requestedMatches && symbolMatches && foundMatches) return []
    return [
      `${expected.kind} ${JSON.stringify(expected.alias)} for ${expected.policySymbol} expected ${
        expected.expectedSymbol || "no mapping"
      }, received ${JSON.stringify(result || null)}`,
    ]
  })
}

function publicBaseUrl(
  rawValue = process.env.ICONOPLASM_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
) {
  const value = String(rawValue || "").trim()
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`Invalid public base URL: ${value}`)
  }
  if (!/^https?:$/.test(url.protocol)) fail(`Unsupported public base URL: ${value}`)
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    fail(`Public base URL must be an origin without credentials, path, query, or hash: ${value}`)
  }
  return url
}

function extensionHeaders(extra = {}) {
  return {
    "X-Iconoplasm-Extension-Version": EXTENSION_VERSION,
    ...extra,
  }
}

async function fetchJson(
  url,
  options = {},
  { fetchImpl = fetch, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) {
  const response = await fetchImpl(url, {
    ...options,
    headers: extensionHeaders(options.headers),
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  const bodyText = await response.text()
  let payload
  try {
    payload = JSON.parse(bodyText)
  } catch {
    fail(`${url} returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok) {
    fail(`${url} returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`)
  }
  return { payload, response }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPublishedOverlay(
  baseUrl,
  { fetchImpl, sleep, maxAttempts, retryDelayMs, requestTimeoutMs, now },
) {
  const manifestUrl = new URL("/api/public/v1/catalog/manifest", baseUrl)
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      manifestUrl.searchParams.set("publication_alias_verify", `${now()}-${attempt}`)
      const { payload, response } = await fetchJson(
        manifestUrl,
        {},
        { fetchImpl, requestTimeoutMs },
      )
      const validated = validatePublicationAliasOverlay(payload?.publication_aliases)
      const blocklist = validateExtensionBlocklistProjection(payload?.extension_blocklist)
      return {
        ...validated,
        blocklist,
        attempts: attempt,
        etag: response.headers.get("etag") || "",
        manifestUrl: manifestUrl.toString(),
      }
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) await sleep(retryDelayMs)
    }
  }

  fail(
    `live manifest did not expose valid recognition-policy payloads after ${maxAttempts} attempts: ${String(
      lastError?.message || lastError || "unknown error",
    )}`,
  )
}

function operationBatches(operations) {
  const batches = []
  for (let offset = 0; offset < operations.length; offset += PUBLIC_RESOLVE_BATCH_LIMIT) {
    batches.push(operations.slice(offset, offset + PUBLIC_RESOLVE_BATCH_LIMIT))
  }
  return batches
}

function boundedMismatchSummary(mismatches) {
  const visible = mismatches.slice(0, 20)
  const omitted = Math.max(0, mismatches.length - visible.length)
  return `${visible.join("; ")}${omitted ? `; plus ${omitted} more mismatches` : ""}`
}

async function waitForResolution(
  baseUrl,
  expectedOperations,
  { fetchImpl, sleep, maxAttempts, retryDelayMs, requestTimeoutMs },
) {
  if (expectedOperations.length === 0) return { attempts: 0 }

  const resolveUrl = new URL("/api/public/v1/resolve", baseUrl)
  let lastMismatches = []
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const mismatches = []
      for (const batch of operationBatches(expectedOperations)) {
        const { payload } = await fetchJson(
          resolveUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifiers: batch.map(({ alias }) => alias) }),
          },
          { fetchImpl, requestTimeoutMs },
        )
        mismatches.push(...resolutionMismatches(payload, batch))
      }
      if (mismatches.length === 0) return { attempts: attempt }
      lastMismatches = mismatches
      lastError = null
    } catch (error) {
      lastError = error
      lastMismatches = []
    }
    if (attempt < maxAttempts) await sleep(retryDelayMs)
  }

  if (lastError) {
    fail(
      `live resolver could not verify publication aliases after ${maxAttempts} attempts: ${String(
        lastError?.message || lastError,
      )}`,
    )
  }
  fail(
    `live resolver remained inconsistent after ${maxAttempts} attempts: ${boundedMismatchSummary(
      lastMismatches,
    )}`,
  )
}

export async function verifyPublishedAliasState({
  baseUrl: rawBaseUrl,
  fetchImpl = fetch,
  sleep = delay,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    fail("maxAttempts must be a positive integer")
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    fail("retryDelayMs must be a non-negative number")
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    fail("requestTimeoutMs must be a positive number")
  }

  const baseUrl = publicBaseUrl(rawBaseUrl)
  const published = await waitForPublishedOverlay(baseUrl, {
    fetchImpl,
    sleep,
    maxAttempts,
    retryDelayMs,
    requestTimeoutMs,
    now,
  })
  const expected = buildExpectedAliasOperations(published.overlay)
  const blocklistOperations = buildExpectedBlocklistOperations(published.blocklist)
  const resolution = await waitForResolution(
    baseUrl,
    [...expected.operations, ...blocklistOperations],
    {
      fetchImpl,
      sleep,
      maxAttempts,
      retryDelayMs,
      requestTimeoutMs,
    },
  )

  return {
    ok: true,
    base_url: baseUrl.toString(),
    overlay_version: published.overlay.version,
    alias_count: published.overlay.alias_count,
    removal_count: published.overlay.removal_count,
    overlay_bytes: published.overlayBytes,
    resolved_count: expected.additions.length,
    removed_mapping_count: expected.removals.length,
    extension_blocklist_revision: published.blocklist.revision,
    extension_blocklist_version: published.blocklist.version,
    extension_blocklist_term_count: published.blocklist.term_count,
    blocklist_resolved_count: blocklistOperations.length,
    manifest_etag: published.etag,
    manifest_attempts: published.attempts,
    resolution_attempts: resolution.attempts,
  }
}

async function runCli() {
  const result = await verifyPublishedAliasState()
  console.log(JSON.stringify(result, null, 2))
}

const entryPath = process.argv[1] ? pathToFileURL(resolvePath(process.argv[1])).href : ""
if (entryPath === import.meta.url) {
  runCli().catch((error) => {
    console.error(String(error?.stack || error))
    process.exitCode = 1
  })
}
