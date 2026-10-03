// Opens the body objects that are still AES-256-GCM envelopes (38,487 when the
// conversion was prepared): an object whose per-object key is wrapped by the
// key-encryption key ICONOPLASM_AUTHORING_BODY_KEK_V<version> and recorded in the
// row. Plain bodies never come here. This file, the key secret and the
// conversion that rewrites the envelopes all go away together once every object
// reads as plain text (B-958).
import { sha256Hex } from "./iconoplasm-sha256.js"

const ENCODER = new TextEncoder()

function base64ToBytes(raw, label) {
  const compact = String(raw || "")
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new TypeError(`${label} is not valid base64`)
  }
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=")
  let binary
  try {
    binary = atob(padded)
  } catch {
    throw new TypeError(`${label} is not valid base64`)
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function encodeAad(parts) {
  return ENCODER.encode(parts.map((part) => String(part)).join("\n"))
}

function equalHex(left, right) {
  const a = String(left || "").toLowerCase()
  const b = String(right || "").toLowerCase()
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return mismatch === 0
}

async function importKek(env, keyVersion) {
  const variableName = `ICONOPLASM_AUTHORING_BODY_KEK_V${keyVersion}`
  const bytes = base64ToBytes(env?.[variableName], variableName)
  if (bytes.byteLength !== 32) throw new Error(`${variableName} must decode to exactly 32 bytes`)
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["decrypt"])
}

// `envelope` is the storage row: ciphertext_sha256, ciphertext_bytes,
// body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version, aad_version.
// `expected` is the plaintext the row promises: sha256 and byte length.
async function decryptEnvelope(env, ciphertext, envelope, expected, { contentAad, wrapAad }) {
  if (Number(envelope.aad_version) !== 1) {
    throw new Error("Unsupported Iconoplasm envelope AAD version")
  }
  if (
    ciphertext.byteLength !== Number(envelope.ciphertext_bytes) ||
    !equalHex(await sha256Hex(ciphertext), envelope.ciphertext_sha256)
  ) {
    throw new Error("Iconoplasm ciphertext integrity verification failed")
  }
  const keyVersion = Number(envelope.key_version)
  const kek = await importKek(env, keyVersion)
  let dekBytes
  try {
    dekBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(envelope.wrap_iv_base64, "wrap_iv_base64"),
          additionalData: encodeAad(wrapAad(keyVersion)),
        },
        kek,
        base64ToBytes(envelope.wrapped_dek_base64, "wrapped_dek_base64"),
      ),
    )
    const dek = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, [
      "decrypt",
    ])
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(envelope.body_iv_base64, "body_iv_base64"),
          additionalData: encodeAad(contentAad),
        },
        dek,
        ciphertext,
      ),
    )
    if (
      plain.byteLength !== Number(expected.bodyBytes) ||
      !equalHex(await sha256Hex(plain), expected.bodySha256)
    ) {
      throw new Error("Iconoplasm plaintext integrity verification failed")
    }
    return plain
  } finally {
    dekBytes?.fill(0)
  }
}

// A prose envelope binds the revision, the gene, the plaintext hash and length.
export function decryptLegacyProse(env, ciphertext, envelope, ids) {
  return decryptEnvelope(env, ciphertext, envelope, ids, {
    contentAad: [
      "iconoplasm.manifestation.prose.v1",
      ids.revisionId,
      ids.geneId,
      ids.bodySha256,
      ids.bodyBytes,
    ],
    wrapAad: (keyVersion) => [
      "iconoplasm.manifestation.prose.dek.v1",
      ids.revisionId,
      ids.geneId,
      keyVersion,
    ],
  })
}

// A Tags envelope binds the derivative, its revision, that revision's body
// hash, the plaintext hash and length.
export function decryptLegacyTags(env, ciphertext, envelope, ids) {
  return decryptEnvelope(env, ciphertext, envelope, ids, {
    contentAad: [
      "iconoplasm.manifestation.tags.v1",
      ids.derivativeId,
      ids.revisionId,
      ids.sourceBodySha256,
      ids.bodySha256,
      ids.bodyBytes,
    ],
    wrapAad: (keyVersion) => [
      "iconoplasm.manifestation.tags.dek.v1",
      ids.derivativeId,
      ids.revisionId,
      ids.sourceBodySha256,
      keyVersion,
    ],
  })
}
