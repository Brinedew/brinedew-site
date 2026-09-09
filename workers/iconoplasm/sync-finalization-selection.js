// Scoped Queue deliveries own an explicit symbol manifest. Probe those unique
// keys before filtering or sorting; an optional-OR predicate instead lets SQLite
// walk the entire status backlog. Retain the existing phase priority, exact
// counts, durable retry dates and stale-lease selection. Global deliveries use
// the separate indexed selectors; never revive an optional-OR backlog scan.
function scope(scoped) {
  if (scoped !== true) throw new RangeError("An explicit finalization symbol scope is required")
  return {
    index: "INDEXED BY sqlite_autoindex_icono_sync_finalization_jobs_1",
    predicate: "(? = 1 AND gene_symbol IN (SELECT value FROM json_each(?)))",
  }
}

export function runningFinalizationJobsSql(scoped) {
  const { index } = scope(scoped)
  return `WITH scoped_symbols AS (
       SELECT value AS gene_symbol FROM json_each(?)
     )
     SELECT gene_symbol, phase, attempts, requested_at, last_attempt_at
     FROM icono_sync_finalization_jobs ${index}
     WHERE status = ?
       AND phase <> ?
       AND (? = 1 AND gene_symbol IN (SELECT gene_symbol FROM scoped_symbols))
     ORDER BY COALESCE(NULLIF(last_attempt_at, ''), NULLIF(requested_at, '')) ASC, gene_symbol ASC
     LIMIT ?`
}

export function dueFinalizationJobsSql(scoped) {
  const { index } = scope(scoped)
  return `WITH scoped_symbols AS (
       SELECT value AS gene_symbol FROM json_each(?)
     )
     SELECT *
     FROM icono_sync_finalization_jobs ${index}
     WHERE status IN (?, ?)
       AND phase <> ?
       AND next_attempt_at <= ?
       AND (? = 1 AND gene_symbol IN (SELECT gene_symbol FROM scoped_symbols))
     ORDER BY CASE phase WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END ASC,
       requested_at ASC, gene_symbol ASC
     LIMIT ?`
}

export function pendingFinalizationWorkSql(scoped) {
  const { index, predicate } = scope(scoped)
  return `SELECT
       COUNT(*) AS remaining,
       SUM(CASE WHEN status IN (?, ?) AND phase <> ? AND next_attempt_at <= ?
         THEN 1 ELSE 0 END) AS runnable,
       MIN(CASE WHEN status IN (?, ?) AND phase <> ? AND next_attempt_at > ?
         THEN next_attempt_at ELSE NULL END) AS next_attempt_at
     FROM icono_sync_finalization_jobs ${index}
     WHERE status <> ? AND ${predicate}`
}
