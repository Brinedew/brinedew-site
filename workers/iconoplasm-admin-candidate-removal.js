// B-901: deleting a candidate rewrites the gene's stable object before the
// answer, so a reloaded page never offers the deleted candidate again. A delete
// of a candidate that an earlier delete already removed (the admin's page was
// loaded before that delete) is an idempotent success that also republishes
// the gene, which heals a stale object. A republish failure never turns a
// committed delete into an error: the remove_candidate event lets the Actions
// publisher repair the object on its next run.
const REQUIRED_SERVICES = Object.freeze(["remove", "wasRemoved", "republish"])

export function createIconoplasmCandidateRemoval(services) {
  for (const name of REQUIRED_SERVICES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm candidate removal service is missing: ${name}`)
    }
  }
  const { remove, wasRemoved, republish } = services

  async function republishQuietly(symbol) {
    try {
      await republish(symbol)
      return true
    } catch (error) {
      console.error(
        "Candidate removal republish failed:",
        symbol,
        String(error?.message || error).slice(0, 300),
      )
      return false
    }
  }

  return async function removeCandidate({
    symbol,
    assetSha256,
    candidateImageId = null,
    actorId = "",
    reason = "",
  }) {
    if (!assetSha256) return { status: 400, body: { error: "Missing asset_sha256" } }
    const removal = await remove({ symbol, assetSha256, candidateImageId, actorId, reason })
    if (removal?.code === "NOT_FOUND" && (await wasRemoved(symbol, assetSha256))) {
      return {
        status: 200,
        body: {
          ok: true,
          action: "remove_candidate",
          symbol,
          asset_sha256: assetSha256,
          already_removed: true,
          republished: await republishQuietly(symbol),
        },
      }
    }
    if (!removal?.ok) return { status: 404, body: { error: "Asset not found" } }
    return {
      status: 200,
      body: {
        ok: true,
        action: "remove_candidate",
        symbol,
        asset_sha256: assetSha256,
        candidate_image_id: candidateImageId,
        unpublished_current: !!removal.unpublished_current,
        deleted_r2_keys: Number(removal.deleted_r2_keys || 0),
        queued_local_removal: removal.queued_local_removal || null,
        auto_promote: removal.auto_promote || null,
        republished: await republishQuietly(symbol),
      },
    }
  }
}
