// B-744: these are maintained by migration 0104's source-table triggers.
// Missing counts require the admitted migration; readers never seed or scan.
export async function fetchMaintainedAssetSummary(db) {
  const row = await db
    .prepare("SELECT * FROM icono_asset_summary_counts WHERE summary_key='default'")
    .first()
  if (!row) throw new Error("ICONOPLASM_ASSET_SUMMARY_MIGRATION_REQUIRED")
  return row
}

export async function fetchStorageAuditRecheckDue(db, days, now = Date.now()) {
  const cutoff = new Date(now - days * 86_400_000).toISOString()
  const year = cutoff.slice(0, 4)
  const month = cutoff.slice(0, 7)
  const day = cutoff.slice(0, 10)
  const seconds =
    Number(cutoff.slice(11, 13)) * 3600 +
    Number(cutoff.slice(14, 16)) * 60 +
    Number(cutoff.slice(17, 19))
  // Fixed calendar domains: at most 10,000 year rows, 11 month rows and
  // 30 day rows, independent of asset/audit history. The boundary day is one
  // bounded seconds histogram, preserving the former exact second cutoff.
  const row = await db
    .prepare(
      `SELECT
    (SELECT COALESCE(SUM(total),0) FROM icono_audit_age_years WHERE bucket < ?1) +
    (SELECT COALESCE(SUM(total),0) FROM icono_audit_age_months WHERE bucket >= ?1 AND bucket < ?2) +
    (SELECT COALESCE(SUM(total),0) FROM icono_audit_age_days WHERE bucket >= ?2 AND bucket < ?3) AS previous_total,
    (SELECT seconds_json FROM icono_audit_age_days WHERE bucket=?3) AS seconds_json`,
    )
    .bind(year, month, day)
    .first()
  let total = Number(row?.previous_total || 0)
  for (const [second, count] of Object.entries(JSON.parse(row?.seconds_json || "{}"))) {
    if (Number(second) <= seconds) total += count
  }
  return total
}
