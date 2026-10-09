// B-898 Stage 1: THE ONLY trigger of the catalog publisher. Every few minutes
// the Worker compares the newest canonical-affecting publish event with the
// id it last dispatched for; when it moved, it sends one repository_dispatch
// to GitHub Actions (.github/workflows/publish-iconoplasm-catalog.yml), which
// rebuilds catalog/v3/index.json. One D1 row read and one KV read per tick,
// one KV write per dispatch. GitHub's own `schedule` trigger is only a
// backstop (B-893 measured it firing 4 to 11 times a day here).
export const CATALOG_DISPATCH_WATERMARK_KEY = "iconoplasm:catalog-dispatch-watermark"
export const CATALOG_DISPATCH_EVENT_TYPE = "iconoplasm-catalog"
const DISPATCH_URL = "https://api.github.com/repos/Brinedew/brinedew-site/dispatches"
// THE ONE LIST of icono_publish_events actions that change what readers see in
// a gene's stable object or in the catalog object: its winner, its candidate
// gallery, or its place in the catalogue. Every path that adds, removes or
// changes a gene's candidates or winner, or adds, changes or removes its
// catalogue row (B-1055: until then a new gene stayed invisible and a removed
// one kept its page), writes one of these, and the Actions publisher
// republishes every gene with one after its watermark (scripts/publish-iconoplasm-catalog.mjs imports
// this list, as do the runtime's blot backlog and gallery version). Bookkeeping
// actions such as gene_card_materialized stay out, so one publish never
// schedules a second no-op publish.
export const PUBLICATION_AFFECTING_ACTIONS = Object.freeze([
  "publish",
  "auto_promote",
  "vote_auto_promote",
  "reject",
  "legacy_mark",
  "restore_keep",
  "remove_candidate",
  "rollback",
  "unpublish",
  "purge_legacy",
  "manifestation_canonical_changed",
  "candidate_added",
  "candidate_changed",
  "copy_candidate",
  "edit_candidate",
  "generate_candidate",
  "unstale",
  "catalog_upserted",
  "catalog_removed",
])

export async function dispatchIconoplasmCatalogPublication(env, { fetchImpl = fetch } = {}) {
  const token = String(env?.GITHUB_RECAP_DISPATCH_TOKEN || "").trim()
  if (!token) return { dispatched: false, reason: "no_token" }
  if (!env?.ICONOPLASM_DB || !env?.KV) return { dispatched: false, reason: "bindings_missing" }
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT COALESCE(MAX(id), 0) AS id FROM icono_publish_events WHERE action IN (${PUBLICATION_AFFECTING_ACTIONS.map(() => "?").join(",")})`,
  )
    .bind(...PUBLICATION_AFFECTING_ACTIONS)
    .first()
  const highWater = Number(row?.id || 0)
  const stored = Number((await env.KV.get(CATALOG_DISPATCH_WATERMARK_KEY)) || 0)
  if (highWater <= stored) return { dispatched: false, reason: "unchanged", watermark: highWater }
  const response = await fetchImpl(DISPATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "iconoplasm-worker",
    },
    body: JSON.stringify({
      event_type: CATALOG_DISPATCH_EVENT_TYPE,
      client_payload: { watermark_event_id: highWater },
    }),
  })
  await response.body?.cancel().catch(() => {})
  if (!response.ok) {
    return { dispatched: false, reason: `github_${response.status}`, watermark: highWater }
  }
  await env.KV.put(CATALOG_DISPATCH_WATERMARK_KEY, String(highWater))
  return { dispatched: true, watermark: highWater, previous: stored }
}
