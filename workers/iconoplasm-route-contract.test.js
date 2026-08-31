import assert from "node:assert/strict"
import test from "node:test"

// ARCHITECTURE FENCE [IPD-008]: immutable hover-detail routing remains explicit and covered.

import {
  ICONOPLASM_API_SCHEMA_VERSION,
  ICONOPLASM_ROUTE_CONTRACTS,
  matchIconoplasmRouteContract,
} from "./iconoplasm-route-contract.js"
import { resolveIconoplasmRateLimitPolicy } from "./iconoplasm-rate-limit.js"
import {
  ICONOPLASM_DECLARED_API_HANDLER_NAMES,
  ICONOPLASM_DECLARED_GATEWAY_HANDLER_NAMES,
  handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  iconoplasmD1BudgetAttributionFromRequest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const PATTERN_EXAMPLES = Object.freeze({
  public_card_object: `/published-cards/v2/immutable/genes/${"a".repeat(64)}.json`,
  public_card_delivery_index: "/api/public/v1/card-snapshots/card-v1/delivery-index",
  public_card_content_gene: `/api/public/v1/card-content/v1/${"a".repeat(64)}/genes/TP53`,
  public_card_content_portrait: `/api/public/v1/card-content/v1/${"a".repeat(64)}/portraits/TP53`,
  public_catalog_artifact: "/api/public/v1/catalog/catalog.abc123.json",
  public_scanner_artifact: "/api/public/v1/catalog/scanner.abc123.json",
  public_catalog_dump: "/api/public/v1/dumps/catalog.abc123.jsonl",
  public_card_snapshot_gene: "/api/public/v1/card-snapshots/card-v1/genes/TP53",
  public_card_snapshot_portrait_locator: "/api/public/v1/card-snapshots/card-v1/portraits/TP53",
  mobile_card_symbol: "/api/iconoplasm/cards/TP53",
  print_copy_png: "/api/iconoplasm/print-copy/TP53.png",
  print_copy_enrollment: "/api/iconoplasm/print-copy-requests/TP53",
  print_copy_status: "/api/iconoplasm/print-copy-status/TP53",
  print_copy_render: "/api/iconoplasm/print-copy-render/TP53",
  semantic_gene_blot: "/blot/TP53.webp",
  admin_blots_upload: "/api/iconoplasm/admin/blots/TP53",
  public_gene_detail: "/api/public/v1/genes/TP53",
  gene_request_summary: "/api/iconoplasm/requests/gene/TP53/summary",
  gene_request_state_gone: "/api/iconoplasm/requests/gene/TP53",
  emulsion_favorite_item: "/api/iconoplasm/emulsion-favorites/A1-255",
  admin_gene_request_diagnostics: "/api/iconoplasm/admin/requests/gene/TP53/diagnostics",
  caretaker_gene_dossier: "/api/iconoplasm/caretaker/genes/TP53",
  caretaker_revision_body: "/api/iconoplasm/caretaker/genes/TP53/revisions/revision_0001/body",
  caretaker_derivative_body:
    "/api/iconoplasm/caretaker/genes/TP53/derivatives/derivative_0001/body",
  caretaker_revision_create: "/api/iconoplasm/caretaker/genes/TP53/revisions",
  caretaker_canonical_selection: "/api/iconoplasm/caretaker/genes/TP53/canonical-selections",
  caretaker_manifestation_withdraw:
    "/api/iconoplasm/caretaker/genes/TP53/manifestations/manifestation_0001",
  caretaker_manifestation_restore:
    "/api/iconoplasm/caretaker/genes/TP53/manifestations/manifestation_0001/restore",
  caretaker_assignment_action:
    "/api/iconoplasm/caretaker/genes/TP53/assignments/assignment_0001/accept",
  caretaker_supervote: "/api/iconoplasm/caretaker/genes/TP53/supervote",
  caretaker_admin_assignment_action:
    "/api/iconoplasm/admin/caretakers/assignments/assignment_0001/suspend",
  authority_snapshot_status: "/api/iconoplasm/authority/snapshots/snapshot_0001",
  authority_snapshot_parts: "/api/iconoplasm/authority/snapshots/snapshot_0001/parts",
  authority_snapshot_complete: "/api/iconoplasm/authority/snapshots/snapshot_0001/complete",
  authority_revision_body: "/api/iconoplasm/authority/revisions/revision_0001/body",
  authority_derivative_body: "/api/iconoplasm/authority/derivatives/derivative_0001/body",
  authority_tags_derivative_submit:
    "/api/iconoplasm/authority/revisions/revision_0001/tags-derivatives",
  authority_tags_derivative_select:
    "/api/iconoplasm/authority/revisions/revision_0001/tags-derivative-head",
  authority_backups: "/api/iconoplasm/authority/backups/capabilities",
  authority_cutover_status: "/api/iconoplasm/authority/cutover/runs/cutover_0001",
  authority_cutover_actions: "/api/iconoplasm/authority/cutover/runs/cutover_0001/actions",
  authority_maintenance_retention:
    "/api/iconoplasm/authority/maintenance/withdrawal-retention/sweep",
  authority_maintenance_commands: "/api/iconoplasm/authority/maintenance/command-receipts/compact",
  authority_event_compaction_status:
    "/api/iconoplasm/authority/maintenance/event-compaction/checkpoints/checkpoint_0001",
  authority_event_compaction_action:
    "/api/iconoplasm/authority/maintenance/event-compaction/checkpoints/checkpoint_0001/build",
  authority_generation_lease_renew:
    "/api/iconoplasm/authority/generation-leases/generation_lease_0001/renew",
  authority_generation_lease_fail:
    "/api/iconoplasm/authority/generation-leases/generation_lease_0001/fail",
  clan_members: "/api/iconoplasm/clans/Kinase/members",
  gene_comments_legacy_read: "/api/iconoplasm/comments/gene/TP53",
  gene_comments: "/api/iconoplasm/genes/TP53/comments",
  image_edit_job: "/api/iconoplasm/image-edit/jobs/job-1",
  image_edit_job_publish: "/api/iconoplasm/image-edit/jobs/job-1/publish",
  candidate_generation_job: "/api/iconoplasm/candidate-generation/jobs/job-1",
  candidate_generation_job_publish: "/api/iconoplasm/candidate-generation/jobs/job-1/publish",
  admin_gene_detail: "/api/iconoplasm/admin/gene/TP53",
})

function examplePath(route) {
  if (route.match.kind === "exact") return route.match.value
  if (route.match.kind === "prefix") return `${route.match.value}TP53`
  return PATTERN_EXAMPLES[route.id]
}

test("Iconoplasm route contracts are complete, unique, immutable, and executable", () => {
  const ids = new Set()
  const methodPaths = new Set()

  for (const route of ICONOPLASM_ROUTE_CONTRACTS) {
    assert.equal(Object.isFrozen(route), true, `${route.id} must be immutable`)
    assert.equal(ids.has(route.id), false, `duplicate route id: ${route.id}`)
    ids.add(route.id)
    assert.equal(route.schemaVersion, ICONOPLASM_API_SCHEMA_VERSION)
    assert.equal(route.observabilityRoute, route.budgetFamily)
    assert.ok(route.auth, `${route.id} must declare auth intent`)
    if (typeof route.auth === "object") {
      assert.deepEqual(
        Object.keys(route.auth).sort(),
        [...route.methods].sort(),
        `${route.id} must declare auth intent for every method`,
      )
    }
    assert.ok(route.cache, `${route.id} must declare cache intent`)
    assert.ok(route.budgetFamily, `${route.id} must declare a budget family`)
    assert.ok(route.gatewayHandler, `${route.id} must declare a gateway handler`)
    assert.ok(route.methods.length > 0, `${route.id} must declare methods`)

    const path = examplePath(route)
    assert.ok(path, `${route.id} needs a contract test example`)
    for (const method of route.methods) {
      const key = `${method} ${path}`
      assert.equal(methodPaths.has(key), false, `duplicate route contract: ${key}`)
      methodPaths.add(key)
      const match = matchIconoplasmRouteContract(path, method)
      assert.equal(match?.route.id, route.id, `${key} must resolve to ${route.id}`)
      assert.equal(match?.methodAllowed, true)
    }
  }
})

test("every declared gateway handler has exactly one executable registry entry", () => {
  const declaredHandlerNames = Array.from(
    new Set(
      ICONOPLASM_ROUTE_CONTRACTS.map((route) => route.gatewayHandler).filter(
        (handlerName) => handlerName !== "iconoplasm_api",
      ),
    ),
  ).sort()

  assert.deepEqual(ICONOPLASM_DECLARED_GATEWAY_HANDLER_NAMES, declaredHandlerNames)
})

test("retired semantic source-portrait routes are not part of the public contract", () => {
  assert.equal(matchIconoplasmRouteContract("/portrait/TP53.webp", "GET"), null)
})

test("every declared API handler has exactly one executable registry entry", () => {
  const declaredHandlerNames = Array.from(
    new Set(ICONOPLASM_ROUTE_CONTRACTS.map((route) => route.apiHandler).filter(Boolean)),
  ).sort()

  assert.deepEqual(ICONOPLASM_DECLARED_API_HANDLER_NAMES, declaredHandlerNames)
})

test("authority routes declare one least-privilege bearer audience", () => {
  const expected = {
    "authority-generation-bearer": [
      "authority_generation_lease_claim",
      "authority_generation_lease_renew",
      "authority_generation_lease_fail",
      "authority_generation_lease_complete",
    ],
    "authority-replica-bearer": [
      "authority_events",
      "authority_events_ack",
      "authority_snapshots_create",
      "authority_snapshot_status",
      "authority_snapshot_parts",
      "authority_snapshot_complete",
      "authority_revision_body",
      "authority_derivative_body",
      "authority_tags_derivative_submit",
      "authority_tags_derivative_select",
    ],
    "authority-backup-bearer": ["authority_backups"],
    "authority-cutover-bearer": ["authority_cutover_status", "authority_cutover_actions"],
    "authority-maintenance-bearer": [
      "authority_maintenance_retention",
      "authority_maintenance_commands",
      "authority_event_compaction_start",
      "authority_event_compaction_sweep",
      "authority_event_compaction_status",
      "authority_event_compaction_action",
    ],
  }
  const authorityRoutes = ICONOPLASM_ROUTE_CONTRACTS.filter((route) =>
    route.id.startsWith("authority_"),
  )
  assert.equal(
    authorityRoutes.some((route) => route.auth === "service-bearer"),
    false,
  )
  for (const [audience, routeIds] of Object.entries(expected)) {
    assert.deepEqual(
      authorityRoutes
        .filter((route) => route.auth === audience)
        .map((route) => route.id)
        .sort(),
      [...routeIds].sort(),
      audience,
    )
  }
})

test("every route contract resolves to an executable D1 budget classification", () => {
  for (const route of ICONOPLASM_ROUTE_CONTRACTS) {
    const attribution = iconoplasmD1BudgetAttributionFromRequest(
      new Request(`https://iconoplasm.brinedew.bio${examplePath(route)}`, {
        method: route.methods[0],
      }),
    )

    assert.equal(attribution.route_family, route.budgetFamily, route.id)
    assert.notEqual(attribution.budget_class, "non_iconoplasm", route.id)
    assert.ok(attribution.actor_class, route.id)
    assert.ok(attribution.source_class, route.id)
  }
})

test("method admission and edge quota resolve from the same route contract", () => {
  const getResolve = matchIconoplasmRouteContract("/api/public/v1/resolve", "GET")
  assert.equal(getResolve?.route.id, "public_resolve")
  assert.equal(getResolve?.methodAllowed, false)
  assert.equal(
    resolveIconoplasmRateLimitPolicy(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/resolve", { method: "GET" }),
    ),
    null,
  )

  for (const route of ICONOPLASM_ROUTE_CONTRACTS.filter((entry) => entry.rateLimit)) {
    const policy = resolveIconoplasmRateLimitPolicy(
      new Request(`https://iconoplasm.brinedew.bio${examplePath(route)}`, {
        method: route.methods[0],
      }),
    )
    assert.deepEqual(policy, route.rateLimit, `${route.id} quota must come from its route contract`)
  }
})

test("the public schema route is admitted by the production stateful gateway", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/schema"),
      {},
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.api_version, "v1")
  assert.equal(payload.schema_version, ICONOPLASM_API_SCHEMA_VERSION)
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600")
})

test("the public OpenAPI route is executable and advertises service discovery", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/openapi.json"),
      {},
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.openapi, "3.1.0")
  assert.ok(payload.paths["/api/public/v1/images/resolve"])
  assert.match(response.headers.get("Link") || "", /rel="service-desc"/)
})

test("declared route method mismatches return 405 with an Allow contract", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/schema", { method: "POST" }),
      {},
      { waitUntil() {} },
    )

  assert.equal(response.status, 405)
  assert.equal(response.headers.get("Allow"), "GET, HEAD")
  assert.deepEqual(await response.json(), { error: "Method not allowed" })
})

test("declared API handlers execute HEAD through the contract instead of falling through", async () => {
  const response = await handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/catalog/state", {
      method: "HEAD",
      headers: {
        "x-iconoplasm-admin-token": "founder-secret",
        "x-iconoplasm-only-allowed-stateful-worker-internal": "1",
      },
    }),
    {
      ICONOPLASM_ADMIN_TOKEN: "founder-secret",
      ICONOPLASM_DB: {
        prepare() {
          return {
            async all() {
              return {
                results: [
                  {
                    gene_symbol: "TP53",
                    full_name: "tumor protein p53",
                    uniprot: "P04637",
                    color_hex: "#35353C",
                    tmh: 0,
                    aliases_json: "[]",
                  },
                ],
              }
            },
          }
        },
      },
    },
    { waitUntil() {} },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(await response.text(), "")
})
