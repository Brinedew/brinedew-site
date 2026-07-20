const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const FULL_CATALOG_ERROR = Object.freeze({
  ok: false,
  code: "CARD_ARTIFACT_REQUIRES_FULL_CATALOG",
  error:
    "Card artifact publication has one valid scope: the full catalog. Symbol-scoped artifacts are not allowed because they make unrelated catalog genes look missing.",
  supported_scope: "catalog",
})

const REQUIRED_FUNCTIONS = Object.freeze([
  "coerceBoolean",
  "currentMobileCardSnapshotVersion",
  "ensureBootstrapInitialized",
  "fetchBootstrapState",
  "invalidateGalleryCache",
  "isAdmin",
  "json",
  "normalizeBootstrapSteps",
  "normalizeSymbol",
  "normalizeSymbolBatch",
  "normalizeVisionBatch",
  "runBootstrapStep",
  "sanitizeText",
  "syncReadModels",
  "syncReadModelsAndInvalidateGallery",
  "validVisionId",
  "writeBootstrapState",
])

function assertReadModelServices(services) {
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin read-model service is missing: ${name}`)
    }
  }
  for (const name of [
    "bootstrapCompleteStatus",
    "cardArtifactUnavailableCode",
    "symbolRequestMax",
    "visionRequestMax",
  ]) {
    if (services?.[name] === undefined || services?.[name] === null) {
      throw new TypeError(`Iconoplasm admin read-model configuration is missing: ${name}`)
    }
  }
}

export function createIconoplasmAdminReadModelHandlers(services) {
  assertReadModelServices(services)
  const {
    bootstrapCompleteStatus,
    cardArtifactUnavailableCode,
    coerceBoolean,
    currentMobileCardSnapshotVersion,
    ensureBootstrapInitialized,
    fetchBootstrapState,
    invalidateGalleryCache,
    isAdmin,
    json,
    normalizeBootstrapSteps,
    normalizeSymbol,
    normalizeSymbolBatch,
    normalizeVisionBatch,
    runBootstrapStep,
    sanitizeText,
    symbolRequestMax,
    syncReadModels,
    syncReadModelsAndInvalidateGallery,
    validVisionId,
    visionRequestMax,
    writeBootstrapState,
  } = services

  async function sync({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_read_models_sync_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done(
        "admin_read_models_sync_500",
        json({ error: "ICONOPLASM_DB binding missing" }, 500),
      )
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_read_models_sync_400", json({ error: "Invalid JSON" }, 400))
    }
    const rawSymbols = Array.isArray(payload?.symbols) ? payload.symbols : []
    const rawVisionIds = Array.isArray(payload?.vision_ids ?? payload?.visionIds)
      ? (payload.vision_ids ?? payload.visionIds)
      : []
    if (rawSymbols.length > symbolRequestMax)
      return done(
        "admin_read_models_sync_400",
        json({ error: `Too many symbols (max ${symbolRequestMax})` }, 400),
      )
    if (rawVisionIds.length > visionRequestMax)
      return done(
        "admin_read_models_sync_400",
        json({ error: `Too many vision_ids (max ${visionRequestMax})` }, 400),
      )

    const symbols = Array.from(
      new Set(rawSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
    )
    const visionIds = Array.from(
      new Set(rawVisionIds.map((value) => validVisionId(value)).filter(Boolean)),
    )
    const fullVision = coerceBoolean(payload?.full_vision ?? payload?.fullVision, false)
    const fullRebuild = coerceBoolean(payload?.full_rebuild ?? payload?.fullRebuild, false)
    const skipVoteSummaries = coerceBoolean(
      payload?.skip_vote_summaries ?? payload?.skipVoteSummaries,
      false,
    )
    const skipGeneRollups = coerceBoolean(
      payload?.skip_gene_rollups ?? payload?.skipGeneRollups,
      false,
    )
    const skipVisionRollups = coerceBoolean(
      payload?.skip_vision_rollups ?? payload?.skipVisionRollups,
      false,
    )
    const skipDashboard = coerceBoolean(payload?.skip_dashboard ?? payload?.skipDashboard, false)
    const shouldInvalidateGallery = coerceBoolean(
      payload?.invalidate_gallery ?? payload?.invalidateGallery,
      true,
    )
    const options = {
      symbols,
      visionIds,
      fullVision,
      fullRebuild,
      skipVoteSummaries,
      skipGeneRollups,
      skipVisionRollups,
      skipDashboard,
    }
    // Scoped finalization phases stay D1-only. The durable ledger completion
    // performs the single global card-catalog publication.
    const result = shouldInvalidateGallery
      ? await syncReadModelsAndInvalidateGallery(env, options)
      : await syncReadModels(env, options)
    return done(
      "admin_read_models_sync",
      json(
        {
          ok: true,
          symbols: Number(result?.symbols || 0),
          visions: Number(result?.visions || 0),
          partial: Boolean(result?.partial),
          stop_reason: sanitizeText(result?.stop_reason || "", 255) || null,
          deferred:
            result?.deferred && typeof result.deferred === "object"
              ? {
                  symbols: Math.max(0, Number(result.deferred.symbols || 0) || 0),
                  visions:
                    result.deferred.visions === null || result.deferred.visions === undefined
                      ? null
                      : Math.max(0, Number(result.deferred.visions || 0) || 0),
                  dashboard: Boolean(result.deferred.dashboard),
                }
              : { symbols: 0, visions: 0, dashboard: false },
          budget: result?.budget || null,
          target_daily_percent:
            result?.target_daily_percent === null || result?.target_daily_percent === undefined
              ? null
              : Number(result.target_daily_percent || 0) || null,
          invalidate_gallery: shouldInvalidateGallery,
          full_vision: fullVision,
          full_rebuild: fullRebuild,
          skip_vote_summaries: skipVoteSummaries,
          skip_gene_rollups: skipGeneRollups,
          skip_vision_rollups: skipVisionRollups,
          skip_dashboard: skipDashboard,
          card_catalog:
            result?.card_catalog && typeof result.card_catalog === "object"
              ? {
                  artifact_version:
                    sanitizeText(result.card_catalog.artifact_version || "", 128) || null,
                  artifact_gene_count: Math.max(
                    0,
                    Number(result.card_catalog.artifact_gene_count || 0) || 0,
                  ),
                  catalog_gene_count: Math.max(
                    0,
                    Number(result.card_catalog.catalog_gene_count || 0) || 0,
                  ),
                  artifact_validated_at:
                    sanitizeText(result.card_catalog.artifact_validated_at || "", 64) || null,
                  source: "published_card_catalog",
                }
              : null,
        },
        200,
        NO_STORE,
      ),
    )
  }

  async function warmCardArtifacts({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_card_vms_warm_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_card_vms_warm_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_card_vms_warm_400", json({ error: "Invalid JSON" }, 400))
    }
    const versionInfo = await currentMobileCardSnapshotVersion(env)
    const requestedVersion = sanitizeText(payload?.version || "", 128) || ""
    const snapshotVersion =
      requestedVersion && requestedVersion === versionInfo.previous
        ? versionInfo.previous
        : versionInfo.current
    const scope = String(payload?.scope || "")
      .trim()
      .toLowerCase()
    if (scope && scope !== "catalog")
      return done("admin_card_vms_warm_scope_409", json(FULL_CATALOG_ERROR, 409, NO_STORE))
    if (Array.isArray(payload?.symbols) && payload.symbols.length)
      return done("admin_card_vms_warm_symbols_409", json(FULL_CATALOG_ERROR, 409, NO_STORE))

    let invalidation
    try {
      invalidation = await invalidateGalleryCache(env)
    } catch (error) {
      const errorCode = sanitizeText(String(error?.code || ""), 128) || cardArtifactUnavailableCode
      return done(
        "admin_card_vms_warm_card_artifact_refused",
        json(
          {
            ok: false,
            code: errorCode,
            error: sanitizeText(String(error?.message || error), 1000),
            budget: error?.payload || null,
            version: snapshotVersion,
            scope: "catalog",
          },
          errorCode === "CARD_CATALOG_KV_WRITE_BUDGET_EXHAUSTED" ? 429 : 409,
          NO_STORE,
        ),
      )
    }
    const publishResult = invalidation.card_catalog || {}
    const rebuildInProgress = Boolean(publishResult.bootstrap_more)
    return done(
      "admin_card_vms_warm",
      json(
        {
          ok: true,
          scope: "catalog",
          version: invalidation.version,
          after: sanitizeText(payload?.after || payload?.cursor || "", 64) || "",
          next_cursor: "",
          done: !rebuildInProgress,
          rebuild_in_progress: rebuildInProgress,
          requested: publishResult.catalog_gene_count,
          warmed: publishResult.artifact_gene_count,
          missing: 0,
          artifact_version: publishResult.artifact_version,
          artifact_gene_count: publishResult.artifact_gene_count,
          catalog_gene_count: publishResult.catalog_gene_count,
          artifact_validated_at: publishResult.artifact_validated_at,
          source: "published_card_catalog",
        },
        200,
        NO_STORE,
      ),
    )
  }

  async function bootstrap({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_read_models_bootstrap_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done(
        "admin_read_models_bootstrap_500",
        json({ error: "ICONOPLASM_DB binding missing" }, 500),
      )
    if (request.method === "GET" || request.method === "HEAD") {
      return done(
        "admin_read_models_bootstrap_get",
        json({ ok: true, state: await fetchBootstrapState(env) }, 200, NO_STORE),
      )
    }
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_read_models_bootstrap_400", json({ error: "Invalid JSON" }, 400))
    }
    const reset = coerceBoolean(payload?.reset ?? payload?.restart, false)
    const steps = normalizeBootstrapSteps(payload?.steps)
    const symbolBatch = normalizeSymbolBatch(payload?.symbol_batch ?? payload?.symbolBatch)
    const visionBatch = normalizeVisionBatch(payload?.vision_batch ?? payload?.visionBatch)
    let latest = null
    let processedSymbols = 0
    let processedVisions = 0
    try {
      for (let index = 0; index < steps; index += 1) {
        latest = await runBootstrapStep(env, {
          reset: reset && index === 0,
          symbolBatch,
          visionBatch,
        })
        processedSymbols += Number(latest?.processed?.symbols || 0)
        processedVisions += Number(latest?.processed?.visions || 0)
        if (!latest?.advanced || latest?.state?.status === bootstrapCompleteStatus) break
      }
    } catch (error) {
      const state = await ensureBootstrapInitialized(env)
      await writeBootstrapState(env, {
        ...state,
        last_error: String(error?.message || error || "bootstrap failed").slice(0, 2000),
      })
      throw error
    }
    return done(
      "admin_read_models_bootstrap_post",
      json(
        {
          ok: true,
          steps,
          processed_symbols: processedSymbols,
          processed_visions: processedVisions,
          state: latest?.state || (await fetchBootstrapState(env)),
        },
        200,
        NO_STORE,
      ),
    )
  }

  return Object.freeze({
    "admin_read_models.bootstrap": bootstrap,
    "admin_read_models.card_artifacts_warm": warmCardArtifacts,
    "admin_read_models.sync": sync,
  })
}
