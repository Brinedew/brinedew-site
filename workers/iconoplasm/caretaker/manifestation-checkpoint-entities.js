import { authorityError } from "./manifestation-authority-contract.js"

const MAX_ENTITY_JSON_BYTES = 64 * 1024
const ENCODER = new TextEncoder()

function record(kind, key, geneId, sourceEventSequence, value) {
  const entityJson = JSON.stringify(value)
  if (ENCODER.encode(entityJson).byteLength > MAX_ENTITY_JSON_BYTES) {
    throw authorityError(
      "CHECKPOINT_ENTITY_TOO_LARGE",
      "Authority checkpoint entity exceeds the bounded record size",
      409,
    )
  }
  return {
    entityKind: kind,
    entityKey: String(key),
    geneId: String(geneId),
    sourceEventSequence: Number(sourceEventSequence),
    entityJson,
  }
}

function geneRecords(gene, canonical, geneId, sequence) {
  const aliases = Array.isArray(gene?.aliases) ? gene.aliases : []
  const identity = { ...gene }
  delete identity.aliases
  return [
    record("gene_identity", geneId, geneId, sequence, identity),
    record("canonical_head", geneId, geneId, sequence, canonical),
    ...aliases.map((alias) =>
      record("gene_alias", String(alias.alias_symbol || "").toUpperCase(), geneId, sequence, alias),
    ),
  ]
}

export function checkpointRecordsFromBaseline(row) {
  const gene = {
    gene_id: row.gene_id,
    canonical_symbol: row.canonical_symbol,
    status: "active",
    merged_into_gene_id: null,
    identity_version: 1,
    aliases: [
      {
        alias_symbol: row.canonical_symbol,
        alias_kind: "canonical",
        valid_from: row.registered_at,
        retired_at: null,
      },
    ],
  }
  return geneRecords(
    gene,
    {
      manifestation_id: null,
      manifestation_revision_id: null,
      canonical_selection_id: null,
      head_version: 0,
      gene_revision: 0,
    },
    row.gene_id,
    0,
  )
}

export function checkpointRecordsFromEvent(row) {
  let payload
  try {
    payload = JSON.parse(row.payload_json)
  } catch (error) {
    throw authorityError(
      "CORRUPT_AUTHORITY_EVENT",
      "Authority event payload is invalid",
      500,
      error,
    )
  }
  const sequence = Number(row.event_sequence)
  const geneId = String(row.gene_id)
  const records = geneRecords(payload.gene, payload.canonical, geneId, sequence)
  const optional = [
    ["assignment", "caretaker_assignment_id", payload.assignment],
    ["manifestation", "manifestation_id", payload.manifestation],
    ["revision", "manifestation_revision_id", payload.changed_revision],
    ["canonical_selection", "canonical_selection_id", payload.changed_selection],
    ["tags_derivative", "manifestation_derivative_id", payload.changed_derivative],
    ["derivative_head", "manifestation_revision_id", payload.derivative_head],
  ]
  for (const [kind, idField, value] of optional) {
    if (value && typeof value === "object") {
      if (!value[idField]) {
        throw authorityError(
          "CORRUPT_AUTHORITY_EVENT",
          `Authority event ${kind} identity is missing`,
          500,
        )
      }
      records.push(record(kind, value[idField], geneId, sequence, value))
    }
  }
  for (const tombstone of Array.isArray(payload.tombstones) ? payload.tombstones : []) {
    if (!tombstone?.entity_type || !tombstone?.entity_id) {
      throw authorityError(
        "CORRUPT_AUTHORITY_EVENT",
        "Authority event tombstone identity is missing",
        500,
      )
    }
    records.push(
      record(
        "tombstone",
        `${tombstone.entity_type}:${tombstone.entity_id}`,
        geneId,
        sequence,
        tombstone,
      ),
    )
  }
  return records
}

export function checkpointEntityPart(checkpoint, row) {
  return {
    schema_version: 1,
    part_kind: "authority_checkpoint_entity",
    checkpoint: {
      checkpoint_id: checkpoint.checkpoint_id,
      authority_epoch: Number(checkpoint.authority_epoch),
      watermark_event_sequence: Number(checkpoint.target_watermark_event_sequence),
      manifest_sha256: checkpoint.manifest_sha256,
    },
    entity: {
      entity_kind: row.entity_kind,
      entity_key: row.entity_key,
      gene_id: row.gene_id,
      source_event_sequence: Number(row.source_event_sequence),
      record: JSON.parse(row.entity_json),
    },
  }
}

export { MAX_ENTITY_JSON_BYTES }
