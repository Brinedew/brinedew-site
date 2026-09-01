import { authorityError, normalizeId } from "./manifestation-authority-contract.js"
import { first, requireDatabase } from "./manifestation-authority-repository.js"

// Secret-free exact-current record for the primary D1 projector. Callers must
// CAS on gene_revision/head_version because callbacks may arrive out of order.
export async function readCanonicalProjectionRecord(db, rawGeneId) {
  requireDatabase(db)
  const geneId = normalizeId(rawGeneId, "gene_id")
  const row = await first(
    db,
    `SELECT gene.gene_id, gene.canonical_symbol, gene.status AS gene_status,
            head.canonical_manifestation_id, head.canonical_revision_id,
            head.canonical_selection_id, head.head_version, head.gene_revision,
            head.last_event_sequence, latest.event_uuid AS last_event_id,
            revision.body_sha256, revision.body_bytes,
            manifestation.public_page_visible AS canonical_public_page_visible,
            lifecycle.status AS revision_lifecycle,
            derivative_head.accepted_derivative_id,
            derivative_head.derivative_head_version,
            derivative.status AS derivative_status,
             derivative.source_body_sha256 AS derivative_source_body_sha256,
             derivative.body_sha256 AS derivative_body_sha256,
             derivative.body_bytes AS derivative_body_bytes,
             derivative.tags_sha256, derivative.tags_bytes,
             derivative.fields_sha256, derivative.fields_bytes,
            derivative.recipe_id, derivative.recipe_version,
            derivative.provider_id, derivative.model_id,
            derivative.tagger_config_sha256, derivative.provenance_status
       FROM icono_gene_identities gene
       JOIN icono_manifestation_heads head ON head.gene_id = gene.gene_id
       LEFT JOIN icono_manifestation_events latest
         ON latest.event_sequence = head.last_event_sequence
       LEFT JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = head.canonical_revision_id
       LEFT JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = head.canonical_manifestation_id
       LEFT JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivative_heads derivative_head
         ON derivative_head.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivatives derivative
         ON derivative.manifestation_derivative_id = derivative_head.accepted_derivative_id
      WHERE gene.gene_id = ?`,
    geneId,
  )
  if (!row) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  const canonical = row.canonical_revision_id
    ? {
        manifestation_id: row.canonical_manifestation_id,
        manifestation_revision_id: row.canonical_revision_id,
        canonical_selection_id: row.canonical_selection_id,
        body_sha256: row.body_sha256,
        body_bytes: Number(row.body_bytes),
        lifecycle: row.revision_lifecycle,
        public_page_visible: Boolean(row.canonical_public_page_visible),
      }
    : null
  const derivative = row.accepted_derivative_id
    ? {
        manifestation_derivative_id: row.accepted_derivative_id,
        derivative_head_version: Number(row.derivative_head_version),
        status: row.derivative_status,
        source_body_sha256: row.derivative_source_body_sha256,
        body_sha256: row.derivative_body_sha256,
        body_bytes: Number(row.derivative_body_bytes),
        tags_sha256: row.tags_sha256,
        tags_bytes: Number(row.tags_bytes),
        fields_sha256: row.fields_sha256,
        fields_bytes: Number(row.fields_bytes),
        recipe_id: row.recipe_id,
        recipe_version: row.recipe_version,
        provider_id: row.provider_id,
        model_id: row.model_id,
        tagger_config_sha256: row.tagger_config_sha256,
        provenance_status: row.provenance_status,
      }
    : null
  return Object.freeze({
    schema_version: 1,
    gene_id: row.gene_id,
    canonical_symbol: row.canonical_symbol,
    gene_status: row.gene_status,
    head_version: Number(row.head_version),
    gene_revision: Number(row.gene_revision),
    last_event_sequence: Number(row.last_event_sequence),
    last_event_id: row.last_event_id || null,
    canonical,
    accepted_tags_derivative: derivative,
  })
}
