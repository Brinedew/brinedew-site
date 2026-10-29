import { IconoplasmVisionEmulsionCodeBoundError } from "./iconoplasm/vision-emulsion-code-bound.js"

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const REQUIRED_FUNCTIONS = Object.freeze([
  "coerceBoolean",
  "isAdmin",
  "json",
  "normalizeSymbol",
  "sanitizeText",
  "syncReadModels",
  "validVisionId",
])

function assertReadModelServices(services) {
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin read-model service is missing: ${name}`)
    }
  }
  for (const name of ["symbolRequestMax", "visionRequestMax"]) {
    if (services?.[name] === undefined || services?.[name] === null) {
      throw new TypeError(`Iconoplasm admin read-model configuration is missing: ${name}`)
    }
  }
}

export function createIconoplasmAdminReadModelHandlers(services) {
  assertReadModelServices(services)
  const {
    coerceBoolean,
    isAdmin,
    json,
    normalizeSymbol,
    sanitizeText,
    symbolRequestMax,
    syncReadModels,
    validVisionId,
    visionRequestMax,
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
    if (!symbols.length && !visionIds.length)
      return done(
        "admin_read_models_sync_400",
        json({ error: "Scoped read-model sync requires at least one symbol or vision_id" }, 400),
      )
    const skipVoteSummaries = coerceBoolean(
      payload?.skip_vote_summaries ?? payload?.skipVoteSummaries,
      false,
    )
    const skipVisionRollups = coerceBoolean(
      payload?.skip_vision_rollups ?? payload?.skipVisionRollups,
      false,
    )
    const skipDashboard = coerceBoolean(payload?.skip_dashboard ?? payload?.skipDashboard, false)
    const options = {
      symbols,
      visionIds,
      skipVoteSummaries,
      skipVisionRollups,
      skipDashboard,
    }
    // A read-model sync is only that. The gene's stable object and the catalog
    // object are published by the per-gene publisher and the Actions catalog
    // publisher.
    let result
    try {
      result = await syncReadModels(env, options)
    } catch (error) {
      // A vision above the emulsion-code bound is refused before any write (B-946).
      // Say so in words: the finalization job keeps this message as its last error.
      if (error instanceof IconoplasmVisionEmulsionCodeBoundError) {
        return done(
          "admin_read_models_sync_409",
          json({ ok: false, error: { code: error.code, message: error.message } }, 409, NO_STORE),
        )
      }
      throw error
    }
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
                  visions: Math.max(0, Number(result.deferred.visions || 0) || 0),
                  dashboard: Boolean(result.deferred.dashboard),
                }
              : { symbols: 0, visions: 0, dashboard: false },
          budget: result?.budget || null,
          target_daily_percent:
            result?.target_daily_percent === null || result?.target_daily_percent === undefined
              ? null
              : Number(result.target_daily_percent || 0) || null,
          skip_vote_summaries: skipVoteSummaries,
          skip_vision_rollups: skipVisionRollups,
          skip_dashboard: skipDashboard,
        },
        200,
        NO_STORE,
      ),
    )
  }

  return Object.freeze({
    "admin_read_models.sync": sync,
  })
}
