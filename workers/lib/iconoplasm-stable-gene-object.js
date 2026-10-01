// B-898: THE ONLY composer of the stable gene object, genes/v3/<SYMBOL>.json.
// It is the projected gene record (what the card catalog materializer builds
// from D1 and the authoring store) with the complete candidate pool inline, so
// a reader fetches one URL and never walks an index. Written by
// publishIconoplasmGeneStableObject in the stateful runtime; the publication
// coordinator wrote the same shape until the deletion stage retired it.
const HASH = /^[a-f0-9]{64}$/

export const STABLE_GENE_OBJECT_VERSION = 3

export function composeStableGeneObject(
  projected,
  { selectedAssetSha256 = undefined, now = () => new Date().toISOString() } = {},
) {
  const pool = Array.isArray(projected?.portrait_candidates) ? projected.portrait_candidates : []
  const selected =
    selectedAssetSha256 === undefined
      ? undefined
      : String(selectedAssetSha256 || "")
          .trim()
          .toLowerCase()
  const candidates =
    selected === undefined
      ? pool
      : pool.map((candidate) => ({
          ...candidate,
          is_current:
            HASH.test(selected) && String(candidate?.asset_sha256 || "").toLowerCase() === selected,
        }))
  return {
    ...projected,
    portrait:
      projected?.portrait && typeof projected.portrait === "object" ? projected.portrait : null,
    portrait_candidates: candidates,
    candidate_count: candidates.length,
    stable_object_version: STABLE_GENE_OBJECT_VERSION,
    published_at: now(),
  }
}
