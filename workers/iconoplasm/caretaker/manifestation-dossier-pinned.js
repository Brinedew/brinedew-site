import { all } from "./manifestation-authority-repository.js"
import { hydrateManifestationRevisionBodies } from "./manifestation-body-hydration.js"

export async function readPinnedManifestationRevisions(
  db,
  env,
  { geneId, revisionIds, onIntegrityFailure } = {},
) {
  const ids = [...new Set((revisionIds || []).filter(Boolean))].slice(0, 3)
  if (!ids.length) return []
  const slots = ids.map(() => "?").join(", ")
  const rows = await all(
    db,
    `SELECT revision.manifestation_revision_id, revision.manifestation_id,
            manifestation.gene_id, revision.revision_number,
            revision.parent_revision_id, revision.source_revision_id,
            revision.body_sha256, revision.body_bytes,
            revision.sample_label, revision.sample_number, revision.sample_text_sha256,
            revision.created_at, lifecycle.status AS lifecycle_status,
            lifecycle.lifecycle_version, storage.object_key,
            storage.ciphertext_sha256, storage.ciphertext_bytes,
            storage.body_iv_base64, storage.wrapped_dek_base64,
            storage.wrap_iv_base64, storage.key_version, storage.aad_version
       FROM icono_manifestation_revisions revision
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
      WHERE manifestation.gene_id = ?
        AND revision.manifestation_revision_id IN (${slots})`,
    geneId,
    ...ids,
  )
  const hydrated = await hydrateManifestationRevisionBodies(env, rows, onIntegrityFailure)
  const byId = new Map(hydrated.map((row) => [row.manifestation_revision_id, row]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    return [
      {
        manifestation_revision_id: row.manifestation_revision_id,
        manifestation_id: row.manifestation_id,
        revision_number: Number(row.revision_number),
        parent_revision_id: row.parent_revision_id || null,
        source_revision_id: row.source_revision_id || null,
        body_sha256: row.body_sha256,
        body_bytes: Number(row.body_bytes),
        body: row.prose ?? "",
        body_available:
          row.body_state === "available" &&
          !new Set(["purged", "quarantined"]).has(row.lifecycle_status),
        lifecycle: row.lifecycle_status,
        lifecycle_version: Number(row.lifecycle_version),
        sample_label: row.sample_label || null,
        sample_number: row.sample_number == null ? null : Number(row.sample_number),
        sample_text_sha256: row.sample_text_sha256 || null,
        created_at: row.created_at,
      },
    ]
  })
}
