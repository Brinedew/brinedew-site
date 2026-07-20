const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })

const REQUIRED_SERVICE_NAMES = Object.freeze([
  "actor",
  "coerceBoolean",
  "fetchCatalogState",
  "fetchCatalogStateRows",
  "fetchEssenceStateRows",
  "isAdmin",
  "json",
  "mutationLimiterSnapshot",
  "normalizeCatalogPayloadItem",
  "normalizeEssencePayload",
  "normalizeSymbol",
  "publishCatalogArtifact",
  "rebuildSharedGeneDiscoveryRollup",
  "sanitizeText",
  "syncAdminReadModels",
  "upsertGeneEssence",
])

function assertPublicationServices(services) {
  for (const name of REQUIRED_SERVICE_NAMES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm admin publication service is missing: ${name}`)
    }
  }
}

export function createIconoplasmAdminPublicationHandlers(services) {
  assertPublicationServices(services)
  const {
    actor,
    coerceBoolean,
    fetchCatalogState,
    fetchCatalogStateRows,
    fetchEssenceStateRows,
    isAdmin,
    json,
    mutationLimiterSnapshot,
    normalizeCatalogPayloadItem,
    normalizeEssencePayload,
    normalizeSymbol,
    publishCatalogArtifact,
    rebuildSharedGeneDiscoveryRollup,
    sanitizeText,
    syncAdminReadModels,
    upsertGeneEssence,
  } = services

  async function catalogState({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_catalog_state_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_catalog_state_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
    if (request.method === "POST") {
      let payload
      try {
        payload = await request.json()
      } catch {
        return done("admin_catalog_state_400", json({ error: "Invalid JSON" }, 400))
      }
      const rawSymbols = Array.isArray(payload?.symbols) ? payload.symbols : []
      if (rawSymbols.length > 25000)
        return done("admin_catalog_state_400", json({ error: "Too many symbols (max 25000)" }, 400))
      const rows = await fetchCatalogStateRows(env, rawSymbols.length ? rawSymbols : null)
      return done(
        "admin_catalog_state",
        json({ ok: true, count: rows.length, rows }, 200, NO_STORE),
      )
    }
    const state = await fetchCatalogState(env)
    return done(
      "admin_catalog_state",
      json(
        {
          ok: true,
          gene_count: Number(state.gene_count || 0),
          content_hash: String(state.content_hash || ""),
        },
        200,
        NO_STORE,
      ),
    )
  }

  async function catalogUpsert({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_catalog_upsert_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_catalog_upsert_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_catalog_upsert_400", json({ error: "Invalid JSON" }, 400))
    }
    const items = Array.isArray(payload?.items) ? payload.items : []
    const deferReadModels = coerceBoolean(
      payload?.defer_read_models ?? payload?.deferReadModels,
      false,
    )
    if (!items.length)
      return done("admin_catalog_upsert_400", json({ error: "No items provided" }, 400))
    if (items.length > 1000)
      return done("admin_catalog_upsert_400", json({ error: "Too many items (max 1000)" }, 400))

    const actorId = await actor(request, env)
    const source =
      sanitizeText(payload?.source || "nicegui_catalog_sync", 64) || "nicegui_catalog_sync"
    let processed = 0
    let invalid = 0
    const results = []
    for (const rawItem of items) {
      const item = normalizeCatalogPayloadItem(rawItem)
      if (!item || item.validation_error) {
        invalid += 1
        results.push({
          ok: false,
          symbol:
            normalizeSymbol(rawItem?.symbol || rawItem?.gene_symbol || "") || item?.symbol || "",
          error: item?.validation_error || "Invalid catalog item",
        })
        continue
      }
      await env.ICONOPLASM_DB.prepare(
        `INSERT INTO icono_gene_catalog (
           gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json, source, updated_by, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(gene_symbol) DO UPDATE SET
           full_name=excluded.full_name,
           uniprot=excluded.uniprot,
           color_hex=excluded.color_hex,
           tmh=excluded.tmh,
           aliases_json=excluded.aliases_json,
           source=excluded.source,
           updated_by=excluded.updated_by,
           updated_at=CURRENT_TIMESTAMP`,
      )
        .bind(
          item.gene_symbol,
          item.full_name,
          item.uniprot || null,
          item.color_hex || null,
          item.tmh ? 1 : 0,
          item.aliases_json || "[]",
          source,
          actorId,
        )
        .run()
      processed += 1
      results.push({ ok: true, symbol: item.gene_symbol })
    }
    if (processed > 0 && !deferReadModels) {
      await syncAdminReadModels(env, {
        symbols: results.filter((row) => row?.ok && row?.symbol).map((row) => row.symbol),
      })
    }
    return done(
      "admin_catalog_upsert",
      json(
        {
          ok: invalid === 0,
          processed,
          invalid,
          total: items.length,
          defer_read_models: deferReadModels,
          mutation_limiter: mutationLimiterSnapshot(env),
          results,
        },
        invalid > 0 && processed === 0 ? 400 : 200,
        NO_STORE,
      ),
    )
  }

  async function catalogReconcile({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_catalog_reconcile_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done(
        "admin_catalog_reconcile_500",
        json({ error: "ICONOPLASM_DB binding missing" }, 500),
      )
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_catalog_reconcile_400", json({ error: "Invalid JSON" }, 400))
    }
    const keepSymbolsRaw = Array.isArray(payload?.keep_symbols) ? payload.keep_symbols : []
    const deleteSymbolsRaw = Array.isArray(payload?.delete_symbols) ? payload.delete_symbols : []
    const deferReadModels = coerceBoolean(
      payload?.defer_read_models ?? payload?.deferReadModels,
      false,
    )
    if (keepSymbolsRaw.length > 25000)
      return done(
        "admin_catalog_reconcile_400",
        json({ error: "Too many keep_symbols (max 25000)" }, 400),
      )
    if (deleteSymbolsRaw.length > 25000)
      return done(
        "admin_catalog_reconcile_400",
        json({ error: "Too many delete_symbols (max 25000)" }, 400),
      )
    const keepSymbols = new Set(
      keepSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean),
    )
    const explicitDeleteSymbols = Array.from(
      new Set(deleteSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean)),
    )
    if (!keepSymbols.size && !explicitDeleteSymbols.length)
      return done(
        "admin_catalog_reconcile_400",
        json({ error: "No keep_symbols or delete_symbols provided" }, 400),
      )

    let toDelete = explicitDeleteSymbols
    if (keepSymbols.size) {
      const currentRows = await env.ICONOPLASM_DB.prepare(
        "SELECT gene_symbol FROM icono_gene_catalog",
      ).all()
      const currentSymbols = Array.isArray(currentRows?.results) ? currentRows.results : []
      toDelete = currentSymbols
        .map((row) => normalizeSymbol(row?.gene_symbol || ""))
        .filter((symbol) => symbol && !keepSymbols.has(symbol))
    }
    for (const symbol of toDelete) {
      await env.ICONOPLASM_DB.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol=?")
        .bind(symbol)
        .run()
    }
    if (toDelete.length > 0 && !deferReadModels) {
      await syncAdminReadModels(env, { symbols: toDelete })
    }
    return done(
      "admin_catalog_reconcile",
      json(
        {
          ok: true,
          kept: keepSymbols.size,
          deleted: toDelete.length,
          mode: keepSymbols.size ? "keep_symbols" : "delete_symbols",
          defer_read_models: deferReadModels,
          mutation_limiter: mutationLimiterSnapshot(env),
        },
        200,
        NO_STORE,
      ),
    )
  }

  async function catalogPublish({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_catalog_publish_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done(
        "admin_catalog_publish_500",
        json({ error: "ICONOPLASM_DB binding missing" }, 500),
      )
    if (!env.KV)
      return done("admin_catalog_publish_500", json({ error: "KV binding missing" }, 500))
    try {
      return done("admin_catalog_publish", json(await publishCatalogArtifact(env), 200, NO_STORE))
    } catch (error) {
      return done(
        "admin_catalog_publish_400",
        json({ error: String(error?.message || error || "Catalog publish failed") }, 400),
      )
    }
  }

  async function essenceState({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_essence_state_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_essence_state_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_essence_state_400", json({ error: "Invalid JSON" }, 400))
    }
    const rawSymbols = Array.isArray(payload?.symbols) ? payload.symbols : []
    if (rawSymbols.length > 25000)
      return done("admin_essence_state_400", json({ error: "Too many symbols (max 25000)" }, 400))
    const rows = await fetchEssenceStateRows(env, rawSymbols.length ? rawSymbols : null)
    return done("admin_essence_state", json({ ok: true, count: rows.length, rows }, 200, NO_STORE))
  }

  async function essenceUpsert({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_essence_upsert_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_essence_upsert_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_essence_upsert_400", json({ error: "Invalid JSON" }, 400))
    }
    const items = Array.isArray(payload?.items) ? payload.items : []
    const deferReadModels = Boolean(payload?.defer_read_models)
    if (!items.length)
      return done("admin_essence_upsert_400", json({ error: "No items provided" }, 400))
    if (items.length > 1000)
      return done("admin_essence_upsert_400", json({ error: "Too many items (max 1000)" }, 400))

    const actorId = await actor(request, env)
    const source = sanitizeText(payload?.source || "nicegui_sync", 64) || "nicegui_sync"
    let processed = 0
    let invalid = 0
    const results = []
    for (const rawItem of items) {
      const rawEssence =
        rawItem &&
        typeof rawItem === "object" &&
        rawItem.essence &&
        typeof rawItem.essence === "object"
          ? rawItem.essence
          : rawItem
      const symbolHint =
        rawItem && typeof rawItem === "object"
          ? rawItem.symbol ||
            rawItem.gene_symbol ||
            rawEssence?.symbol ||
            rawEssence?.gene_symbol ||
            ""
          : ""
      const essence = normalizeEssencePayload(rawEssence, symbolHint)
      if (!essence || essence.validation_error) {
        invalid += 1
        results.push({
          ok: false,
          symbol: normalizeSymbol(symbolHint) || essence?.gene_symbol || "",
          error: essence?.validation_error || "Invalid or empty essence payload",
        })
        continue
      }
      await upsertGeneEssence(env, essence, actorId, source)
      processed += 1
      results.push({ ok: true, symbol: essence.gene_symbol })
    }
    if (processed > 0 && !deferReadModels) {
      await syncAdminReadModels(env, {
        symbols: results.filter((row) => row?.ok && row?.symbol).map((row) => row.symbol),
      })
    }
    return done(
      "admin_essence_upsert",
      json(
        {
          ok: invalid === 0,
          processed,
          invalid,
          total: items.length,
          defer_read_models: deferReadModels,
          mutation_limiter: mutationLimiterSnapshot(env),
          results,
        },
        invalid > 0 && processed === 0 ? 400 : 200,
        NO_STORE,
      ),
    )
  }

  async function sharedDiscoveries({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_read_models_shared_discoveries_403", json({ error: "Unauthorized" }, 403))
    const result = await rebuildSharedGeneDiscoveryRollup(env)
    if (!result.ok)
      return done(
        "admin_read_models_shared_discoveries_500",
        json({ ok: false, error: String(result.error || "Shared discovery rebuild failed") }, 500),
      )
    return done("admin_read_models_shared_discoveries", json(result, 200, NO_STORE))
  }

  return Object.freeze({
    "admin_publication.catalog_publish": catalogPublish,
    "admin_publication.catalog_reconcile": catalogReconcile,
    "admin_publication.catalog_state": catalogState,
    "admin_publication.catalog_upsert": catalogUpsert,
    "admin_publication.essence_state": essenceState,
    "admin_publication.essence_upsert": essenceUpsert,
    "admin_publication.shared_discoveries": sharedDiscoveries,
  })
}
