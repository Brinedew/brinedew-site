// ARCHITECTURE FENCE [IPD-013]
// B-1067: the price of every administrator and workstation route the
// legacy gateway serves, so the app's one fall-through gate (app.js) lets each
// in by its price before it runs (batch-admission.js). This replaced the daily
// budget referee, a Durable Object that wrapped every D1 call and read a
// lagging meter while the work ran.
//
// Chesterton's fence, the 2026-10-11 vote outage: a route without a price is
// work nobody priced. This module refuses to load while a contract route with
// one of these audiences has no entry, or an entry names no route, so a new
// admin route can't ship unpriced by being forgotten.
//
// Each entry is one of:
//   { criticality: "critical", reason }   a person's own small action: runs to
//                                          Cloudflare's wall, never refused here
//   { criticality, price }                 a fixed price per request
//   { criticality, per: { field, unit } }  the body's `field` array, priced per item
// Criticalities and their stops: shared/iconoplasm-d1-budget-policy.js.
import { BATCH_METERS, BATCH_PRICES } from "./batch-admission.js"
import { ICONOPLASM_ROUTE_CONTRACTS } from "../iconoplasm-route-contract.js"

const PRICED_AUDIENCES = new Set(["administrator", "authority-generation-bearer"])

// Unmeasured estimates (2026-10-11), rounded up. Replace one with a measurement
// (d1QueriesAdaptiveGroups for the route's window) when one exists.
// A view over the whole catalogue (about 20,000 genes and their portraits).
const CATALOGUE_READ = Object.freeze({ rows_written: 0, rows_read: 40_000 })
// A view over one gene or one short list.
const SMALL_READ = Object.freeze({ rows_written: 0, rows_read: 2_000 })
// A bounded write: one gene's rows, a policy row, a queue acknowledgement.
const SMALL_WRITE = Object.freeze({ rows_written: 200, rows_read: 2_000 })
// A sweep over many genes in one request (canon repair, legacy purge).
const SWEEP = Object.freeze({ rows_written: 20_000, rows_read: 100_000 })
// Measured (iconoplasm-admin-publication-routes.js): a catalogue row with its
// indexes and an essence row with its indexes.
const CATALOG_ROW = Object.freeze({ rows_written: 14, rows_read: 20 })
const ESSENCE_ROW = Object.freeze({ rows_written: 5, rows_read: 10 })
// A vote and its summary rows (9 written after #592).
const VOTE = Object.freeze({ rows_written: 10, rows_read: 20 })

const critical = (reason) => Object.freeze({ criticality: "critical", reason })
const owner = (price) => Object.freeze({ criticality: "sheddable", price })
const batch = (price) => Object.freeze({ criticality: "sheddable_plus", price })
const perItem = (field, unit, criticality = "sheddable_plus") =>
  Object.freeze({ criticality, per: Object.freeze({ field, unit }) })

const OWN_ACTION = "the owner's own action on one gene, role or setting"

export const BATCH_ROUTE_PRICES = Object.freeze({
  // The Drain's view of readers' open requests and its plan for them.
  admin_requests_open: batch(SMALL_READ),
  admin_requests_drain_plan: batch(SMALL_READ),
  admin_requests_history: owner(SMALL_READ),
  admin_gene_request_diagnostics: owner(SMALL_READ),
  // Each call moves one lease of a reader's request; the request is a person's.
  authority_generation_lease_claim: critical(
    "a reader's request: the lease that starts its portrait",
  ),
  authority_generation_lease_material: critical("a reader's request: reading its lease"),
  authority_generation_lease_renew: critical("a reader's request: keeping its lease"),
  authority_generation_lease_fail: critical("a reader's request: returning its lease"),
  authority_generation_lease_complete: critical("a reader's request: delivering its portrait"),
  caretaker_admin_registry: owner(SMALL_READ),
  caretaker_admin_accounts: owner(SMALL_READ),
  caretaker_admin_genes: owner(SMALL_READ),
  caretaker_admin_terms: owner(SMALL_READ),
  caretaker_admin_assignment_action: critical(OWN_ACTION),
  // One erasure pass writes at most 5,000 rows (its own max_rows_written cap)
  // and its unindexed steps scan about 80,000 rows (docs/ICONOPLASM_OPERATIONS.md).
  // A heavy account takes many passes; the person waits days, not seconds.
  admin_account_erase: batch({ rows_written: 5_000, rows_read: 80_000 }),
  admin_votes_import: perItem("items", VOTE),
  admin_votes_set: critical(OWN_ACTION),
  admin_votes_snapshot: owner(SMALL_READ),
  admin_votes_snapshots: owner(SMALL_READ),
  admin_votes_vision_stats: owner(CATALOGUE_READ),
  admin_votes_vision_previews: owner(SMALL_READ),
  admin_votes_vision_detail: owner(SMALL_READ),
  admin_factory_recipe: batch(SMALL_WRITE),
  admin_factory_belts: batch(SMALL_READ),
  admin_factory_recommendation: batch(SMALL_WRITE),
  admin_factory_visions: batch(SMALL_WRITE),
  admin_diagnostic_matrix: owner(SMALL_WRITE),
  admin_image_edit_prompts: critical(OWN_ACTION),
  admin_caretaker_switch_cooldown: critical(OWN_ACTION),
  admin_me: critical("the sign-in check behind every admin page"),
  admin_ingest: perItem("items", BATCH_PRICES.portrait),
  admin_overview: owner(CATALOGUE_READ),
  admin_coverage: owner(CATALOGUE_READ),
  admin_public_stats_audit: owner(CATALOGUE_READ),
  admin_canon_audit: owner(CATALOGUE_READ),
  admin_read_models_bootstrap: batch(SWEEP),
  admin_read_models_sync: perItem("symbols", BATCH_PRICES.card),
  admin_read_models_shared_discoveries: batch(SMALL_WRITE),
  admin_assets: owner(SMALL_READ),
  admin_assets_summary: owner(CATALOGUE_READ),
  // B-1020 measured 151,000 rows read for one full audit.
  admin_assets_storage_audit: owner({ rows_written: 0, rows_read: 160_000 }),
  admin_assets_repair_scope: owner(CATALOGUE_READ),
  admin_assets_state: batch(CATALOGUE_READ),
  admin_blots_backlog: batch(CATALOGUE_READ),
  admin_blots_upload: batch(SMALL_WRITE),
  admin_publication_pull_zone: critical("no D1 rows: it applies the Bunny pull-zone policy"),
  admin_publication_catalog_object: batch(SMALL_WRITE),
  admin_gallery: owner(SMALL_READ),
  admin_extension_blocklist: critical(OWN_ACTION),
  admin_publication_aliases: critical(OWN_ACTION),
  admin_gallery_mutation_publish: critical(OWN_ACTION),
  admin_gallery_mutation_clear_override: critical(OWN_ACTION),
  admin_gallery_mutation_reject: critical(OWN_ACTION),
  admin_gallery_mutation_rollback: critical(OWN_ACTION),
  admin_gallery_mutation_unpublish: critical(OWN_ACTION),
  admin_gallery_mutation_unstale: critical(OWN_ACTION),
  admin_gallery_mutation_unstale_batch: perItem("symbols", BATCH_PRICES.card),
  admin_gallery_mutation_purge_legacy: batch(SWEEP),
  admin_gallery_mutation_remove_candidate: critical(OWN_ACTION),
  admin_gallery_mutation_restore_mis_rejected_candidates: batch(SWEEP),
  admin_gallery_mutation_canon_repair: batch(SWEEP),
  admin_gene_detail: owner(SMALL_READ),
  admin_local_removals_pending: batch(SMALL_READ),
  admin_local_removals_ack: batch(SMALL_WRITE),
  admin_artist_styles_remove: critical(OWN_ACTION),
  admin_artist_blacklist_pending: batch(SMALL_READ),
  admin_artist_blacklist_ack: batch(SMALL_WRITE),
  admin_catalog_state: perItem("symbols", { rows_written: 0, rows_read: 20 }),
  admin_catalog_upsert: perItem("items", CATALOG_ROW),
  admin_catalog_reconcile: perItem("delete_symbols", CATALOG_ROW),
  admin_catalog_publish: batch(CATALOGUE_READ),
  admin_essence_upsert: perItem("items", ESSENCE_ROW),
  admin_cost_snapshot: critical("no D1 rows: it reads KV and Cloudflare's analytics"),
})

function assertPrices() {
  const routes = ICONOPLASM_ROUTE_CONTRACTS.filter((route) => PRICED_AUDIENCES.has(route.auth))
  const ids = new Set(routes.map((route) => route.id))
  const unpriced = [...ids].filter((id) => !BATCH_ROUTE_PRICES[id])
  const stale = Object.keys(BATCH_ROUTE_PRICES).filter((id) => !ids.has(id))
  const malformed = Object.entries(BATCH_ROUTE_PRICES)
    .filter(([, spec]) => {
      if (spec.criticality === "critical") return !spec.reason
      if (!["sheddable_plus", "sheddable"].includes(spec.criticality)) return true
      const price = spec.per ? spec.per.unit : spec.price
      return (
        !BATCH_METERS.every((meter) => Number.isSafeInteger(price?.[meter]) && price[meter] >= 0) ||
        (spec.per && typeof spec.per.field !== "string")
      )
    })
    .map(([id]) => id)
  if (unpriced.length || stale.length || malformed.length)
    throw new Error(
      `ARCHITECTURE FENCE [IPD-013]: every administrator, workstation and internal route names its D1 price in workers/iconoplasm/batch-route-prices.js (B-1067). Unpriced: ${unpriced.join(", ") || "none"}; no such route: ${stale.join(", ") || "none"}; malformed: ${malformed.join(", ") || "none"}`,
    )
}
assertPrices()

// A contract route's entry here, or null for a reader's own route.
export function batchRouteSpec(route) {
  return (route && PRICED_AUDIENCES.has(route.auth) && BATCH_ROUTE_PRICES[route.id]) || null
}

// The price of one request under a non-critical entry. A per-item price counts
// the JSON body's array, read through readBodyText (the caller reads the body
// once: an ingest body carries base64 renditions, so a clone would double it).
// An unreadable body counts one item.
export async function batchRouteAdmission(spec, readBodyText) {
  if (!spec.per) return { criticality: spec.criticality, price: spec.price }
  let body = null
  try {
    body = JSON.parse(await readBodyText())
  } catch {}
  const items = body?.[spec.per.field]
  const count = Math.max(1, Array.isArray(items) ? items.length : 0)
  return {
    criticality: spec.criticality,
    price: Object.fromEntries(BATCH_METERS.map((meter) => [meter, spec.per.unit[meter] * count])),
  }
}
