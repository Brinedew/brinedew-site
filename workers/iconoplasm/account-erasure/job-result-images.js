// B-993: the result images of unpublished generation and edit jobs.
//
// A job that produced an image has written three renditions to the portrait storage under
// content-addressed keys (`portraits/v1/<sha[:2]>/<sha>/{full,medium,thumb}.webp`). The pull zone in
// front of that storage is public, so the image answers to anyone who has its URL until the object
// is deleted. Erasing the job row alone leaves the objects behind, unreferenced and still public.
//
// The step deletes an unpublished job's objects before it deletes the job's row, so a failed
// delete leaves the row and the next request repeats it (a DELETE of an absent object is fine).
//
// Two checks keep a published portrait safe:
//  1. A job's key is deleted only if it is exactly the canonical key of the job's own
//     `result_asset_sha256`; a row naming any other path (a gene object, someone else's image)
//     never reaches the storage.
//  2. Keys are content-addressed, so another row can name the same objects. If the gene already has
//     a published asset row for this hash, the objects are kept (the primary key lookup, one index
//     read per job); the job row is deleted either way.
//
// An edge copy of an image someone already requested stays in Bunny's cache until the pull zone's
// 30 day cache time ends, and a purge right after a delete can refill the edge from a storage
// replica that has not yet caught up (the replication lag measured on 2026-10-02), so none is sent.

const KEY_PATTERN = /^portraits\/v1\/([0-9a-f]{2})\/([0-9a-f]{64})\/(full|medium|thumb)\.webp$/

/** The job's own image keys: its three result keys that are the canonical keys of its hash. */
export function deletableJobImageKeys(job) {
  const sha = String(job?.sha || "")
  const keys = new Set()
  for (const [rendition, key] of [
    ["full", job?.full_key],
    ["medium", job?.medium_key],
    ["thumb", job?.thumb_key],
  ]) {
    const match = KEY_PATTERN.exec(String(key || ""))
    if (match && match[2] === sha && match[1] === sha.slice(0, 2) && match[3] === rendition) {
      keys.add(match[0])
    }
  }
  return [...keys]
}

// A slice reads the person's unpublished jobs that wrote an image, with whether the gene already
// publishes that hash (the primary key of icono_portrait_assets is the gene and the hash).
export function jobImagesSliceSql(table, geneColumn) {
  return `SELECT j.rowid AS k, j.result_asset_sha256 AS sha,
                 j.result_r2_key_full AS full_key,
                 j.result_r2_key_medium AS medium_key,
                 j.result_r2_key_thumb AS thumb_key,
                 EXISTS (
                   SELECT 1 FROM icono_portrait_assets published
                    WHERE published.gene_symbol = j.${geneColumn}
                      AND published.asset_sha256 = j.result_asset_sha256
                 ) AS published
            FROM ${table} j
           WHERE j.user_id = ? AND j.published_at IS NULL
             AND (j.result_r2_key_full <> '' OR j.result_r2_key_medium <> '' OR j.result_r2_key_thumb <> '')
           ORDER BY j.rowid LIMIT ?`
}
