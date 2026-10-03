const ENCODER = new TextEncoder()

export const ICONOPLASM_MANIFESTATION_TAGS_MAX_BYTES = 32 * 1024

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
