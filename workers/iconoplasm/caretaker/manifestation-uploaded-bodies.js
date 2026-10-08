import { deleteManifestationBodyObject } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { first } from "./manifestation-authority-repository.js"

// B-859: a save uploads its bodies to the private zone first, then commits the
// rows that point at them, with no reservation row in between (that row and its
// adoption cost 14 to 28 D1 writes a save). When the commit fails, or turns out
// to be a replay of an earlier command, the new objects may be unreferenced:
// delete them here instead of leaving them for a sweeper.
//
// Only an object no storage row references is deleted. A commit can succeed even
// when the batch call reports an error (runCommand then returns the receipt as a
// replay), and that storage row points at these very keys, so "the call failed"
// is never enough. Anything uncertain (a failed read) keeps the object: an orphan
// costs a few KB of storage; a deleted committed body loses a text.

const STORAGE_TABLES = Object.freeze({
  revision: "icono_manifestation_revision_storage_secrets",
  derivative: "icono_manifestation_derivative_storage_secrets",
})

async function deleteIfUnreferenced(db, env, { kind, objectKey }) {
  const table = STORAGE_TABLES[kind]
  if (!table || !objectKey) return "kept"
  try {
    const referenced = await first(
      db,
      `SELECT 1 AS hit FROM ${table} WHERE object_key = ?`,
      objectKey,
    )
    if (referenced) return "referenced"
    await deleteManifestationBodyObject(env, objectKey)
    return "deleted"
  } catch (error) {
    console.warn("[manifestation-upload] unreferenced body kept", {
      kind,
      code: String(error?.code || error?.name || "cleanup_failed").slice(0, 80),
    })
    return "kept"
  }
}

export async function discardUnreferencedBodies(db, env, bodies) {
  return Promise.all(bodies.map((body) => deleteIfUnreferenced(db, env, body)))
}

// Upload the bodies, run the commit, and clean up whatever the commit did not
// adopt. `bodies` is [{ kind, objectKey, upload: () => Promise<upload> }].
export async function commitUploadedBodies(db, env, bodies, commit) {
  // Wait for every upload to settle: cleaning up while a sibling is still in
  // flight would miss the object it is about to write.
  const settled = await Promise.allSettled(bodies.map((body) => body.upload()))
  const failed = settled.find((outcome) => outcome.status === "rejected")
  if (failed) {
    await discardUnreferencedBodies(db, env, bodies)
    throw failed.reason
  }
  const uploads = settled.map((outcome) => outcome.value)
  let result
  try {
    result = await commit(uploads)
  } catch (error) {
    await discardUnreferencedBodies(db, env, bodies)
    throw error
  }
  if (result?.replayed) await discardUnreferencedBodies(db, env, bodies)
  return result
}
