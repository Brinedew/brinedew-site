import { readManifestationProse } from "../../lib/iconoplasm-manifestation-body-reader.js"

export async function hydrateManifestationRevisionBodies(env, rows, onIntegrityFailure) {
  if (!env) return rows
  return Promise.all(
    rows.map(async (row) => {
      if (new Set(["purged", "quarantined"]).has(row.lifecycle_status) || !row.object_key) {
        return { ...row, body_state: "unavailable", prose: null }
      }
      try {
        const prose = await readManifestationProse(env, row, {
          revisionId: row.manifestation_revision_id,
          geneId: row.gene_id,
          bodySha256: row.body_sha256,
          bodyBytes: Number(row.body_bytes),
        })
        if (prose === null) throw new Error("manifestation_body_missing")
        return { ...row, body_state: "available", prose }
      } catch (error) {
        if (typeof onIntegrityFailure === "function") {
          await onIntegrityFailure({
            entity_kind: "revision",
            entity_id: row.manifestation_revision_id,
            gene_id: row.gene_id,
            expected_body_sha256: row.body_sha256,
            cause: error,
          })
        }
        return { ...row, body_state: "quarantine_required", prose: null }
      }
    }),
  )
}
