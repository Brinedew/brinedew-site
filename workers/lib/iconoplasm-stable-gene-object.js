// ARCHITECTURE FENCE [IPD-011]: THE ONLY composer of the stable gene object,
// genes/v3/<SYMBOL>.json (B-898). It is the projected gene record (what the
// card materializer builds from D1 and the authoring store) with the complete
// candidate pool inline, so a reader fetches one URL and never walks an index.
// Written by publishIconoplasmGeneStableObject in the stateful runtime, the one
// per-gene publisher. This object and catalog/v3/index.json (built by
// scripts/publish-iconoplasm-catalog.mjs in GitHub Actions) are the two
// published objects every reader resolves.
const HASH = /^[a-f0-9]{64}$/

export const STABLE_GENE_OBJECT_VERSION = 3

// `voteVersion` is the gene's icono_gene_vote_version read before the
// record was materialized: the object reflects at least every vote up to it,
// and the publisher compares it with the version after its write to catch a
// vote that landed in between. A publisher without D1 passes null.
export function composeStableGeneObject(
  projected,
  {
    selectedAssetSha256 = undefined,
    voteVersion = null,
    now = () => new Date().toISOString(),
  } = {},
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
    vote_version: Number.isSafeInteger(voteVersion) && voteVersion >= 0 ? voteVersion : null,
    published_at: now(),
  }
}

// The published record carries the complete candidate pool. A silent slice hid
// candidates whenever a pool grew past a fixed number (B-792); the stable
// object's size limit is the boundary instead, and exceeding it fails the
// publication loudly rather than truncating what readers see.
export async function enrichPublishedGeneCandidates(records, loadCandidates) {
  const enriched = []
  for (const record of Array.isArray(records) ? records : []) {
    const candidates = await loadCandidates(record)
    enriched.push({
      ...record,
      portrait_candidates: Array.isArray(candidates) ? candidates : [],
    })
  }
  return enriched
}

export function projectCardBlot(record, blot) {
  const projected = { ...record }
  if (blot) projected.blot = blot
  else delete projected.blot
  return projected
}
