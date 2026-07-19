import assert from "node:assert/strict"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { readIconoplasmPublisherAuthority } from "../scripts/lib/iconoplasm-publisher-authority.mjs"
import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  mergePublishedPortraitRefsIntoArtifact,
  projectPublishedCompatibilityArtifact,
  publishedCatalogContractForClientVersion,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const publisherRelease = readIconoplasmPublisherAuthority(
  fileURLToPath(new URL("..", import.meta.url)),
)
const currentArtifactToken = `a${publisherRelease.contractSchemaVersion}c${publisherRelease.contractRevision}`

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
}

function buildCatalogResolveKv() {
  const hash = "aliascatalog01"
  return new FakeKV({
    "iconoplasm:catalog-manifest": JSON.stringify({
      current_hash: hash,
      generated_at: "2026-05-21T00:00:00.000Z",
      schema_version: 4,
      canonical_key: "symbol",
      gene_count: 2,
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
  })
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
      ],
    },
    4,
  )

  assert.equal(projected.schema_version, 4)
  assert.equal(projected.genes[0].a.includes("p65"), true)
  assert.equal(projected.genes[0].pt, `portraits/v1/cc/${sha}/medium.webp`)
  assert.equal(projected.genes[0].ph, `portraits/v1/cc/${sha}/full.webp`)
  assert.equal("p" in projected.genes[0], false)
})

test("public gene payload includes published portrait dimensions", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/A1BG"),
      buildEnv(),
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
      buildEnv(),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.portrait?.status, "published")
  assert.equal(payload?.portrait?.width, 384)
  assert.equal(payload?.portrait?.height, 512)
  assert.equal(payload?.portrait?.sample_label, "A1BG-3")
  assert.equal(payload?.portrait?.sample_number, 3)
  assert.equal(typeof payload?.essence, "object")
  assert.ok(Array.isArray(payload?.portrait_candidates))
  assert.equal("manifestation" in payload, false)
  assert.equal("description" in payload, false)
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
        buildEnv({ GAME_SESSIONS: sessions }),
        {},
      )
    assert.equal(response.status, 200)
    return response.json()
  }

  const guest = await read()
  const loweren = await read("session=loweren-session")
  const anotherAccount = await read("session=another-session")

  assert.deepEqual(loweren, guest)
  assert.deepEqual(anotherAccount, guest)
  assert.equal(typeof guest.essence, "object")
  assert.ok(Array.isArray(guest.portrait_candidates))
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

test("public media payload includes published portrait dimensions", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG"),
      buildEnv({
        ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.media?.width, 384)
  assert.equal(payload?.media?.height, 512)
  assert.match(
    String(payload?.media?.canonical_url || ""),
    /^https:\/\/iconoplasm\.brinedew\.bio\/portraits\//,
  )
  assert.equal(payload?.media?.info_url, "https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG")
  assert.equal(payload?.media?.asset?.asset_sha256?.length, 64)
  assert.match(
    payload?.media?.asset?.renditions?.medium?.canonical_url || "",
    /^https:\/\/iconoplasm\.brinedew\.bio\/portraits\//,
  )
})

test("public catalog manifest publishes explicit extension contract fields", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
      buildEnv({
        ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
        KV: {
          async get(key) {
            if (key !== "iconoplasm:catalog-manifest") return null
            return JSON.stringify({
              current_hash: "catalog-2026-04-16",
              generated_at: "2026-04-16T16:30:00.000Z",
              gene_count: 19001,
            })
          },
        },
      }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.artifact_schema_version, publisherRelease.contractSchemaVersion)
  assert.equal(payload?.schema_version, publisherRelease.contractSchemaVersion)
  assert.equal(payload?.min_extension_version, publisherRelease.minimumSupportedVersion)
  assert.equal(payload?.catalog_hash, "catalog")
  assert.equal(payload?.build_version, `catalog-2026-04-16-${currentArtifactToken}`)
  assert.ok(
    String(payload?.artifact_url || "").endsWith(
      `/catalog.catalog-2026-04-16-${currentArtifactToken}.json`,
    ),
  )
  assert.deepEqual(payload?.portrait_delivery, {
    version: 1,
    canonical_origin: "https://iconoplasm.brinedew.bio",
    accelerator: {
      id: "bunny",
      origin: "https://iconoplasmportraits.b-cdn.net",
      enabled: true,
    },
    probe_timeout_ms: 2500,
    decision_scope: "tab",
  })
  assert.match(payload?.publication_aliases?.version || "", /^v1-[a-f0-9]{16}$/)
  assert.equal(payload?.publication_aliases?.by_symbol?.RELA?.includes("p65"), true)
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
    compatibilityContract.schemaVersion < publisherRelease.contractSchemaVersion
  const effectiveSchemaVersion = requiresProjection
    ? compatibilityContract.schemaVersion
    : publisherRelease.contractSchemaVersion
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
      buildEnv(),
      {},
    )
  const extensionPayload = await extensionResponse.json()
  assert.equal(extensionResponse.status, 200)
  assert.equal(Array.isArray(extensionPayload?.genes), true)
  assert.equal(extensionPayload?.genes?.[0]?.symbol, "A1BG")
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
      buildEnv(),
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
