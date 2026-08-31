import { normalizeId } from "./manifestation-authority-contract.js"
import {
  commandInputs,
  eventPayload,
  eventStatement,
  prepared,
  readHead,
  requireActiveGene,
  requireDatabase,
  runCommand,
} from "./manifestation-authority-repository.js"

export async function seedGeneWithoutManifestation(db, input = {}) {
  requireDatabase(db)
  const gene = await requireActiveGene(db, input.geneId)
  const head = await readHead(db, gene.gene_id)
  const cmd = commandInputs({
    commandId: input.commandId,
    requestSha256: input.requestSha256,
    actorKind: "migration",
    actorAccountId: null,
  })
  const eventUuid = normalizeId(input.eventUuid, "event_uuid")
  const nextHead = {
    ...head,
    gene_revision: Number(head.gene_revision) + 1,
  }
  return runCommand({
    db,
    ...cmd,
    commandType: "gene.registered_without_manifestation",
    geneId: gene.gene_id,
    response: {
      ok: true,
      gene_id: gene.gene_id,
      head_version: Number(nextHead.head_version),
      gene_revision: Number(nextHead.gene_revision),
      canonical_manifestation_id: null,
      canonical_revision_id: null,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_heads head
         WHERE head.gene_id = ? AND head.head_version = 0
           AND head.gene_revision = 0 AND head.canonical_revision_id IS NULL
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, gene.gene_id],
    statements: [
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = 1
          WHERE gene_id = ? AND head_version = 0 AND gene_revision = 0
            AND canonical_manifestation_id IS NULL AND canonical_revision_id IS NULL
            AND canonical_selection_id IS NULL`,
        gene.gene_id,
      ),
      eventStatement(db, {
        eventUuid,
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: 1,
        payloadJson: eventPayload({
          cause: "gene.registered_without_manifestation",
          gene,
          head: nextHead,
        }),
      }),
    ],
  })
}
