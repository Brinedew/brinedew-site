import { decryptManifestationProse } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { readEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"

export async function hydrateManifestationRevisionBodies(env, rows, onIntegrityFailure) {
  if (!env) return rows
  return Promise.all(
    rows.map(async (row) => {
      if (new Set(["purged", "quarantined"]).has(row.lifecycle_status) || !row.object_key) {
        return { ...row, body_state: "unavailable", prose: null }
      }
      try {
        const encrypted = await readEncryptedManifestationBody(env, row.object_key)
        if (!encrypted) throw new Error("manifestation_body_missing")
        const prose = await decryptManifestationProse(env, {
          revisionId: row.manifestation_revision_id,
          geneId: row.gene_id,
          ciphertext: encrypted.bytes,
          ciphertextSha256: row.ciphertext_sha256,
          ciphertextBytes: Number(row.ciphertext_bytes),
          bodySha256: row.body_sha256,
          bodyBytes: Number(row.body_bytes),
          bodyIvBase64: row.body_iv_base64,
          wrappedDekBase64: row.wrapped_dek_base64,
          wrapIvBase64: row.wrap_iv_base64,
          keyVersion: Number(row.key_version),
          aadVersion: Number(row.aad_version),
        })
        return { ...row, body_state: "available", prose }
      } catch (error) {
        if (typeof onIntegrityFailure === "function") {
          await onIntegrityFailure({
            entity_kind: "revision",
            entity_id: row.manifestation_revision_id,
            gene_id: row.gene_id,
            expected_body_sha256: row.body_sha256,
            expected_ciphertext_sha256: row.ciphertext_sha256 || null,
            cause: error,
          })
        }
        return { ...row, body_state: "quarantine_required", prose: null }
      }
    }),
  )
}
