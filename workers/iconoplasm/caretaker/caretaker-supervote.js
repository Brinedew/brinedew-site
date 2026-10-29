import {
  VOTE_DAILY_BUDGET_EXHAUSTED,
  VOTE_PERSON_DAILY_LIMIT,
  geneVoteVersionBumpStatement,
  isVoteDailyBudgetRefusal,
  voteAllowanceCleanupStatement,
  voteAllowanceStatement,
  voteDailyBudgetMessage,
} from "../votes/vote-guards.js"

export const CARETAKER_SUPERVOTE_WEIGHT = 10
export const CARETAKER_SUPERVOTE_DIRECTIONS = Object.freeze([-1, 1])

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
// The candidates an election counts (gene-votes.js); a supervote may only name one.
const ELIGIBLE_CANDIDATE_SQL =
  "lower(pa.status) <> 'rejected' AND pa.autopick_eligible = 1 AND pa.is_stale = 0"

export class CaretakerSupervoteError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = "CaretakerSupervoteError"
    this.code = code
    this.status = status
  }
}

function fail(code, message, status = 400) {
  throw new CaretakerSupervoteError(code, message, status)
}

function normalizeId(value, field) {
  const normalized = String(value || "").trim()
  if (!ID_PATTERN.test(normalized)) fail("INVALID_SUPERVOTE_INPUT", `${field} is invalid`)
  return normalized
}

function normalizeSymbol(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL_PATTERN.test(normalized)) fail("INVALID_SUPERVOTE_INPUT", "gene_symbol is invalid")
  return normalized
}

function normalizeSha256(value, { optional = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (optional && !normalized) return null
  if (!SHA256_PATTERN.test(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "asset_sha256 is invalid")
  }
  return normalized
}

function normalizeVersion(value, field, { minimum = 0 } = {}) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    fail("INVALID_SUPERVOTE_INPUT", `${field} is invalid`)
  }
  return normalized
}

function normalizeDirection(value, { optional = false } = {}) {
  if (optional && (value == null || value === "")) return null
  const normalized = Number(value)
  if (!CARETAKER_SUPERVOTE_DIRECTIONS.includes(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "direction must be -1 or 1")
  }
  return normalized
}

export function caretakerWeightedScore(row) {
  const ordinaryScore = Number(row?.score ?? row?.image_score ?? 0) || 0
  const direction = row?.caretaker_supervote
    ? normalizeDirection(row?.caretaker_supervote_direction ?? 1)
    : 0
  return ordinaryScore + direction * CARETAKER_SUPERVOTE_WEIGHT
}

export function compareCaretakerWeightedCandidates(left, right, fallback = () => 0) {
  return (
    caretakerWeightedScore(right) - caretakerWeightedScore(left) ||
    Number(
      (right?.caretaker_supervote_direction ?? (right?.caretaker_supervote ? 1 : null)) === 1,
    ) -
      Number(
        (left?.caretaker_supervote_direction ?? (left?.caretaker_supervote ? 1 : null)) === 1,
      ) ||
    fallback(left, right)
  )
}

// B-1065 B2b: the caretaker's signed 10x vote is three columns of their role
// (icono_caretaker_assignments, migration 0126). It counts while the role is
// active or suspended and stops when the role ends, with no copy to clear.
// Until now it lived in a per-gene head, an audit log, a receipt table, a copy
// of the role, and a trigger-maintained copy of every candidate's eligibility.
//
// The open-role filter repeats the partial unique index's own condition, so
// the lookup uses that index.
const OPEN_ROLE_SQL = `status IN ('pending_acceptance', 'active', 'suspended')`

// The election input for one gene, as election readers select it:
// asset_sha256, direction, active (1 while the supervote counts) and the
// role's status, with the role's account and start for the gene object. `symbolSql` is the SQL that names the gene (a parameter or a
// column).
// Every open role's supervote, for a join on gene_symbol.
export const CARETAKER_SUPERVOTES_SQL = `SELECT supervote_asset_sha256 AS asset_sha256,
         supervote_direction AS direction,
         CASE WHEN supervote_asset_sha256 IS NOT NULL
               AND status IN ('active', 'suspended') THEN 1 ELSE 0 END AS active,
         status AS assignment_status, gene_symbol, account_id, started_at
    FROM icono_caretaker_assignments
   WHERE ${OPEN_ROLE_SQL}`

export function caretakerSupervoteOfGeneSql(symbolSql) {
  return `${CARETAKER_SUPERVOTES_SQL} AND gene_symbol = ${symbolSql}`
}

const ROLE_SQL = `SELECT caretaker_assignment_id, gene_symbol, account_id, status,
                         assignment_version, supervote_asset_sha256, supervote_direction,
                         supervote_version, supervote_command_id
                    FROM icono_caretaker_assignments
                   WHERE gene_symbol = ?1 AND ${OPEN_ROLE_SQL}
                   LIMIT 1`

function supervoteSnapshot(role, viewerAccountId = "") {
  const counting = Boolean(
    role?.supervote_asset_sha256 &&
    CARETAKER_SUPERVOTE_DIRECTIONS.includes(Number(role.supervote_direction)) &&
    ["active", "suspended"].includes(String(role.status || "")),
  )
  const accountId = String(viewerAccountId || "").trim()
  return {
    schema_version: 2,
    assignment: role
      ? {
          gene_symbol: String(role.gene_symbol),
          caretaker_assignment_id: String(role.caretaker_assignment_id),
          caretaker_account_id: String(role.account_id),
          status: String(role.status),
          assignment_version: Number(role.assignment_version),
        }
      : null,
    assignment_status: role ? String(role.status) : null,
    assignment_version: Number(role?.assignment_version || 0),
    accepted_event_sequence: 0,
    supervote_version: Number(role?.supervote_version || 0),
    asset_sha256: counting ? String(role.supervote_asset_sha256) : null,
    direction: counting ? Number(role.supervote_direction) : null,
    active: counting,
    suspended: String(role?.status || "") === "suspended",
    weight: CARETAKER_SUPERVOTE_WEIGHT,
    can_mutate: Boolean(role && role.status === "active" && accountId === role.account_id),
  }
}

export async function readCaretakerSupervote(db, symbol, viewerAccountId = "") {
  const role = await db.prepare(ROLE_SQL).bind(normalizeSymbol(symbol)).first()
  return { role: role || null, snapshot: supervoteSnapshot(role, viewerAccountId) }
}

function appliedCommandBump(db, symbol, commandId) {
  return geneVoteVersionBumpStatement(db, symbol, {
    whenSql: `EXISTS (SELECT 1 FROM icono_caretaker_assignments
                       WHERE gene_symbol = ?1 AND ${OPEN_ROLE_SQL} AND supervote_command_id = ?2)`,
    whenArgs: [commandId],
  })
}

/**
 * The caretaker's signed 10x vote: move, confirm or clear it. One guarded
 * UPDATE of the caretaker's own role, applied only from the role and supervote
 * versions the page saw, and only onto a candidate the election counts. The
 * role remembers the last command, so a retry after a lost answer replays.
 *
 * A supervote spends one unit of the caretaker's own daily allowance
 * (vote-guards.js, counted apart from their reader votes). Once the day is
 * spent the write batch is refused whole, nothing is written, and the caller
 * gets a 429.
 */
export async function setCaretakerSupervote(
  db,
  {
    symbol,
    accountId,
    assetSha256 = null,
    direction = null,
    commandId,
    expectedAssignmentVersion,
    expectedSupervoteVersion,
  } = {},
  { dailyVoteLimit = VOTE_PERSON_DAILY_LIMIT } = {},
) {
  const geneSymbol = normalizeSymbol(symbol)
  const account = normalizeId(accountId, "caretaker_account_id")
  const targetAsset = normalizeSha256(assetSha256, { optional: true })
  const targetDirection = targetAsset ? normalizeDirection(direction) : null
  const command = normalizeId(commandId, "command_id")
  const expectedAssignment = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
    { minimum: 1 },
  )
  const expectedSupervote = normalizeVersion(expectedSupervoteVersion, "expected_supervote_version")

  const { role } = await readCaretakerSupervote(db, geneSymbol)
  const respond = (current, { changed, replayed }) => ({
    ok: true,
    changed,
    replayed,
    mutation_id: `caretaker-supervote:${command}`,
    accepted_event_sequence: 0,
    supervote: supervoteSnapshot(current, account),
  })
  if (role?.account_id === account && role.supervote_command_id === command)
    return respond(role, { changed: false, replayed: true })
  if (!role) fail("CARETAKER_ASSIGNMENT_REQUIRED", "Caretaker assignment is missing", 403)
  if (role.status === "suspended")
    fail("CARETAKER_ASSIGNMENT_SUSPENDED", "Suspended caretakers cannot move the supervote", 409)
  if (role.status !== "active")
    fail("CARETAKER_ASSIGNMENT_INACTIVE", "An active caretaker assignment is required", 403)
  if (role.account_id !== account)
    fail("CARETAKER_ASSIGNMENT_NOT_OWNED", "Only this gene's caretaker can move the supervote", 403)
  if (Number(role.assignment_version) !== expectedAssignment)
    fail("STALE_ASSIGNMENT_STATE", "Caretaker assignment changed", 409)
  if (Number(role.supervote_version || 0) !== expectedSupervote)
    fail("STALE_SUPERVOTE_STATE", "Caretaker supervote changed", 409)

  const changed =
    (role.supervote_asset_sha256 || null) !== targetAsset ||
    (role.supervote_asset_sha256 ? Number(role.supervote_direction) : null) !== targetDirection
  let results
  try {
    results = await db.batch([
      voteAllowanceStatement(db, `caretaker:${account}`, 1, dailyVoteLimit),
      // The role's updated_at stays: it dates the role's own changes.
      db
        .prepare(
          `UPDATE icono_caretaker_assignments
              SET supervote_asset_sha256 = ?1, supervote_direction = ?2,
                  supervote_version = supervote_version + 1, supervote_command_id = ?3
            WHERE caretaker_assignment_id = ?4 AND account_id = ?5 AND status = 'active'
              AND assignment_version = ?6 AND supervote_version = ?7
              AND (?1 IS NULL OR EXISTS (
                SELECT 1 FROM icono_portrait_assets pa
                 WHERE pa.gene_symbol = ?8 AND pa.asset_sha256 = ?1 AND ${ELIGIBLE_CANDIDATE_SQL}))`,
        )
        .bind(
          targetAsset,
          targetDirection,
          command,
          role.caretaker_assignment_id,
          account,
          expectedAssignment,
          expectedSupervote,
          geneSymbol,
        ),
      appliedCommandBump(db, geneSymbol, command),
      // Last, so the results above keep their positions.
      voteAllowanceCleanupStatement(db, `caretaker:${account}`),
    ])
  } catch (error) {
    if (isVoteDailyBudgetRefusal(error))
      fail(VOTE_DAILY_BUDGET_EXHAUSTED, voteDailyBudgetMessage(), 429)
    throw error
  }
  const { role: after } = await readCaretakerSupervote(db, geneSymbol)
  if (Number(results?.[1]?.meta?.changes || 0) === 1)
    return respond(after, { changed, replayed: false })
  if (after?.account_id === account && after.supervote_command_id === command)
    return respond(after, { changed: false, replayed: true })
  if (
    targetAsset &&
    Number(after?.assignment_version) === expectedAssignment &&
    Number(after?.supervote_version || 0) === expectedSupervote
  )
    fail(
      "SUPERVOTE_TARGET_INELIGIBLE",
      "Caretaker supervotes require an eligible, current candidate portrait",
      409,
    )
  fail("STALE_SUPERVOTE_STATE", "Caretaker supervote changed", 409)
}

/**
 * A candidate is about to stop being eligible (rejected, marked legacy,
 * removed, purged): the supervote that names it is cleared, so the
 * caretaker's page stops showing a vote for an image that is gone. The
 * election would ignore it anyway; clearing it advances the gene's vote
 * version, so the next election runs.
 */
export async function invalidateCaretakerSupervote(db, { symbol, assetSha256, invalidationId }) {
  const geneSymbol = normalizeSymbol(symbol)
  const asset = normalizeSha256(assetSha256)
  const mutationId = normalizeId(invalidationId, "invalidation_id")
  const results = await db.batch([
    db
      .prepare(
        `UPDATE icono_caretaker_assignments
            SET supervote_asset_sha256 = NULL, supervote_direction = NULL,
                supervote_version = supervote_version + 1, supervote_command_id = ?3
          WHERE gene_symbol = ?1 AND ${OPEN_ROLE_SQL} AND supervote_asset_sha256 = ?2`,
      )
      .bind(geneSymbol, asset, mutationId),
    appliedCommandBump(db, geneSymbol, mutationId),
  ])
  return {
    ok: true,
    selection_cleared: Number(results?.[0]?.meta?.changes || 0) > 0,
    mutation_id: mutationId,
  }
}
