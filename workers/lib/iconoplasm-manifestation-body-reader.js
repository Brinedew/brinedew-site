// The one place a body object becomes text (B-859).
//
// A body is a plain UTF-8 object whose SHA-256 and byte length are the ones
// recorded in its revision or derivative row. The 38,487 AES-GCM envelope
// objects that predate plain bodies stay readable until the one-shot conversion
// has rewritten them. The bytes identify themselves, so there is no flag to get
// wrong and an interrupted conversion is harmless:
//   1. bytes that hash to the row's plaintext hash are the plain text;
//   2. otherwise bytes that hash to the row's ciphertext hash are an envelope,
//      which is opened with the key secret;
//   3. anything else is an integrity failure and is refused.
// Once nothing reads as an envelope, step 2 and the legacy envelope file go.
import { sha256Hex } from "./iconoplasm-sha256.js"
import { decryptLegacyProse, decryptLegacyTags } from "./iconoplasm-legacy-body-envelope.js"
import { readManifestationBodyObject } from "./iconoplasm-manifestation-body-storage.js"

const DECODER = new TextDecoder("utf-8", { fatal: true })

async function hashesTo(bytes, sha256, byteLength) {
  return (
    bytes.byteLength === Number(byteLength) &&
    (await sha256Hex(bytes)).toLowerCase() === String(sha256 || "").toLowerCase()
  )
}

// "plain", "legacy" (an envelope, by its recorded hash and length) or "damaged".
// Needs no key: it only hashes.
export async function classifyManifestationBody(bytes, storage, ids) {
  if (await hashesTo(bytes, ids.bodySha256, ids.bodyBytes)) return "plain"
  if (await hashesTo(bytes, storage.ciphertext_sha256, storage.ciphertext_bytes)) return "legacy"
  return "damaged"
}

// The plain bytes of a stored object, opening an envelope when that is what it
// is. `kind` is "prose" or "tags". Throws when the object is damaged, when its
// envelope cannot be opened, or when the opened text is not the promised text.
export async function openManifestationBody(env, kind, bytes, storage, ids) {
  if (await hashesTo(bytes, ids.bodySha256, ids.bodyBytes)) return { bytes, legacy: false }
  const decrypt = kind === "tags" ? decryptLegacyTags : decryptLegacyProse
  return { bytes: await decrypt(env, bytes, storage, ids), legacy: true }
}

async function readText(env, kind, storage, ids) {
  const stored = await readManifestationBodyObject(env, storage.object_key)
  if (!stored) return null
  const opened = await openManifestationBody(env, kind, stored.bytes, storage, ids)
  return DECODER.decode(opened.bytes)
}

// `storage` is the storage row (object_key, ciphertext_sha256, ciphertext_bytes,
// body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version, aad_version).
// Returns the prose, or null when the object does not exist.
export function readManifestationProse(env, storage, ids) {
  return readText(env, "prose", storage, ids)
}

// Returns the combined Tags output (`tags`, a line feed, the fields JSON), or
// null when the object does not exist.
export function readManifestationTags(env, storage, ids) {
  return readText(env, "tags", storage, ids)
}
