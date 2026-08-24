import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { readIconoplasmPublisherAuthority } from "../scripts/lib/iconoplasm-publisher-authority.mjs"
import { iconoplasmExtensionBlocklistKvKey } from "./iconoplasm-extension-blocklist-policy.js"
import {
  iconoplasmGeneBlotFingerprint,
  iconoplasmGeneBlotObjectKey,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
import {
  ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  iconoplasmPublicationAliasManifestFromPolicy,
} from "./iconoplasm-publication-aliases.js"
import { iconoplasmPublicationAliasKvKey } from "./iconoplasm-publication-alias-policy.js"
import { iconoplasmRecognitionPairKvKey } from "./iconoplasm-recognition-policy-reconciliation.js"
import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  buildPublishedScannerArtifact,
  materializePublishedCompatibilityArtifact,
  mergePublishedPortraitRefsIntoArtifact,
  projectPublishedCompatibilityArtifact,
  publishedCatalogContractForClientVersion,
  readIconoplasmPublishedCardCatalogArtifactForTest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// ARCHITECTURE FENCE [IPD-008]: public hover batches project card artifacts without D1.

const publisherRelease = readIconoplasmPublisherAuthority(
  fileURLToPath(new URL("..", import.meta.url)),
)
const candidateContract = {
  schemaVersion: Number(publisherRelease.candidate.catalog_schema_version),
  revision: Number(publisherRelease.candidate.catalog_contract_revision),
}
const currentArtifactToken = `a${candidateContract.schemaVersion}c${candidateContract.revision}`
const scannerContract = {
  schemaVersion: Number(publisherRelease.candidate.scanner_schema_version),
  revision: Number(publisherRelease.candidate.scanner_contract_revision),
}
const amidBlocklistVersion = `ebl1-${createHash("sha256")
  .update(JSON.stringify(["AMID"]))
  .digest("hex")
  .slice(0, 16)}`

function expectedPublishedContract(version, contract) {
  const schemaVersion = Number(contract.schema_version)
  const revision = Number(contract.revision)
  return {
    version,
    schemaVersion,
    revision,
    token: `a${schemaVersion}p${String(version).replace(/\D/g, "")}c${revision}`,
  }
}

test("published browser versions resolve through the inspectable authority contract", () => {
  assert.deepEqual(
    publishedCatalogContractForClientVersion(publisherRelease.version),
    expectedPublishedContract(publisherRelease.version, {
      schema_version: publisherRelease.contractSchemaVersion,
      revision: publisherRelease.contractRevision,
    }),
  )
  for (const [version, contract] of Object.entries(publisherRelease.compatibilityContracts)) {
    assert.deepEqual(
      publishedCatalogContractForClientVersion(version),
      expectedPublishedContract(version, contract),
    )
  }
  assert.equal(publishedCatalogContractForClientVersion("0.0.0"), null)
})

test("published scanner artifacts contain only the fields needed for page matching", () => {
  const { scanner, byteSize } = buildPublishedScannerArtifact({
    generated_at: "2026-07-30T00:00:00.000Z",
    genes: [
      {
        s: "TP53",
        n: "tumor protein p53",
        u: "P04637",
        c: "#abcdef",
        a: ["p53"],
        tmh: false,
        p: { asset_sha256: "a".repeat(64) },
      },
    ],
  })

  assert.deepEqual(scanner.genes, {
    TP53: {
      n: "tumor protein p53",
      u: "P04637",
      c: "#abcdef",
      a: ["p53"],
    },
  })
  assert.equal(scanner.schema_version, scannerContract.schemaVersion)
  assert.equal(scanner.contract_revision, scannerContract.revision)
  assert.ok(byteSize < 3 * 1024 * 1024)
})

class FakeStatement {
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
    if (this.sql.includes("FROM icono_gene_catalog")) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      const row = this.db.catalog.get(symbol)
      return row ? { ...row } : null
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      const row = this.db.published.get(symbol)
      return row ? { ...row } : null
    }

    if (this.sql.includes("FROM icono_gene_essence")) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      const row = this.db.essence.get(symbol)
      return row ? { ...row } : null
    }

    if (this.sql.includes("FROM icono_gene_blot_materializations")) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      const row = this.db.blots.get(symbol)
      return row ? { ...row } : null
    }

    return null
  }

  async all() {
    return { results: [] }
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  constructor() {
    this.catalog = new Map([
      [
        "A1BG",
        {
          gene_symbol: "A1BG",
          full_name: "alpha-1-B glycoprotein",
          uniprot: "P04217",
          color_hex: "#dd8c9d",
          tmh: 0,
          aliases_json: "[]",
          updated_at: "2026-04-04 00:00:00",
        },
      ],
      [
        "SOSTDC1",
        {
          gene_symbol: "SOSTDC1",
          full_name: "sclerostin domain containing 1",
          uniprot: "Q6X4U4",
          color_hex: "#6f8b4e",
          tmh: 0,
          aliases_json: JSON.stringify(["USAG1"]),
          updated_at: "2026-04-04 00:00:00",
        },
      ],
    ])
    this.published = new Map([
      [
        "A1BG",
        {
          asset_sha256: "4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212",
          r2_key_full: "",
          r2_key_medium: "",
          r2_key_thumb: "",
          width: 384,
          height: 512,
          vision_id: "anima-v1-2397",
          emulsion_id: "C9-2397",
          candidate_image_id: 4155,
          sample_label: "A1BG-3",
          sample_number: 3,
          sample_text_hash: "f".repeat(64),
        },
      ],
      [
        "SOSTDC1",
        {
          asset_sha256: "a247c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212",
          r2_key_full: "",
          r2_key_medium: "",
          r2_key_thumb: "",
          width: 640,
          height: 832,
          vision_id: "anima-v1-5521",
          candidate_image_id: 5521,
          sample_label: "SOSTDC1-2",
          sample_number: 2,
          sample_text_hash: "e".repeat(64),
        },
      ],
    ])
    this.essence = new Map([
      [
        "A1BG",
        {
          full_name: "alpha-1-B glycoprotein",
          sex: "Female",
          manifestation:
            "This long internal sample exists for image generation and must not be published as gene-page prose.",
        },
      ],
      [
        "SOSTDC1",
        {
          full_name: "sclerostin domain containing 1",
          sex: "Female",
          manifestation:
            "Alias route regression fixture; this private prose must not leak into site payloads.",
        },
      ],
    ])
    this.blots = new Map()
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
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
      body: cloned.method === "GET" || cloned.method === "HEAD" ? null : await cloned.text(),
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

class FakeKV {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
  }

  async get(key) {
    return this.entries.get(key) || null
  }

  async put(key, value) {
    this.entries.set(key, value)
    return true
  }

  async list({ prefix = "", limit = 1_000, cursor = "" } = {}) {
    const names = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort()
    const offset = Number.parseInt(cursor, 10) || 0
    const page = names.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    return {
      keys: page.map((name) => ({ name })),
      list_complete: nextOffset >= names.length,
      cursor: nextOffset < names.length ? String(nextOffset) : "",
    }
  }
}

class CountedJsonValue {
  constructor(value, onParse) {
    this.serialized = JSON.stringify(value)
    this.onParse = onParse
  }

  [Symbol.toPrimitive]() {
    this.onParse()
    return this.serialized
  }
}

class CountingCardCatalogKv {
  constructor({ pauseReads = false } = {}) {
    this.pauseReads = pauseReads
    this.entries = new Map()
    this.readCounts = new Map()
    this.parseCounts = new Map()
  }

  setJson(key, value) {
    this.entries.set(
      key,
      new CountedJsonValue(value, () => {
        this.parseCounts.set(key, Number(this.parseCounts.get(key) || 0) + 1)
      }),
    )
  }

  async get(key) {
    this.readCounts.set(key, Number(this.readCounts.get(key) || 0) + 1)
    if (this.pauseReads) await Promise.resolve()
    return this.entries.get(key) || null
  }

  reads(key) {
    return Number(this.readCounts.get(key) || 0)
  }

  parses(key) {
    return Number(this.parseCounts.get(key) || 0)
  }
}

function completeCardCatalogCacheVm(symbol, label = symbol) {
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: "content-addressed",
    data_source: "published_card_catalog",
    symbol,
    full_name: label,
    display_color: "#667788",
    portrait: { status: "missing" },
    field_status: { symbol: "present", portrait: "known_absent" },
    payload: {
      api_version: "v1",
      schema_version: 1,
      canonical_key: "symbol",
      canonical_symbol: symbol,
      symbol,
      full_name: label,
      color: "#667788",
      portrait: { status: "missing" },
    },
  }
}

function putContentAddressedCardCatalog(kv, { version, shardCards }) {
  const shards = []
  const symbolShardIndex = {}
  let cardCount = 0
  shardCards.forEach((cards, index) => {
    const contentHash = `${version}-shard-${index}`
    const key = `iconoplasm:card-catalog-shard:${contentHash}`
    const normalizedCards = cards.map((card) => ({ ...card }))
    kv.setJson(key, {
      schema: "iconoplasm.cardCatalog.v1",
      storage: "kv_card_catalog_content_addressed_shards",
      content_hash: contentHash,
      cards: normalizedCards,
    })
    shards.push({
      key,
      index,
      card_count: normalizedCards.length,
      content_hash: contentHash,
      first_symbol: normalizedCards[0]?.symbol || null,
      last_symbol: normalizedCards.at(-1)?.symbol || null,
    })
    for (const card of normalizedCards) symbolShardIndex[card.symbol] = index
    cardCount += normalizedCards.length
  })
  const manifestKey = `iconoplasm:card-catalog:${version}`
  kv.setJson(manifestKey, {
    schema: "iconoplasm.cardCatalog.v1",
    artifact_version: version,
    snapshot_version: version,
    source: "published_card_catalog",
    storage: "kv_card_catalog_content_addressed_shards",
    shard_count: shards.length,
    catalog_gene_count: cardCount,
    card_count: cardCount,
    symbol_shard_index: symbolShardIndex,
    shards,
  })
  return { manifestKey, shards }
}

function publicGeneBatchRequest(symbols) {
  return new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Iconoplasm-Extension-Version": "0.4.13",
    },
    body: JSON.stringify({ symbols }),
  })
}

function buildCatalogResolveKv() {
  const hash = "aliascatalog01"
  const scanner = {
    schema_version: scannerContract.schemaVersion,
    contract_revision: scannerContract.revision,
    generated_at: "2026-05-21T00:00:00.000Z",
    gene_count: 2,
    genes: {
      A1BG: { n: "alpha-1-B glycoprotein", u: "P04217", c: "#dd8c9d" },
      SOSTDC1: {
        n: "sclerostin domain containing 1",
        u: "Q6X4U4",
        c: "#6f8b4e",
        a: ["USAG1"],
      },
    },
  }
  const scannerJson = JSON.stringify(scanner)
  return new FakeKV({
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      generated_at: "2026-05-21T00:00:00.000Z",
      schema_version: 4,
      canonical_key: "symbol",
      gene_count: 2,
      scanner_artifact: {
        schema_version: scannerContract.schemaVersion,
        contract_revision: scannerContract.revision,
        build_version: hash,
        filename: `scanner.${hash}.json`,
        byte_size: Buffer.byteLength(scannerJson, "utf8"),
      },
    }),
    [`iconoplasm:catalog:${hash}`]: JSON.stringify({
      schema_version: 4,
      generated_at: "2026-05-21T00:00:00.000Z",
      gene_count: 2,
      genes: [
        { s: "A1BG", n: "alpha-1-B glycoprotein", u: "P04217", c: "#dd8c9d", tmh: false, a: [] },
        {
          s: "SOSTDC1",
          n: "sclerostin domain containing 1",
          u: "Q6X4U4",
          c: "#6f8b4e",
          tmh: false,
          a: ["USAG1"],
        },
      ],
    }),
    "iconoplasm:published-portrait-fingerprint:v3": JSON.stringify({
      schema: "iconoplasm.publishedPortraitFingerprint.v1",
      published_at: "2026-05-21T00:00:00.000Z",
      fingerprint: { published_count: 0, latest: null },
    }),
    "iconoplasm:published-portrait-refs:v3-none": "[]",
    [`iconoplasm:scanner-catalog:${hash}`]: scannerJson,
    [iconoplasmExtensionBlocklistKvKey(1)]: JSON.stringify({
      schema_version: 1,
      revision: 1,
      version: amidBlocklistVersion,
      term_count: 1,
      terms: ["AMID"],
    }),
  })
}

function buildPublishedCardReadKv({
  version = "test-card-v1",
  portraitSha = "4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212",
} = {}) {
  const shardKey = `iconoplasm:card-catalog-shard:${version}:0`
  const blotFingerprint = createHash("sha256")
    .update(`blot:${portraitSha}`)
    .digest("hex")
    .slice(0, 32)
  const blotAssetSha = createHash("sha256").update(`blot-bytes:${portraitSha}`).digest("hex")
  const blotObjectKey = `blots/v1/A/A1BG/${blotFingerprint}/A1BG-iconoplasm-gene-blot.webp`
  const payload = {
    api_version: "v1",
    schema_version: 1,
    canonical_key: "symbol",
    canonical_symbol: "A1BG",
    symbol: "A1BG",
    full_name: "alpha-1-B glycoprotein",
    color: "#dd8c9d",
    essence: {
      name: "alpha-1-B glycoprotein",
      sex: "Female",
      sex_origin: ["Soluble"],
    },
    portrait: {
      status: "published",
      hero_url: `https://iconoplasm.brinedew.bio/portraits/v1/${portraitSha.slice(0, 2)}/${portraitSha}/full.webp`,
      medium_url: `https://iconoplasm.brinedew.bio/portraits/v1/${portraitSha.slice(0, 2)}/${portraitSha}/medium.webp`,
      thumb_url: `https://iconoplasm.brinedew.bio/portraits/v1/${portraitSha.slice(0, 2)}/${portraitSha}/thumb.webp`,
      asset_sha256: portraitSha,
      width: 384,
      height: 512,
      candidate_image_id: 4155,
      vision_id: "anima-v1-2397",
      emulsion_id: "C9-2397",
      sample_label: "A1BG-3",
      sample_number: 3,
      sample_text_hash: "f".repeat(64),
    },
    blot: {
      status: "ready",
      blot_fingerprint: blotFingerprint,
      portrait_asset_sha256: portraitSha,
      asset_sha256: blotAssetSha,
      object_key: blotObjectKey,
      image_url: `https://iconoplasmportraits.b-cdn.net/${blotObjectKey}`,
      canonical_url: `https://iconoplasm.brinedew.bio/${blotObjectKey}`,
      // Historical immutable cards can retain the old plural semantic URL.
      semantic_url: "https://iconoplasm.brinedew.bio/blots/A1BG.webp",
      width: 768,
      height: 1024,
      filename: "A1BG-iconoplasm-gene-blot.webp",
    },
    snapshot_version: version,
  }
  return new FakeKV({
    "iconoplasm:gallery-version": JSON.stringify({
      current: version,
      previous: null,
      published_at: "2026-08-23T00:00:00.000Z",
      status: "active",
    }),
    [`iconoplasm:card-catalog:${version}`]: JSON.stringify({
      schema: "iconoplasm.cardCatalog.v1",
      storage: "kv_sharded",
      artifact_version: version,
      snapshot_version: version,
      catalog_gene_count: 1,
      card_count: 1,
      shards: [
        {
          key: shardKey,
          index: 0,
          card_count: 1,
          first_symbol: "A1BG",
          last_symbol: "A1BG",
        },
      ],
    }),
    [shardKey]: JSON.stringify({
      schema: "iconoplasm.cardCatalog.v1",
      artifact_version: version,
      shard_index: 0,
      cards: [
        {
          __complete: true,
          schema_version: "iconoplasm.mobileCard.v1",
          snapshot_version: version,
          symbol: "A1BG",
          full_name: payload.full_name,
          portrait: payload.portrait,
          field_status: { symbol: "present", portrait: "present" },
          payload,
        },
      ],
    }),
  })
}

function buildAgentImageResolverKv(options = {}) {
  const catalog = buildCatalogResolveKv()
  const cards = buildPublishedCardReadKv(options)
  for (const [key, value] of cards.entries) catalog.entries.set(key, value)
  return catalog
}

function buildSessionBinding(sessions) {
  return {
    idFromName(name) {
      return String(name || "")
    },
    get(id) {
      return {
        async fetch() {
          const session = sessions[String(id || "")] || null
          return new Response(JSON.stringify(session), {
            status: session ? 200 : 404,
            headers: { "Content-Type": "application/json" },
          })
        },
      }
    },
  }
}

function buildEnv(overrides = {}, { bindGateway = true } = {}) {
  const gatewayDb =
    overrides.ICONOPLASM_DB === undefined ? new FakeIconoplasmDb() : overrides.ICONOPLASM_DB
  const gatewayEnv = {
    ICONOPLASM_DB: gatewayDb,
    DB: null,
    ...overrides,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

test.beforeEach(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test.after(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test("catalog hydration emits only schema-5 inspectable portrait assets", () => {
  const sha = "b".repeat(64)
  const hydrated = mergePublishedPortraitRefsIntoArtifact(
    {
      schema_version: 4,
      genes: [
        { s: "A1BG", ph: "portraits/old-full.webp", pt: "portraits/old-medium.webp" },
        { s: "TP53", ph: "portraits/stale.webp" },
      ],
    },
    [{ symbol: "A1BG", asset_sha256: sha }],
  )

  assert.equal(hydrated.schema_version, 5)
  assert.equal("ph" in hydrated.genes[0], false)
  assert.equal("pt" in hydrated.genes[0], false)
  assert.equal(hydrated.genes[0].p.asset_sha256, sha)
  assert.equal(
    hydrated.genes[0].p.renditions.medium.canonical_url,
    `https://iconoplasm.brinedew.bio/portraits/v1/bb/${sha}/medium.webp`,
  )
  assert.equal("ph" in hydrated.genes[1], false)
  assert.equal("p" in hydrated.genes[1], false)
})

test("published compatibility projection materializes aliases and legacy portrait paths", () => {
  const sha = "c".repeat(64)
  const projected = projectPublishedCompatibilityArtifact(
    {
      schema_version: 5,
      contract_revision: 1,
      genes: [
        {
          s: "RELA",
          a: [],
          p: {
            schema_version: 1,
            asset_sha256: sha,
            renditions: {
              medium: { path: `portraits/v1/cc/${sha}/medium.webp` },
              full: { path: `portraits/v1/cc/${sha}/full.webp` },
            },
          },
        },
        { s: "CXCL8", a: [] },
      ],
    },
    { schemaVersion: 4, revision: 1 },
    {
      by_symbol: { RELA: ["p65"], CXCL8: ["IL8"] },
      remove_by_symbol: {},
    },
  )

  assert.equal(projected.schema_version, 4)
  assert.equal(projected.contract_revision, 1)
  assert.equal(projected.genes[0].a.includes("p65"), true)
  assert.equal(projected.genes[1].a.includes("IL8"), true)
  assert.equal(projected.genes[0].pt, `portraits/v1/cc/${sha}/medium.webp`)
  assert.equal(projected.genes[0].ph, `portraits/v1/cc/${sha}/full.webp`)
  assert.equal("p" in projected.genes[0], false)
})

test("compatibility projection fails closed for an undeclared contract revision", () => {
  const projected = projectPublishedCompatibilityArtifact(
    { schema_version: 5, contract_revision: 2, genes: [{ s: "TP53" }] },
    { schemaVersion: 5, revision: 1 },
  )

  assert.equal(projected, null)
})

test("public gene payload includes published portrait dimensions", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/A1BG"),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 403)
  assert.equal(payload?.code, "FIRST_PARTY_ONLY")
  assert.match(String(payload?.error || ""), /website ui/i)
  assert.equal(
    payload?.recommended_public_api?.metadata,
    "https://iconoplasm.brinedew.bio/api/public/v1/metadata",
  )
})

test("site gene payload includes published portrait dimensions for first-party browser requests", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
        headers: {
          Referer: "https://iconoplasm.brinedew.bio/gene/A1BG",
        },
      }),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get("Cache-Control"),
    "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
  )
  assert.equal(response.headers.get("X-Iconoplasm-Card-Version"), "test-card-v1")
  assert.equal(response.headers.get("X-Iconoplasm-Portrait-Source"), "published-card-catalog")
  assert.equal(payload?.card_snapshot_version, "test-card-v1")
  assert.equal(payload?.portrait?.status, "published")
  assert.equal(payload?.portrait?.width, 384)
  assert.equal(payload?.portrait?.height, 512)
  assert.equal(payload?.portrait?.emulsion_id, "C9-2397")
  assert.equal("public_emulsion_code" in payload.portrait, false)
  assert.equal(payload?.portrait?.sample_label, "A1BG-3")
  assert.equal(payload?.portrait?.sample_number, 3)
  assert.equal(payload?.blot?.status, "ready")
  assert.equal(payload?.blot?.semantic_url, "https://iconoplasm.brinedew.bio/blot/A1BG.webp")
  assert.equal(typeof payload?.essence, "object")
  assert.ok(Array.isArray(payload?.portrait_candidates))
  assert.equal("manifestation" in payload, false)
  assert.equal("description" in payload, false)
})

test("site gene detail exposes an exact ready blot without republishing the card artifact", async () => {
  const kv = buildPublishedCardReadKv({ version: "test-card-zero-kv-blot" })
  const shardKey = "iconoplasm:card-catalog-shard:test-card-zero-kv-blot:0"
  const shard = JSON.parse(await kv.get(shardKey))
  const cardPayload = shard.cards[0].payload
  delete cardPayload.blot
  await kv.put(shardKey, JSON.stringify(shard))
  const fingerprint = iconoplasmGeneBlotFingerprint(cardPayload)
  const objectKey = iconoplasmGeneBlotObjectKey("A1BG", fingerprint)
  const env = buildEnv({ KV: kv })
  env.gatewayDb.blots.set("A1BG", {
    gene_blot_fingerprint: fingerprint,
    gene_blot_portrait_asset_sha256: cardPayload.portrait.asset_sha256,
    gene_blot_asset_sha256: "b".repeat(64),
    gene_blot_object_key: objectKey,
    gene_blot_width: 768,
    gene_blot_height: 1024,
  })

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
        headers: { Referer: "https://iconoplasm.brinedew.bio/gene/A1BG" },
      }),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.card_snapshot_version, "test-card-zero-kv-blot")
  assert.equal(payload?.blot?.status, "ready")
  assert.equal(payload?.blot?.blot_fingerprint, fingerprint)
  assert.equal(payload?.blot?.portrait_asset_sha256, cardPayload.portrait.asset_sha256)
  assert.equal(payload?.blot?.object_key, objectKey)
  assert.equal(payload?.blot?.semantic_url, "https://iconoplasm.brinedew.bio/blot/A1BG.webp")
})

test("site gene detail rejects a stale blot row as a public image authority", async () => {
  const kv = buildPublishedCardReadKv({ version: "test-card-stale-d1-blot" })
  const shardKey = "iconoplasm:card-catalog-shard:test-card-stale-d1-blot:0"
  const shard = JSON.parse(await kv.get(shardKey))
  delete shard.cards[0].payload.blot
  await kv.put(shardKey, JSON.stringify(shard))
  const env = buildEnv({ KV: kv })
  env.gatewayDb.blots.set("A1BG", {
    gene_blot_fingerprint: "0".repeat(32),
    gene_blot_portrait_asset_sha256: shard.cards[0].payload.portrait.asset_sha256,
    gene_blot_asset_sha256: "b".repeat(64),
    gene_blot_object_key: iconoplasmGeneBlotObjectKey("A1BG", "0".repeat(32)),
    gene_blot_width: 768,
    gene_blot_height: 1024,
  })

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
        headers: { Referer: "https://iconoplasm.brinedew.bio/gene/A1BG" },
      }),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal("blot" in payload, false)
})

test("site gene detail is identical for guest, Loweren, and every other account", async () => {
  const sessions = buildSessionBinding({
    "session:loweren-session": { user_id: "loweren-id", username: "Loweren" },
    "session:another-session": { user_id: "another-id", username: "another-user" },
  })
  const read = async (cookie = "") => {
    resetIconoplasmRuntimeCachesForTest()
    const response =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
          headers: {
            Referer: "https://iconoplasm.brinedew.bio/gene/A1BG",
            ...(cookie ? { Cookie: cookie } : {}),
          },
        }),
        buildEnv({ GAME_SESSIONS: sessions, KV: buildPublishedCardReadKv() }),
        {},
      )
    assert.equal(response.status, 200)
    return { payload: await response.json(), cacheControl: response.headers.get("Cache-Control") }
  }

  const guestResult = await read()
  const lowerenResult = await read("session=loweren-session")
  const anotherAccountResult = await read("session=another-session")
  const guest = guestResult.payload
  const loweren = lowerenResult.payload
  const anotherAccount = anotherAccountResult.payload

  assert.deepEqual(loweren, guest)
  assert.deepEqual(anotherAccount, guest)
  assert.equal(
    guestResult.cacheControl,
    "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
  )
  assert.equal(lowerenResult.cacheControl, guestResult.cacheControl)
  assert.equal(anotherAccountResult.cacheControl, guestResult.cacheControl)
  assert.equal(typeof guest.essence, "object")
  assert.ok(Array.isArray(guest.portrait_candidates))
})

test("site gene detail keeps the public cache policy on conditional responses", async () => {
  const env = buildEnv({ KV: buildPublishedCardReadKv() })
  const first =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
        headers: { Referer: "https://iconoplasm.brinedew.bio/gene/A1BG" },
      }),
      env,
      {},
    )
  const etag = first.headers.get("ETag")
  assert.ok(etag)

  resetIconoplasmRuntimeCachesForTest()
  const conditional =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
        headers: {
          Referer: "https://iconoplasm.brinedew.bio/gene/A1BG",
          "If-None-Match": etag,
        },
      }),
      env,
      {},
    )

  assert.equal(conditional.status, 304)
  assert.equal(
    conditional.headers.get("Cache-Control"),
    "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
  )
  assert.equal(conditional.headers.get("X-Iconoplasm-Card-Version"), "test-card-v1")
})

test("unpublished D1 portrait changes cannot move the published gene portrait", async () => {
  const env = buildEnv({ KV: buildPublishedCardReadKv() })
  const read = async () =>
    handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/A1BG", {
        headers: { Referer: "https://iconoplasm.brinedew.bio/gene/A1BG" },
      }),
      env,
      {},
    )

  const before = await read()
  const beforePayload = await before.clone().json()
  const votedAssetSha = "9".repeat(64)
  env.gatewayDb.published.set("A1BG", {
    ...env.gatewayDb.published.get("A1BG"),
    asset_sha256: votedAssetSha,
    candidate_image_id: 9001,
    sample_label: "A1BG-9",
    sample_number: 9,
  })
  resetIconoplasmRuntimeCachesForTest()
  const after = await read()
  const afterPayload = await after.clone().json()

  assert.equal(before.status, 200)
  assert.equal(after.status, 200)
  assert.equal(after.headers.get("ETag"), before.headers.get("ETag"))
  assert.equal(afterPayload?.portrait?.asset_sha256, beforePayload?.portrait?.asset_sha256)
  assert.notEqual(afterPayload?.portrait?.asset_sha256, votedAssetSha)

  const nextPublishedKv = buildPublishedCardReadKv({
    version: "test-card-v2",
    portraitSha: votedAssetSha,
  })
  for (const [key, value] of nextPublishedKv.entries) env.KV.entries.set(key, value)
  resetIconoplasmRuntimeCachesForTest()
  const published = await read()
  const publishedPayload = await published.clone().json()

  assert.equal(published.status, 200)
  assert.notEqual(published.headers.get("ETag"), before.headers.get("ETag"))
  assert.equal(published.headers.get("X-Iconoplasm-Card-Version"), "test-card-v2")
  assert.equal(publishedPayload?.card_snapshot_version, "test-card-v2")
  assert.equal(publishedPayload?.portrait?.asset_sha256, votedAssetSha)
})

test("site gene detail canonicalizes alias requests before rendering the gene payload", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/USAG1", {
        headers: {
          Referer: "https://iconoplasm.brinedew.bio/gene/USAG1",
        },
      }),
      buildEnv({ KV: buildCatalogResolveKv() }),
      {},
    )

  assert.equal(response.status, 302)
  assert.equal(
    response.headers.get("Location"),
    "https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/SOSTDC1",
  )
})

test("public media exposes only the canonical gene blot", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG"),
      buildEnv({
        ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
        KV: buildPublishedCardReadKv(),
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.media?.type, "gene_blot")
  assert.equal(payload?.media?.width, 768)
  assert.equal(payload?.media?.height, 1024)
  assert.equal(payload?.media?.canonical_url, "https://iconoplasm.brinedew.bio/blot/A1BG.webp")
  assert.equal(payload?.media?.info_url, "https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG")
  assert.equal(payload?.media?.checksum_sha256?.length, 64)
  assert.equal(payload?.media?.rights, "CC0 1.0 Universal")
  assert.equal(payload?.media?.license_url, "https://creativecommons.org/publicdomain/zero/1.0/")
  assert.equal(payload?.media?.usage_url, "https://iconoplasm.brinedew.bio/license")
  assert.equal(payload?.media?.embedding_permitted, true)
  assert.equal(payload?.media?.hotlinking_permitted, true)
  assert.equal(payload?.media?.modification_permitted, true)
  assert.equal(payload?.media?.commercial_use_permitted, true)
  assert.equal(payload?.media?.attribution_required, false)
  assert.equal("portrait" in payload.media, false)
})

test("public image resolver separates gene blots from temporary portrait coverage", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/images/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: ["A1BG", "USAG1", "NOT_A_GENE"] }),
      }),
      buildEnv({
        ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
        KV: buildAgentImageResolverKv(),
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("X-Iconoplasm-Media-Source"), "published-card-image-resolver")
  assert.equal(payload.max_symbols, 50)
  assert.equal(payload.results[0]?.canonical_symbol, "A1BG")
  assert.equal(payload.results[0]?.images?.gene_blot?.type, "gene_blot")
  assert.equal(
    payload.results[0]?.images?.gene_blot?.canonical_url,
    "https://iconoplasm.brinedew.bio/blot/A1BG.webp",
  )
  assert.equal(payload.results[0]?.images?.portrait?.type, "portrait")
  assert.equal(payload.results[0]?.images?.portrait?.rights, "CC0 1.0 Universal")
  assert.equal(payload.results[0]?.images?.portrait?.attribution_required, false)
  assert.equal(
    payload.results[0]?.images?.portrait?.semantic_url,
    "https://iconoplasm.brinedew.bio/portrait/A1BG.webp",
  )
  assert.equal(payload.results[1]?.canonical_symbol, "SOSTDC1")
  assert.equal(payload.results[1]?.matched_by, "alias")
  assert.equal(payload.results[1]?.images, null)
  assert.equal(payload.results[2]?.found, false)
  assert.equal(payload.results[2]?.images, null)
})

test("public image resolver derives the stable blot URL before catalog metadata catches up", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const kv = buildAgentImageResolverKv({ version: "test-card-without-blot" })
  const shardKey = "iconoplasm:card-catalog-shard:test-card-without-blot:0"
  const shard = JSON.parse(await kv.get(shardKey))
  delete shard.cards[0].payload.blot
  await kv.put(shardKey, JSON.stringify(shard))
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/images/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ["A1BG"] }),
      }),
      buildEnv({ KV: kv }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(
    payload.results[0]?.images?.gene_blot?.canonical_url,
    "https://iconoplasm.brinedew.bio/blot/A1BG.webp",
  )
  assert.equal(payload.results[0]?.images?.gene_blot?.availability, "resolve_at_canonical_url")
  assert.equal(payload.results[0]?.images?.portrait?.type, "portrait")
})

test("stable source portrait alias redirects to the exact card's medium rendition", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/portrait/A1BG.webp"),
      buildEnv({
        ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
        KV: buildPublishedCardReadKv(),
      }),
      {},
    )

  assert.equal(response.status, 302)
  assert.match(response.headers.get("Location") || "", /\/portraits\/v1\/.+\/medium\.webp$/)
  assert.match(response.headers.get("Link") || "", /^<https:\/\/iconoplasmportraits\.b-cdn\.net\//)
  assert.equal(response.headers.get("X-Iconoplasm-Media-Type"), "portrait")
  assert.equal(response.headers.get("X-Iconoplasm-Portrait-Rendition"), "medium")
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*")
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "cross-origin")
  assert.equal(response.headers.get("X-License"), "CC0-1.0")
  assert.equal(
    response.headers.get("X-Iconoplasm-Usage-Info"),
    "https://iconoplasm.brinedew.bio/license",
  )
  assert.match(response.headers.get("Link") || "", /rel="alternate"/)
  assert.match(response.headers.get("Link") || "", /rel="license"/)
  assert.match(response.headers.get("Link") || "", /rel="describedby"/)
})

test("stable blot route derives the Bunny object from the published card without embedded blot metadata", async () => {
  const kv = buildPublishedCardReadKv({ version: "test-card-derived-blot" })
  const shardKey = "iconoplasm:card-catalog-shard:test-card-derived-blot:0"
  const shard = JSON.parse(await kv.get(shardKey))
  const cardPayload = shard.cards[0].payload
  delete cardPayload.blot
  await kv.put(shardKey, JSON.stringify(shard))
  const fingerprint = iconoplasmGeneBlotFingerprint(cardPayload)
  const expectedObjectKey = iconoplasmGeneBlotObjectKey("A1BG", fingerprint)
  const reads = []
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/blot/A1BG.webp"),
      buildEnv({
        KV: kv,
        ICONOPLASM_PORTRAITS: {
          async get(key) {
            reads.push(key)
            return key === expectedObjectKey
              ? {
                  body: new Uint8Array([82, 73, 70, 70]),
                  size: 4,
                  httpEtag: '"derived-blot"',
                  httpMetadata: { contentType: "image/webp" },
                }
              : null
          },
        },
      }),
      {},
    )

  assert.equal(response.status, 200)
  assert.deepEqual(reads, [expectedObjectKey])
  assert.equal(
    response.headers.get("Content-Location"),
    `https://iconoplasm.brinedew.bio/${expectedObjectKey}`,
  )
  assert.equal(response.headers.get("X-Iconoplasm-Blot-Fingerprint"), fingerprint)
  assert.equal(response.headers.get("X-Iconoplasm-Card-Version"), "test-card-derived-blot")
})

test("stable blot route preserves an exact-card legacy blot until its replacement arrives", async () => {
  const kv = buildPublishedCardReadKv({ version: "test-card-legacy-blot" })
  const shardKey = "iconoplasm:card-catalog-shard:test-card-legacy-blot:0"
  const shard = JSON.parse(await kv.get(shardKey))
  const cardPayload = shard.cards[0].payload
  const expectedObjectKey = iconoplasmGeneBlotObjectKey(
    "A1BG",
    iconoplasmGeneBlotFingerprint(cardPayload),
  )
  const legacyObjectKey = cardPayload.blot.object_key
  const reads = []
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/blot/A1BG.webp"),
      buildEnv({
        KV: kv,
        ICONOPLASM_PORTRAITS: {
          async get(key) {
            reads.push(key)
            return key === legacyObjectKey
              ? {
                  body: new Uint8Array([82, 73, 70, 70]),
                  size: 4,
                  httpEtag: '"legacy-blot"',
                  httpMetadata: { contentType: "image/webp" },
                }
              : null
          },
        },
      }),
      {},
    )

  assert.equal(response.status, 200)
  assert.deepEqual(reads, [expectedObjectKey, legacyObjectKey])
  assert.equal(
    response.headers.get("Content-Location"),
    `https://iconoplasm.brinedew.bio/${legacyObjectKey}`,
  )
  assert.equal(
    response.headers.get("X-Iconoplasm-Blot-Fingerprint"),
    cardPayload.blot.blot_fingerprint,
  )
})

test("public media follows the published card barrier instead of D1 portrait changes", async () => {
  const d1PortraitA = "a".repeat(64)
  const publishedCardB = "b".repeat(64)
  const publishedCardC = "c".repeat(64)
  const env = buildEnv({
    KV: buildPublishedCardReadKv({
      version: "test-card-media-v1",
      portraitSha: publishedCardB,
    }),
  })
  env.gatewayDb.published.set("A1BG", {
    ...env.gatewayDb.published.get("A1BG"),
    asset_sha256: d1PortraitA,
  })
  const read = async () => {
    const response =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request("https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG"),
        env,
        {},
      )
    return { response, payload: await response.clone().json() }
  }

  const before = await read()
  assert.equal(before.response.status, 200)
  assert.equal(before.response.headers.get("X-Iconoplasm-Card-Version"), "test-card-media-v1")
  assert.equal(before.response.headers.get("X-Iconoplasm-Media-Source"), "published-card-gene-blot")
  assert.equal(
    before.payload?.media?.canonical_url,
    "https://iconoplasm.brinedew.bio/blot/A1BG.webp",
  )

  const unpublishedD1Portrait = "d".repeat(64)
  env.gatewayDb.published.set("A1BG", {
    ...env.gatewayDb.published.get("A1BG"),
    asset_sha256: unpublishedD1Portrait,
  })
  resetIconoplasmRuntimeCachesForTest()
  const afterD1Change = await read()

  assert.equal(afterD1Change.response.status, 200)
  assert.equal(afterD1Change.response.headers.get("ETag"), before.response.headers.get("ETag"))
  assert.equal(afterD1Change.payload?.card_snapshot_version, "test-card-media-v1")
  assert.deepEqual(afterD1Change.payload?.media, before.payload?.media)

  const nextPublishedKv = buildPublishedCardReadKv({
    version: "test-card-media-v2",
    portraitSha: publishedCardC,
  })
  for (const [key, value] of nextPublishedKv.entries) env.KV.entries.set(key, value)
  resetIconoplasmRuntimeCachesForTest()
  const afterCardBarrierFlip = await read()

  assert.equal(afterCardBarrierFlip.response.status, 200)
  assert.notEqual(
    afterCardBarrierFlip.response.headers.get("ETag"),
    before.response.headers.get("ETag"),
  )
  assert.equal(
    afterCardBarrierFlip.response.headers.get("X-Iconoplasm-Card-Version"),
    "test-card-media-v2",
  )
  assert.equal(afterCardBarrierFlip.payload?.card_snapshot_version, "test-card-media-v2")
  assert.equal(
    afterCardBarrierFlip.payload?.media?.checksum_sha256,
    createHash("sha256").update(`blot-bytes:${publishedCardC}`).digest("hex"),
  )
  assert.equal(
    afterCardBarrierFlip.payload?.media?.canonical_url,
    "https://iconoplasm.brinedew.bio/blot/A1BG.webp",
  )
})

test("public catalog manifest publishes explicit extension contract fields", async () => {
  const publishedAliases = await iconoplasmPublicationAliasManifestFromPolicy({
    by_symbol: { CXCL8: ["IL8"] },
    remove_by_symbol: {},
  })
  const blocklistVersion = `ebl1-${createHash("sha256")
    .update(JSON.stringify(["AMID"]))
    .digest("hex")
    .slice(0, 16)}`
  const publishedBlocklist = {
    schema_version: 1,
    revision: 1,
    version: blocklistVersion,
    term_count: 1,
    terms: ["AMID"],
  }
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
      buildEnv({
        ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
        KV: new FakeKV({
          "iconoplasm:catalog-manifest": JSON.stringify({
            current_hash: "catalog-2026-04-16",
            generated_at: "2026-04-16T16:30:00.000Z",
            gene_count: 19001,
            scanner_artifact: {
              schema_version: scannerContract.schemaVersion,
              contract_revision: scannerContract.revision,
              build_version: "catalog",
              filename: "scanner.catalog.json",
              byte_size: 1_900_000,
            },
          }),
          "iconoplasm:published-portrait-fingerprint:v3": JSON.stringify({
            schema: "iconoplasm.publishedPortraitFingerprint.v1",
            published_at: "2026-04-16T16:30:00.000Z",
            fingerprint: { published_count: 0, latest: null },
          }),
          "iconoplasm:published-portrait-refs:v3-none": "[]",
          [iconoplasmExtensionBlocklistKvKey(1)]: JSON.stringify({
            ...publishedBlocklist,
            depends_on_alias_revision: null,
          }),
          [iconoplasmPublicationAliasKvKey(2)]: JSON.stringify(publishedAliases),
          [iconoplasmRecognitionPairKvKey(2, 1)]: JSON.stringify({
            schema_version: 1,
            alias_revision: 2,
            blocklist_revision: 1,
            alias_depends_on_blocklist_revision: null,
            blocklist_depends_on_alias_revision: null,
            publication_aliases: publishedAliases,
            extension_blocklist: publishedBlocklist,
          }),
        }),
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.artifact_schema_version, candidateContract.schemaVersion)
  assert.equal(payload?.artifact_contract_revision, candidateContract.revision)
  assert.equal(payload?.schema_version, candidateContract.schemaVersion)
  assert.equal(payload?.min_extension_version, publisherRelease.minimumSupportedVersion)
  assert.equal(payload?.catalog_hash, "catalog")
  assert.equal(payload?.build_version, `catalog-2026-04-16-${currentArtifactToken}`)
  assert.ok(
    String(payload?.artifact_url || "").endsWith(
      `/catalog.catalog-2026-04-16-${currentArtifactToken}.json`,
    ),
  )
  assert.deepEqual(payload?.scanner_artifact, {
    schema_version: scannerContract.schemaVersion,
    contract_revision: scannerContract.revision,
    build_version: "catalog",
    byte_size: 1_900_000,
    artifact_url: "https://iconoplasm.brinedew.bio/api/public/v1/catalog/scanner.catalog.json",
  })
  assert.deepEqual(payload?.portrait_delivery, {
    version: 1,
    canonical_origin: "https://iconoplasm.brinedew.bio",
    accelerator: {
      id: "bunny",
      origin: "https://iconoplasmportraits.b-cdn.net",
      enabled: true,
    },
    probe_timeout_ms: 2500,
    fallback_hedge_delay_ms: 350,
    decision_scope: "tab",
  })
  assert.equal(payload?.publication_aliases?.version, publishedAliases.version)
  assert.deepEqual(payload?.publication_aliases?.by_symbol?.CXCL8, ["IL8"])
  assert.deepEqual(Object.keys(payload.publication_aliases).sort(), [
    "alias_count",
    "by_symbol",
    "removal_count",
    "remove_by_symbol",
    "schema_version",
    "version",
  ])
  assert.deepEqual(Object.keys(payload.extension_blocklist).sort(), [
    "revision",
    "schema_version",
    "term_count",
    "terms",
    "version",
  ])
  assert.match(response.headers.get("etag") || "", /aliases-v1-/)
})

test("published extension receives its publisher-declared client contract", async () => {
  const [compatibilityVersion, compatibilityAuthority] = Object.entries(
    publisherRelease.compatibilityContracts,
  )[0] || [
    publisherRelease.version,
    {
      schema_version: publisherRelease.contractSchemaVersion,
      revision: publisherRelease.contractRevision,
    },
  ]
  const compatibilityContract = expectedPublishedContract(
    compatibilityVersion,
    compatibilityAuthority,
  )
  const requiresProjection =
    compatibilityContract.schemaVersion < candidateContract.schemaVersion ||
    (compatibilityContract.schemaVersion === candidateContract.schemaVersion &&
      compatibilityContract.revision < candidateContract.revision)
  const effectiveSchemaVersion = requiresProjection
    ? compatibilityContract.schemaVersion
    : candidateContract.schemaVersion
  const effectiveContractRevision = requiresProjection
    ? compatibilityContract.revision
    : candidateContract.revision
  const kv = buildCatalogResolveKv()
  const env = buildEnv({ KV: kv })
  const manifestResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest", {
        headers: { "X-Iconoplasm-Extension-Version": compatibilityVersion },
      }),
      env,
      {},
    )
  const manifest = await manifestResponse.json()

  assert.equal(manifestResponse.status, 200)
  assert.equal(manifest.schema_version, effectiveSchemaVersion)
  assert.equal(manifest.artifact_schema_version, effectiveSchemaVersion)
  assert.equal(manifest.artifact_contract_revision, effectiveContractRevision)
  assert.equal(manifest.min_extension_version, publisherRelease.minimumSupportedVersion)
  if (requiresProjection) {
    assert.equal(manifest.portrait_base_url, "https://iconoplasm.brinedew.bio")
    assert.ok(String(manifest.artifact_url || "").includes(`-${compatibilityContract.token}-`))
  } else {
    assert.equal("portrait_base_url" in manifest, false)
  }

  const artifactResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(manifest.artifact_url, {
        headers: { "X-Iconoplasm-Extension-Version": compatibilityVersion },
      }),
      env,
      {},
    )
  const artifact = await artifactResponse.json()
  assert.equal(artifactResponse.status, 200)
  assert.equal(artifact.schema_version, effectiveSchemaVersion)
  assert.equal(Array.isArray(artifact.genes), true)
  if (requiresProjection) {
    assert.equal(
      artifact.genes.some((gene) => "p" in gene),
      false,
    )
  }

  const scannerResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(manifest.scanner_artifact.artifact_url, {
        headers: { "X-Iconoplasm-Extension-Version": compatibilityVersion },
      }),
      env,
      {},
    )
  const scanner = await scannerResponse.json()
  assert.equal(scannerResponse.status, 200)
  assert.equal(scanner.schema_version, scannerContract.schemaVersion)
  assert.equal(scanner.contract_revision, scannerContract.revision)
  assert.equal(Object.keys(scanner.genes).length, 2)
  assert.equal(
    Object.values(scanner.genes).some((gene) => "p" in gene),
    false,
  )
})

test("a cold cached compatibility URL survives a newer alias pair without a revision-1 KV record", async () => {
  const compatibilityContract = {
    version: "0.4.0",
    schemaVersion: 4,
    revision: 1,
    token: "a4p040c1",
  }

  const kv = buildCatalogResolveKv()
  const rawCatalogKey = "iconoplasm:catalog:aliascatalog01"
  const rawCatalog = JSON.parse(kv.entries.get(rawCatalogKey))
  rawCatalog.genes.push({
    s: "CXCL8",
    n: "C-X-C motif chemokine ligand 8",
    u: "P10145",
    c: "#89685f",
    tmh: false,
    a: [],
  })
  rawCatalog.gene_count = rawCatalog.genes.length
  kv.entries.set(rawCatalogKey, JSON.stringify(rawCatalog))
  const env = buildEnv({ KV: kv })
  const oldHash = `aliascatalog01-${compatibilityContract.token}-v1bf7d4149d6b2df6c`
  assert.equal(
    [...kv.entries.keys()].some((key) =>
      key.startsWith("iconoplasm:publication-alias-policy:v1:revision:"),
    ),
    false,
  )

  const aliasesV2 = await iconoplasmPublicationAliasManifestFromPolicy({
    ...ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
    by_symbol: {
      ...ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol,
      CXCL8: ["IL8"],
    },
  })
  const blocklist = {
    schema_version: 1,
    revision: 1,
    version: amidBlocklistVersion,
    term_count: 1,
    terms: ["AMID"],
  }
  kv.entries.set(
    iconoplasmRecognitionPairKvKey(2, 1),
    JSON.stringify({
      schema_version: 1,
      alias_revision: 2,
      blocklist_revision: 1,
      alias_depends_on_blocklist_revision: 1,
      blocklist_depends_on_alias_revision: null,
      publication_aliases: aliasesV2,
      extension_blocklist: blocklist,
    }),
  )
  const portraitFingerprint = { published_count: 1, latest: "c".repeat(64) }
  kv.entries.set(
    "iconoplasm:published-portrait-fingerprint:v3",
    JSON.stringify({
      schema: "iconoplasm.publishedPortraitFingerprint.v1",
      published_at: "2026-08-11T00:00:00.000Z",
      fingerprint: portraitFingerprint,
    }),
  )
  kv.entries.set(
    `iconoplasm:published-portrait-refs:v3-1-${portraitFingerprint.latest}`,
    JSON.stringify([{ symbol: "CXCL8", asset_sha256: "d".repeat(64) }]),
  )
  // Simulate pair propagation reaching this colo before the v2 token index.
  resetIconoplasmRuntimeCachesForTest()
  const aliasTokenV2 = aliasesV2.version.replace(/-/g, "")
  const newHash = `aliascatalog01-${compatibilityContract.token}-v3-1-${portraitFingerprint.latest}-${aliasTokenV2}`
  assert.notEqual(newHash, oldHash)

  await assert.rejects(
    materializePublishedCompatibilityArtifact(
      env.gatewayDb ? { ...env, ICONOPLASM_DB: env.gatewayDb } : env,
      newHash.replace(aliasTokenV2, "v1aaaaaaaaaaaaaaaa"),
      compatibilityContract,
    ),
    (error) => error.code === "ICONOPLASM_PUBLISHED_ALIAS_SNAPSHOT_UNAVAILABLE",
  )

  const statefulEnv = env.gatewayDb ? { ...env, ICONOPLASM_DB: env.gatewayDb } : env
  const oldArtifact = await materializePublishedCompatibilityArtifact(
    statefulEnv,
    oldHash,
    compatibilityContract,
  )
  assert.ok(oldArtifact)
  assert.equal(
    oldArtifact.genes.find((gene) => gene.s === "CXCL8")?.a?.includes("IL8") || false,
    false,
  )
  assert.equal("ph" in oldArtifact.genes.find((gene) => gene.s === "CXCL8"), false)

  const newArtifact = await materializePublishedCompatibilityArtifact(
    statefulEnv,
    newHash,
    compatibilityContract,
  )
  assert.ok(newArtifact)
  assert.equal(newArtifact.genes.find((gene) => gene.s === "CXCL8")?.a?.includes("IL8"), true)
  assert.match(
    newArtifact.genes.find((gene) => gene.s === "CXCL8")?.ph || "",
    new RegExp("d{64}/full\\.webp$"),
  )
})

test("public media fails closed when THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE is missing", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG"),
      buildEnv({ THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: null }, { bindGateway: false }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload?.code, "THE_ONLY_ALLOWED_STATEFUL_WORKER_REQUIRED")
  assert.match(String(payload?.error || ""), /THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE/i)
})

test("portrait asset requests still reach the only allowed stateful worker when the public edge has no direct bucket binding", async () => {
  const gateway = new FakeOnlyAllowedGateway(
    () =>
      new Response("image-bytes", {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      }),
  )
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/portraits/v1/47/4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212/medium.webp",
      ),
      {
        THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway,
      },
      {},
    )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/webp")
  assert.equal(gateway.calls.length, 1)
})

test("public gene batch is limited to first-party clients and extension traffic", async () => {
  const deniedResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: ["A1BG"] }),
      }),
      buildEnv(),
      {},
    )
  const deniedPayload = await deniedResponse.json()
  assert.equal(deniedResponse.status, 403)
  assert.equal(deniedPayload?.code, "FIRST_PARTY_ONLY")

  const extensionResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Iconoplasm-Extension-Version": "0.3.0",
        },
        body: JSON.stringify({ symbols: ["A1BG"] }),
      }),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  const extensionPayload = await extensionResponse.json()
  assert.equal(extensionResponse.status, 200)
  assert.equal(extensionPayload?.snapshot_version, "test-card-v1")
  assert.equal(Array.isArray(extensionPayload?.genes), true)
  assert.equal(extensionPayload?.genes?.[0]?.symbol, "A1BG")
  assert.equal(extensionResponse.headers.get("x-iconoplasm-data-source"), "published-card-catalog")
})

test("versioned public gene detail is immutable, extension-only, and published-artifact backed", async () => {
  const requestUrl =
    "https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/test-card-v1/genes/A1BG"
  const deniedResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(requestUrl),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  assert.equal(deniedResponse.status, 403)

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(requestUrl, {
        headers: { "X-Iconoplasm-Extension-Version": "0.4.15" },
      }),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.snapshot_version, "test-card-v1")
  assert.equal(payload?.gene?.symbol, "A1BG")
  assert.equal(payload?.gene?.full_name, "alpha-1-B glycoprotein")
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable")
  assert.equal(response.headers.get("x-iconoplasm-data-source"), "published-card-catalog")
  assert.match(String(response.headers.get("etag") || ""), /card-detail-test-card-v1-A1BG/)

  const retiredResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/retired/genes/A1BG",
        { headers: { "X-Iconoplasm-Extension-Version": "0.4.15" } },
      ),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  assert.equal(retiredResponse.status, 404)
  assert.equal(retiredResponse.headers.get("cache-control"), "no-store")
})

test("versioned public gene detail reuses the Worker edge cache and serves HEAD", async () => {
  const previousCaches = globalThis.caches
  const entries = new Map()
  let matches = 0
  let puts = 0
  globalThis.caches = {
    default: {
      async match(request) {
        matches += 1
        return entries.get(request.url)?.clone() || null
      },
      async put(request, response) {
        puts += 1
        entries.set(request.url, response.clone())
      },
    },
  }
  try {
    const env = buildEnv({ KV: buildPublishedCardReadKv() })
    const url =
      "https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/test-card-v1/genes/A1BG"
    const headers = { "X-Iconoplasm-Extension-Version": "0.4.15" }
    const first =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request(url, { headers }),
        env,
        {},
      )
    const second =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request(url, { headers }),
        env,
        {},
      )
    const head =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request(url, { method: "HEAD", headers }),
        env,
        {},
      )

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(head.status, 200)
    assert.equal(await head.text(), "")
    assert.equal(first.headers.get("x-iconoplasm-detail-cache"), "MISS")
    assert.equal(second.headers.get("x-iconoplasm-detail-cache"), "HIT")
    assert.equal(head.headers.get("x-iconoplasm-detail-cache"), "HIT")
    assert.equal(puts, 1)
    assert.equal(matches, 3)
  } finally {
    if (previousCaches === undefined) delete globalThis.caches
    else globalThis.caches = previousCaches
  }
})

test("public gene batch honors lean field projection for extension traffic", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Iconoplasm-Extension-Version": "0.3.0",
        },
        body: JSON.stringify({
          symbols: ["A1BG"],
          fields: ["symbol", "full_name", "color", "essence", "portrait"],
        }),
      }),
      buildEnv({ KV: buildPublishedCardReadKv() }),
      {},
    )
  const payload = await response.json()
  const gene = payload?.genes?.[0] || null

  assert.equal(response.status, 200)
  assert.equal(gene?.symbol, "A1BG")
  assert.equal(gene?.full_name, "alpha-1-B glycoprotein")
  assert.equal(gene?.color, "#dd8c9d")
  assert.deepEqual(gene?.essence, {
    name: "alpha-1-B glycoprotein",
    sex: "Female",
    sex_origin: ["Soluble"],
  })
  assert.equal("manifestation" in (gene || {}), false)
  assert.equal("description" in (gene || {}), false)
  assert.match(
    String(gene?.portrait?.medium_url || ""),
    /^https:\/\/iconoplasm\.brinedew\.bio\/portraits\//,
  )
  assert.equal("media" in (gene || {}), false)
  assert.equal("portrait_candidates" in (gene || {}), false)
  assert.equal("source_links" in (gene || {}), false)
  assert.equal("page_url" in (gene || {}), false)
})

test("overlapping public gene batches share manifest and parsed shard work", async () => {
  const kv = new CountingCardCatalogKv({ pauseReads: true })
  const version = "batch-cache-v1"
  kv.setJson("iconoplasm:gallery-version", { current: version, status: "active" })
  const cards = ["G000", "G001", "G002"].map((symbol) => completeCardCatalogCacheVm(symbol))
  const { manifestKey, shards } = putContentAddressedCardCatalog(kv, {
    version,
    shardCards: [cards.slice(0, 2), cards.slice(2)],
  })
  const env = { KV: kv }

  const [firstResponse, secondResponse] = await Promise.all([
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      publicGeneBatchRequest(["G000", "G001"]),
      env,
    ),
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      publicGeneBatchRequest(["G001", "G002"]),
      env,
    ),
  ])
  const firstPayload = await firstResponse.json()
  const secondPayload = await secondResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.equal(secondResponse.status, 200)
  assert.deepEqual(
    firstPayload.genes.map((gene) => gene.symbol),
    ["G000", "G001"],
  )
  assert.deepEqual(
    secondPayload.genes.map((gene) => gene.symbol),
    ["G001", "G002"],
  )
  assert.equal(kv.reads(manifestKey), 1)
  assert.equal(kv.parses(manifestKey), 1)
  for (const shard of shards) {
    assert.equal(kv.reads(shard.key), 1)
    assert.equal(kv.parses(shard.key), 1)
  }

  const warmResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      publicGeneBatchRequest(["G001"]),
      env,
    )
  assert.equal(warmResponse.status, 200)
  assert.equal(kv.reads(manifestKey), 1)
  assert.equal(kv.parses(manifestKey), 1)
  assert.equal(kv.reads(shards[0].key), 1)
  assert.equal(kv.parses(shards[0].key), 1)
})

test("parsed content-addressed shard cache retains no more than four entries", async () => {
  const kv = new CountingCardCatalogKv()
  const version = "shard-lru-v1"
  const cards = Array.from({ length: 5 }, (_, index) =>
    completeCardCatalogCacheVm(`G${String(index).padStart(3, "0")}`),
  )
  const { manifestKey, shards } = putContentAddressedCardCatalog(kv, {
    version,
    shardCards: cards.map((card) => [card]),
  })
  const env = { KV: kv }

  for (const card of cards) {
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [
      card.symbol,
    ])
    assert.equal(artifact?.bySymbol.get(card.symbol)?.symbol, card.symbol)
  }
  assert.equal(kv.reads(manifestKey), 1)
  assert.equal(kv.parses(manifestKey), 1)
  assert.equal(kv.reads(shards[0].key), 1)
  assert.equal(kv.reads(shards.at(-1).key), 1)

  await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [cards.at(-1).symbol])
  assert.equal(kv.reads(shards.at(-1).key), 1, "newest shard remains hot")

  await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [cards[0].symbol])
  assert.equal(kv.reads(shards[0].key), 2, "oldest shard is reread after the four-entry bound")
  assert.equal(kv.parses(shards[0].key), 2)
})

test("an oversized parsed shard is served but never retained", async () => {
  const kv = new CountingCardCatalogKv()
  const version = "shard-oversized-v1"
  const card = completeCardCatalogCacheVm("G000")
  card.payload.cache_padding = "x".repeat(3 * 1024 * 1024)
  const { manifestKey, shards } = putContentAddressedCardCatalog(kv, {
    version,
    shardCards: [[card]],
  })
  const env = { KV: kv }

  for (let read = 0; read < 2; read += 1) {
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [
      card.symbol,
    ])
    assert.equal(artifact?.bySymbol.get(card.symbol)?.symbol, card.symbol)
  }

  assert.equal(kv.reads(manifestKey), 1, "the small manifest remains cached")
  assert.equal(kv.parses(manifestKey), 1)
  assert.equal(kv.reads(shards[0].key), 2, "the shard exceeds the estimated 16 MiB ceiling")
  assert.equal(kv.parses(shards[0].key), 2)
})

test("parsed shard cache evicts the least-recent entry before aggregate weight exceeds its ceiling", async () => {
  const kv = new CountingCardCatalogKv()
  const version = "shard-weight-lru-v1"
  const cards = [completeCardCatalogCacheVm("G000"), completeCardCatalogCacheVm("G001")]
  for (const card of cards) card.payload.cache_padding = "x".repeat(1536 * 1024)
  const { manifestKey, shards } = putContentAddressedCardCatalog(kv, {
    version,
    shardCards: cards.map((card) => [card]),
  })
  const env = { KV: kv }

  for (const card of cards) {
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [
      card.symbol,
    ])
    assert.equal(artifact?.bySymbol.get(card.symbol)?.symbol, card.symbol)
  }
  await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [cards[1].symbol])
  assert.equal(kv.reads(shards[1].key), 1, "newest weighted shard remains cached")

  await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, [cards[0].symbol])
  assert.equal(kv.reads(manifestKey), 1)
  assert.equal(kv.parses(manifestKey), 1)
  assert.equal(kv.reads(shards[0].key), 2, "aggregate weight evicts the oldest shard")
  assert.equal(kv.parses(shards[0].key), 2)
})

test("manifest cache is bounded and cannot cross published artifact versions", async () => {
  const kv = new CountingCardCatalogKv()
  const manifests = []
  for (let index = 1; index <= 4; index += 1) {
    const version = `manifest-lru-v${index}`
    manifests.push(
      putContentAddressedCardCatalog(kv, {
        version,
        shardCards: [[completeCardCatalogCacheVm("G000", `version ${index}`)]],
      }),
    )
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest({ KV: kv }, version, [
      "G000",
    ])
    assert.equal(artifact?.bySymbol.get("G000")?.payload?.full_name, `version ${index}`)
  }

  const newest = await readIconoplasmPublishedCardCatalogArtifactForTest(
    { KV: kv },
    "manifest-lru-v4",
    ["G000"],
  )
  assert.equal(newest?.bySymbol.get("G000")?.payload?.full_name, "version 4")
  assert.equal(kv.reads(manifests[3].manifestKey), 1, "newest version remains cached")

  const oldest = await readIconoplasmPublishedCardCatalogArtifactForTest(
    { KV: kv },
    "manifest-lru-v1",
    ["G000"],
  )
  assert.equal(oldest?.bySymbol.get("G000")?.payload?.full_name, "version 1")
  assert.equal(kv.reads(manifests[0].manifestKey), 2, "oldest manifest is reread after the bound")
  assert.equal(kv.parses(manifests[0].manifestKey), 2)
})

test("public media hot path uses THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE when bound", async () => {
  const gateway = new FakeOnlyAllowedGateway(async () =>
    Response.json({
      media: {
        symbol: "A1BG",
        width: 999,
        height: 777,
      },
    }),
  )

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG"),
      buildEnv({
        ICONOPLASM_DB: null,
        THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway,
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.media?.width, 999)
  assert.equal(gateway.calls.length, 1)
  assert.equal(
    gateway.calls[0]?.url,
    "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/public/v1/media/A1BG",
  )
  assert.equal(gateway.calls[0]?.method, "GET")
})

test("public gene batch forwards post bodies through THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE", async () => {
  const gateway = new FakeOnlyAllowedGateway(async () =>
    Response.json({
      genes: [{ symbol: "A1BG" }],
    }),
  )

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Iconoplasm-Extension-Version": "0.3.0",
        },
        body: JSON.stringify({ symbols: ["A1BG", "TP53"] }),
      }),
      buildEnv({
        ICONOPLASM_DB: null,
        THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway,
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.genes?.[0]?.symbol, "A1BG")
  assert.equal(gateway.calls.length, 1)
  assert.equal(
    gateway.calls[0]?.url,
    "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/public/v1/genes/batch",
  )
  assert.equal(gateway.calls[0]?.method, "POST")
  assert.deepEqual(JSON.parse(gateway.calls[0]?.body || "null"), { symbols: ["A1BG", "TP53"] })
  assert.equal(gateway.calls[0]?.headers?.["x-iconoplasm-extension-version"], "0.3.0")
})
