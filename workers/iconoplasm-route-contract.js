export const ICONOPLASM_PUBLIC_API_VERSION = "v1"
export const ICONOPLASM_API_SCHEMA_VERSION = 4
export const ICONOPLASM_PUBLIC_API_PREFIX = `/api/public/${ICONOPLASM_PUBLIC_API_VERSION}`
export const ICONOPLASM_SITE_GENE_API_PREFIX = "/api/iconoplasm/site/genes"

export function iconoplasmPublicApiPath(suffix = "") {
  const normalized = String(suffix || "")
  if (!normalized) return ICONOPLASM_PUBLIC_API_PREFIX
  return normalized.startsWith("/")
    ? `${ICONOPLASM_PUBLIC_API_PREFIX}${normalized}`
    : `${ICONOPLASM_PUBLIC_API_PREFIX}/${normalized}`
}

const GET = Object.freeze(["GET", "HEAD"])
const POST = Object.freeze(["POST"])

function exact(value) {
  return Object.freeze({ kind: "exact", value })
}

function prefix(value, param = null) {
  return Object.freeze({ kind: "prefix", value, param })
}

function pattern(value, params = []) {
  return Object.freeze({ kind: "pattern", value, params: Object.freeze(params) })
}

function rateLimit(id, limit) {
  return Object.freeze({
    id,
    limit,
    period: 60,
    binding: `ICONOPLASM_RATE_LIMIT_${limit}`,
  })
}

function contract(definition) {
  return Object.freeze({
    schemaVersion: ICONOPLASM_API_SCHEMA_VERSION,
    observabilityRoute: definition.budgetFamily,
    ...definition,
  })
}

// Public and first-party read seams are declared once here. Admission, quota,
// cost attribution, and the stateful gateway all consume this same contract.
// A route cannot silently exist in one dispatcher while being absent in another.
export const ICONOPLASM_ROUTE_CONTRACTS = Object.freeze([
  contract({
    id: "public_metadata",
    match: exact(iconoplasmPublicApiPath("/metadata")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    budgetFamily: "public_metadata",
    gatewayHandler: "public_metadata",
    rateLimit: rateLimit("metadata", 60),
  }),
  contract({
    id: "public_stats",
    match: exact(iconoplasmPublicApiPath("/stats")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    budgetFamily: "public_stats",
    gatewayHandler: "public_stats",
    rateLimit: rateLimit("stats", 60),
  }),
  contract({
    id: "public_schema",
    match: exact(iconoplasmPublicApiPath("/schema")),
    methods: GET,
    auth: "public",
    cache: "public-1h",
    budgetFamily: "public_schema",
    gatewayHandler: "public_schema",
    rateLimit: rateLimit("schema", 60),
  }),
  contract({
    id: "public_catalog_manifest",
    match: exact(iconoplasmPublicApiPath("/catalog/manifest")),
    methods: GET,
    auth: "public",
    cache: "public-5m",
    budgetFamily: "public_catalog",
    gatewayHandler: "public_catalog_manifest",
    rateLimit: rateLimit("catalog_manifest", 60),
  }),
  contract({
    id: "public_catalog_artifact",
    match: pattern(/^\/api\/public\/v1\/catalog\/catalog\.([^/]+)\.json$/),
    methods: GET,
    auth: "public",
    cache: "immutable",
    budgetFamily: "public_catalog",
    gatewayHandler: "public_catalog_artifact",
    rateLimit: rateLimit("catalog_artifact", 120),
  }),
  contract({
    id: "public_catalog_dump",
    match: pattern(/^\/api\/public\/v1\/dumps\/catalog\.([^/]+)\.jsonl$/),
    methods: GET,
    auth: "public",
    cache: "immutable",
    budgetFamily: "public_catalog_dump",
    gatewayHandler: "public_catalog_dump",
    rateLimit: rateLimit("catalog_dump", 60),
  }),
  contract({
    id: "public_gallery",
    match: exact(iconoplasmPublicApiPath("/gallery")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    budgetFamily: "public_gallery",
    gatewayHandler: "public_gallery",
    rateLimit: rateLimit("gallery", 60),
  }),
  contract({
    id: "public_gene_search",
    match: exact(iconoplasmPublicApiPath("/genes/search")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    budgetFamily: "public_gene_search",
    gatewayHandler: "public_gene_search",
    rateLimit: rateLimit("gene_search", 120),
  }),
  contract({
    id: "public_gene_batch",
    match: exact(iconoplasmPublicApiPath("/genes/batch")),
    methods: POST,
    auth: "trusted-client",
    cache: "no-store",
    budgetFamily: "public_gene_batch",
    gatewayHandler: "public_gene_batch",
    rateLimit: rateLimit("gene_batch", 60),
  }),
  contract({
    id: "mobile_card_manifest",
    match: exact("/api/iconoplasm/mobile-card-manifest"),
    methods: POST,
    auth: "first-party",
    cache: "no-store",
    budgetFamily: "mobile_card_manifest",
    gatewayHandler: "mobile_card_manifest",
    rateLimit: null,
  }),
  contract({
    id: "mobile_card_symbol",
    match: pattern(/^\/api\/iconoplasm\/cards\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "first-party",
    cache: "versioned-handler",
    budgetFamily: "mobile_card_symbol",
    gatewayHandler: "mobile_card_symbol",
    rateLimit: null,
  }),
  contract({
    id: "print_copy_png",
    match: pattern(/^\/api\/iconoplasm\/print-copy\/([^/]+)\.png$/, ["symbol"]),
    methods: GET,
    auth: "first-party",
    cache: "handler-defined",
    budgetFamily: "print_copy_png",
    gatewayHandler: "print_copy_png",
    rateLimit: null,
  }),
  contract({
    id: "print_copy_render",
    match: pattern(/^\/api\/iconoplasm\/print-copy-render\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "first-party",
    cache: "no-store",
    budgetFamily: "print_copy_render",
    gatewayHandler: "print_copy_render",
    rateLimit: null,
  }),
  contract({
    id: "public_gene_detail",
    match: pattern(/^\/api\/public\/v1\/genes\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "denied-public-rich-route",
    cache: "no-store",
    budgetFamily: "public_gene_detail",
    gatewayHandler: "public_gene_denied",
    rateLimit: null,
  }),
  contract({
    id: "public_resolve",
    match: exact(iconoplasmPublicApiPath("/resolve")),
    methods: POST,
    auth: "public",
    cache: "no-store",
    budgetFamily: "public_resolve",
    gatewayHandler: "public_resolve",
    rateLimit: rateLimit("resolve", 60),
  }),
  contract({
    id: "public_changes",
    match: exact(iconoplasmPublicApiPath("/changes")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    budgetFamily: "public_changes",
    gatewayHandler: "public_changes",
    rateLimit: rateLimit("changes", 60),
  }),
  contract({
    id: "public_media",
    match: prefix(iconoplasmPublicApiPath("/media/"), "symbol"),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    budgetFamily: "public_media",
    gatewayHandler: "public_media",
    rateLimit: rateLimit("media", 120),
  }),
  contract({
    id: "portrait",
    match: prefix("/portraits/", "storageKey"),
    methods: GET,
    auth: "public",
    cache: "immutable",
    budgetFamily: "public_portrait",
    gatewayHandler: "portrait",
    rateLimit: null,
  }),
  contract({
    id: "site_gene_detail",
    match: prefix(`${ICONOPLASM_SITE_GENE_API_PREFIX}/`, "symbol"),
    methods: GET,
    auth: "trusted-browser-or-admin",
    cache: "handler-defined",
    budgetFamily: "site_gene_detail",
    gatewayHandler: "site_gene_detail",
    rateLimit: rateLimit("site_gene", 120),
  }),
  contract({
    id: "artist_blacklist_submission",
    match: exact("/api/iconoplasm/artist-blacklist-submissions"),
    methods: POST,
    auth: "turnstile-or-authenticated-user",
    cache: "no-store",
    budgetFamily: "artist_blacklist_submission",
    gatewayHandler: "iconoplasm_api",
    rateLimit: rateLimit("artist_blocklist_submission", 5),
  }),
])

function matchDescriptor(descriptor, path) {
  if (descriptor.kind === "exact") return path === descriptor.value ? {} : null
  if (descriptor.kind === "prefix") {
    if (!path.startsWith(descriptor.value) || path.length === descriptor.value.length) return null
    return descriptor.param ? { [descriptor.param]: path.slice(descriptor.value.length) } : {}
  }
  const match = descriptor.value.exec(path)
  if (!match) return null
  return Object.fromEntries(descriptor.params.map((name, index) => [name, match[index + 1] || ""]))
}

export function matchIconoplasmRouteContract(path, method = null) {
  const normalizedPath = String(path || "")
  const normalizedMethod = method == null ? null : String(method || "GET").toUpperCase()
  for (const route of ICONOPLASM_ROUTE_CONTRACTS) {
    const params = matchDescriptor(route.match, normalizedPath)
    if (!params) continue
    return Object.freeze({
      route,
      params: Object.freeze(params),
      methodAllowed: normalizedMethod == null || route.methods.includes(normalizedMethod),
    })
  }
  return null
}
