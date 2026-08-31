import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeSymbol,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readFallback,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  requireActiveGene,
  requireDatabase,
  runCommand,
} from "./manifestation-authority-repository.js"
import { administratorContext } from "./manifestation-admin-context.js"
import { manifestationPurgeStorageStatements } from "./manifestation-purge-transition.js"

function nextGeneHead(head) {
  return { ...head, gene_revision: Number(head.gene_revision) + 1 }
}

function aliasRecord(aliasSymbol, aliasKind, validFrom, retiredAt = null) {
  return {
    alias_symbol: aliasSymbol,
    alias_kind: aliasKind,
    valid_from: validFrom,
    retired_at: retiredAt,
  }
}

export async function renameGeneIdentity(
  db,
  {
    geneId,
    canonicalSymbol,
    expectedIdentityVersion,
    expectedGeneRevision,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const admin = await administratorContext(db, command)
  if (admin.replay) return admin.replay
  const gene = await requireActiveGene(db, geneId)
  const head = await readHead(db, gene.gene_id)
  const symbol = normalizeSymbol(canonicalSymbol)
  const identityVersion = normalizeVersion(expectedIdentityVersion, "expected_identity_version")
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  if (symbol === gene.canonical_symbol) {
    throw authorityError("GENE_SYMBOL_UNCHANGED", "Canonical symbol is unchanged", 409)
  }
  const collision = await first(
    db,
    "SELECT gene_id FROM icono_gene_aliases WHERE alias_symbol = ? COLLATE NOCASE",
    symbol,
  )
  if (collision && collision.gene_id !== gene.gene_id) {
    throw authorityError("GENE_ALIAS_CONFLICT", "Gene symbol belongs to another gene", 409)
  }
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({
    ...command,
    actorKind: admin.actorKind,
    actorAccountId: admin.actor.account_id,
  })
  const aliases = (await readGeneAliases(db, gene.gene_id)).map((alias) =>
    alias.alias_symbol.toUpperCase() === gene.canonical_symbol.toUpperCase()
      ? { ...alias, alias_kind: "previous", retired_at: null }
      : alias,
  )
  const existing = aliases.find(
    (alias) => alias.alias_symbol.toUpperCase() === symbol.toUpperCase(),
  )
  if (existing) {
    existing.alias_kind = "canonical"
    existing.retired_at = null
  } else {
    aliases.push(aliasRecord(symbol, "canonical", timestamp))
  }
  const nextGene = {
    ...gene,
    canonical_symbol: symbol,
    identity_version: Number(gene.identity_version) + 1,
    aliases,
  }
  const nextHead = nextGeneHead(head)
  const response = {
    ok: true,
    gene_id: gene.gene_id,
    canonical_symbol: symbol,
    identity_version: nextGene.identity_version,
    gene_revision: nextHead.gene_revision,
  }
  return runCommand({
    db,
    ...cmd,
    commandType: "gene.rename",
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_gene_identities gene
        JOIN icono_manifestation_heads head ON head.gene_id = gene.gene_id
        WHERE gene.gene_id = ? AND gene.status = 'active'
          AND gene.identity_version = ? AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, gene.gene_id, identityVersion, geneRevision],
    statements: [
      prepared(
        db,
        `UPDATE icono_gene_aliases SET alias_kind = 'previous', retired_at = NULL
          WHERE gene_id = ? AND alias_symbol = ? COLLATE NOCASE`,
        gene.gene_id,
        gene.canonical_symbol,
      ),
      prepared(
        db,
        `INSERT INTO icono_gene_aliases (
           alias_symbol, gene_id, alias_kind, valid_from, retired_at
         ) VALUES (?, ?, 'canonical', ?, NULL)
         ON CONFLICT(alias_symbol) DO UPDATE SET alias_kind = 'canonical', retired_at = NULL
           WHERE gene_id = excluded.gene_id`,
        symbol,
        gene.gene_id,
        timestamp,
      ),
      prepared(
        db,
        `UPDATE icono_gene_identities
            SET canonical_symbol = ?, identity_version = identity_version + 1, updated_at = ?
          WHERE gene_id = ?`,
        symbol,
        timestamp,
        gene.gene_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        geneRevision,
      ),
      eventStatement(db, {
        eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        payloadJson: eventPayload({
          cause: "gene.identity_renamed",
          gene: nextGene,
          head: nextHead,
          changedAliases: aliases,
        }),
      }),
    ],
  })
}

export async function changeGeneAlias(
  db,
  {
    geneId,
    aliasSymbol,
    action,
    aliasKind = "synonym",
    expectedIdentityVersion,
    expectedGeneRevision,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const admin = await administratorContext(db, command)
  if (admin.replay) return admin.replay
  const gene = await requireActiveGene(db, geneId)
  const head = await readHead(db, gene.gene_id)
  const symbol = normalizeSymbol(aliasSymbol)
  const actionNorm = String(action || "")
    .trim()
    .toLowerCase()
  if (!new Set(["add", "retire"]).has(actionNorm)) {
    throw authorityError("INVALID_ALIAS_ACTION", "Alias action must be add or retire")
  }
  const kind = String(aliasKind || "synonym")
    .trim()
    .toLowerCase()
  if (!new Set(["previous", "synonym", "merge_source"]).has(kind)) {
    throw authorityError("INVALID_ALIAS_KIND", "Alias kind is invalid")
  }
  if (symbol === gene.canonical_symbol) {
    throw authorityError("CANONICAL_ALIAS_IMMUTABLE", "Canonical alias cannot be changed here", 409)
  }
  const identityVersion = normalizeVersion(expectedIdentityVersion, "expected_identity_version")
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const timestamp = normalizeTimestamp(now)
  const existing = await first(
    db,
    "SELECT gene_id, alias_kind, valid_from, retired_at FROM icono_gene_aliases WHERE alias_symbol = ? COLLATE NOCASE",
    symbol,
  )
  if (actionNorm === "add" && existing && existing.gene_id !== gene.gene_id) {
    throw authorityError("GENE_ALIAS_CONFLICT", "Alias belongs to another gene", 409)
  }
  if (actionNorm === "retire" && (!existing || existing.gene_id !== gene.gene_id)) {
    throw authorityError("GENE_ALIAS_NOT_FOUND", "Alias was not found", 404)
  }
  const cmd = commandInputs({
    ...command,
    actorKind: admin.actorKind,
    actorAccountId: admin.actor.account_id,
  })
  const aliases = await readGeneAliases(db, gene.gene_id)
  const changedAlias =
    actionNorm === "add"
      ? aliasRecord(symbol, kind, existing?.valid_from || timestamp)
      : aliasRecord(symbol, existing.alias_kind, existing.valid_from, timestamp)
  const nextAliases = aliases.filter(
    (alias) => alias.alias_symbol.toUpperCase() !== symbol.toUpperCase(),
  )
  nextAliases.push(changedAlias)
  const nextGene = {
    ...gene,
    identity_version: Number(gene.identity_version) + 1,
    aliases: nextAliases,
  }
  const nextHead = nextGeneHead(head)
  const aliasStatement =
    actionNorm === "add"
      ? prepared(
          db,
          `INSERT INTO icono_gene_aliases (
             alias_symbol, gene_id, alias_kind, valid_from, retired_at
           ) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(alias_symbol) DO UPDATE SET alias_kind = excluded.alias_kind, retired_at = NULL
             WHERE gene_id = excluded.gene_id`,
          symbol,
          gene.gene_id,
          kind,
          existing?.valid_from || timestamp,
        )
      : prepared(
          db,
          "UPDATE icono_gene_aliases SET retired_at = ? WHERE gene_id = ? AND alias_symbol = ? COLLATE NOCASE",
          timestamp,
          gene.gene_id,
          symbol,
        )
  return runCommand({
    db,
    ...cmd,
    commandType: `gene.alias_${actionNorm}`,
    geneId: gene.gene_id,
    response: {
      ok: true,
      gene_id: gene.gene_id,
      alias: changedAlias,
      identity_version: nextGene.identity_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_gene_identities gene
        JOIN icono_manifestation_heads head ON head.gene_id = gene.gene_id
        WHERE gene.gene_id = ? AND gene.identity_version = ? AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, gene.gene_id, identityVersion, geneRevision],
    statements: [
      aliasStatement,
      prepared(
        db,
        `UPDATE icono_gene_identities SET identity_version = identity_version + 1, updated_at = ?
          WHERE gene_id = ?`,
        timestamp,
        gene.gene_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        geneRevision,
      ),
      eventStatement(db, {
        eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        payloadJson: eventPayload({
          cause: `gene.alias_${actionNorm}`,
          gene: nextGene,
          head: nextHead,
          changedAliases: [changedAlias],
          tombstones:
            actionNorm === "retire"
              ? [{ entity_type: "gene_alias", entity_id: symbol, state: "retired" }]
              : [],
        }),
      }),
    ],
  })
}

export async function mergeGeneIdentity(
  db,
  {
    geneId,
    targetGeneId,
    expectedIdentityVersion,
    expectedGeneRevision,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const admin = await administratorContext(db, command)
  if (admin.replay) return admin.replay
  const gene = await requireActiveGene(db, geneId)
  const target = await requireActiveGene(db, targetGeneId)
  if (gene.gene_id === target.gene_id) {
    throw authorityError("GENE_MERGE_SELF", "A gene cannot merge into itself", 409)
  }
  const head = await readHead(db, gene.gene_id)
  const identityVersion = normalizeVersion(expectedIdentityVersion, "expected_identity_version")
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({
    ...command,
    actorKind: admin.actorKind,
    actorAccountId: admin.actor.account_id,
  })
  const nextGene = {
    ...gene,
    status: "merged",
    merged_into_gene_id: target.gene_id,
    identity_version: Number(gene.identity_version) + 1,
  }
  const nextHead = nextGeneHead(head)
  return runCommand({
    db,
    ...cmd,
    commandType: "gene.merge",
    geneId: gene.gene_id,
    response: {
      ok: true,
      gene_id: gene.gene_id,
      merged_into_gene_id: target.gene_id,
      identity_version: nextGene.identity_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_gene_identities gene
        JOIN icono_manifestation_heads head ON head.gene_id = gene.gene_id
        WHERE gene.gene_id = ? AND gene.status = 'active'
          AND gene.identity_version = ? AND head.gene_revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM icono_caretaker_assignments assignment
             WHERE assignment.gene_id = gene.gene_id
               AND assignment.status IN ('pending_acceptance', 'active', 'suspended')
          )
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, gene.gene_id, identityVersion, geneRevision],
    statements: [
      prepared(
        db,
        `UPDATE icono_gene_identities
            SET status = 'merged', merged_into_gene_id = ?,
                identity_version = identity_version + 1, updated_at = ?
          WHERE gene_id = ?`,
        target.gene_id,
        timestamp,
        gene.gene_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        geneRevision,
      ),
      eventStatement(db, {
        eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        payloadJson: eventPayload({
          cause: "gene.identity_merged",
          gene: nextGene,
          head: nextHead,
          tombstones: [
            {
              entity_type: "gene_identity",
              entity_id: gene.gene_id,
              state: "merged",
              merged_into_gene_id: target.gene_id,
            },
          ],
        }),
      }),
    ],
  })
}

async function setManifestationAdministrativeStatus(
  db,
  {
    manifestationId,
    status,
    expectedManifestationVersion,
    expectedHeadVersion,
    expectedCanonicalRevisionId,
    reasonCode,
    urgentPurge = false,
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  },
) {
  requireDatabase(db)
  const admin = await administratorContext(db, command)
  if (admin.replay) return admin.replay
  const manifestation = await readManifestation(
    db,
    normalizeId(manifestationId, "manifestation_id"),
  )
  if (!manifestation)
    throw authorityError("MANIFESTATION_NOT_FOUND", "Manifestation was not found", 404)
  if (manifestation.non_withdrawable) {
    throw authorityError("MANIFESTATION_NON_WITHDRAWABLE", "System seed cannot be changed", 409)
  }
  const timestamp = normalizeTimestamp(now)
  const purgeStatuses = new Set(["active", "withdrawn", "moderated"])
  if (
    status === "purged"
      ? !purgeStatuses.has(manifestation.status)
      : manifestation.status !== "active"
  ) {
    throw authorityError(
      "MANIFESTATION_NOT_ELIGIBLE",
      "Manifestation is not eligible for this transition",
      409,
    )
  }
  if (status === "purged") {
    const deadlineElapsed =
      manifestation.status === "withdrawn" &&
      manifestation.purge_eligible_at &&
      manifestation.purge_eligible_at <= timestamp
    if (!deadlineElapsed && urgentPurge !== true) {
      throw authorityError(
        "MANIFESTATION_PURGE_RETENTION_ACTIVE",
        "Manifestation retention has not elapsed; urgent purge requires explicit authorization",
        409,
      )
    }
  }
  const gene = await readGene(db, manifestation.gene_id)
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const version = normalizeVersion(expectedManifestationVersion, "expected_manifestation_version")
  const headVersion = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedRevision =
    expectedCanonicalRevisionId == null
      ? null
      : normalizeId(expectedCanonicalRevisionId, "expected_canonical_revision_id")
  const isCanonical = head.canonical_manifestation_id === manifestation.manifestation_id
  const fallback = isCanonical
    ? await readFallback(db, gene.gene_id, [manifestation.manifestation_id])
    : null
  const reason = String(reasonCode || "").trim()
  if (!reason || reason.length > 128) {
    throw authorityError(
      "INVALID_ADMINISTRATIVE_REASON",
      "Administrative reason must contain 1 to 128 characters",
    )
  }
  const cmd = commandInputs({
    ...command,
    actorKind: admin.actorKind,
    actorAccountId: admin.actor.account_id,
  })
  const selectionIdNorm = isCanonical
    ? createId(selectionId, "canonical_selection_id", "selection", idFactory)
    : null
  const nextHead = isCanonical
    ? {
        ...head,
        canonical_manifestation_id: fallback.selected_manifestation_id,
        canonical_revision_id: fallback.selected_revision_id,
        canonical_selection_id: selectionIdNorm,
        head_version: Number(head.head_version) + 1,
        gene_revision: Number(head.gene_revision) + 1,
      }
    : nextGeneHead(head)
  const selectionReason = status === "purged" ? "purge_fallback" : "moderation_fallback"
  const changedSelection = isCanonical
    ? canonicalSelectionRecord({
        selectionId: selectionIdNorm,
        geneId: gene.gene_id,
        head,
        nextHead,
        manifestationId: fallback.selected_manifestation_id,
        revisionId: fallback.selected_revision_id,
        actorAccountId: admin.actor.account_id,
        assignmentId: manifestation.caretaker_assignment_id,
        reason: selectionReason,
        commandId: cmd.commandId,
        timestamp,
      })
    : null
  const statements = []
  if (isCanonical) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        selectionIdNorm,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        fallback.selected_manifestation_id,
        fallback.selected_revision_id,
        admin.actor.account_id,
        manifestation.caretaker_assignment_id,
        selectionReason,
        cmd.commandId,
        nextHead.head_version,
        nextHead.gene_revision,
        timestamp,
      ),
    )
  } else {
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        Number(head.gene_revision),
      ),
    )
  }
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestations
          SET status = ?, row_version = row_version + 1,
              withdrawal_reason = ?, withdrawn_at = NULL, purge_eligible_at = NULL, updated_at = ?
        WHERE manifestation_id = ?`,
      status,
      reason,
      timestamp,
      manifestation.manifestation_id,
    ),
    prepared(
      db,
      `UPDATE icono_manifestation_revision_lifecycle
          SET status = ?, lifecycle_version = lifecycle_version + 1,
              changed_by_account_id = ?, change_reason = ?, changed_at = ?
        WHERE manifestation_revision_id IN (
          SELECT manifestation_revision_id FROM icono_manifestation_revisions
           WHERE manifestation_id = ?
        ) AND status <> 'purged'`,
      status,
      admin.actor.account_id,
      reason,
      timestamp,
      manifestation.manifestation_id,
    ),
  )
  if (status === "purged") {
    statements.push(
      ...manifestationPurgeStorageStatements(db, {
        manifestationId: manifestation.manifestation_id,
        actorKind: admin.actorKind,
        actorAccountId: admin.actor.account_id,
        timestamp,
      }),
    )
  }
  statements.push(
    eventStatement(db, {
      eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId: manifestation.manifestation_id,
      selectionId: selectionIdNorm,
      assignmentId: manifestation.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: `manifestation.${status}`,
        gene,
        head: nextHead,
        manifestation: {
          ...manifestation,
          status,
          row_version: Number(manifestation.row_version) + 1,
        },
        changedSelection,
        tombstones: [
          {
            entity_type: "manifestation",
            entity_id: manifestation.manifestation_id,
            state: status,
          },
        ],
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: `manifestation.${status}`,
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_id: manifestation.manifestation_id,
      status,
      manifestation_row_version: Number(manifestation.row_version) + 1,
      fallback_revision_id: fallback?.selected_revision_id || null,
      head_version: nextHead.head_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestations manifestation
        JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
        WHERE manifestation.manifestation_id = ? AND manifestation.status = ?
          AND manifestation.non_withdrawable = 0 AND manifestation.row_version = ?
          AND head.head_version = ? AND head.canonical_revision_id IS ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      manifestation.manifestation_id,
      manifestation.status,
      version,
      headVersion,
      expectedRevision,
    ],
    statements,
  })
}

export function moderateManifestation(db, input = {}) {
  return setManifestationAdministrativeStatus(db, { ...input, status: "moderated" })
}

export function purgeManifestation(db, input = {}) {
  return setManifestationAdministrativeStatus(db, { ...input, status: "purged" })
}

// ARCHITECTURE FENCE [IPD-012]
