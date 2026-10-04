// The one place a body object becomes text (B-859).
//
// A body is a plain UTF-8 object whose SHA-256 and byte length are the ones
// recorded in its revision or derivative row. Bytes that hash to anything else
// are an integrity failure and are refused.
import { sha256Hex } from "./iconoplasm-sha256.js"
import { readManifestationBodyObject } from "./iconoplasm-manifestation-body-storage.js"

const DECODER = new TextDecoder("utf-8", { fatal: true })

async function hashesTo(bytes, sha256, byteLength) {
  return (
    bytes.byteLength === Number(byteLength) &&
    (await sha256Hex(bytes)).toLowerCase() === String(sha256 || "").toLowerCase()
  )
}

// The stored bytes, once they are proven to be the promised text. Throws when
// the object is damaged.
export async function openManifestationBody(bytes, ids) {
  if (await hashesTo(bytes, ids.bodySha256, ids.bodyBytes)) return bytes
  throw new Error("Manifestation body object does not match its recorded hash")
}

async function readText(env, storage, ids) {
  const stored = await readManifestationBodyObject(env, storage.object_key)
  if (!stored) return null
  return DECODER.decode(await openManifestationBody(stored.bytes, ids))
}

// `storage` is the storage row (object_key, ...). Returns the prose, or null
// when the object does not exist.
export function readManifestationProse(env, storage, ids) {
  return readText(env, storage, ids)
}

// Returns the combined Tags output (`tags`, a line feed, the fields JSON), or
// null when the object does not exist.
export function readManifestationTags(env, storage, ids) {
  return readText(env, storage, ids)
}
