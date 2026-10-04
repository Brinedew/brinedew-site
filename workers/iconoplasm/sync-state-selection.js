const CATALOG_COLUMNS = "gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json"

function stateSql(table, columns, scoped) {
  if (!scoped) return `SELECT ${columns} FROM ${table} ORDER BY gene_symbol ASC`
  return `SELECT ${columns} FROM json_each(?) incoming
    CROSS JOIN ${table} INDEXED BY sqlite_autoindex_${table}_1
    WHERE gene_symbol = incoming.value`
}

export const CATALOG_STATE_SCOPED_SQL = stateSql("icono_gene_catalog", CATALOG_COLUMNS, true)

async function readStateRows(db, table, columns, symbols) {
  // The existing explicit whole-state contract remains separate. It still
  // requires whole-operation admission; it must never be selected merely
  // because an explicit scope exceeds a SQL parameter threshold.
  if (symbols === null) {
    const response = await db.prepare(stateSql(table, columns, false)).all()
    return response.results || []
  }
  if (!Array.isArray(symbols) || symbols.length > 25000)
    throw new RangeError("State lookup requires at most 25000 explicit symbols")
  const wanted = [...new Set(symbols)].sort()
  const rows = []
  for (let offset = 0; offset < wanted.length; offset += 500) {
    const response = await db
      .prepare(stateSql(table, columns, true))
      .bind(JSON.stringify(wanted.slice(offset, offset + 500)))
      .all()
    rows.push(...(response.results || []))
  }
  return rows.sort((a, b) =>
    a.gene_symbol < b.gene_symbol ? -1 : a.gene_symbol > b.gene_symbol ? 1 : 0,
  )
}

export function readCatalogStateRows(db, symbols) {
  return readStateRows(db, "icono_gene_catalog", CATALOG_COLUMNS, symbols)
}
