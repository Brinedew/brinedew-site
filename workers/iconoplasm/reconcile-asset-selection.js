// Reconciliation is affirmative: only supplied keep/legacy identities can
// change. Enumerating unrelated assets to report how many were left alone both
// obscured that contract and made a tiny publication scan growing history.
export const RECONCILE_ASSET_KEYS_SQL = `SELECT pa.gene_symbol, pa.asset_sha256, pa.status,
  COALESCE(pa.is_stale, 0) AS is_stale, COALESCE(pa.is_legacy, 0) AS is_legacy
  FROM json_each(?) incoming
  CROSS JOIN icono_portrait_assets pa INDEXED BY sqlite_autoindex_icono_portrait_assets_1
  WHERE pa.gene_symbol = json_extract(incoming.value, '$[0]')
    AND pa.asset_sha256 = json_extract(incoming.value, '$[1]')`

export const RECONCILE_PUBLISH_STATE_SQL = `SELECT gene_symbol, current_asset_sha256,
  COALESCE(admin_override, 0) AS admin_override
  FROM icono_publish_state INDEXED BY sqlite_autoindex_icono_publish_state_1
  WHERE gene_symbol IN (SELECT value FROM json_each(?))`

export async function readReconcileAssetKeys(db, { keep = [], legacy = [], symbols = [] } = {}) {
  if (keep.length > 50000 || legacy.length > 50000 || symbols.length > 5000)
    throw new RangeError("Reconcile input exceeds the supported manifest")
  const scope = new Set(symbols)
  const keys = new Map()
  for (const row of [...keep, ...legacy]) {
    if (scope.size && !scope.has(row.symbol)) continue
    keys.set(`${row.symbol}|${row.asset_sha256}`, [row.symbol, row.asset_sha256])
  }
  const entries = [...keys.values()]
  const rows = []
  for (let start = 0; start < entries.length; start += 500) {
    const result = await db
      .prepare(RECONCILE_ASSET_KEYS_SQL)
      .bind(JSON.stringify(entries.slice(start, start + 500)))
      .all()
    rows.push(...(result.results || []))
  }
  return rows
}

export async function readReconcilePublishState(db, symbols) {
  if (!symbols.length || symbols.length > 5000)
    throw new RangeError("Unpublishing requires an explicit symbol scope of at most 5000 genes")
  const result = await db.prepare(RECONCILE_PUBLISH_STATE_SQL).bind(JSON.stringify(symbols)).all()
  return result.results || []
}
