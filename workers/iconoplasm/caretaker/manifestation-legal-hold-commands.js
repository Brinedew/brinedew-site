import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  requireDatabase,
  runCommand,
} from "./manifestation-authority-repository.js"
import { administratorContext } from "./manifestation-admin-context.js"

export async function changeManifestationLegalHold(
  db,
  {
    manifestationId,
    action,
    legalHoldId,
    reasonCode,
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
  const manifestation = await readManifestation(
    db,
    normalizeId(manifestationId, "manifestation_id"),
  )
  if (!manifestation)
    throw authorityError("MANIFESTATION_NOT_FOUND", "Manifestation was not found", 404)
  const gene = await readGene(db, manifestation.gene_id)
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const actionNorm = String(action || "")
    .trim()
    .toLowerCase()
  if (!new Set(["place", "release"]).has(actionNorm)) {
    throw authorityError("INVALID_LEGAL_HOLD_ACTION", "Legal hold action is invalid")
  }
  const holdId = normalizeId(legalHoldId, "legal_hold_id")
  if (!admin.actor.account_id) {
    throw authorityError("AUDIT_ACCOUNT_REQUIRED", "Legal hold requires an audit account", 403)
  }
  const activeHold = await first(
    db,
    `SELECT legal_hold_id FROM icono_manifestation_legal_holds
      WHERE manifestation_id = ? AND released_at IS NULL`,
    manifestation.manifestation_id,
  )
  if (actionNorm === "place" && activeHold) {
    throw authorityError("LEGAL_HOLD_ALREADY_ACTIVE", "Manifestation already has a legal hold", 409)
  }
  if (actionNorm === "release" && activeHold?.legal_hold_id !== holdId) {
    throw authorityError("LEGAL_HOLD_NOT_ACTIVE", "The specified legal hold is not active", 409)
  }
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({
    ...command,
    actorKind: admin.actorKind,
    actorAccountId: admin.actor.account_id,
  })
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const mutation =
    actionNorm === "place"
      ? prepared(
          db,
          `INSERT INTO icono_manifestation_legal_holds (
           legal_hold_id, manifestation_id, reason, placed_by_account_id, placed_at
         ) VALUES (?, ?, ?, ?, ?)`,
          holdId,
          manifestation.manifestation_id,
          String(reasonCode || "legal_hold").slice(0, 128),
          admin.actor.account_id,
          timestamp,
        )
      : prepared(
          db,
          `UPDATE icono_manifestation_legal_holds
            SET released_by_account_id = ?, released_at = ?
          WHERE legal_hold_id = ? AND manifestation_id = ? AND released_at IS NULL`,
          admin.actor.account_id,
          timestamp,
          holdId,
          manifestation.manifestation_id,
        )
  return runCommand({
    db,
    ...cmd,
    commandType: `manifestation.legal_hold_${actionNorm}`,
    geneId: gene.gene_id,
    response: {
      ok: true,
      legal_hold_id: holdId,
      status: actionNorm === "place" ? "active" : "released",
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_heads
         WHERE gene_id = ? AND gene_revision = ?
      ) AND ${
        actionNorm === "place"
          ? `NOT EXISTS (SELECT 1 FROM icono_manifestation_legal_holds
                           WHERE manifestation_id = ? AND released_at IS NULL)`
          : `EXISTS (SELECT 1 FROM icono_manifestation_legal_holds
                       WHERE manifestation_id = ? AND legal_hold_id = ?
                         AND released_at IS NULL)`
      } THEN 1 ELSE 0 END`,
    guardParams:
      actionNorm === "place"
        ? [cmd.commandId, gene.gene_id, geneRevision, manifestation.manifestation_id]
        : [cmd.commandId, gene.gene_id, geneRevision, manifestation.manifestation_id, holdId],
    statements: [
      mutation,
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
        manifestationId: manifestation.manifestation_id,
        payloadJson: eventPayload({
          cause: `manifestation.legal_hold_${actionNorm}`,
          gene,
          head: nextHead,
          manifestation,
          tombstones: [
            {
              entity_type: "legal_hold",
              entity_id: holdId,
              state: actionNorm === "place" ? "active" : "released",
            },
          ],
        }),
      }),
    ],
  })
}

// ARCHITECTURE FENCE [IPD-012]
