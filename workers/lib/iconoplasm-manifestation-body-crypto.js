import {
  decryptEnvelope,
  encryptEnvelope,
  rewrapEnvelope,
  sha256Hex,
} from "./iconoplasm-envelope-crypto.js"

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder("utf-8", { fatal: true })

export const ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS = 4000
export const ICONOPLASM_MANIFESTATION_PROSE_MAX_BYTES = 16 * 1024
export const ICONOPLASM_MANIFESTATION_BODY_KEY_VERSION_DEFAULT = 1

function opaqueId(raw, label) {
  const value = String(raw || "").trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

export function normalizeManifestationProse(raw) {
  if (typeof raw !== "string") throw new TypeError("Manifestation prose must be text")
  const prose = raw.normalize("NFC").replace(/\r\n?/g, "\n")
  if (!prose.trim()) throw new TypeError("Manifestation prose cannot be empty")
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prose)) {
    throw new TypeError("Manifestation prose contains unsupported control characters")
  }
  const codePoints = Array.from(prose).length
  if (codePoints > ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS) {
    throw new TypeError(
      `Manifestation prose exceeds ${ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS} characters`,
    )
  }
  const bytes = ENCODER.encode(prose)
  if (bytes.byteLength > ICONOPLASM_MANIFESTATION_PROSE_MAX_BYTES) {
    throw new TypeError(
      `Manifestation prose exceeds ${ICONOPLASM_MANIFESTATION_PROSE_MAX_BYTES} UTF-8 bytes`,
    )
  }
  return { prose, bytes, codePoints }
}

function proseContentAad({ revisionId, geneId, bodySha256, bodyBytes }) {
  return ["iconoplasm.manifestation.prose.v1", revisionId, geneId, bodySha256, bodyBytes]
}

function proseWrapAad(revisionId, geneId, keyVersion) {
  return ["iconoplasm.manifestation.prose.dek.v1", revisionId, geneId, keyVersion]
}

export async function encryptManifestationProse(env, { revisionId, geneId, prose }) {
  const normalizedRevisionId = opaqueId(revisionId, "manifestation_revision_id")
  const normalizedGeneId = opaqueId(geneId, "gene_id")
  const normalized = normalizeManifestationProse(prose)
  const bodySha256 = await sha256Hex(normalized.bytes)
  const encrypted = await encryptEnvelope(env, {
    plaintext: normalized.bytes,
    contentAad: proseContentAad({
      revisionId: normalizedRevisionId,
      geneId: normalizedGeneId,
      bodySha256,
      bodyBytes: normalized.bytes.byteLength,
    }),
    wrapAadForKeyVersion: (keyVersion) =>
      proseWrapAad(normalizedRevisionId, normalizedGeneId, keyVersion),
  })
  return Object.freeze({
    prose: normalized.prose,
    body_sha256: bodySha256,
    body_bytes: normalized.bytes.byteLength,
    ...encrypted,
  })
}

export async function decryptManifestationProse(
  env,
  {
    revisionId,
    geneId,
    ciphertext,
    ciphertextSha256,
    ciphertextBytes,
    bodySha256,
    bodyBytes,
    bodyIvBase64,
    wrappedDekBase64,
    wrapIvBase64,
    keyVersion,
    aadVersion = 1,
  },
) {
  const normalizedRevisionId = opaqueId(revisionId, "manifestation_revision_id")
  const normalizedGeneId = opaqueId(geneId, "gene_id")
  const bytes = await decryptEnvelope(env, {
    ciphertext,
    ciphertextSha256,
    ciphertextBytes,
    plaintextSha256: bodySha256,
    plaintextBytes: bodyBytes,
    bodyIvBase64,
    wrappedDekBase64,
    wrapIvBase64,
    keyVersion,
    aadVersion,
    contentAad: proseContentAad({
      revisionId: normalizedRevisionId,
      geneId: normalizedGeneId,
      bodySha256,
      bodyBytes,
    }),
    wrapAadForKeyVersion: (version) =>
      proseWrapAad(normalizedRevisionId, normalizedGeneId, version),
  })
  return DECODER.decode(bytes)
}

export async function rewrapManifestationDek(
  env,
  { revisionId, geneId, wrappedDekBase64, wrapIvBase64, fromKeyVersion, toKeyVersion },
) {
  const normalizedRevisionId = opaqueId(revisionId, "manifestation_revision_id")
  const normalizedGeneId = opaqueId(geneId, "gene_id")
  return rewrapEnvelope(env, {
    wrappedDekBase64,
    wrapIvBase64,
    fromKeyVersion,
    toKeyVersion,
    wrapAadForKeyVersion: (version) =>
      proseWrapAad(normalizedRevisionId, normalizedGeneId, version),
  })
}

export { sha256Hex }
