// B-724: which saved prose version made each candidate image.
//
// Every portrait made from an exact text leaves one receipt in
// icono_portrait_generation_provenance: the Drain's fulfilments and the
// in-site generators alike. That table is the record. The asset row's own
// provenance columns stay legacy_unbound for every Drain portrait, because
// the factory's register route carries no source (2026-10-14 copy: 848
// receipts, 0 bound assets), so reading the asset row showed no links at all.
// This reads one gene's receipts by the (gene_symbol, asset_sha256) index
// (migration 0129). It is returned only inside the caretaker dossier, which
// only a caretaker relationship or an administrator can open; the public
// stable gene object never carries it. A portrait with no receipt has no entry:
// its source is unknown and nothing is invented for it. A failed read must
// never break the dossier, so callers get null and the caretaker simply sees
// no links.
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
           FROM icono_portrait_generation_provenance
          WHERE gene_symbol = ?`,
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
