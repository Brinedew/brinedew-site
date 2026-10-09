// B-898 Stage 2: the two guards every vote write carries (migration 0113).

// One integer per gene that every change to an election input advances: a
// vote, a caretaker supervote, an assignment change, an eligibility
// invalidation, and the start of every admin-triggered election. An election
// reads it in the same batch as its inputs and projects its winner only while
// it is unchanged, so an older election can never overwrite a newer one. The
// stable gene object carries the version it was materialized at, and its
// publisher re-reads the version after the write to catch a vote that landed
// in between.

// Advances the version. `whenSql` (optional) is a boolean SQL expression over
// numbered parameters starting at ?2; the bump happens only when it holds, so
// a conditional write batch can advance the version exactly when its guarded
// statement applied.
export function geneVoteVersionBumpStatement(db, symbol, { whenSql = "", whenArgs = [] } = {}) {
  return db
    .prepare(
      `INSERT INTO icono_gene_vote_version (gene_symbol, version, updated_at)
       SELECT ?1, 1, CURRENT_TIMESTAMP WHERE ${whenSql || "1"}
       ON CONFLICT(gene_symbol) DO UPDATE SET
         version = icono_gene_vote_version.version + 1,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(symbol, ...whenArgs)
}

// Scalar SQL for the current version; a gene never voted on reads as 0.
export const GENE_VOTE_VERSION_SQL =
  "(SELECT COALESCE(MAX(version), 0) FROM icono_gene_vote_version WHERE gene_symbol = ?1)"

// The current version of one gene: one primary-key row read.
export async function readGeneVoteVersion(db, symbol) {
  const row = await db.prepare(`SELECT ${GENE_VOTE_VERSION_SQL} AS version`).bind(symbol).first()
  return Math.max(0, Number(row?.version || 0) || 0)
}

// The daily vote budget. Reader votes, the votes a reader's image edit or
// generated candidate brings with it, and caretaker supervotes share one
// allowance of admitted vote changes per UTC day, sized so they spend at most
// about 40% of D1's free 100,000 rows written a day.
//
// Measured on the complete migrated schema with Miniflare's D1 receipts
// (workers/iconoplasm/vote-asset-summary-cost.test.js, 2026-10-09, after
// migration 0119 dropped six indexes nothing read), one admitted unit writes:
//   - 14 rows for a user's first vote on an asset nobody has voted on (the
//     vote row and its three index entries, a new summary row and its key,
//     the workstation's icono_vote_events row with its index entries and
//     AUTOINCREMENT counter, the gene's version row, this budget row);
//   - 12 rows for a first vote on an asset that already has votes;
//   - 11 rows to flip a vote;
//   - 13 rows for a caretaker supervote.
// (Before 0119: 21, 17 and 15.) A vote that moves its gene's winner adds the
// projection, 7 rows measured since the winner is no longer relabelled
// "approved". At 100x today's traffic about one vote in ten moves a winner. So
// a full day at the cap costs at most 1,750 x 14 + 175 x 7 = 25,725 rows, 26%
// of the 100,000. Even if every admitted vote moved a winner the day would
// cost 1,750 x 21 = 36,750 rows.
//
// One reader action can bring many votes: publishing an image edit imports
// the edit's inherited upvotes (at most IMAGE_EDIT_INHERITED_UPVOTE_LIMIT) and
// the publisher's own vote in one import. That is at most 26 units and 264
// rows written in one click (measured, vote-asset-summary-cost.test.js: one
// budget row and one version row for the import, about 10 rows per vote), 1.5%
// of the day's 1,750 units and 0.3% of the 100,000 rows. The daily cap still
// holds the whole day to 1,750 units however the clicks are spread.
export const VOTE_DAILY_LIMIT = 1_750
export const VOTE_DAILY_BUDGET_EXHAUSTED = "VOTE_DAILY_BUDGET_EXHAUSTED"
export const VOTE_DAILY_BUDGET_MESSAGE =
  "Voting is paused until 00:00 UTC to protect the site's daily database allowance."

// Publishing an image edit brings the edit's source's votes along: 90% of the
// source's upvotes, as synthetic voters, on the new candidate. Each one is a
// real vote (rows written, a budget unit), so what one click can spend is
// capped: at most this many inherited votes, plus the publisher's own.
export const IMAGE_EDIT_INHERITED_UPVOTE_LIMIT = 25
const IMAGE_EDIT_INHERITED_UPVOTE_SHARE = 0.9

// The inherited-vote count a job row holds, never above the limit. Applied to
// every stored value as well, so a job row holding a larger number still
// imports (and reports) only the limit.
export function capImageEditInheritedUpvotes(stored) {
  const count = Math.floor(Number(stored) || 0)
  return Math.min(IMAGE_EDIT_INHERITED_UPVOTE_LIMIT, Math.max(0, count))
}

// What a new image edit inherits from a source with `sourceUpvotes` upvotes.
export function imageEditInheritedUpvotes(sourceUpvotes) {
  const upvotes = Math.max(0, Number(sourceUpvotes) || 0)
  return capImageEditInheritedUpvotes(Math.floor(upvotes * IMAGE_EDIT_INHERITED_UPVOTE_SHARE))
}

// A vote import is one Worker invocation, so what counts is the number of
// calls it makes to D1, and a db.batch() is one call however many statements
// it carries. Measured 2026-10-03 on this account (a Cloudflare Free plan)
// with a throwaway Worker run by `wrangler dev --remote` against a scratch D1
// database (B-914):
//   - after a batch of 1, 60 or 120 statements, 999 more separate D1 calls
//     succeed and the 1,001st call of the invocation fails with "Too many API
//     requests by single Worker invocation"; so a batch costs exactly one;
//   - single batches of 101, 106 and 500 inserts, and of 1,100 and 5,000
//     SELECTs, all run, so an image edit's batch of up to 106 statements is
//     one call, and no batch ceiling was found up to 500 inserts or 5,000
//     SELECTs;
//   - the free limit for D1 calls is 1,000 per invocation. The 50 that
//     developers.cloudflare.com/d1/platform/limits/ lists ("Queries per
//     Worker invocation", updated 21 Apr 2026) is not what the platform
//     enforces: the Workers limits page (5 Sep 2026) and the 11 Feb 2026
//     changelog give the free plan 50 external subrequests (fetch(), where the
//     same probe failed on the 51st call) and a separate 1,000 for Cloudflare
//     services such as D1.
// An import makes two calls per chunk of GENE_VOTE_IMPORT_CHUNK votes (a read
// batch, a write batch) and two per gene it names (the election read and the
// projection), so at most 2 x ceil(votes / 50) + 2 x genes. At the two bounds
// below that is 2 x 4 + 2 x 12 = 32 calls, measured in
// workers/iconoplasm.d1-votes.test.js. The bounds keep the 50-call figure
// anyway: the measurement ran in a preview, the D1 page still says 50, and
// callers already split their imports. No other limit was measured for them,
// so raising them needs its own measurement of CPU time and rows written per
// request. A request past either bound is refused up front, before anything
// is written; callers split their imports by these numbers.
export const VOTE_IMPORT_MAX_ITEMS = 200
export const VOTE_IMPORT_MAX_GENES = 12

// The refusal text for an import of `items` votes across `genes` distinct
// genes, or null when the import fits.
export function voteImportBoundsError({ items = 0, genes = 0 } = {}) {
  if (items <= VOTE_IMPORT_MAX_ITEMS && genes <= VOTE_IMPORT_MAX_GENES) return null
  return (
    `A vote import takes at most ${VOTE_IMPORT_MAX_GENES} genes and ${VOTE_IMPORT_MAX_ITEMS} votes ` +
    `per request; this one has ${items} votes across ${genes} genes. Split it into smaller requests.`
  )
}

// The first statement of every admitted vote write batch. It adds `units` to
// today's row (day = D1's UTC date) while the total stays within the limit.
// Past the limit it raises instead (json() of a non-JSON string, the same
// refusal idiom the migration adapters use), so D1 rolls the whole batch back
// and nothing else in it is written. One row written per admitted batch.
export function voteDailyBudgetStatement(db, units = 1, limit = VOTE_DAILY_LIMIT) {
  return db
    .prepare(
      `INSERT INTO icono_vote_daily_budget (day, votes)
       VALUES (date('now'), CASE WHEN ?1 <= ?2 THEN ?1 ELSE json('${VOTE_DAILY_BUDGET_EXHAUSTED}') END)
       ON CONFLICT(day) DO UPDATE SET votes = CASE
         WHEN icono_vote_daily_budget.votes + ?1 <= ?2 THEN icono_vote_daily_budget.votes + ?1
         ELSE json('${VOTE_DAILY_BUDGET_EXHAUSTED}')
       END`,
    )
    .bind(Math.max(1, Math.trunc(Number(units) || 1)), limit)
}

// D1 reports the refusal as "D1_ERROR: malformed JSON" from the statement
// above; no other statement in a vote or supervote write batch calls json().
export function isVoteDailyBudgetRefusal(error) {
  return /malformed JSON|VOTE_DAILY_BUDGET_EXHAUSTED/i.test(String(error?.message || error || ""))
}

export function voteDailyBudgetRefusal() {
  return {
    ok: false,
    status: 429,
    code: VOTE_DAILY_BUDGET_EXHAUSTED,
    error: VOTE_DAILY_BUDGET_MESSAGE,
  }
}
