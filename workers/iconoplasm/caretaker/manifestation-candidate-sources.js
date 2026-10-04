// B-724: which saved prose version made each candidate image.
//
// The answer is already stored on every bound portrait asset
// (icono_portrait_assets.source_manifestation_revision_id, migration 0083), so this
// reads one gene's pool by the table's primary-key prefix, the same rows the gene
// page's candidate pool reads. It is returned only inside the caretaker dossier, which
// only a caretaker relationship or an administrator can open; the public stable gene
// object never carries it. A legacy_unbound asset has no entry: its source is
// unknown and nothing is invented for it. A failed read must never break the
// dossier, so callers get null and the caretaker simply sees no links.
const SHA256 = /^[a-f0-9]{64}$/
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

export async function readCandidateSources(primaryDb, symbol) {
  const geneSymbol = String(symbol || "")
    .trim()
    .toUpperCase()
  if (!primaryDb || !geneSymbol) return null
  try {
    const result = await primaryDb
      .prepare(
        `SELECT asset_sha256, source_manifestation_revision_id
           FROM icono_portrait_assets
          WHERE gene_symbol = ?
            AND generation_provenance_status = 'bound'
            AND COALESCE(status, '') <> 'rejected'
            AND source_manifestation_revision_id <> ''`,
      )
      .bind(geneSymbol)
      .all()
    return (Array.isArray(result?.results) ? result.results : [])
      .map((row) => ({
        asset_sha256: String(row.asset_sha256 || "").toLowerCase(),
        source_manifestation_revision_id: String(row.source_manifestation_revision_id || ""),
      }))
      .filter(
        (row) =>
          SHA256.test(row.asset_sha256) && OPAQUE_ID.test(row.source_manifestation_revision_id),
      )
  } catch (_error) {
    return null
  }
}
