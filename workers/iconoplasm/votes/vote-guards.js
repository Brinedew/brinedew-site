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

// The daily vote allowance (B-1065): each person may change 200 votes per UTC day.
// A vote, the votes an image edit or generated candidate brings with it (charged to
// the reader who published it) and a caretaker supervote all count. Sized from real
// behaviour on the 2026-10-06 nightly copy: 24 people over 197 person-days, the
// busiest day 140 changes, none over 200. Stack Overflow's 40 would have stopped
// real people on 6 of those days; 200 stopped nobody and bounds a scripted account.
// It replaced one global allowance of 1,750 a day, which let one script spend
// everyone's votes.
//
// Measured on the complete migrated schema with Miniflare's D1 receipts
// (workers/iconoplasm/vote-asset-summary-cost.test.js), one admitted vote writes:
//   - 9 rows for a user's first vote on an asset nobody has voted on (the vote row
//     and its three index entries, a new summary row and its key, the gene's version
//     row, the person's allowance row);
//   - 7 rows for a first vote on an asset that already has votes;
//   - 6 rows to flip a vote;
//   - 13 rows for a caretaker supervote.
// One person at the allowance spends at most 200 x 9 = 1,800 rows, 1.8% of the
// 100,000-row write wall, plus the projection (7 rows) when a vote moves a winner.
// It takes about 55 scripted accounts, each with its own Discord sign-in and held to
// the rate limiter's per-minute window, to spend the wall.
//
// One reader action can bring many votes: publishing an image edit imports the
// edit's inherited upvotes (at most IMAGE_EDIT_INHERITED_UPVOTE_LIMIT) and the
// publisher's own vote in one import, at most 26 of the publisher's allowance and
// 134 rows written in one click (measured, vote-asset-summary-cost.test.js).
export const VOTE_PERSON_DAILY_LIMIT = 200
// The refusal's code is a wire contract: the page's vote box, the shared card
// controller and the published extension all read it.
export const VOTE_DAILY_BUDGET_EXHAUSTED = "VOTE_DAILY_BUDGET_EXHAUSTED"

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

// The first statement of every admitted vote write batch. It adds `units` to the
// person's row for today (day = D1's UTC date) while the total stays within the
// allowance. Past it, it raises instead (json() of a non-JSON string, the same
// refusal idiom the migration adapters use), so D1 rolls the whole batch back and
// nothing else in it is written. One row written per admitted batch.
export function voteAllowanceStatement(db, userId, units = 1, limit = VOTE_PERSON_DAILY_LIMIT) {
  return db
    .prepare(
      `INSERT INTO icono_vote_person_day (user_id, day, changes)
       VALUES (?1, date('now'), CASE WHEN ?2 <= ?3 THEN ?2 ELSE json('${VOTE_DAILY_BUDGET_EXHAUSTED}') END)
       ON CONFLICT(user_id, day) DO UPDATE SET changes = CASE
         WHEN icono_vote_person_day.changes + ?2 <= ?3 THEN icono_vote_person_day.changes + ?2
         ELSE json('${VOTE_DAILY_BUDGET_EXHAUSTED}')
       END`,
    )
    .bind(String(userId || ""), Math.max(1, Math.trunc(Number(units) || 1)), limit)
}

// The person's earlier days, deleted by their own next admitted vote through the
// primary key: no row to delete after the first vote of a day, one before it.
export function voteAllowanceCleanupStatement(db, userId) {
  return db
    .prepare("DELETE FROM icono_vote_person_day WHERE user_id = ?1 AND day < date('now')")
    .bind(String(userId || ""))
}

// D1 reports the refusal as "D1_ERROR: malformed JSON" from the statement
// above; no other statement in a vote or supervote write batch calls json().
export function isVoteDailyBudgetRefusal(error) {
  return /malformed JSON|VOTE_DAILY_BUDGET_EXHAUSTED/i.test(String(error?.message || error || ""))
}

// Stack Overflow's sentence at its daily vote limit, by substitution: "Daily vote
// limit reached; vote again in N hours." The reset is 00:00 UTC.
export function voteDailyBudgetMessage(now = Date.now()) {
  const next = new Date(now)
  next.setUTCHours(24, 0, 0, 0)
  const hours = Math.max(1, Math.ceil((next.getTime() - now) / 3_600_000))
  return `Daily vote limit reached; vote again in ${hours} ${hours === 1 ? "hour" : "hours"}.`
}

export function voteDailyBudgetRefusal(now = Date.now()) {
  return {
    ok: false,
    status: 429,
    code: VOTE_DAILY_BUDGET_EXHAUSTED,
    error: voteDailyBudgetMessage(now),
  }
}
