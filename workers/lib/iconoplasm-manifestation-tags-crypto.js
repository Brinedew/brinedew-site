import {
  decryptEnvelope,
  encryptEnvelope,
  rewrapEnvelope,
  sha256Hex,
} from "./iconoplasm-envelope-crypto.js"

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder("utf-8", { fatal: true })

export const ICONOPLASM_MANIFESTATION_TAGS_MAX_BYTES = 32 * 1024

function opaqueId(raw, label) {
  const value = String(raw || "").trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function sha(raw, label) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

export function normalizeManifestationTags(raw) {
  if (typeof raw !== "string") throw new TypeError("Manifestation Tags must be text")
  const tags = raw.normalize("NFC").replace(/\r\n?/g, "\n")
  if (!tags.trim()) throw new TypeError("Manifestation Tags cannot be empty")
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(tags)) {
    throw new TypeError("Manifestation Tags contain unsupported control characters")
  }
  const bytes = ENCODER.encode(tags)
  if (bytes.byteLength > ICONOPLASM_MANIFESTATION_TAGS_MAX_BYTES) {
    throw new TypeError(
      `Manifestation Tags exceed ${ICONOPLASM_MANIFESTATION_TAGS_MAX_BYTES} UTF-8 bytes`,
    )
  }
  return { tags, bytes }
}

function tagsContentAad({ derivativeId, revisionId, sourceBodySha256, bodySha256, bodyBytes }) {
  return [
    "iconoplasm.manifestation.tags.v1",
    derivativeId,
    revisionId,
    sourceBodySha256,
    bodySha256,
    bodyBytes,
  ]
}

function tagsWrapAad(derivativeId, revisionId, sourceBodySha256, keyVersion) {
  return [
    "iconoplasm.manifestation.tags.dek.v1",
    derivativeId,
    revisionId,
    sourceBodySha256,
    keyVersion,
  ]
}

function identity(input) {
  return {
    derivativeId: opaqueId(input.derivativeId, "manifestation_derivative_id"),
    revisionId: opaqueId(input.revisionId, "manifestation_revision_id"),
    sourceBodySha256: sha(input.sourceBodySha256, "source_body_sha256"),
  }
}

export async function encryptManifestationTags(env, input = {}) {
  const ids = identity(input)
  const normalized = normalizeManifestationTags(input.tags)
  const bodySha256 = await sha256Hex(normalized.bytes)
  const encrypted = await encryptEnvelope(env, {
    plaintext: normalized.bytes,
    contentAad: tagsContentAad({
      ...ids,
      bodySha256,
      bodyBytes: normalized.bytes.byteLength,
    }),
    wrapAadForKeyVersion: (version) =>
      tagsWrapAad(ids.derivativeId, ids.revisionId, ids.sourceBodySha256, version),
  })
  return Object.freeze({
    tags: normalized.tags,
    body_sha256: bodySha256,
    body_bytes: normalized.bytes.byteLength,
    ...encrypted,
  })
}

export async function decryptManifestationTags(env, input = {}) {
  const ids = identity(input)
  const bytes = await decryptEnvelope(env, {
    ciphertext: input.ciphertext,
    ciphertextSha256: input.ciphertextSha256,
    ciphertextBytes: input.ciphertextBytes,
    plaintextSha256: input.bodySha256,
    plaintextBytes: input.bodyBytes,
    bodyIvBase64: input.bodyIvBase64,
    wrappedDekBase64: input.wrappedDekBase64,
    wrapIvBase64: input.wrapIvBase64,
    keyVersion: input.keyVersion,
    aadVersion: input.aadVersion ?? 1,
    contentAad: tagsContentAad({
      ...ids,
      bodySha256: input.bodySha256,
      bodyBytes: input.bodyBytes,
    }),
    wrapAadForKeyVersion: (version) =>
      tagsWrapAad(ids.derivativeId, ids.revisionId, ids.sourceBodySha256, version),
  })
  return DECODER.decode(bytes)
}

export async function rewrapManifestationTagsDek(env, input = {}) {
  const ids = identity(input)
  return rewrapEnvelope(env, {
    wrappedDekBase64: input.wrappedDekBase64,
    wrapIvBase64: input.wrapIvBase64,
    fromKeyVersion: input.fromKeyVersion,
    toKeyVersion: input.toKeyVersion,
    wrapAadForKeyVersion: (version) =>
      tagsWrapAad(ids.derivativeId, ids.revisionId, ids.sourceBodySha256, version),
  })
}
