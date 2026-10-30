// B-1147: once batch work has spent its share of a D1 meter for the UTC day, a
// winner change after a vote waits for the reset, and this sweep elects it then.
//
// Shed by who is waiting (shared/iconoplasm-d1-budget-policy.js): a vote is a
// reader's own action and runs to Cloudflare's wall; the winner change it
// causes is publication, which stops at 85%. A vote writes 4 to 6 rows and a
// winner change 9 (migration 0149). On a shed day a winner change marks its
// gene due, 1 row or none when the gene already is, and a vote that keeps the
// winner writes what it writes on any day, so shedding never writes more than
// not shedding. A gene whose winner changed ten times that day is elected once.
//
// Why a flag in D1 and not the meter itself: the vote path can't ask
// Cloudflare's GraphQL analytics, which allows 300 queries per 5 minutes per
// token (developers.cloudflare.com/analytics/graphql-api/limits/, read
// 2026-10-30). At viral scale many isolates, each asking every 30 s, would
// spend that and blind batch admission everywhere. This sweep asks once per
// run and writes the day as shed; a vote reads the flag inside the election
// batch it already sends (gene-votes.js).
//
// The flag is late by up to one gap between runs (6 minutes) plus the meter's
// lag (about 2.5). Votes alone cross the 15,000 rows between 85% and the wall
// in that time only above about 1,760 rows a minute, about 6,700 votes an hour
// at the 15.7 rows each predicted from 2026-10-27 to 30's receipts; faster than
// that, the wall comes before the flag, as it would without one. At four runs
// an hour the flag held only to about 770 rows a minute.
//
// After the reset the sweep elects the due genes, admitted by their price. The
// winner change writes a `publish` event, so the Actions publisher republishes
// that gene's object, with the counts of the votes that waited. Until then
// each of those voters sees their own vote in their own box.
import { BATCH_METERS, admitBatchWork, batchSpendNow, priceOf } from "../batch-admission.js"
import { accountD1Usage } from "../operation-cost-account-usage.js"
import { GENE_VOTE_ELECTION_ACTOR, electAndProjectGeneWinner } from "./gene-votes.js"

// One read batch and at most one write batch per gene, plus five. Cloudflare
// allows 1,000 calls to its own services per invocation; production requests
// have made 89 D1 calls and succeeded (request record, 2026-10-27 to 30).
export const DEFERRED_ELECTIONS_PER_RUN = 100

// The due genes with the vote version each had when this run read it. Every
// vote and supervote advances its gene's version in its own write batch.
const DUE_SQL = `SELECT due.gene_symbol, COALESCE(v.version, 0) AS version
                   FROM icono_gene_elections_due AS due
                   LEFT JOIN icono_gene_vote_version AS v USING (gene_symbol)
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

export async function sweepDeferredElections(db, { usage, now = Date.now() } = {}) {
  // A meter that can't be read stops batch work and marks no day. It is a
  // failure, so the scheduled handler logs it: a dead analytics token would
  // otherwise leave every day unshed and due genes unelected without a word.
  if (!usage) return { ok: false, waiting: "D1_METER_UNAVAILABLE" }
  const spend = await batchSpendNow(db, usage, "sheddable_plus", now)
  const spent = BATCH_METERS.find((meter) => spend[meter].projected >= spend[meter].stop)
  if (spent) {
    await db
      .prepare(
        `INSERT INTO icono_publication_shed_days (day, meter, projected, stop)
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT (day) DO NOTHING`,
      )
      .bind(usage.day, spent, spend[spent].projected, spend[spent].stop)
      .run()
    return { ok: true, shed: usage.day, meter: spent, ...spend[spent] }
  }
  // A shed day stays shed, so votes never mark a gene while this elects it.
  const [shedToday, due] = await db.batch([
    db.prepare("SELECT 1 AS shed FROM icono_publication_shed_days WHERE day = ?1").bind(usage.day),
    db.prepare(DUE_SQL).bind(DEFERRED_ELECTIONS_PER_RUN),
  ])
  if (shedToday?.results?.length) return { ok: true, shed: usage.day }
  const versions = new Map((due?.results || []).map((row) => [row.gene_symbol, row.version]))
  const symbols = [...versions.keys()]
  if (!symbols.length) return { ok: true, elected: 0 }
  const admission = await admitBatchWork(db, {
    usage,
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
    usage: await accountD1Usage(env).catch(() => null),
  })
}
