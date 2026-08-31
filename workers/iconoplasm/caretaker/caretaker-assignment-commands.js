import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizePolicy,
  normalizeSha256,
  normalizeSymbol,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  geneSnapshot,
  prepared,
  readAccount,
  readGene,
  readGeneAliases,
  readHead,
  requireActiveAccount,
  requireActiveGene,
  requireAssignment,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"

export async function registerAuthorityAccount(
  db,
  { accountId, publicCreditLabel = null, status = "active", now } = {},
) {
  requireDatabase(db)
  const accountIdNorm = normalizeId(accountId, "account_id")
  const statusNorm = String(status || "active").trim()
  if (!["active", "disabled", "erasure_pending", "tombstoned"].includes(statusNorm)) {
    throw authorityError("INVALID_ACCOUNT_STATUS", "Account status is invalid")
  }
  const timestamp = normalizeTimestamp(now)
  const creditLabel =
    publicCreditLabel == null
      ? `Caretaker ${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`
      : String(publicCreditLabel).trim()
  if (
    creditLabel.length < 3 ||
    creditLabel.length > 64 ||
    /[\u0000-\u001f\u007f]/u.test(creditLabel)
  ) {
    throw authorityError("INVALID_PUBLIC_CREDIT_LABEL", "Public caretaker credit label is invalid")
  }
  await prepared(
    db,
    `INSERT OR IGNORE INTO icono_authority_accounts (
       account_id, public_credit_label, status, created_at, updated_at,
       disabled_at, erasure_requested_at, tombstoned_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    accountIdNorm,
    creditLabel,
    statusNorm,
    timestamp,
    timestamp,
    statusNorm === "disabled" ? timestamp : null,
    ["erasure_pending", "tombstoned"].includes(statusNorm) ? timestamp : null,
    statusNorm === "tombstoned" ? timestamp : null,
  ).run()
  const row = await readAccount(db, accountIdNorm)
  if (!row) throw authorityError("ACCOUNT_REGISTRATION_FAILED", "Account registration failed", 500)
  if (row.status !== statusNorm) {
    throw authorityError(
      "ACCOUNT_IDENTITY_CONFLICT",
      "Account identity already has another status",
      409,
    )
  }
  return Object.freeze({
    account_id: row.account_id,
    public_credit_label: row.public_credit_label,
    status: row.status,
    identity_version: Number(row.identity_version),
  })
}

export async function registerGeneIdentity(db, { geneId, canonicalSymbol, now } = {}) {
  requireDatabase(db)
  const geneIdNorm = normalizeId(geneId, "gene_id")
  const symbol = normalizeSymbol(canonicalSymbol)
  const timestamp = normalizeTimestamp(now)
  try {
    await prepared(
      db,
      `INSERT OR IGNORE INTO icono_gene_identities (
         gene_id, canonical_symbol, created_at, updated_at
       ) VALUES (?, ?, ?, ?)`,
      geneIdNorm,
      symbol,
      timestamp,
      timestamp,
    ).run()
  } catch (error) {
    const bySymbol = await first(
      db,
      "SELECT gene_id, canonical_symbol FROM icono_gene_identities WHERE canonical_symbol = ? COLLATE NOCASE",
      symbol,
    )
    if (bySymbol?.gene_id !== geneIdNorm) {
      throw authorityError(
        "GENE_IDENTITY_CONFLICT",
        "Gene symbol already belongs to another gene",
        409,
        error,
      )
    }
  }
  const row = await readGene(db, geneIdNorm)
  if (!row || String(row.canonical_symbol).toUpperCase() !== symbol) {
    throw authorityError(
      "GENE_IDENTITY_CONFLICT",
      "Gene identity does not match its canonical symbol",
      409,
    )
  }
  row.aliases = await readGeneAliases(db, geneIdNorm)
  return Object.freeze(geneSnapshot(row))
}

export async function registerCaretakerTermsVersion(
  db,
  {
    termsVersionId,
    termsSha256,
    documentUrl,
    displayLabel,
    effectiveAt,
    createdByAccountId,
    createdByActorKind = "account",
  } = {},
) {
  requireDatabase(db)
  const termsId = normalizeId(termsVersionId, "terms_version_id")
  const creatorKind = normalizeActorKind(createdByActorKind)
  if (!new Set(["account", "administrator", "service", "migration"]).has(creatorKind)) {
    throw authorityError("INVALID_TERMS_CREATOR", "Caretaker terms creator is invalid")
  }
  const account = new Set(["account", "administrator"]).has(creatorKind)
    ? await requireActiveAccount(db, createdByAccountId)
    : null
  if (account == null && createdByAccountId != null) {
    throw authorityError(
      "INVALID_TERMS_CREATOR",
      "Service terms registration cannot impersonate an account",
    )
  }
  const hash = normalizeSha256(termsSha256, "terms_sha256")
  const url = String(documentUrl || "").trim()
  if (!/^https:\/\/[^\s]{4,488}$/.test(url)) {
    throw authorityError("INVALID_TERMS_DOCUMENT_URL", "Caretaker terms document URL is invalid")
  }
  const label = String(displayLabel || "").trim()
  if (label.length < 3 || label.length > 120) {
    throw authorityError("INVALID_TERMS_DISPLAY_LABEL", "Caretaker terms label is invalid")
  }
  const effective = normalizeTimestamp(effectiveAt)
  await prepared(
    db,
    `INSERT OR IGNORE INTO icono_caretaker_terms_versions (
       terms_version_id, terms_sha256, document_url, display_label,
        effective_at, created_by_actor_kind, created_by_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    termsId,
    hash,
    url,
    label,
    effective,
    creatorKind,
    account?.account_id || null,
  ).run()
  const row = await first(
    db,
    `SELECT terms_version_id, terms_sha256, document_url, display_label, effective_at,
            created_by_actor_kind, created_by_account_id
       FROM icono_caretaker_terms_versions WHERE terms_version_id = ?`,
    termsId,
  )
  if (
    !row ||
    row.terms_sha256 !== hash ||
    row.document_url !== url ||
    row.display_label !== label ||
    row.effective_at !== effective ||
    row.created_by_actor_kind !== creatorKind ||
    (row.created_by_account_id || null) !== (account?.account_id || null)
  ) {
    throw authorityError("TERMS_VERSION_CONFLICT", "Caretaker terms version already differs", 409)
  }
  return Object.freeze(row)
}

export async function offerCaretakerAssignment(
  db,
  {
    geneId,
    accountId,
    invitedByAccountId,
    entitlementPolicyVersion,
    expectedGeneRevision,
    assignmentId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const replay = await resolveCommandReplay(db, command, {
    actorKind: "administrator",
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const gene = await requireActiveGene(db, geneId)
  const account = await requireActiveAccount(db, accountId)
  const inviter = await requireActiveAccount(db, invitedByAccountId)
  const head = await readHead(db, gene.gene_id)
  if (!head.canonical_manifestation_id || !head.canonical_revision_id) {
    throw authorityError(
      "GENE_NOT_CARETAKER_READY",
      "This gene does not yet have a provable system manifestation seed",
      409,
    )
  }
  const expectedRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const policyVersion = String(entitlementPolicyVersion || "").trim()
  if (!policyVersion || policyVersion.length > 128) {
    throw authorityError("INVALID_ENTITLEMENT_POLICY", "Entitlement policy version is invalid")
  }
  const assignmentIdNorm = createId(
    assignmentId,
    "caretaker_assignment_id",
    "assignment",
    idFactory,
  )
  const eventUuidNorm = createId(eventUuid, "event_uuid", "event", idFactory)
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({
    ...command,
    actorKind: "administrator",
    actorAccountId: inviter.account_id,
  })
  const nextAssignment = {
    caretaker_assignment_id: assignmentIdNorm,
    gene_id: gene.gene_id,
    account_id: account.account_id,
    account_public_credit_label: account.public_credit_label,
    account_status: account.status,
    status: "pending_acceptance",
    assignment_version: 1,
    terms_version_id: null,
    entitlement_policy_version: policyVersion,
    entitlement_grace_ends_at: null,
    relinquish_policy: null,
    started_at: null,
    suspended_at: null,
    ended_at: null,
  }
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const response = {
    ok: true,
    caretaker_assignment_id: assignmentIdNorm,
    status: "pending_acceptance",
    assignment_version: 1,
    gene_revision: nextHead.gene_revision,
  }
  return runCommand({
    db,
    ...cmd,
    commandType: "caretaker.assignment_offer",
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_heads h
        WHERE h.gene_id = ? AND h.gene_revision = ?
          AND h.canonical_manifestation_id IS NOT NULL
          AND h.canonical_revision_id IS NOT NULL
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, gene.gene_id, expectedRevision],
    statements: [
      prepared(
        db,
        `INSERT INTO icono_caretaker_assignments (
           caretaker_assignment_id, gene_id, account_id, status,
           entitlement_policy_version, invited_by_account_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'pending_acceptance', ?, ?, ?, ?)`,
        assignmentIdNorm,
        gene.gene_id,
        account.account_id,
        policyVersion,
        inviter.account_id,
        timestamp,
        timestamp,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads
            SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        expectedRevision,
      ),
      eventStatement(db, {
        eventUuid: eventUuidNorm,
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        assignmentId: assignmentIdNorm,
        payloadJson: eventPayload({
          cause: "caretaker.assignment_offered",
          gene,
          head: nextHead,
          assignment: nextAssignment,
        }),
      }),
    ],
  })
}

export async function transitionCaretakerAssignment(
  db,
  {
    assignmentId,
    action,
    expectedAssignmentVersion,
    termsVersionId = null,
    relinquishPolicy = null,
    suspensionReason = null,
    graceEndsAt = null,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const replayAction = String(action || "")
    .trim()
    .toLowerCase()
  const accountOwnedAction = replayAction === "accept" || replayAction === "decline"
  const replay = await resolveCommandReplay(db, command, {
    actorKind: accountOwnedAction ? "account" : normalizeActorKind(command.actorKind),
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const assignment = await requireAssignment(db, assignmentId)
  const gene = await requireActiveGene(db, assignment.gene_id)
  const head = await readHead(db, gene.gene_id)
  const expectedVersion = normalizeVersion(expectedAssignmentVersion, "expected_assignment_version")
  const actionNorm = String(action || "")
    .trim()
    .toLowerCase()
  const transitions = {
    accept: { from: "pending_acceptance", to: "active", cause: "caretaker.assignment_accepted" },
    decline: {
      from: "pending_acceptance",
      to: "ended",
      cause: "caretaker.assignment_declined",
      endReason: "invitation_declined",
    },
    cancel: {
      from: "pending_acceptance",
      to: "ended",
      cause: "caretaker.assignment_cancelled",
      endReason: "invitation_cancelled",
    },
    suspend: { from: "active", to: "suspended", cause: "caretaker.assignment_suspended" },
    resume: { from: "suspended", to: "active", cause: "caretaker.assignment_resumed" },
  }
  const transition = transitions[actionNorm]
  if (!transition) throw authorityError("INVALID_ASSIGNMENT_ACTION", "Assignment action is invalid")
  if (assignment.status !== transition.from) {
    throw authorityError(
      "INVALID_ASSIGNMENT_TRANSITION",
      "Assignment is not in the required state",
      409,
    )
  }
  const actorKind = ["accept", "decline"].includes(actionNorm)
    ? "account"
    : normalizeActorKind(command.actorKind)
  const actorAccountId =
    actorKind === "service"
      ? normalizeOptionalId(command.actorAccountId, "actor_account_id")
      : normalizeId(command.actorAccountId, "actor_account_id")
  if (actorAccountId) await requireActiveAccount(db, actorAccountId)
  if (["accept", "decline"].includes(actionNorm) && actorAccountId !== assignment.account_id) {
    throw authorityError("ASSIGNMENT_NOT_OWNED", "Only the invited account may respond", 403)
  }
  if (
    !["accept", "decline"].includes(actionNorm) &&
    !["administrator", "service"].includes(actorKind)
  ) {
    throw authorityError(
      "ADMINISTRATOR_REQUIRED",
      "This assignment transition requires administrator authority",
      403,
    )
  }
  let termsId = assignment.terms_version_id || null
  let nextPolicy = assignment.relinquish_policy || null
  const timestamp = normalizeTimestamp(now)
  if (actionNorm === "accept") {
    termsId = normalizeId(termsVersionId, "terms_version_id")
    const terms = await first(
      db,
      `SELECT terms_version_id FROM icono_caretaker_terms_versions
        WHERE terms_version_id = ? AND retired_at IS NULL AND effective_at <= ?`,
      termsId,
      timestamp,
    )
    if (!terms)
      throw authorityError("TERMS_VERSION_NOT_ACTIVE", "Caretaker terms version is not active", 409)
    if (relinquishPolicy == null) {
      throw authorityError(
        "RELINQUISH_POLICY_CONFIRMATION_REQUIRED",
        "Choose the default retain or withdraw policy before accepting",
      )
    }
    nextPolicy = normalizePolicy(relinquishPolicy)
  }
  let suspensionReasonNorm = null
  if (actionNorm === "suspend") {
    suspensionReasonNorm = String(suspensionReason ?? "").trim()
    if (!suspensionReasonNorm || suspensionReasonNorm.length > 500) {
      throw authorityError(
        "INVALID_SUSPENSION_REASON",
        "Suspension reason must contain 1 to 500 characters",
      )
    }
  }
  const nextVersion = Number(assignment.assignment_version) + 1
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const nextAssignment = {
    ...assignment,
    status: transition.to,
    assignment_version: nextVersion,
    terms_version_id: termsId,
    terms_accepted_at: actionNorm === "accept" ? timestamp : assignment.terms_accepted_at,
    relinquish_policy: nextPolicy,
    started_at: actionNorm === "accept" ? timestamp : assignment.started_at,
    suspended_at:
      actionNorm === "suspend"
        ? timestamp
        : actionNorm === "resume"
          ? null
          : assignment.suspended_at,
    suspension_reason:
      actionNorm === "suspend"
        ? suspensionReasonNorm
        : actionNorm === "resume"
          ? null
          : assignment.suspension_reason,
    entitlement_grace_ends_at:
      actionNorm === "suspend" && graceEndsAt ? normalizeTimestamp(graceEndsAt) : null,
    ended_by_account_id:
      transition.to === "ended" ? actorAccountId : assignment.ended_by_account_id,
    end_reason: transition.to === "ended" ? transition.endReason : assignment.end_reason,
    ended_at: transition.to === "ended" ? timestamp : assignment.ended_at,
  }
  const cmd = commandInputs({
    ...command,
    actorKind,
    actorAccountId,
  })
  const response = {
    ok: true,
    caretaker_assignment_id: assignment.caretaker_assignment_id,
    status: transition.to,
    assignment_version: nextVersion,
    gene_revision: nextHead.gene_revision,
  }
  return runCommand({
    db,
    ...cmd,
    commandType: `caretaker.assignment_${actionNorm}`,
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1
          FROM icono_caretaker_assignments a
          JOIN icono_manifestation_heads h ON h.gene_id = a.gene_id
         WHERE a.caretaker_assignment_id = ?
           AND a.status = ?
           AND a.assignment_version = ?
           AND h.gene_revision = ?
           AND (? <> 'accept' OR EXISTS (
             SELECT 1 FROM icono_caretaker_terms_versions terms
              WHERE terms.terms_version_id = ? AND terms.retired_at IS NULL
                AND terms.effective_at <= ?
           ))
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      assignment.caretaker_assignment_id,
      transition.from,
      expectedVersion,
      Number(head.gene_revision),
      actionNorm,
      termsId,
      timestamp,
    ],
    statements: [
      prepared(
        db,
        `UPDATE icono_caretaker_assignments
            SET status = ?, assignment_version = assignment_version + 1,
                terms_version_id = ?, terms_accepted_at = ?, relinquish_policy = ?,
                started_at = ?, suspended_at = ?, entitlement_grace_ends_at = ?,
                suspension_reason = ?,
                ended_by_account_id = ?, end_reason = ?, ended_at = ?,
                updated_at = ?
          WHERE caretaker_assignment_id = ?`,
        transition.to,
        termsId,
        nextAssignment.terms_accepted_at,
        nextPolicy,
        nextAssignment.started_at,
        nextAssignment.suspended_at,
        nextAssignment.entitlement_grace_ends_at,
        nextAssignment.suspension_reason,
        nextAssignment.ended_by_account_id,
        nextAssignment.end_reason,
        nextAssignment.ended_at,
        timestamp,
        assignment.caretaker_assignment_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads
            SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        Number(head.gene_revision),
      ),
      eventStatement(db, {
        eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        assignmentId: assignment.caretaker_assignment_id,
        payloadJson: eventPayload({
          cause: transition.cause,
          gene,
          head: nextHead,
          assignment: nextAssignment,
        }),
      }),
    ],
  })
}
