import {
  MANIFESTATION_AUTHORITY_EVENT_TYPE,
  authorityError,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizeSha256,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"

function prepared(db, sql, ...params) {
  const statement = db.prepare(sql)
  return params.length ? statement.bind(...params) : statement
}

async function first(db, sql, ...params) {
  const statement = prepared(db, sql, ...params)
  if (typeof statement.first === "function") return statement.first()
  const result = await statement.all()
  return Array.isArray(result?.results) ? result.results[0] || null : null
}

async function all(db, sql, ...params) {
  const result = await prepared(db, sql, ...params).all()
  return Array.isArray(result?.results) ? result.results : []
}

function requireDatabase(db) {
  if (!db?.prepare || !db?.batch) throw new TypeError("A D1 database binding is required")
  return db
}

function parseReceiptResponse(row) {
  try {
    return JSON.parse(String(row?.response_json || "{}"))
  } catch {
    throw authorityError("CORRUPT_COMMAND_RECEIPT", "Stored command receipt is invalid", 500)
  }
}

async function readReceipt(db, commandId) {
  return first(
    db,
    `SELECT receipt.command_id, receipt.request_sha256, receipt.response_json,
            receipt.actor_kind, receipt.actor_account_id,
            receipt.accepted_event_sequence, receipt.accepted_event_uuid AS event_uuid
       FROM icono_authoring_command_receipts receipt
      WHERE receipt.command_id = ?`,
    commandId,
  )
}

async function readCommandTombstone(db, commandId) {
  return first(
    db,
    `SELECT command_id, request_sha256, actor_kind, actor_account_id,
            accepted_event_sequence, accepted_event_uuid AS event_uuid
       FROM icono_authoring_command_tombstones WHERE command_id = ?`,
    commandId,
  )
}

function receiptResult(row, replayed) {
  return Object.freeze({
    ...parseReceiptResponse(row),
    event_id: row?.event_uuid || null,
    accepted_event_sequence:
      row?.accepted_event_sequence == null ? null : Number(row.accepted_event_sequence),
    replayed,
  })
}

async function findReplay(db, commandId, requestSha256, actorKind, actorAccountId) {
  const row = (await readReceipt(db, commandId)) || (await readCommandTombstone(db, commandId))
  if (!row) return null
  if (String(row.request_sha256 || "").toLowerCase() !== requestSha256) {
    throw authorityError(
      "IDEMPOTENCY_KEY_REUSED",
      "This command ID was already used for a different request",
      409,
    )
  }
  if (row.actor_kind !== actorKind || (row.actor_account_id || null) !== (actorAccountId || null)) {
    throw authorityError(
      "IDEMPOTENCY_ACTOR_MISMATCH",
      "This command ID belongs to another authority actor",
      403,
    )
  }
  if (row.response_json == null) {
    throw authorityError(
      "IDEMPOTENCY_RECEIPT_EXPIRED",
      "This accepted command is outside the replay-response window; refresh authority state",
      409,
    )
  }
  return receiptResult(row, true)
}

async function resolveCommandReplay(
  db,
  command,
  { actorKind = command?.actorKind, actorAccountId = command?.actorAccountId } = {},
) {
  requireDatabase(db)
  const commandId = normalizeId(command?.commandId, "command_id")
  const requestSha256 = normalizeSha256(command?.requestSha256)
  const normalizedActorKind = normalizeActorKind(actorKind)
  const normalizedActorAccountId = normalizeOptionalId(actorAccountId, "actor_account_id")
  return findReplay(db, commandId, requestSha256, normalizedActorKind, normalizedActorAccountId)
}

function isCasFailure(error) {
  return /authority_command_guard_failed|check constraint failed:\s*(?:guard_value|icono_authority_command_guards)|stale_(?:canonical_selection|manifestation_head_version|gene_revision)|canonical_revision_is_not_eligible|event_gene_revision_mismatch/i.test(
    String(error?.message || error || ""),
  )
}

async function runCommand({
  db,
  commandId,
  commandType,
  requestSha256,
  actorKind,
  actorAccountId,
  geneId,
  response,
  guardSql,
  guardParams,
  statements,
}) {
  const replay = await findReplay(db, commandId, requestSha256, actorKind, actorAccountId)
  if (replay) return replay

  const receipt = prepared(
    db,
    `INSERT INTO icono_authoring_command_receipts (
       command_id, command_type, actor_kind, actor_account_id, gene_id,
       request_sha256, response_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    commandId,
    commandType,
    actorKind,
    actorAccountId,
    geneId,
    requestSha256,
    JSON.stringify(response),
  )
  const guard = prepared(db, guardSql, ...guardParams)
  const clearGuard = prepared(
    db,
    "DELETE FROM icono_authority_command_guards WHERE command_id = ?",
    commandId,
  )

  try {
    await db.batch([guard, receipt, ...statements, clearGuard])
  } catch (error) {
    const concurrentReplay = await findReplay(
      db,
      commandId,
      requestSha256,
      actorKind,
      actorAccountId,
    )
    if (concurrentReplay) return concurrentReplay
    if (isCasFailure(error)) {
      throw authorityError(
        "STALE_AUTHORITY_STATE",
        "The manifestation authority changed before this command committed",
        409,
        error,
      )
    }
    const message = String(error?.message || error || "")
    if (/unique constraint failed:\s*icono_caretaker_assignments\.account_id/i.test(message)) {
      throw authorityError(
        "ACCOUNT_ALREADY_HAS_OPEN_ASSIGNMENT",
        "This account already has an open caretaker assignment",
        409,
        error,
      )
    }
    if (/unique constraint failed:\s*icono_caretaker_assignments\.gene_id/i.test(message)) {
      throw authorityError(
        "GENE_ALREADY_HAS_OPEN_CARETAKER",
        "This gene already has an open caretaker assignment",
        409,
        error,
      )
    }
    throw error
  }

  const committed = await readReceipt(db, commandId)
  if (!committed)
    throw authorityError("COMMAND_RECEIPT_MISSING", "Command receipt did not commit", 500)
  return receiptResult(committed, false)
}

async function readAccount(db, accountId) {
  return first(
    db,
    `SELECT account_id, public_credit_label, status, identity_version
       FROM icono_authority_accounts
      WHERE account_id = ?`,
    accountId,
  )
}

async function requireActiveAccount(db, rawAccountId) {
  const accountId = normalizeId(rawAccountId, "account_id")
  const row = await readAccount(db, accountId)
  if (!row) throw authorityError("ACCOUNT_NOT_REGISTERED", "Account is not registered", 404)
  if (row.status === "disabled") {
    throw authorityError("ACCOUNT_DISABLED", "Account authoring access is disabled", 403)
  }
  if (row.status === "erasure_pending") {
    throw authorityError("ACCOUNT_ERASURE_PENDING", "Account erasure is in progress", 403)
  }
  if (row.status === "tombstoned") {
    throw authorityError("ACCOUNT_TOMBSTONED", "Account is no longer active", 403)
  }
  return row
}

async function readGene(db, geneId) {
  return first(
    db,
    `SELECT gene_id, canonical_symbol, status, merged_into_gene_id, identity_version
       FROM icono_gene_identities
      WHERE gene_id = ?`,
    geneId,
  )
}

async function readGeneAliases(db, geneId) {
  return all(
    db,
    `SELECT alias_symbol, alias_kind, valid_from, retired_at
       FROM icono_gene_aliases
      WHERE gene_id = ?
      ORDER BY valid_from, alias_symbol COLLATE NOCASE`,
    geneId,
  )
}

async function requireActiveGene(db, rawGeneId) {
  const geneId = normalizeId(rawGeneId, "gene_id")
  const row = await readGene(db, geneId)
  if (!row) throw authorityError("GENE_NOT_REGISTERED", "Gene is not registered", 404)
  if (row.status !== "active") throw authorityError("GENE_NOT_ACTIVE", "Gene is not active", 409)
  return { ...row, aliases: await readGeneAliases(db, geneId) }
}

async function readHead(db, geneId) {
  const row = await first(
    db,
    `SELECT gene_id, canonical_manifestation_id, canonical_revision_id,
            canonical_selection_id, head_version, gene_revision, last_event_sequence
       FROM icono_manifestation_heads
      WHERE gene_id = ?`,
    geneId,
  )
  if (!row)
    throw authorityError("MANIFESTATION_HEAD_MISSING", "Gene authority head is missing", 500)
  return row
}

async function readSelection(db, selectionId) {
  if (!selectionId) return null
  return first(
    db,
    `SELECT canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
            selected_manifestation_id, selected_revision_id, actor_account_id,
            caretaker_assignment_id, reason, command_id, head_version,
            gene_revision, created_at
       FROM icono_manifestation_canonical_selections
      WHERE canonical_selection_id = ?`,
    selectionId,
  )
}

async function readAssignment(db, assignmentId) {
  return first(
    db,
    `SELECT assignment.caretaker_assignment_id, assignment.gene_id,
            assignment.account_id, assignment.status, assignment.assignment_version,
            assignment.terms_version_id, assignment.terms_accepted_at,
            assignment.entitlement_policy_version, assignment.entitlement_grace_ends_at,
            assignment.relinquish_policy, assignment.invited_by_account_id,
            assignment.ended_by_account_id, assignment.end_reason,
            assignment.started_at, assignment.suspended_at,
            assignment.suspension_reason, assignment.ended_at,
            account.public_credit_label AS account_public_credit_label,
            account.status AS account_status
       FROM icono_caretaker_assignments assignment
       JOIN icono_authority_accounts account ON account.account_id = assignment.account_id
      WHERE assignment.caretaker_assignment_id = ?`,
    assignmentId,
  )
}

async function requireAssignment(db, rawAssignmentId) {
  const assignmentId = normalizeId(rawAssignmentId, "caretaker_assignment_id")
  const row = await readAssignment(db, assignmentId)
  if (!row) throw authorityError("ASSIGNMENT_NOT_FOUND", "Caretaker assignment was not found", 404)
  return row
}

async function readManifestation(db, manifestationId) {
  return first(
    db,
    `SELECT manifestation_id, gene_id, author_account_id, caretaker_assignment_id,
            origin, status, manifestation_head_revision_id, source_manifestation_id,
            row_version, non_withdrawable, public_page_visible, withdrawn_at, purge_eligible_at
       FROM icono_manifestations
      WHERE manifestation_id = ?`,
    manifestationId,
  )
}

async function readAssignmentManifestation(db, assignmentId) {
  return first(
    db,
    `SELECT manifestation_id, gene_id, author_account_id, caretaker_assignment_id,
            origin, status, manifestation_head_revision_id, source_manifestation_id,
            row_version, non_withdrawable, public_page_visible, withdrawn_at, purge_eligible_at
       FROM icono_manifestations
      WHERE caretaker_assignment_id = ?
        AND origin IN ('caretaker', 'fork')
      ORDER BY created_at DESC
      LIMIT 1`,
    assignmentId,
  )
}

async function readRevision(db, revisionId) {
  return first(
    db,
    `SELECT r.manifestation_revision_id, r.manifestation_id, r.revision_number,
            r.parent_revision_id, r.source_revision_id, r.body_sha256, r.body_bytes,
            r.sample_label, r.sample_number, r.sample_text_sha256,
            r.author_account_id, r.caretaker_assignment_id, r.created_at,
            m.gene_id, m.status AS manifestation_status, m.author_account_id AS owner_account_id,
            l.status AS lifecycle_status, l.lifecycle_version
       FROM icono_manifestation_revisions r
       JOIN icono_manifestations m ON m.manifestation_id = r.manifestation_id
       JOIN icono_manifestation_revision_lifecycle l
         ON l.manifestation_revision_id = r.manifestation_revision_id
       JOIN icono_manifestation_revision_storage_secrets s
         ON s.manifestation_revision_id = r.manifestation_revision_id
      WHERE r.manifestation_revision_id = ?`,
    revisionId,
  )
}

async function readFallback(db, geneId, excludedManifestationIds) {
  const excluded = new Set(excludedManifestationIds.filter(Boolean))
  const rows = await all(
    db,
    `SELECT s.canonical_selection_id, s.selected_manifestation_id,
            s.selected_revision_id, s.head_version,
            r.body_sha256, r.body_bytes, r.revision_number,
            m.origin, m.author_account_id
       FROM icono_manifestation_canonical_selections s
       JOIN icono_manifestations m ON m.manifestation_id = s.selected_manifestation_id
       JOIN icono_manifestation_revisions r
         ON r.manifestation_revision_id = s.selected_revision_id
       JOIN icono_manifestation_revision_lifecycle l
         ON l.manifestation_revision_id = r.manifestation_revision_id
       JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = r.manifestation_revision_id
      WHERE s.gene_id = ?
        AND m.status = 'active'
        AND l.status = 'active'
      ORDER BY s.head_version DESC`,
    geneId,
  )
  const selected = rows.find((row) => !excluded.has(String(row.selected_manifestation_id || "")))
  if (!selected) {
    throw authorityError(
      "NO_ELIGIBLE_FALLBACK",
      "No eligible canonical fallback exists; every gene requires a system seed",
      409,
    )
  }
  return selected
}

function geneSnapshot(gene) {
  return gene
    ? {
        gene_id: gene.gene_id,
        canonical_symbol: gene.canonical_symbol,
        status: gene.status,
        merged_into_gene_id: gene.merged_into_gene_id || null,
        identity_version: Number(gene.identity_version),
        aliases: Array.isArray(gene.aliases)
          ? gene.aliases.map((alias) => ({
              alias_symbol: alias.alias_symbol,
              alias_kind: alias.alias_kind,
              valid_from: alias.valid_from,
              retired_at: alias.retired_at || null,
            }))
          : [],
      }
    : null
}

function assignmentSnapshot(assignment) {
  return assignment
    ? {
        caretaker_assignment_id: assignment.caretaker_assignment_id,
        gene_id: assignment.gene_id,
        account_id: assignment.account_id,
        account_public_credit_label: assignment.account_public_credit_label || null,
        account_tombstoned: assignment.account_status === "tombstoned",
        status: assignment.status,
        assignment_version: Number(assignment.assignment_version),
        terms_version_id: assignment.terms_version_id || null,
        entitlement_policy_version: assignment.entitlement_policy_version,
        entitlement_grace_ends_at: assignment.entitlement_grace_ends_at || null,
        relinquish_policy: assignment.relinquish_policy || null,
        started_at: assignment.started_at || null,
        suspended_at: assignment.suspended_at || null,
        ended_at: assignment.ended_at || null,
      }
    : null
}

function manifestationSnapshot(manifestation) {
  return manifestation
    ? {
        manifestation_id: manifestation.manifestation_id,
        gene_id: manifestation.gene_id,
        author_account_id: manifestation.author_account_id || null,
        caretaker_assignment_id: manifestation.caretaker_assignment_id || null,
        origin: manifestation.origin,
        status: manifestation.status,
        manifestation_head_revision_id: manifestation.manifestation_head_revision_id || null,
        source_manifestation_id: manifestation.source_manifestation_id || null,
        row_version: Number(manifestation.row_version),
        non_withdrawable: Boolean(manifestation.non_withdrawable),
        public_page_visible: Boolean(manifestation.public_page_visible),
      }
    : null
}

function revisionSnapshot(revision) {
  return revision
    ? {
        manifestation_revision_id: revision.manifestation_revision_id,
        manifestation_id: revision.manifestation_id,
        revision_number: Number(revision.revision_number),
        parent_revision_id: revision.parent_revision_id || null,
        source_revision_id: revision.source_revision_id || null,
        body_sha256: revision.body_sha256,
        body_bytes: Number(revision.body_bytes),
        sample_label: revision.sample_label || null,
        sample_number: revision.sample_number == null ? null : Number(revision.sample_number),
        sample_text_sha256: revision.sample_text_sha256 || null,
        author_account_id: revision.author_account_id || null,
        caretaker_assignment_id: revision.caretaker_assignment_id || null,
        lifecycle_status: revision.lifecycle_status || "active",
        lifecycle_version: Number(revision.lifecycle_version || 1),
        created_at: revision.created_at,
      }
    : null
}

function canonicalSnapshot(head) {
  return head
    ? {
        manifestation_id: head.canonical_manifestation_id || null,
        manifestation_revision_id: head.canonical_revision_id || null,
        canonical_selection_id: head.canonical_selection_id || null,
        head_version: Number(head.head_version),
        gene_revision: Number(head.gene_revision),
      }
    : null
}

function selectionSnapshot(selection) {
  return selection
    ? {
        canonical_selection_id: selection.canonical_selection_id,
        gene_id: selection.gene_id,
        previous_selection_id: selection.previous_selection_id || null,
        previous_revision_id: selection.previous_revision_id || null,
        selected_manifestation_id: selection.selected_manifestation_id,
        selected_revision_id: selection.selected_revision_id,
        actor_account_id: selection.actor_account_id || null,
        caretaker_assignment_id: selection.caretaker_assignment_id || null,
        reason: selection.reason,
        command_id: selection.command_id,
        head_version: Number(selection.head_version),
        gene_revision: Number(selection.gene_revision),
        created_at: selection.created_at,
      }
    : null
}

function canonicalSelectionRecord({
  selectionId,
  geneId,
  head,
  nextHead,
  manifestationId,
  revisionId,
  actorAccountId,
  assignmentId,
  reason,
  commandId,
  timestamp,
}) {
  return {
    canonical_selection_id: selectionId,
    gene_id: geneId,
    previous_selection_id: head.canonical_selection_id || null,
    previous_revision_id: head.canonical_revision_id || null,
    selected_manifestation_id: manifestationId,
    selected_revision_id: revisionId,
    actor_account_id: actorAccountId || null,
    caretaker_assignment_id: assignmentId || null,
    reason,
    command_id: commandId,
    head_version: Number(nextHead.head_version),
    gene_revision: Number(nextHead.gene_revision),
    created_at: timestamp,
  }
}

function eventPayload({
  cause,
  gene,
  head,
  assignment = null,
  manifestation = null,
  revision = null,
  changedSelection = null,
  changedAliases = [],
  changedDerivative = null,
  derivativeHead = null,
  tombstones = [],
}) {
  return JSON.stringify({
    schema_version: 1,
    cause,
    gene: geneSnapshot(gene),
    assignment: assignmentSnapshot(assignment),
    manifestation: manifestationSnapshot(manifestation),
    canonical: canonicalSnapshot(head),
    changed_revision: revisionSnapshot(revision),
    changed_selection: selectionSnapshot(changedSelection),
    changed_aliases: changedAliases,
    changed_derivative: changedDerivative,
    derivative_head: derivativeHead,
    tombstones,
  })
}

function eventStatement(
  db,
  {
    eventUuid,
    commandId,
    geneId,
    geneRevision,
    payloadJson,
    manifestationId = null,
    revisionId = null,
    selectionId = null,
    assignmentId = null,
  },
) {
  return prepared(
    db,
    `INSERT INTO icono_manifestation_events (
       event_uuid, command_id, event_type, gene_id, gene_revision,
       manifestation_id, manifestation_revision_id, canonical_selection_id,
       caretaker_assignment_id, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventUuid,
    commandId,
    MANIFESTATION_AUTHORITY_EVENT_TYPE,
    geneId,
    geneRevision,
    manifestationId,
    revisionId,
    selectionId,
    assignmentId,
    payloadJson,
  )
}

function commandInputs({ commandId, requestSha256, actorKind = "account", actorAccountId = null }) {
  return {
    commandId: normalizeId(commandId, "command_id"),
    requestSha256: normalizeSha256(requestSha256),
    actorKind: normalizeActorKind(actorKind),
    actorAccountId: normalizeOptionalId(actorAccountId, "actor_account_id"),
  }
}

export async function readManifestationAuthorityGeneState(db, rawGeneId) {
  requireDatabase(db)
  const gene = await requireActiveGene(db, rawGeneId)
  const head = await readHead(db, gene.gene_id)
  const assignment = await first(
    db,
    `SELECT caretaker_assignment_id, gene_id, account_id, status,
            assignment_version, terms_version_id, entitlement_policy_version,
            entitlement_grace_ends_at, relinquish_policy, started_at,
            suspended_at, ended_at
       FROM icono_caretaker_assignments
      WHERE gene_id = ? AND status IN ('pending_acceptance', 'active', 'suspended')
      LIMIT 1`,
    gene.gene_id,
  )
  const manifestation = head.canonical_manifestation_id
    ? await readManifestation(db, head.canonical_manifestation_id)
    : null
  const revision = head.canonical_revision_id
    ? await readRevision(db, head.canonical_revision_id)
    : null
  const selection = await readSelection(db, head.canonical_selection_id)
  return Object.freeze({
    schema_version: 1,
    last_event_sequence: Number(head.last_event_sequence),
    gene: geneSnapshot(gene),
    assignment: assignmentSnapshot(assignment),
    manifestation: manifestationSnapshot(manifestation),
    canonical: canonicalSnapshot(head),
    changed_revision: revisionSnapshot(revision),
    changed_selection: selectionSnapshot(selection),
    changed_aliases: [],
    changed_derivative: null,
    derivative_head: null,
    tombstones: [],
  })
}

export {
  all,
  assignmentSnapshot,
  canonicalSnapshot,
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  geneSnapshot,
  manifestationSnapshot,
  prepared,
  readAccount,
  readAssignment,
  readAssignmentManifestation,
  readFallback,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  readReceipt,
  readRevision,
  readSelection,
  receiptResult,
  requireActiveAccount,
  requireActiveGene,
  requireAssignment,
  requireDatabase,
  resolveCommandReplay,
  revisionSnapshot,
  selectionSnapshot,
  runCommand,
}
