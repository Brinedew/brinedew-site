const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const D1_UPSERT_TRANSACTION_SIZE = 10
const MAX_ROWS_WRITTEN_PER_UPSERT = 4
// A catalogue row and its counter triggers (4), plus its publication event (1).
const CATALOG_ROWS_WRITTEN_PER_CHANGE = 5
// B-1055: a catalogue change is a publication change. Until 2026-10-09 neither
// catalogue route wrote an event, so the Actions publisher never rebuilt the
// gene: 600 genes added on 10-07 had no page, and 613 removed on 10-08 kept
// theirs. The upsert records one when the row is new or differs, or when the
// gene has no page yet (no route membership: the 600 rows of 10-07 sat in D1
// unpublished), so sending a row always means "this gene is visible". A resent
// unchanged row of a gene that has its page schedules nothing.
const CATALOG_UPSERTED_EVENT_SQL = `INSERT INTO icono_publish_events (
     gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason
   )
   SELECT ?, NULL, NULL, 'catalog_upserted', ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM icono_gene_catalog
       WHERE gene_symbol = ? AND full_name IS ? AND uniprot IS ? AND color_hex IS ?
         AND tmh IS ? AND aliases_json IS ?
    )
       OR NOT EXISTS (SELECT 1 FROM icono_published_gene_routes WHERE gene_symbol = ?)`
const CATALOG_REMOVED_EVENT_SQL = `INSERT INTO icono_publish_events (
     gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason
   ) VALUES (?, NULL, NULL, 'catalog_removed', ?, 'delete_symbols')`

const REQUIRED_SERVICE_NAMES = Object.freeze([
  "actor",
  "coerceBoolean",
  "fetchCatalogStateRows",
  "isAdmin",
  "json",
  "mutationLimiterSnapshot",
  "normalizeCatalogPayloadItem",
  "normalizeEssencePayload",
  "normalizeSymbol",
  "prepareGeneEssenceUpsertStatement",
  "publishCatalogArtifact",
  "rebuildSharedGeneDiscoveryRollup",
  "sanitizeText",
  "syncAdminReadModels",
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
    fetchCatalogStateRows,
    isAdmin,
    json,
    mutationLimiterSnapshot,
    normalizeCatalogPayloadItem,
    normalizeEssencePayload,
    normalizeSymbol,
    prepareGeneEssenceUpsertStatement,
    publishCatalogArtifact,
    rebuildSharedGeneDiscoveryRollup,
    sanitizeText,
    syncAdminReadModels,
  } = services

  async function catalogState({ request, env, done }) {
    if (!(await isAdmin(request, env)))
      return done("admin_catalog_state_403", json({ error: "Unauthorized" }, 403))
    if (!env.ICONOPLASM_DB)
      return done("admin_catalog_state_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
    let payload
    try {
      payload = await request.json()
    } catch {
      return done("admin_catalog_state_400", json({ error: "Invalid JSON" }, 400))
    }
    if (!Array.isArray(payload?.symbols))
      return done(
        "admin_catalog_state_400",
        json({ error: "symbols must be a non-empty array" }, 400),
      )
    const rawSymbols = payload.symbols
    if (rawSymbols.length > 25000)
      return done("admin_catalog_state_400", json({ error: "Too many symbols (max 25000)" }, 400))
    // A repeated symbol can turn a bounded lookup into duplicate D1 work.
    // Preserve first-seen order because clients pair the returned hashes with
    // their requested scope, but charge each canonical symbol only once.
    const symbols = Array.from(new Set(rawSymbols.map((value) => normalizeSymbol(value))))
    if (!symbols.length || symbols.some((symbol) => !symbol))
      return done(
        "admin_catalog_state_400",
        json({ error: "symbols must contain at least one valid symbol" }, 400),
      )
    const rows = await fetchCatalogStateRows(env, symbols)
    return done("admin_catalog_state", json({ ok: true, count: rows.length, rows }, 200, NO_STORE))
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
    if (items.length > 100)
      return done("admin_catalog_upsert_400", json({ error: "Too many items (max 100)" }, 400))

    const actorId = await actor(request, env)
    const source =
      sanitizeText(payload?.source || "nicegui_catalog_sync", 64) || "nicegui_catalog_sync"
    let processed = 0
    let invalid = 0
    const results = []
    const itemStatements = []
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
      const row = [
        item.full_name,
        item.uniprot || null,
        item.color_hex || null,
        item.tmh ? 1 : 0,
        item.aliases_json || "[]",
      ]
      itemStatements.push([
        // Before the upsert, in the same transaction: it compares against the old row.
        env.ICONOPLASM_DB.prepare(CATALOG_UPSERTED_EVENT_SQL).bind(
          item.gene_symbol,
          actorId,
          source,
          item.gene_symbol,
          ...row,
          item.gene_symbol,
        ),
        env.ICONOPLASM_DB.prepare(
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
        ).bind(item.gene_symbol, ...row, source, actorId),
      ])
      processed += 1
      results.push({ ok: true, symbol: item.gene_symbol })
    }
    // Reserve more write headroom than this table normally consumes before
    // each atomic D1 transaction. The metered database wrapper rejects the
    // whole batch before execution if it could cross either a hard quota or
    // the admin mutation limiter's share, then records actual D1 metadata.
    // This preserves exact guard authority without paying one network round
    // trip for every catalog row.
    for (let offset = 0; offset < itemStatements.length; offset += D1_UPSERT_TRANSACTION_SIZE) {
      const transaction = itemStatements.slice(offset, offset + D1_UPSERT_TRANSACTION_SIZE)
      await env.ICONOPLASM_DB.batch(transaction.flat(), {
        maxRowsWritten: transaction.length * CATALOG_ROWS_WRITTEN_PER_CHANGE,
      })
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
    if (payload?.keep_symbols !== undefined)
      return done(
        "admin_catalog_reconcile_400",
        json(
          { error: "keep_symbols reconciliation is not admitted; provide explicit delete_symbols" },
          400,
        ),
      )
    const deleteSymbolsRaw = Array.isArray(payload?.delete_symbols) ? payload.delete_symbols : []
    const deferReadModels = coerceBoolean(
      payload?.defer_read_models ?? payload?.deferReadModels,
      false,
    )
    if (deleteSymbolsRaw.length > 25000)
      return done(
        "admin_catalog_reconcile_400",
        json({ error: "Too many delete_symbols (max 25000)" }, 400),
      )
    const explicitDeleteSymbols = Array.from(
      new Set(deleteSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean)),
    )
    if (!explicitDeleteSymbols.length)
      return done(
        "admin_catalog_reconcile_400",
        json({ error: "No valid delete_symbols provided" }, 400),
      )

    const actorId = await actor(request, env)
    // One D1 call per symbol (a batch is one call): the delete, its counter
    // triggers, and the event that has the publisher take the gene's page down.
    // The event is written even when the row is already gone, so a resend
    // finishes a removal whose page outlived it.
    for (const symbol of explicitDeleteSymbols) {
      await env.ICONOPLASM_DB.batch(
        [
          env.ICONOPLASM_DB.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol=?").bind(
            symbol,
          ),
          env.ICONOPLASM_DB.prepare(CATALOG_REMOVED_EVENT_SQL).bind(symbol, actorId),
        ],
        { maxRowsWritten: CATALOG_ROWS_WRITTEN_PER_CHANGE },
      )
    }
    if (!deferReadModels) {
      await syncAdminReadModels(env, { symbols: explicitDeleteSymbols })
    }
    return done(
      "admin_catalog_reconcile",
      json(
        {
          ok: true,
          deleted: explicitDeleteSymbols.length,
          mode: "delete_symbols",
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
    const statements = []
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
      statements.push(prepareGeneEssenceUpsertStatement(env, essence, actorId, source))
      processed += 1
      results.push({ ok: true, symbol: essence.gene_symbol })
    }
    // Essence is a roster-wide bulk write. Execute the already validated rows
    // as small atomic D1 transactions, reserving conservative quota headroom
    // before each transaction through the metered database wrapper.
    for (let offset = 0; offset < statements.length; offset += D1_UPSERT_TRANSACTION_SIZE) {
      const transaction = statements.slice(offset, offset + D1_UPSERT_TRANSACTION_SIZE)
      await env.ICONOPLASM_DB.batch(transaction, {
        maxRowsWritten: transaction.length * MAX_ROWS_WRITTEN_PER_UPSERT,
      })
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
    "admin_publication.essence_upsert": essenceUpsert,
    "admin_publication.shared_discoveries": sharedDiscoveries,
  })
}
