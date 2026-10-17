// B-1065 B2b: who looks after which gene, as plain rows of
// icono_caretaker_assignments in the main database (migration 0125), next to
// the votes and comments that read them. One statement per change, guarded by
// the row's own state and version; a gene and a person each have at most one
// open role (two partial unique indexes), so two racing claims end with one
// winner by construction.
//
// These replace the old authority's caretaker commands: a receipt, a guard row
// and an event per change, a head per gene, and an event replay that copied
// each role into two more tables here.
//
// A role is offered (pending_acceptance, B-1083 brings the admin's offer back),
// active, suspended by the admin, or ended. The caretaker claims a free gene,
// switches to another one, accepts or declines an offer, and leaves; the admin
// cancels an offer, suspends, resumes and ends a role.
import { sha256Hex } from "../lib/iconoplasm-sha256.js"
import { CURRENT_CARETAKER_TERMS } from "./caretaker/caretaker-terms-registry.js"
import { authorityError } from "./caretaker/manifestation-authority-contract.js"
import { geneVoteVersionBumpStatement } from "./votes/vote-guards.js"

export const OPEN_ROLE_STATUSES = Object.freeze(["pending_acceptance", "active", "suspended"])
const OPEN = `('pending_acceptance', 'active', 'suspended')`
// The browser echoes this back on a claim; one policy has ever existed.
export const CARETAKER_ENTITLEMENT_POLICY_VERSION = "caretaker_standard_v1"
// B-860: a caretaker's text stays with the gene when they leave. Only the admin
// can still end a role with "withdraw".
const LEAVE_POLICY = "retain"
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const GENE_LOCATOR = /^[A-Za-z0-9_.-]{1,128}$/

export const ROLE_COLUMNS = `caretaker_assignment_id, gene_symbol, account_id, status,
  assignment_version, terms_version_id, terms_accepted_at, relinquish_policy,
  invited_by_account_id, ended_by_account_id, end_reason, started_at, suspended_at,
  suspension_reason, ended_at, comments_read_through_id, created_at, updated_at,
  supervote_asset_sha256, supervote_direction, supervote_version`

// A role that ends while its supervote names one of the gene's images takes
// that vote out of the election (it counts only while the role is open). The
// gene's vote version advances in the same batch, and the caller re-runs the
// election for the genes in `reElect`.
function endedSupervoteBump(db, symbol, roleId, version) {
  return geneVoteVersionBumpStatement(db, symbol, {
    whenSql: `EXISTS (SELECT 1 FROM icono_caretaker_assignments
                       WHERE caretaker_assignment_id = ?2 AND assignment_version = ?3
                         AND status = 'ended' AND supervote_asset_sha256 IS NOT NULL)`,
    whenArgs: [roleId, version],
  })
}

// A caretaker starts with every comment already on the gene read.
const LATEST_COMMENT_SQL = (symbolSql) =>
  `COALESCE((SELECT MAX(id) FROM icono_gene_comments
              WHERE gene_symbol = ${symbolSql} AND status = 'visible'), 0)`

export function rolesDb(env) {
  const db = env?.ICONOPLASM_DB
  if (!db?.prepare)
    throw authorityError("CARETAKING_UNAVAILABLE", "Caretaker tools are unavailable", 503)
  return db
}

const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first()

// A gene the panel can work on is one with a text (every catalogue gene has one).
export async function resolveGene(db, rawLocator) {
  const locator = String(rawLocator || "").trim()
  if (!GENE_LOCATOR.test(locator))
    throw authorityError("INVALID_GENE_LOCATOR", "Gene identity or alias is invalid")
  const gene = await first(
    db,
    `SELECT gene_symbol, gene_id FROM icono_gene_texts WHERE gene_symbol = ?`,
    locator.toUpperCase(),
  )
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  return Object.freeze({
    gene_id: gene.gene_id,
    canonical_symbol: gene.gene_symbol,
    status: "active",
    aliases: [],
  })
}

export function openRoleOfAccount(db, accountId) {
  return first(
    db,
    `SELECT ${ROLE_COLUMNS} FROM icono_caretaker_assignments
      WHERE account_id = ? AND status IN ${OPEN} LIMIT 1`,
    accountId,
  )
}

export function openRoleOfGene(db, symbol) {
  return first(
    db,
    `SELECT ${ROLE_COLUMNS} FROM icono_caretaker_assignments
      WHERE gene_symbol = ? AND status IN ${OPEN} LIMIT 1`,
    symbol,
  )
}

// The account's role on this gene: its open one first, else its latest. Only an
// account that has cared for the gene may open its panel.
export function viewerRole(db, symbol, accountId) {
  return first(
    db,
    `SELECT ${ROLE_COLUMNS} FROM icono_caretaker_assignments
      WHERE account_id = ? AND gene_symbol = ?
      ORDER BY CASE status
        WHEN 'active' THEN 0 WHEN 'suspended' THEN 1
        WHEN 'pending_acceptance' THEN 2 ELSE 3 END,
        created_at DESC, caretaker_assignment_id DESC
      LIMIT 1`,
    accountId,
    symbol,
  )
}

// A write to a gene's texts needs its active caretaker (B-860: they look after
// every line on the gene, not only their own).
export async function requireSteward(db, geneLocator, accountId) {
  const gene = await resolveGene(db, geneLocator)
  const role = await first(
    db,
    `SELECT ${ROLE_COLUMNS} FROM icono_caretaker_assignments
      WHERE gene_symbol = ? AND account_id = ? AND status IN ${OPEN} LIMIT 1`,
    gene.canonical_symbol,
    accountId,
  )
  if (!role) throw authorityError("ASSIGNMENT_NOT_FOUND", "Caretaker assignment was not found", 404)
  if (role.status !== "active")
    throw authorityError("ASSIGNMENT_NOT_ACTIVE", "Caretaker assignment is not active", 409)
  return { gene, assignment: role }
}

// A caretaker's public name is a pseudonym that stays the same for one account,
// so History and the admin registry tell two caretakers apart without naming
// either.
export async function caretakerPseudonym(accountId) {
  const digest = await sha256Hex(
    new TextEncoder().encode(`iconoplasm.caretaker-label\n${accountId}`),
  )
  return `Caretaker ${digest.slice(0, 8).toUpperCase()}`
}

export function caretakerTerms() {
  return CURRENT_CARETAKER_TERMS
}

function publicTerms(terms) {
  return {
    terms_version_id: terms.terms_version_id,
    terms_sha256: terms.terms_sha256,
    document_url: terms.document_url,
    display_label: terms.display_label,
    effective_at: terms.effective_at,
  }
}

// B-1021: an account takes a new gene (a switch, or ending one role and claiming
// another) at most once per cooldown, counted from when it took its latest gene.
// The admin sets the length; switchPolicy answers { seconds, exempt } for the
// session, and the admin account is exempt. Only an account that has held a gene
// pays for the policy read.
async function switchCooldown(db, switchPolicy, session, accountId, nowIso) {
  if (typeof switchPolicy !== "function") return null
  const latest = await first(
    db,
    `SELECT MAX(started_at) AS started_at FROM icono_caretaker_assignments
      WHERE account_id = ? AND started_at IS NOT NULL`,
    accountId,
  )
  const startedMs = Date.parse(latest?.started_at || "")
  if (!Number.isFinite(startedMs)) return null
  const policy = (await switchPolicy(session)) || {}
  const seconds = Number(policy.seconds)
  if (policy.exempt === true || !Number.isFinite(seconds) || seconds <= 0) return null
  const availableMs = startedMs + seconds * 1000
  const nowMs = Date.parse(nowIso)
  if (!(availableMs > nowMs)) return null
  return {
    available_at: new Date(availableMs).toISOString(),
    retry_after_seconds: Math.ceil((availableMs - nowMs) / 1000),
    cooldown_seconds: seconds,
  }
}

// What the gene page's "Become caretaker" button needs. The wire keeps the old
// fields the browser echoes back (gene_revision, entitlement_policy_version).
export async function readClaimAvailability(
  db,
  { geneLocator, accountId, now, switchPolicy, session },
) {
  const gene = await resolveGene(db, geneLocator)
  const [geneRole, accountRole] = await Promise.all([
    openRoleOfGene(db, gene.canonical_symbol),
    openRoleOfAccount(db, accountId),
  ])
  const switchFrom =
    accountRole?.status === "active" && accountRole.gene_symbol !== gene.canonical_symbol
      ? {
          caretaker_assignment_id: accountRole.caretaker_assignment_id,
          canonical_symbol: accountRole.gene_symbol,
          assignment_version: Number(accountRole.assignment_version),
          gene_revision: 0,
          // The switch dialog pre-checks its terms box only when this role already
          // accepted the version on offer.
          terms_version_id: accountRole.terms_version_id,
          // B-1104: the switch dialog says the supervote is withdrawn only when there is one.
          has_supervote: Boolean(accountRole.supervote_asset_sha256),
        }
      : null
  let reason = null
  if (geneRole) reason = geneRole.account_id === accountId ? "already_caretaking" : "gene_taken"
  else if (accountRole && !switchFrom) reason = "account_already_caretaking"
  const cooldown =
    reason == null ? await switchCooldown(db, switchPolicy, session, accountId, now) : null
  if (cooldown) reason = "switch_cooldown"
  return {
    enabled: true,
    gene: { gene_id: gene.gene_id, canonical_symbol: gene.canonical_symbol },
    claim: {
      available: reason == null,
      reason,
      mode: switchFrom && reason == null ? "switch" : "claim",
      switch_from: switchFrom,
      // B-1027: the page shows the cooldown on the button itself, with its timer and
      // how much of the wait has passed, instead of hiding the button.
      ...(cooldown
        ? { available_at: cooldown.available_at, cooldown_seconds: cooldown.cooldown_seconds }
        : {}),
      gene_revision: 0,
      entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
      terms: publicTerms(caretakerTerms()),
    },
  }
}

function readCommandId(body) {
  const commandId = String(body?.command_id || "").trim()
  if (!COMMAND_ID.test(commandId))
    throw authorityError("COMMAND_ID_REQUIRED", "A command_id is required", 400)
  return commandId
}

// A role's ID comes from the account and the page's command ID, so a retried
// claim finds the role it already made instead of making a second.
async function roleIdFor(accountId, commandId) {
  const digest = await sha256Hex(
    new TextEncoder().encode(`iconoplasm.caretaker-claim\n${accountId}\n${commandId}`),
  )
  return `assignment_${digest.slice(0, 48)}`
}

function isConstraintError(error) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT|constraint failed/i.test(
    String(error?.message || error),
  )
}

function claimUnavailable(message = "Caretaking is no longer available for this gene or account") {
  return authorityError("CARETAKER_CLAIM_UNAVAILABLE", message, 409)
}

function requireCurrentTerms(body) {
  if (body?.terms_accepted !== true)
    throw authorityError(
      "TERMS_ACCEPTANCE_REQUIRED",
      "Confirm the displayed caretaker terms before becoming a caretaker",
      400,
    )
  if (String(body.terms_version_id || "") !== caretakerTerms().terms_version_id)
    throw authorityError(
      "TERMS_VERSION_MISMATCH",
      "The caretaker terms changed; refresh the gene page",
      409,
    )
}

// Claiming a free gene, or switching to it from the gene the account looks after
// now (the old role ends as "caretaker_switched_gene" in the same batch). The
// partial unique indexes refuse a second open role for the gene or the person,
// so a race or a stale page ends in 409 and nothing half-written.
export async function claimGene(db, { geneLocator, accountId, body, now, switchPolicy, session }) {
  requireCurrentTerms(body)
  const commandId = readCommandId(body)
  const roleId = await roleIdFor(accountId, commandId)
  const existing = await first(
    db,
    `SELECT ${ROLE_COLUMNS} FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
    roleId,
  )
  if (existing)
    return {
      result: {
        ok: true,
        replayed: true,
        caretaker_assignment_id: roleId,
        status: existing.status,
        assignment_version: Number(existing.assignment_version),
      },
      reElect: [],
    }
  const availability = await readClaimAvailability(db, {
    geneLocator,
    accountId,
    now,
    switchPolicy,
    session,
  })
  const { claim, gene } = availability
  if (claim.reason === "switch_cooldown") {
    const refusal = authorityError(
      "CARETAKER_SWITCH_COOLDOWN",
      "This account took a gene too recently to take another",
      429,
    )
    refusal.retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(claim.available_at) - Date.parse(now)) / 1000),
    )
    throw refusal
  }
  if (!claim.available) throw claimUnavailable()
  if (body.entitlement_policy_version !== claim.entitlement_policy_version)
    throw authorityError(
      "ENTITLEMENT_POLICY_VERSION_MISMATCH",
      "Caretaker eligibility changed; refresh the gene page",
      409,
    )
  const previous = claim.switch_from
  if ((body.previous_assignment_id || null) !== (previous?.caretaker_assignment_id || null))
    throw claimUnavailable("The current caretaker role changed; refresh the gene page")
  const statements = []
  const previousVersion = Number(
    body.expected_previous_assignment_version ?? previous?.assignment_version,
  )
  if (previous)
    statements.push(
      db
        .prepare(
          `UPDATE icono_caretaker_assignments
              SET status = 'ended', assignment_version = assignment_version + 1,
                  relinquish_policy = 'retain', ended_by_account_id = ?,
                  end_reason = 'caretaker_switched_gene', ended_at = ?,
                  suspended_at = NULL, suspension_reason = NULL, updated_at = ?
            WHERE caretaker_assignment_id = ? AND account_id = ? AND status = 'active'
              AND assignment_version = ?`,
        )
        .bind(accountId, now, now, previous.caretaker_assignment_id, accountId, previousVersion),
      endedSupervoteBump(
        db,
        previous.canonical_symbol,
        previous.caretaker_assignment_id,
        previousVersion + 1,
      ),
    )
  statements.push(
    db
      .prepare(
        `INSERT INTO icono_caretaker_assignments
           (caretaker_assignment_id, gene_symbol, account_id, status, assignment_version,
            terms_version_id, terms_accepted_at, relinquish_policy, invited_by_account_id,
            started_at, created_at, updated_at, comments_read_through_id)
         VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ${LATEST_COMMENT_SQL("?")})`,
      )
      .bind(
        roleId,
        gene.canonical_symbol,
        accountId,
        caretakerTerms().terms_version_id,
        now,
        LEAVE_POLICY,
        accountId,
        now,
        now,
        now,
        gene.canonical_symbol,
      ),
  )
  try {
    // A switch whose old role moved on ends nothing, and then the insert meets
    // the account's still-open role: the unique index refuses the whole batch.
    await db.batch(statements)
  } catch (error) {
    if (!isConstraintError(error)) throw error
    throw claimUnavailable()
  }
  const previousRole = previous
    ? await first(
        db,
        `SELECT supervote_asset_sha256 FROM icono_caretaker_assignments
          WHERE caretaker_assignment_id = ?`,
        previous.caretaker_assignment_id,
      )
    : null
  return {
    result: {
      ok: true,
      caretaker_assignment_id: roleId,
      status: "active",
      assignment_version: 1,
      gene_revision: 0,
    },
    reElect: previousRole?.supervote_asset_sha256 ? [previous.canonical_symbol] : [],
  }
}

// One change of one role, applied only from the state and version the page saw.
// A retried request that already landed answers with the role as it is.
const TRANSITIONS = Object.freeze({
  accept: {
    from: ["pending_acceptance"],
    to: "active",
    set: `status = 'active', terms_version_id = ?, terms_accepted_at = ?, started_at = ?,
          relinquish_policy = 'retain',
          comments_read_through_id = ${LATEST_COMMENT_SQL("icono_caretaker_assignments.gene_symbol")}`,
    args: (now) => [caretakerTerms().terms_version_id, now, now],
  },
  decline: {
    from: ["pending_acceptance"],
    to: "ended",
    set: `status = 'ended', end_reason = 'caretaker_declined', ended_by_account_id = ?, ended_at = ?`,
    args: (now, actor) => [actor, now],
  },
  end: {
    from: ["active", "suspended"],
    to: "ended",
    set: `status = 'ended', end_reason = ?, relinquish_policy = ?, ended_by_account_id = ?,
          ended_at = ?, suspended_at = NULL, suspension_reason = NULL`,
    args: (now, actor, { reason, policy }) => [reason, policy, actor, now],
  },
  cancel: {
    from: ["pending_acceptance"],
    to: "ended",
    set: `status = 'ended', end_reason = ?, ended_by_account_id = ?, ended_at = ?`,
    args: (now, actor, { reason }) => [reason, actor, now],
  },
  suspend: {
    from: ["active"],
    to: "suspended",
    set: `status = 'suspended', suspended_at = ?, suspension_reason = ?`,
    args: (now, _actor, { reason }) => [now, reason],
  },
  // B-1097: a role that ended keeping its texts can still withdraw them later,
  // for a gene left with nobody to look after them (ADO, NUP214 and RGS3 kept
  // texts cut at 4,000 characters by an old editor cap). The recorded policy
  // becomes "withdraw" and the admin route then runs the same withdrawal an
  // end with "withdraw" runs.
  withdraw: {
    from: ["ended"],
    to: "ended",
    set: `relinquish_policy = 'withdraw'`,
    args: () => [],
    // Ended before and after, so a replay is told apart by the policy.
    reached: (role) => role.status === "ended" && role.relinquish_policy === "withdraw",
  },
  resume: {
    from: ["suspended"],
    to: "active",
    set: `status = 'active', suspended_at = NULL, suspension_reason = NULL`,
    args: () => [],
  },
})

export function changeRoleStatement(
  db,
  { roleId, action, expectedVersion, actorAccountId, ownerAccountId = null, now, reason, policy },
) {
  const transition = TRANSITIONS[action]
  if (!transition)
    throw authorityError("INVALID_ASSIGNMENT_ACTION", "Assignment action is invalid", 400)
  const version = Number(expectedVersion)
  if (!Number.isSafeInteger(version) || version < 1)
    throw authorityError(
      "EXPECTED_ASSIGNMENT_VERSION_REQUIRED",
      "expected_assignment_version is required",
      400,
    )
  return db
    .prepare(
      `UPDATE icono_caretaker_assignments
          SET ${transition.set}, assignment_version = assignment_version + 1, updated_at = ?
        WHERE caretaker_assignment_id = ? AND assignment_version = ?
          AND status IN (${transition.from.map(() => "?").join(", ")})
          ${ownerAccountId ? "AND account_id = ?" : ""}`,
    )
    .bind(
      ...transition.args(now, actorAccountId, { reason, policy }),
      now,
      roleId,
      version,
      ...transition.from,
      ...(ownerAccountId ? [ownerAccountId] : []),
    )
}

// `extraStatements` run in the same batch, after the change; each must guard
// itself on the change having applied.
export async function changeRole(db, input, { extraStatements = () => [] } = {}) {
  const transition = TRANSITIONS[input.action]
  const before =
    transition?.to === "ended"
      ? await first(
          db,
          `SELECT gene_symbol FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
          input.roleId,
        )
      : null
  const results = await db.batch([
    changeRoleStatement(db, input),
    ...(before
      ? [
          endedSupervoteBump(
            db,
            before.gene_symbol,
            input.roleId,
            Number(input.expectedVersion) + 1,
          ),
        ]
      : []),
    ...extraStatements(db),
  ])
  const role = await first(
    db,
    `SELECT ${ROLE_COLUMNS} FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
    input.roleId,
  )
  if (!role || (input.ownerAccountId && role.account_id !== input.ownerAccountId))
    throw authorityError("ASSIGNMENT_NOT_FOUND", "Caretaker assignment was not found", 404)
  const changed = Number(results?.[0]?.meta?.changes || 0) === 1
  const reached = transition?.reached ?? ((row) => row.status === transition?.to)
  if (!changed && !reached(role))
    throw authorityError(
      "ASSIGNMENT_VERSION_CONFLICT",
      "The caretaker role changed; reload and try again",
      409,
    )
  return {
    changed,
    role,
    reElect:
      changed && role.status === "ended" && role.supervote_asset_sha256 ? [role.gene_symbol] : [],
    result: {
      ok: true,
      caretaker_assignment_id: role.caretaker_assignment_id,
      status: role.status,
      assignment_version: Number(role.assignment_version),
      ...(changed ? {} : { replayed: true }),
    },
  }
}

// The caretaker's own accept, decline or leave, from the gene page.
export async function changeOwnRole(db, { geneLocator, roleId, action, accountId, body, now }) {
  if (body?.caretaker_assignment_id != null && String(body.caretaker_assignment_id) !== roleId)
    throw authorityError("ROUTE_ENTITY_MISMATCH", "Body entity does not match route", 400)
  const gene = await resolveGene(db, geneLocator)
  const role = await first(
    db,
    `SELECT gene_symbol, account_id FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
    roleId,
  )
  if (!role || role.gene_symbol !== gene.canonical_symbol || role.account_id !== accountId)
    throw authorityError("ASSIGNMENT_NOT_FOUND", "Caretaker assignment was not found", 404)
  if (action === "accept") requireCurrentTerms(body)
  return changeRole(db, {
    roleId,
    action,
    expectedVersion: body?.expected_assignment_version,
    actorAccountId: accountId,
    ownerAccountId: accountId,
    now,
    reason: "caretaker_resigned",
    policy: LEAVE_POLICY,
  })
}

// B-987, B-1065 B2b: a person who asks to be erased stops looking after their
// gene at once. Their texts stay with the gene (the erasure rule keeps content,
// and an erased author shows as "Removed account"). Returns the genes whose
// election lost the person's supervote.
export async function endRolesOfErasedAccount(db, accountId, now) {
  const role = await openRoleOfAccount(db, accountId)
  if (!role) return []
  const { reElect } = await changeRole(db, {
    roleId: role.caretaker_assignment_id,
    action: role.status === "pending_acceptance" ? "cancel" : "end",
    expectedVersion: role.assignment_version,
    actorAccountId: null,
    now,
    reason: "account_erasure_requested",
    policy: LEAVE_POLICY,
  })
  return reElect
}
