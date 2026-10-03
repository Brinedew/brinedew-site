import { sha256Hex } from "./iconoplasm-sha256.js"

const ENCODER = new TextEncoder()

export const ICONOPLASM_MANIFESTATION_PROSE_MAX_CODE_POINTS = 4000
export const ICONOPLASM_MANIFESTATION_PROSE_MAX_BYTES = 16 * 1024

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

// The object a save stores is these exact bytes; its row records their hash.
export async function prepareManifestationProse(raw) {
  const normalized = normalizeManifestationProse(raw)
  return Object.freeze({
    prose: normalized.prose,
    bytes: normalized.bytes,
    body_sha256: await sha256Hex(normalized.bytes),
    body_bytes: normalized.bytes.byteLength,
  })
}
