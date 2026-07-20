const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const ASSET_STATE_SCOPE_REQUIRED = Object.freeze({
  error:
    "Unscoped asset state is disabled because the full asset ledger can exceed the Worker CPU budget. Use POST with a bounded symbols list.",
  code: "ICONOPLASM_ASSET_STATE_SCOPE_REQUIRED",
})

const REQUIRED_FUNCTIONS = Object.freeze([
  "adminPortraitUrl",
  "buildSummaryScope",
  "fetchAssetStateRows",
  "fetchRepairScope",
  "fetchStorageAudit",
  "fetchSummaryCounts",
  "isAdmin",
  "json",
  "normalizeMaintenanceLimit",
  "normalizeMaintenanceSymbols",
  "normalizeArtistTag",
  "normalizeAssetStatus",
  "normalizeSha256",
  "normalizeSymbol",
  "optionalInt",
  "portraitBase",
  "readPublicStatsProjection",
  "sanitizeText",
])

function assertAssetServices(services) {
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin asset service is missing: ${name}`)
    }
  }
  if (!Number.isInteger(services?.stateSymbolMax) || services.stateSymbolMax < 1) {
    throw new TypeError("Iconoplasm admin asset configuration is invalid: stateSymbolMax")
  }
}

function requireDatabase(env, done, json, route) {
  if (env.ICONOPLASM_DB) return null
  return done(`${route}_500`, json({ error: "ICONOPLASM_DB binding missing" }, 500))
}

export function createIconoplasmAdminAssetHandlers(services) {
  assertAssetServices(services)
  const {
    adminPortraitUrl,
    buildSummaryScope,
    fetchAssetStateRows,
    fetchRepairScope,
    fetchStorageAudit,
    fetchSummaryCounts,
    isAdmin,
    json,
    normalizeMaintenanceLimit,
    normalizeMaintenanceSymbols,
    normalizeArtistTag,
    normalizeAssetStatus,
    normalizeSha256,
    normalizeSymbol,
    optionalInt,
    portraitBase,
    readPublicStatsProjection,
    sanitizeText,
    stateSymbolMax,
  } = services

  async function list({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_assets_403", json({ error: "Unauthorized" }, 403))
    const missing = requireDatabase(env, done, json, "admin_assets")
    if (missing) return missing

    const url = new URL(request.url)
    const status = (url.searchParams.get("status") || "all").toLowerCase()
    const stale = (url.searchParams.get("stale") || "all").toLowerCase()
    const legacy = (url.searchParams.get("legacy") || "all").toLowerCase()
    const symbolQuery = normalizeSymbol(url.searchParams.get("symbol") || "")
    const limit = Math.max(
      1,
      Math.min(250, Number.parseInt(url.searchParams.get("limit") || "50", 10)),
    )
    const whereParts = []
    const params = []
    if (symbolQuery) {
      whereParts.push("pa.gene_symbol=?")
      params.push(symbolQuery)
    }
    if (status !== "all") {
      whereParts.push("lower(pa.status)=?")
      params.push(status)
    }
    if (stale === "yes") whereParts.push("COALESCE(pa.is_stale, 0) = 1")
    else if (stale === "no") whereParts.push("COALESCE(pa.is_stale, 0) = 0")
    if (legacy === "yes") whereParts.push("COALESCE(pa.is_legacy, 0) = 1")
    else if (legacy === "no") whereParts.push("COALESCE(pa.is_legacy, 0) = 0")
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
    const stmt = env.ICONOPLASM_DB.prepare(
      `WITH vote_agg AS (
         SELECT
           gene_symbol AS gene_symbol,
           asset_sha256 AS asset_sha256,
           SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
           SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes,
           SUM(vote_value) AS score
         FROM icono_image_votes
         GROUP BY gene_symbol, asset_sha256
       )
       SELECT
         pa.gene_symbol,
         pa.asset_sha256,
         pa.status,
         pa.autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         pa.vision_id,
         pa.artist_tag,
         pa.artist_name,
         pa.created_by,
         pa.created_at,
         COALESCE(v.upvotes, 0) AS image_upvotes,
         COALESCE(v.downvotes, 0) AS image_downvotes,
         COALESCE(v.score, 0) AS image_score,
         CASE
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END AS is_current,
         COALESCE(ps.admin_override, 0) AS admin_override,
         0 AS is_vote_leader
       FROM icono_portrait_assets pa
       LEFT JOIN vote_agg v
        ON v.gene_symbol = pa.gene_symbol
       AND v.asset_sha256 = pa.asset_sha256
       LEFT JOIN icono_publish_state ps
        ON ps.gene_symbol = pa.gene_symbol
       ${where}
       ORDER BY
         is_current DESC,
         COALESCE(v.score, 0) DESC,
         COALESCE(v.upvotes, 0) DESC,
         pa.created_at DESC
       LIMIT ?`,
    ).bind(...params, limit)
    const { results } = await stmt.all()
    const base = portraitBase(url, env)
    const assets = (results || []).map((row) => ({
      ...row,
      is_stale: Number(row?.is_stale || 0) > 0,
      is_legacy: Number(row?.is_legacy || 0) > 0,
      is_current: Number(row?.is_current || 0) > 0,
      admin_override: Number(row?.admin_override || 0) > 0,
      is_vote_leader: Number(row?.is_vote_leader || 0) > 0,
      image_upvotes: Number(row?.image_upvotes || 0),
      image_downvotes: Number(row?.image_downvotes || 0),
      image_score: Number(row?.image_score || 0),
      hero_url: adminPortraitUrl(base, row?.asset_sha256, "full"),
      medium_url: adminPortraitUrl(base, row?.asset_sha256, "medium"),
      thumb_url: adminPortraitUrl(base, row?.asset_sha256, "thumb"),
    }))
    return done("admin_assets", json({ assets, count: assets.length }, 200, NO_STORE))
  }

  async function summary({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_assets_summary_403", json({ error: "Unauthorized" }, 403))
    const missing = requireDatabase(env, done, json, "admin_assets_summary")
    if (missing) return missing

    const url = new URL(request.url)
    const refresh = ["1", "true", "yes"].includes(
      String(url.searchParams.get("refresh") || "")
        .trim()
        .toLowerCase(),
    )
    const summaryRow = await fetchSummaryCounts(env, { refresh })
    const publicStats = await readPublicStatsProjection(env)
    const scopes = buildSummaryScope(summaryRow, publicStats)
    return done(
      "admin_assets_summary",
      json(
        {
          ok: true,
          refreshed: refresh,
          public_scope: scopes.public_scope,
          ledger_scope: scopes.ledger_scope,
          candidate_assets: Number(summaryRow?.candidate_assets || 0),
          catalog_candidate_assets: Number(scopes.public_scope.catalog_candidate_assets || 0),
          auditable_assets: Number(summaryRow?.auditable_assets || 0),
          catalog_auditable_assets: Number(scopes.public_scope.catalog_auditable_assets || 0),
          stale_assets: Number(summaryRow?.stale_assets || 0),
          legacy_assets: Number(summaryRow?.legacy_assets || 0),
          published_live_portraits: Number(summaryRow?.published_live_portraits || 0),
          catalog_published_live_portraits: Number(
            scopes.public_scope.catalog_published_live_portraits || 0,
          ),
          audited_assets: Number(summaryRow?.audited_assets || 0),
          verified_renderable_images: Number(summaryRow?.verified_renderable_images || 0),
          storage_audit_coverage_percent: Number(summaryRow?.storage_audit_coverage_percent || 0),
          storage_incomplete_assets: Number(summaryRow?.storage_incomplete_assets || 0),
          broken_live_images: Number(summaryRow?.broken_live_images || 0),
          renderable_live_confirmed: Number(summaryRow?.renderable_live_confirmed || 0),
          unverified_live_portraits: Number(summaryRow?.unverified_live_portraits || 0),
          renderable_live_exact_known: Boolean(summaryRow?.renderable_live_exact_known),
          last_exact_audit_total:
            summaryRow?.last_exact_audit_total === null ||
            summaryRow?.last_exact_audit_total === undefined
              ? null
              : Number(summaryRow.last_exact_audit_total || 0),
          last_exact_audit_at: sanitizeText(summaryRow?.last_exact_audit_at || "", 64) || null,
          storage_queue_backlog_assets: Number(summaryRow?.storage_queue_backlog_assets || 0),
          storage_queue_seeded_complete: Boolean(summaryRow?.storage_queue_seeded_complete),
          storage_audit_status_note:
            sanitizeText(summaryRow?.storage_audit_status_note || "", 2000) ||
            "Website storage truth has not been computed yet.",
          updated_at: sanitizeText(summaryRow?.updated_at || "", 64) || null,
        },
        200,
        NO_STORE,
      ),
    )
  }

  async function maintenanceRequest({ request, env, done }, operation) {
    if (!(await isAdmin(request, env)))
      return done(`${operation.route}_403`, json({ error: "Unauthorized" }, 403))
    const missing = requireDatabase(env, done, json, operation.route)
    if (missing) return missing
    let payload
    try {
      payload = await request.json()
    } catch {
      return done(`${operation.route}_400`, json({ error: "Invalid JSON" }, 400))
    }
    let requestedSymbols
    let limit
    const mode = sanitizeText(payload?.mode || "backlog-batch", 64).toLowerCase() || "backlog-batch"
    try {
      requestedSymbols = normalizeMaintenanceSymbols(payload?.symbols, 5000)
      limit = normalizeMaintenanceLimit(payload?.limit, operation.defaultLimit, operation.maxLimit)
    } catch (error) {
      return done(
        `${operation.route}_400`,
        json({ error: String(error?.message || error || operation.invalidScopeMessage) }, 400),
      )
    }
    const result = await operation.fetch(env, { requestedSymbols, limit })
    return done(
      operation.route,
      json(operation.formatResult({ mode, requestedSymbols, result }), 200, NO_STORE),
    )
  }

  const storageAudit = (context) =>
    maintenanceRequest(context, {
      route: "admin_assets_storage_audit",
      defaultLimit: 100,
      maxLimit: 500,
      invalidScopeMessage: "Invalid storage audit scope",
      fetch: fetchStorageAudit,
      formatResult: ({ mode, requestedSymbols, result }) => ({
        ok: true,
        mode,
        requested_symbols: requestedSymbols.length,
        count: Array.isArray(result?.rows) ? result.rows.length : 0,
        audited_assets: Number(result?.summary?.audited_assets || 0),
        assets: Array.isArray(result?.rows) ? result.rows : [],
        summary: result?.summary || {},
      }),
    })

  const repairScope = (context) =>
    maintenanceRequest(context, {
      route: "admin_assets_repair_scope",
      defaultLimit: 50,
      maxLimit: 250,
      invalidScopeMessage: "Invalid repair scope",
      fetch: fetchRepairScope,
      formatResult: ({ mode, requestedSymbols, result }) => ({
        ok: true,
        mode,
        requested_symbols: requestedSymbols.length,
        scanned_assets: Number(result?.scanned_assets || 0),
        count: Array.isArray(result?.rows) ? result.rows.length : 0,
        assets: Array.isArray(result?.rows) ? result.rows : [],
        summary: result?.summary || {},
      }),
    })

  async function state({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_assets_state_403", json({ error: "Unauthorized" }, 403))
    const missing = requireDatabase(env, done, json, "admin_assets_state")
    if (missing) return missing
    if (request.method === "GET" || request.method === "HEAD") {
      return done("admin_assets_state_400", json(ASSET_STATE_SCOPE_REQUIRED, 400, NO_STORE))
    }
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_assets_state_400", json({ error: "Invalid JSON" }, 400))
    }
    const rawSymbols = Array.isArray(payload?.symbols) ? payload.symbols : []
    if (rawSymbols.length > stateSymbolMax) {
      return done(
        "admin_assets_state_400",
        json({ error: `Too many symbols (max ${stateSymbolMax})` }, 400),
      )
    }
    const assets = (await fetchAssetStateRows(env, rawSymbols))
      .map((row) => ({
        symbol: normalizeSymbol(row?.gene_symbol || ""),
        asset_sha256: normalizeSha256(row?.asset_sha256 || ""),
        candidate_image_id: optionalInt(row?.candidate_image_id),
        vision_id: sanitizeText(row?.vision_id || "", 255) || "",
        emulsion_id: sanitizeText(row?.emulsion_id || "", 64) || "",
        workflow_id: sanitizeText(row?.workflow_id || "", 32) || "",
        workflow_label: sanitizeText(row?.workflow_label || "", 255) || "",
        workflow_path: sanitizeText(row?.workflow_path || "", 512) || "",
        prompt_version: sanitizeText(row?.prompt_version || "", 16) || "",
        variant_slot: sanitizeText(row?.variant_slot || "", 32) || "",
        sample_label: sanitizeText(row?.sample_label || "", 64) || null,
        sample_number: optionalInt(row?.sample_number),
        sample_text_hash: normalizeSha256(row?.sample_text_hash || "") || null,
        artist_tag: normalizeArtistTag(row?.artist_tag || "") || "",
        artist_name: sanitizeText(row?.artist_name || "", 255) || "",
        status: normalizeAssetStatus(row?.status || "", "draft"),
        is_stale: Number(row?.is_stale || 0) > 0,
        image_upvotes: Number(row?.image_upvotes || 0),
        image_downvotes: Number(row?.image_downvotes || 0),
        image_score: Number(row?.image_score || 0),
      }))
      .filter((row) => row.symbol && row.asset_sha256)
    return done(
      "admin_assets_state",
      json({ ok: true, count: assets.length, assets }, 200, NO_STORE),
    )
  }

  return Object.freeze({
    "admin_assets.list": list,
    "admin_assets.repair_scope": repairScope,
    "admin_assets.state": state,
    "admin_assets.storage_audit": storageAudit,
    "admin_assets.summary": summary,
  })
}
