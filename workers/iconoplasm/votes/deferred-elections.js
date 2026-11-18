// B-1147: periodic dirty-queue sweep for hot-gene winner elections. Votes that
// flip a gene's winner again inside HOT_GENE_ELECTION_WINDOW_MS mark
// icono_gene_elections_due (1 D1 row, 0 while already due) instead of projecting
// 9 rows + republishing on every alternating vote. Idle ticks execute one cheap
// D1 read and return without touching Cloudflare's GraphQL analytics.
import { admitBatchWork, priceOf } from "../batch-admission.js"
import { accountD1Usage } from "../operation-cost-account-usage.js"
import {
  GENE_VOTE_ELECTION_ACTOR,
  HOT_GENE_ELECTION_WINDOW_MS,
  electAndProjectGeneWinner,
  sqlUtcTimestamp,
} from "./gene-votes.js"

export const DEFERRED_ELECTIONS_PER_RUN = 100

// The due genes with the vote version each had when this run read it. Every
// vote and supervote advances its gene's version in its own write batch.
// Hot genes whose vote-driven promotion updated icono_publish_state within
// HOT_GENE_ELECTION_WINDOW_MS stay parked here until the cooldown clears.
const DUE_SQL = `SELECT due.gene_symbol, COALESCE(v.version, 0) AS version
                   FROM icono_gene_elections_due AS due
                   LEFT JOIN icono_gene_vote_version AS v USING (gene_symbol)
                   LEFT JOIN icono_publish_state AS ps USING (gene_symbol)
                  WHERE ps.gene_symbol IS NULL
                     OR ps.updated_by IS NOT ?2
                     OR ps.updated_at IS NULL
                     OR ps.updated_at <= ?3
                  ORDER BY due.gene_symbol LIMIT ?1`
// Runs can be a minute apart and overlap. A mark leaves only while its gene's
// version is still the one read above, so a vote that marked the gene again
// while this run elected keeps it due, and the next run elects it once more.
const CLEAR_SQL = `DELETE FROM icono_gene_elections_due
                    WHERE gene_symbol IN (
                      SELECT json_extract(value, '$[0]') FROM json_each(?1)
                       WHERE json_extract(value, '$[1]') = (
                         SELECT COALESCE(MAX(version), 0) FROM icono_gene_vote_version
                          WHERE gene_symbol = json_extract(value, '$[0]')))`

export async function sweepDeferredElections(db, { usage, getUsage, now = Date.now() } = {}) {
  const due = await db
    .prepare(DUE_SQL)
    .bind(
      DEFERRED_ELECTIONS_PER_RUN,
      GENE_VOTE_ELECTION_ACTOR,
      sqlUtcTimestamp(now - HOT_GENE_ELECTION_WINDOW_MS),
    )
    .all()
  const versions = new Map((due?.results || []).map((row) => [row.gene_symbol, row.version]))
  const symbols = [...versions.keys()]
  if (!symbols.length) return { ok: true, elected: 0 }
  const meter = usage !== undefined ? usage : await getUsage?.()
  if (!meter) return { ok: false, waiting: "D1_METER_UNAVAILABLE" }
  const admission = await admitBatchWork(db, {
    usage: meter,
    criticality: "sheddable_plus",
    price: priceOf("vote_election", symbols.length),
    now,
  })
  if (!admission.ok) return { ok: true, waiting: admission.body.code }
  const elected = []
  const failed = []
  let promoted = 0
  for (const symbol of symbols) {
    try {
      const { projection } = await electAndProjectGeneWinner(db, symbol, {
        actor: GENE_VOTE_ELECTION_ACTOR,
        reason: "deferred_vote_election",
      })
      elected.push(symbol)
      if (projection.changed) promoted += 1
    } catch (error) {
      failed.push({ symbol, error: String(error?.message || error).slice(0, 200) })
    }
  }
  if (elected.length)
    await db
      .prepare(CLEAR_SQL)
      .bind(JSON.stringify(elected.map((symbol) => [symbol, versions.get(symbol)])))
      .run()
  return { ok: failed.length === 0, elected: elected.length, promoted, failed }
}

export async function sweepDeferredElectionsForScheduled(env) {
  return sweepDeferredElections(env.ICONOPLASM_DB, {
    getUsage: () => accountD1Usage(env).catch(() => null),
  })
}
