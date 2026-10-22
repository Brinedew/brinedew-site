export const ICONOPLASM_PUBLIC_API_VERSION = "v1"
// ARCHITECTURE FENCE [IPD-008]: hover detail is one stable object per gene on the CDN (B-898);
// the card-snapshots routes below serve the 0.5.8 compatibility window from that same object.
export const ICONOPLASM_API_SCHEMA_VERSION = 4
export const ICONOPLASM_PUBLIC_API_PREFIX = `/api/public/${ICONOPLASM_PUBLIC_API_VERSION}`

export function iconoplasmPublicApiPath(suffix = "") {
  const normalized = String(suffix || "")
  if (!normalized) return ICONOPLASM_PUBLIC_API_PREFIX
  return normalized.startsWith("/")
    ? `${ICONOPLASM_PUBLIC_API_PREFIX}${normalized}`
    : `${ICONOPLASM_PUBLIC_API_PREFIX}/${normalized}`
}

const GET = Object.freeze(["GET", "HEAD"])
const POST = Object.freeze(["POST"])
const PUT = Object.freeze(["PUT"])
const GET_POST = Object.freeze(["GET", "HEAD", "POST"])
const COMMENT_METHODS = Object.freeze(["GET", "HEAD", "POST", "PATCH", "DELETE"])
const FAVORITE_ITEM_METHODS = Object.freeze(["PUT", "DELETE"])
const CARETAKER_SUPERVOTE_METHODS = Object.freeze(["GET", "HEAD", "PUT", "DELETE"])

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
    binding: `PUBLIC_RATE_LIMIT_${limit}`,
  })
}

function contract(definition) {
  return Object.freeze({
    schemaVersion: ICONOPLASM_API_SCHEMA_VERSION,
    ...definition,
  })
}

function iconoplasmApiContract(definition) {
  return contract({
    apiHandler: null,
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
    ...definition,
  })
}

function adminApiContract(id, suffix, methods, apiHandler = null) {
  return iconoplasmApiContract({
    apiHandler,
    id,
    match: exact(`/api/iconoplasm/admin${suffix}`),
    methods,
    auth: "administrator",
  })
}

// Migrated public, first-party, and administrative seams are declared once here.
// Admission, quota, cost attribution, and the stateful gateway all consume this contract.
const DECLARED_ROUTES = Object.freeze([
  contract({
    id: "public_openapi",
    match: exact(iconoplasmPublicApiPath("/openapi.json")),
    methods: GET,
    auth: "public",
    cache: "public-1d",
    gatewayHandler: "public_openapi",
    rateLimit: rateLimit("openapi", 60),
  }),
  contract({
    id: "public_metadata",
    match: exact(iconoplasmPublicApiPath("/metadata")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "public_metadata",
    rateLimit: rateLimit("metadata", 60),
  }),
  contract({
    id: "public_schema",
    match: exact(iconoplasmPublicApiPath("/schema")),
    methods: GET,
    auth: "public",
    cache: "public-1h",
    gatewayHandler: "public_schema",
    rateLimit: rateLimit("schema", 60),
  }),
  contract({
    id: "public_catalog_manifest",
    match: exact(iconoplasmPublicApiPath("/catalog/manifest")),
    methods: GET,
    auth: "public",
    cache: "public-5m",
    gatewayHandler: "public_catalog_manifest",
    rateLimit: rateLimit("catalog_manifest", 60),
  }),
  contract({
    id: "public_catalog_artifact",
    match: pattern(/^\/api\/public\/v1\/catalog\/catalog\.([^/]+)\.json$/),
    methods: GET,
    auth: "public",
    cache: "immutable",
    gatewayHandler: "public_catalog_artifact",
    rateLimit: rateLimit("catalog_artifact", 120),
  }),
  contract({
    id: "public_scanner_artifact",
    match: pattern(/^\/api\/public\/v1\/catalog\/scanner\.([^/]+)\.json$/),
    methods: GET,
    auth: "public",
    cache: "immutable",
    gatewayHandler: "public_scanner_artifact",
    rateLimit: rateLimit("catalog_scanner", 120),
  }),
  contract({
    id: "public_catalog_dump",
    match: pattern(/^\/api\/public\/v1\/dumps\/catalog\.([^/]+)\.jsonl$/),
    methods: GET,
    auth: "public",
    cache: "immutable",
    gatewayHandler: "public_catalog_dump",
    rateLimit: rateLimit("catalog_dump", 60),
  }),
  contract({
    id: "public_gene_search",
    match: exact(iconoplasmPublicApiPath("/genes/search")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "public_gene_search",
    rateLimit: rateLimit("gene_search", 120),
  }),
  contract({
    // B-1098: the /caretakers directory, edge-cached for 60 s by its handler.
    id: "public_caretakers",
    match: exact(iconoplasmPublicApiPath("/caretakers")),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "public_caretakers",
    rateLimit: rateLimit("caretakers", 120),
  }),
  contract({
    // B-898: the one stable catalog object, canonical-origin fallback only.
    id: "public_stable_catalog_object",
    match: exact("/api/public/v1/stable-catalog.json"),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "public_stable_catalog_object",
    rateLimit: rateLimit("card_object", 120),
  }),
  contract({
    // B-898: the one stable object per gene, canonical-origin fallback only.
    id: "public_stable_gene_object",
    match: pattern(/^\/api\/public\/v1\/stable-genes\/([A-Z0-9][A-Z0-9._-]{0,63})\.json$/, [
      "symbol",
    ]),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "public_stable_gene_object",
    rateLimit: rateLimit("card_object", 120),
  }),
  contract({
    id: "public_card_snapshot_gene",
    match: pattern(/^\/api\/public\/v1\/card-snapshots\/([^/]+)\/genes\/([^/]+)$/, [
      "snapshot",
      "symbol",
    ]),
    methods: GET,
    auth: "trusted-client",
    cache: "immutable",
    gatewayHandler: "public_card_snapshot_gene",
    rateLimit: rateLimit("gene_detail", 120),
  }),
  contract({
    id: "public_card_snapshot_portrait_locator",
    match: pattern(/^\/api\/public\/v1\/card-snapshots\/([^/]+)\/portraits\/([^/]+)$/, [
      "snapshot",
      "symbol",
    ]),
    methods: GET,
    auth: "trusted-client",
    cache: "immutable",
    gatewayHandler: "public_card_snapshot_portrait_locator",
    rateLimit: rateLimit("portrait_locator", 120),
  }),
  contract({
    id: "public_gene_batch",
    match: exact(iconoplasmPublicApiPath("/genes/batch")),
    methods: POST,
    auth: "trusted-client",
    cache: "no-store",
    gatewayHandler: "public_gene_batch",
    rateLimit: rateLimit("gene_batch", 60),
  }),
  contract({
    id: "mobile_card_manifest",
    match: exact("/api/iconoplasm/mobile-card-manifest"),
    methods: POST,
    auth: "first-party",
    cache: "no-store",
    gatewayHandler: "mobile_card_manifest",
    rateLimit: null,
  }),
  contract({
    id: "mobile_card_symbol",
    match: pattern(/^\/api\/iconoplasm\/cards\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "first-party",
    cache: "versioned-handler",
    gatewayHandler: "mobile_card_symbol",
    rateLimit: null,
  }),
  contract({
    id: "public_gene_detail",
    match: pattern(/^\/api\/public\/v1\/genes\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "denied-public-rich-route",
    cache: "no-store",
    gatewayHandler: "public_gene_denied",
    rateLimit: null,
  }),
  contract({
    id: "public_resolve",
    match: exact(iconoplasmPublicApiPath("/resolve")),
    methods: POST,
    auth: "public",
    cache: "no-store",
    gatewayHandler: "public_resolve",
    rateLimit: rateLimit("resolve", 60),
  }),
  contract({
    id: "public_image_resolve",
    match: exact(iconoplasmPublicApiPath("/images/resolve")),
    methods: POST,
    auth: "public",
    cache: "no-store",
    gatewayHandler: "public_image_resolve",
    rateLimit: rateLimit("image_resolve", 60),
  }),
  contract({
    id: "public_media",
    match: prefix(iconoplasmPublicApiPath("/media/"), "symbol"),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "public_media",
    rateLimit: rateLimit("media", 120),
  }),
  contract({
    id: "portrait",
    match: prefix("/portraits/", "storageKey"),
    methods: GET,
    auth: "public",
    cache: "immutable",
    gatewayHandler: "portrait",
    rateLimit: null,
  }),
  contract({
    id: "gene_card_asset",
    match: prefix("/gene-cards/", "storageKey"),
    methods: GET,
    auth: "public",
    cache: "immutable",
    gatewayHandler: "gene_card_asset",
    rateLimit: null,
  }),
  contract({
    id: "semantic_gene_blot",
    match: pattern(/^\/blot\/([^/]+)\.webp$/, ["symbol"]),
    methods: GET,
    auth: "public",
    cache: "handler-defined",
    gatewayHandler: "semantic_gene_blot",
    rateLimit: null,
  }),
  contract({
    id: "gene_blot_asset",
    match: prefix("/blots/", "storageKey"),
    methods: GET,
    auth: "public",
    cache: "immutable",
    gatewayHandler: "gene_blot_asset",
    rateLimit: null,
  }),
  contract({
    id: "votes_me",
    match: exact("/api/iconoplasm/votes/me"),
    methods: GET,
    auth: "optional-user-session",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    // Retired per-hover writer: always answers 410 without touching D1. Kept on
    // the contract so installed clients stay on the rate-limit/budget map.
    id: "discoveries_encounter",
    match: exact("/api/iconoplasm/discoveries/encounter"),
    methods: POST,
    auth: "optional-user-session",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "discoveries_batch",
    match: exact("/api/iconoplasm/discoveries/batch"),
    methods: POST,
    auth: "optional-user-session",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "discoveries_me",
    match: exact("/api/iconoplasm/discoveries/me"),
    methods: GET,
    auth: "optional-user-session",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "discoveries_membership",
    match: exact("/api/iconoplasm/discoveries/membership"),
    methods: GET,
    auth: "optional-user-session",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "account_gallery_window",
    match: exact("/api/iconoplasm/account-gallery-window"),
    methods: GET,
    auth: "optional-user-session-or-shared-scope",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "discoveries_merge",
    match: exact("/api/iconoplasm/discoveries/merge"),
    methods: POST,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "gene_request_summary",
    match: pattern(/^\/api\/iconoplasm\/requests\/gene\/([^/]+)\/summary$/, ["symbol"]),
    methods: GET,
    auth: "optional-user-session",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "gene_request_options",
    match: exact("/api/iconoplasm/requests/options"),
    methods: GET,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "emulsion_favorites",
    match: exact("/api/iconoplasm/emulsion-favorites"),
    methods: GET,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "emulsion_favorite_item",
    match: pattern(/^\/api\/iconoplasm\/emulsion-favorites\/([^/]+)$/, ["emulsion_id"]),
    methods: FAVORITE_ITEM_METHODS,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "gene_request_state_gone",
    match: pattern(/^\/api\/iconoplasm\/requests\/gene\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "public-removed-route",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "gene_request_submit",
    match: exact("/api/iconoplasm/requests"),
    methods: POST,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "request_notifications",
    match: exact("/api/iconoplasm/notifications"),
    methods: GET,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "request_notifications_read",
    match: exact("/api/iconoplasm/notifications/read"),
    methods: POST,
    auth: "authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "admin_requests_history",
    match: exact("/api/iconoplasm/admin/requests/history"),
    methods: GET,
    auth: "administrator",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  contract({
    id: "admin_requests_open",
    match: exact("/api/iconoplasm/admin/requests/open"),
    methods: GET,
    auth: "administrator",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  iconoplasmApiContract({
    apiHandler: "manifestation_generation_executor",
    id: "authority_generation_lease_claim",
    match: exact("/api/iconoplasm/authority/generation-leases/claim"),
    methods: POST,
    auth: "authority-generation-bearer",
  }),
  iconoplasmApiContract({
    apiHandler: "manifestation_generation_executor",
    id: "authority_generation_lease_material",
    match: pattern(/^\/api\/iconoplasm\/authority\/generation-leases\/([^/]+)\/material$/, [
      "lease_token",
    ]),
    methods: POST,
    auth: "authority-generation-bearer",
  }),
  iconoplasmApiContract({
    apiHandler: "manifestation_generation_executor",
    id: "authority_generation_lease_renew",
    match: pattern(/^\/api\/iconoplasm\/authority\/generation-leases\/([^/]+)\/renew$/, [
      "lease_token",
    ]),
    methods: POST,
    auth: "authority-generation-bearer",
  }),
  iconoplasmApiContract({
    apiHandler: "manifestation_generation_executor",
    id: "authority_generation_lease_fail",
    match: pattern(/^\/api\/iconoplasm\/authority\/generation-leases\/([^/]+)\/fail$/, [
      "lease_token",
    ]),
    methods: POST,
    auth: "authority-generation-bearer",
  }),
  iconoplasmApiContract({
    apiHandler: "manifestation_generation_executor",
    id: "authority_generation_lease_complete",
    match: exact("/api/iconoplasm/authority/generation-leases/complete"),
    methods: POST,
    auth: "authority-generation-bearer",
  }),
  contract({
    id: "admin_gene_request_diagnostics",
    match: pattern(/^\/api\/iconoplasm\/admin\/requests\/gene\/([^/]+)\/diagnostics$/, ["symbol"]),
    methods: GET,
    auth: "administrator",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: null,
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_gene_claim",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/claim$/, ["gene"]),
    methods: GET_POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_gene_dossier",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)$/, ["gene"]),
    methods: GET,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_notifications",
    id: "caretaker_coordination",
    match: exact("/api/iconoplasm/caretaker/me"),
    methods: GET,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_notifications",
    id: "caretaker_coordination_comments_read",
    match: exact("/api/iconoplasm/caretaker/me/comments/read"),
    methods: POST,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_derivative_body",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/derivatives\/([^/]+)\/body$/, [
      "gene",
      "derivative_id",
    ]),
    methods: GET,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_revision_create",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions$/, ["gene"]),
    methods: POST,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_save_with_tags",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/saves$/, ["gene"]),
    methods: POST,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_taggerize",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/taggerize$/, ["gene"]),
    methods: POST,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_manifestation_page_visibility",
    match: pattern(
      /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/manifestations\/([^/]+)\/page-visibility$/,
      ["gene", "manifestation_id"],
    ),
    methods: POST,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    apiHandler: "caretaker_manifestations",
    id: "caretaker_assignment_action",
    match: pattern(
      /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/assignments\/([^/]+)\/(accept|decline|end)$/,
      ["gene", "assignment_id", "action"],
    ),
    methods: POST,
    auth: "authenticated-caretaker",
  }),
  iconoplasmApiContract({
    id: "caretaker_supervote",
    match: pattern(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/supervote$/, ["symbol"]),
    methods: CARETAKER_SUPERVOTE_METHODS,
    auth: "authenticated-caretaker",
  }),
  adminApiContract(
    "caretaker_admin_registry",
    "/caretakers/registry",
    GET,
    "caretaker_admin.registry",
  ),
  adminApiContract(
    "caretaker_admin_accounts",
    "/caretakers/accounts",
    GET,
    "caretaker_admin.accounts",
  ),
  adminApiContract("caretaker_admin_genes", "/caretakers/genes", GET, "caretaker_admin.genes"),
  adminApiContract("caretaker_admin_terms", "/caretakers/terms", GET, "caretaker_admin.terms"),
  iconoplasmApiContract({
    apiHandler: "caretaker_admin.mutate",
    id: "caretaker_admin_assignment_action",
    match: pattern(
      /^\/api\/iconoplasm\/admin\/caretakers\/assignments\/([^/]+)\/(cancel|suspend|resume|end|withdraw)$/,
      ["assignment_id", "action"],
    ),
    methods: POST,
    auth: "administrator",
  }),
  // B-871: one operator command fulfils an erasure request (privacy page).
  iconoplasmApiContract({
    apiHandler: "admin_account.erase",
    id: "admin_account_erase",
    match: exact("/api/iconoplasm/admin/accounts/erase"),
    methods: POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "votes_set",
    match: exact("/api/iconoplasm/votes/set"),
    methods: POST,
    auth: "first-party-or-extension",
  }),
  iconoplasmApiContract({
    id: "votes_snapshot",
    match: exact("/api/iconoplasm/votes/snapshot"),
    methods: POST,
    auth: "first-party-or-extension",
  }),
  iconoplasmApiContract({
    id: "admin_votes_vision_stats",
    match: exact("/api/iconoplasm/admin/votes/vision-stats"),
    methods: GET,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_votes_vision_previews",
    match: exact("/api/iconoplasm/admin/votes/vision-previews"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_votes_vision_detail",
    match: exact("/api/iconoplasm/admin/votes/vision-detail"),
    methods: GET,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "clans_overview",
    match: exact("/api/iconoplasm/clans"),
    methods: GET,
    auth: "optional-user-session",
  }),
  iconoplasmApiContract({
    id: "clan_members",
    match: pattern(/^\/api\/iconoplasm\/clans\/([^/]+)\/members$/, ["clan"]),
    methods: GET,
    auth: "optional-user-session",
  }),
  iconoplasmApiContract({
    id: "gene_comments_legacy_write",
    match: exact("/api/iconoplasm/comments"),
    methods: POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    id: "gene_comments_legacy_read",
    match: pattern(/^\/api\/iconoplasm\/comments\/gene\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "optional-user-session",
  }),
  iconoplasmApiContract({
    id: "gene_comments",
    match: pattern(/^\/api\/iconoplasm\/genes\/([^/]+)\/comments$/, ["symbol"]),
    methods: COMMENT_METHODS,
    auth: Object.freeze({
      GET: "optional-user-session",
      HEAD: "optional-user-session",
      POST: "authenticated-user",
      PATCH: "authenticated-owner",
      DELETE: "authenticated-owner",
    }),
  }),
  iconoplasmApiContract({
    id: "admin_factory_recipe",
    match: exact("/api/iconoplasm/admin/factory-recipe"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_factory_belts",
    match: exact("/api/iconoplasm/admin/factory-belts"),
    methods: GET,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_factory_recommendation",
    match: exact("/api/iconoplasm/admin/factory-recommendation"),
    methods: POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_factory_visions",
    match: exact("/api/iconoplasm/admin/factory-visions"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_diagnostic_matrix",
    match: exact("/api/iconoplasm/admin/diagnostic-matrices"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_image_edit_prompts",
    match: exact("/api/iconoplasm/admin/image-edit-prompts"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_caretaker_switch_cooldown",
    match: exact("/api/iconoplasm/admin/caretaker-switch-cooldown"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "admin_discord_switches",
    match: exact("/api/iconoplasm/admin/discord-switches"),
    methods: GET_POST,
    auth: "administrator",
  }),
  iconoplasmApiContract({
    id: "image_edit_providers",
    match: exact("/api/iconoplasm/image-edit/providers"),
    methods: GET_POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    id: "user_emulsion",
    match: exact("/api/iconoplasm/user-emulsion"),
    methods: GET_POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    id: "image_edit_jobs_create",
    match: exact("/api/iconoplasm/image-edit/jobs"),
    methods: POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    id: "image_edit_job",
    match: pattern(/^\/api\/iconoplasm\/image-edit\/jobs\/([^/]+)$/, ["jobId"]),
    methods: GET,
    auth: "authenticated-owner",
  }),
  iconoplasmApiContract({
    id: "image_edit_job_publish",
    match: pattern(/^\/api\/iconoplasm\/image-edit\/jobs\/([^/]+)\/publish$/, ["jobId"]),
    methods: POST,
    auth: "authenticated-owner",
  }),
  iconoplasmApiContract({
    id: "candidate_generation_jobs_create",
    match: exact("/api/iconoplasm/candidate-generation/jobs"),
    methods: POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    id: "candidate_generation_job",
    match: pattern(/^\/api\/iconoplasm\/candidate-generation\/jobs\/([^/]+)$/, ["jobId"]),
    methods: GET,
    auth: "authenticated-owner",
  }),
  iconoplasmApiContract({
    id: "candidate_generation_job_publish",
    match: pattern(/^\/api\/iconoplasm\/candidate-generation\/jobs\/([^/]+)\/publish$/, ["jobId"]),
    methods: POST,
    auth: "authenticated-owner",
  }),
  iconoplasmApiContract({
    id: "candidate_copy",
    match: exact("/api/iconoplasm/candidates/copy"),
    methods: POST,
    auth: "authenticated-user",
  }),
  iconoplasmApiContract({
    id: "artist_styles_search",
    match: exact("/api/iconoplasm/artist-styles/search"),
    methods: GET,
    auth: "public",
  }),
  adminApiContract("admin_ingest", "/ingest", POST),
  adminApiContract("admin_overview", "/overview", GET),
  adminApiContract("admin_coverage", "/coverage", GET),
  adminApiContract("admin_public_stats_audit", "/public-stats/audit", GET),
  adminApiContract("admin_canon_audit", "/canon-audit", GET),
  adminApiContract("admin_read_models_sync", "/read-models/sync", POST, "admin_read_models.sync"),
  adminApiContract(
    "admin_read_models_shared_discoveries",
    "/read-models/shared-discoveries",
    POST,
    "admin_publication.shared_discoveries",
  ),
  adminApiContract("admin_assets", "/assets", GET, "admin_assets.list"),
  adminApiContract("admin_assets_summary", "/assets/summary", GET, "admin_assets.summary"),
  adminApiContract(
    "admin_assets_storage_audit",
    "/assets/storage-audit",
    POST,
    "admin_assets.storage_audit",
  ),
  adminApiContract(
    "admin_assets_repair_scope",
    "/assets/repair-scope",
    POST,
    "admin_assets.repair_scope",
  ),
  adminApiContract("admin_assets_state", "/assets/state", GET_POST, "admin_assets.state"),
  iconoplasmApiContract({
    // B-898: apply bunny/the-only-iconoplasm-pull-zone-policy.json (CORS extensions, edge rules).
    id: "admin_publication_pull_zone",
    match: exact("/api/iconoplasm/admin/publication/reconcile-pull-zone"),
    methods: POST,
    auth: "administrator",
    apiHandler: "admin_publication.pull_zone_reconcile",
  }),
  iconoplasmApiContract({
    // B-1087: the Bunny balance, this month's charges and the storage zone's size.
    id: "admin_publication_bunny_account",
    match: exact("/api/iconoplasm/admin/publication/bunny-account"),
    methods: GET,
    auth: "administrator",
    apiHandler: "admin_publication.bunny_account",
  }),
  // B-733: the daily digest in #iconoplasm: a finished day's data, and its post.
  adminApiContract("admin_daily_digest_day", "/daily-digest/day", GET, "admin_daily_digest.day"),
  adminApiContract(
    "admin_daily_digest_post",
    "/daily-digest/post",
    POST,
    "admin_daily_digest.post",
  ),
  iconoplasmApiContract({
    // B-898: the GitHub Actions publisher uploads the one catalog object here.
    id: "admin_publication_catalog_object",
    match: exact("/api/iconoplasm/admin/publication/catalog-object"),
    methods: PUT,
    auth: "administrator",
    apiHandler: "admin_publication.catalog_object_put",
  }),
  adminApiContract("admin_gallery", "/gallery", GET, "admin_gallery.list"),
  adminApiContract(
    "admin_extension_blocklist",
    "/extension-blocklist",
    GET_POST,
    "admin_extension_blocklist.policy",
  ),
  adminApiContract(
    "admin_publication_aliases",
    "/publication-aliases",
    GET_POST,
    "admin_publication_aliases.policy",
  ),
  ...[
    "publish",
    "clear-override",
    "reject",
    "rollback",
    "unpublish",
    "unstale",
    "unstale-batch",
    "purge-legacy",
    "remove-candidate",
  ].map((action) =>
    adminApiContract(
      `admin_gallery_mutation_${action.replaceAll("/", "_").replaceAll("-", "_")}`,
      `/${action}`,
      POST,
    ),
  ),
  iconoplasmApiContract({
    id: "admin_gene_detail",
    match: pattern(/^\/api\/iconoplasm\/admin\/gene\/([^/]+)$/, ["symbol"]),
    methods: GET,
    auth: "administrator",
  }),
  adminApiContract("admin_local_removals_pending", "/local-removals/pending", GET),
  adminApiContract("admin_local_removals_ack", "/local-removals/ack", POST),
  adminApiContract("admin_artist_styles_remove", "/artist-styles/remove", POST),
  adminApiContract("admin_artist_blacklist_pending", "/artist-blacklist-submissions/pending", GET),
  adminApiContract("admin_artist_blacklist_ack", "/artist-blacklist-submissions/ack", POST),
  adminApiContract(
    "admin_catalog_state",
    "/catalog/state",
    POST,
    "admin_publication.catalog_state",
  ),
  adminApiContract(
    "admin_catalog_upsert",
    "/catalog/upsert",
    POST,
    "admin_publication.catalog_upsert",
  ),
  adminApiContract(
    "admin_catalog_reconcile",
    "/catalog/reconcile",
    POST,
    "admin_publication.catalog_reconcile",
  ),
  adminApiContract(
    "admin_essence_upsert",
    "/essence/upsert",
    POST,
    "admin_publication.essence_upsert",
  ),
  adminApiContract("admin_cost_snapshot", "/cost/snapshot", GET),
  contract({
    id: "artist_blacklist_submission",
    match: exact("/api/iconoplasm/artist-blacklist-submissions"),
    methods: POST,
    auth: "turnstile-or-authenticated-user",
    cache: "no-store",
    gatewayHandler: "iconoplasm_api",
    rateLimit: rateLimit("artist_blocklist_submission", 5),
  }),
])

// Who calls each route, so "is this used?" is answered here instead of by a
// search across four repositories. Checked by hand on 2026-10-22 (B-1148)
// against the site's JS, the extension, the workstation (D:\Coding\Iconoplasm)
// and our scripts and workflows.
//   site         our own pages, admin pages included
//   extension    the browser extension, old builds included
//   workstation  the Iconoplasm workstation app
//   ops          a GitHub workflow, one of our scripts, or a runbook step run by hand
//   outside      documented for outside developers or chatbots (the developers page, llms text)
//   none-known   nothing of ours calls it; kept only until the per-request record
//                shows no outside client still does (B-1148), then deleted
// A new route names its callers here; iconoplasm-route-contract.test.js fails
// a route without an entry, and an entry without a route.
export const ICONOPLASM_ROUTE_CALLER_KINDS = Object.freeze([
  "site",
  "extension",
  "workstation",
  "ops",
  "outside",
  "none-known",
])
export const ICONOPLASM_ROUTE_CALLERS = Object.freeze({
  public_openapi: ["outside"],
  public_metadata: ["site", "ops", "outside"],
  public_schema: ["outside"],
  public_catalog_manifest: ["extension", "workstation", "ops"],
  public_catalog_artifact: ["extension"],
  public_scanner_artifact: ["extension"],
  public_catalog_dump: ["outside"],
  public_gene_search: ["site"],
  public_caretakers: ["site", "outside"],
  public_stable_catalog_object: ["site"],
  public_stable_gene_object: ["site", "ops"],
  public_card_snapshot_gene: ["extension"],
  public_card_snapshot_portrait_locator: ["extension"],
  public_gene_batch: ["workstation"],
  mobile_card_manifest: ["site", "ops"],
  mobile_card_symbol: ["none-known"],
  public_gene_detail: ["none-known"],
  public_resolve: ["site", "ops", "outside"],
  public_image_resolve: ["site", "outside"],
  public_media: ["outside"],
  portrait: ["site", "extension"],
  gene_card_asset: ["site", "extension"],
  semantic_gene_blot: ["site", "ops", "outside"],
  gene_blot_asset: ["outside"],
  votes_me: ["none-known"],
  discoveries_encounter: ["none-known"],
  discoveries_batch: ["site", "extension", "ops"],
  discoveries_me: ["site"],
  discoveries_membership: ["extension"],
  account_gallery_window: ["site", "ops"],
  discoveries_merge: ["site", "extension", "ops"],
  gene_request_summary: ["site"],
  gene_request_options: ["site"],
  emulsion_favorites: ["site"],
  emulsion_favorite_item: ["site"],
  gene_request_state_gone: ["none-known"],
  gene_request_submit: ["site"],
  request_notifications: ["site"],
  request_notifications_read: ["site"],
  admin_requests_history: ["site"],
  admin_requests_open: ["workstation"],
  authority_generation_lease_claim: ["workstation"],
  authority_generation_lease_material: ["workstation"],
  authority_generation_lease_renew: ["workstation"],
  authority_generation_lease_fail: ["workstation"],
  authority_generation_lease_complete: ["workstation"],
  admin_gene_request_diagnostics: ["site"],
  caretaker_gene_claim: ["site"],
  caretaker_gene_dossier: ["site"],
  caretaker_coordination: ["site"],
  caretaker_coordination_comments_read: ["site"],
  caretaker_derivative_body: ["site"],
  caretaker_revision_create: ["site"],
  caretaker_save_with_tags: ["site"],
  caretaker_taggerize: ["site"],
  caretaker_manifestation_page_visibility: ["site"],
  caretaker_assignment_action: ["site"],
  caretaker_supervote: ["site"],
  caretaker_admin_registry: ["site"],
  caretaker_admin_accounts: ["site"],
  caretaker_admin_genes: ["site"],
  caretaker_admin_terms: ["site"],
  caretaker_admin_assignment_action: ["site"],
  admin_account_erase: ["ops"],
  votes_set: ["site", "extension", "ops"],
  votes_snapshot: ["site", "extension"],
  admin_votes_vision_stats: ["site"],
  admin_votes_vision_previews: ["site"],
  admin_votes_vision_detail: ["site"],
  clans_overview: ["site"],
  clan_members: ["site"],
  gene_comments_legacy_write: ["none-known"],
  gene_comments_legacy_read: ["none-known"],
  gene_comments: ["site"],
  admin_factory_recipe: ["site", "workstation"],
  admin_factory_belts: ["site"],
  admin_factory_recommendation: ["site"],
  admin_factory_visions: ["workstation"],
  admin_diagnostic_matrix: ["site"],
  admin_image_edit_prompts: ["site"],
  admin_caretaker_switch_cooldown: ["site"],
  admin_discord_switches: ["site"],
  image_edit_providers: ["site"],
  user_emulsion: ["site"],
  image_edit_jobs_create: ["site"],
  image_edit_job: ["site"],
  image_edit_job_publish: ["site"],
  candidate_generation_jobs_create: ["site"],
  candidate_generation_job: ["site"],
  candidate_generation_job_publish: ["site"],
  candidate_copy: ["site"],
  artist_styles_search: ["none-known"],
  admin_ingest: ["workstation"],
  admin_overview: ["site", "workstation"],
  admin_coverage: ["site"],
  admin_public_stats_audit: ["workstation"],
  admin_canon_audit: ["workstation"],
  admin_read_models_sync: ["workstation"],
  admin_read_models_shared_discoveries: ["ops"],
  admin_assets: ["workstation"],
  admin_assets_summary: ["workstation"],
  admin_assets_storage_audit: ["workstation"],
  admin_assets_repair_scope: ["workstation"],
  admin_assets_state: ["workstation"],
  admin_publication_pull_zone: ["ops"],
  admin_publication_bunny_account: ["ops"],
  admin_daily_digest_day: ["ops"],
  admin_daily_digest_post: ["ops"],
  admin_publication_catalog_object: ["ops"],
  admin_gallery: ["site"],
  admin_extension_blocklist: ["site"],
  admin_publication_aliases: ["site"],
  admin_gallery_mutation_publish: ["site"],
  admin_gallery_mutation_clear_override: ["site"],
  admin_gallery_mutation_reject: ["site"],
  admin_gallery_mutation_rollback: ["site"],
  admin_gallery_mutation_unpublish: ["site"],
  admin_gallery_mutation_unstale: ["site"],
  admin_gallery_mutation_unstale_batch: ["site"],
  admin_gallery_mutation_purge_legacy: ["site"],
  admin_gallery_mutation_remove_candidate: ["site"],
  admin_gene_detail: ["site"],
  admin_local_removals_pending: ["workstation"],
  admin_local_removals_ack: ["workstation"],
  admin_artist_styles_remove: ["workstation"],
  admin_artist_blacklist_pending: ["site", "workstation"],
  admin_artist_blacklist_ack: ["workstation"],
  admin_catalog_state: ["workstation"],
  admin_catalog_upsert: ["workstation"],
  admin_catalog_reconcile: ["workstation"],
  admin_essence_upsert: ["workstation"],
  admin_cost_snapshot: ["site", "ops"],
  artist_blacklist_submission: ["site"],
})

export const ICONOPLASM_ROUTE_CONTRACTS = Object.freeze(
  DECLARED_ROUTES.map((route) =>
    Object.freeze({ ...route, callers: ICONOPLASM_ROUTE_CALLERS[route.id] || Object.freeze([]) }),
  ),
)

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
