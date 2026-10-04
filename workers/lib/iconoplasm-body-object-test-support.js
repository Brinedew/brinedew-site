// Test-only. Builds a body object as production stores it since B-859: the
// object is the plain UTF-8 text.
const ENCODER = new TextEncoder()

function sha256Hex(bytes) {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) => Buffer.from(digest).toString("hex"))
}

function normalized(text) {
  return String(text).normalize("NFC").replace(/\r\n?/g, "\n")
}

// A plain body and the storage row it gets: the object is the text, and the row
// records its hash and the envelope-shaped size the schema requires.
export async function plainBodyObject(text) {
  const normalizedText = normalized(text)
  const bytes = ENCODER.encode(normalizedText)
  const bodySha256 = await sha256Hex(bytes)
  return {
    text: normalizedText,
    bytes,
    body_sha256: bodySha256,
    body_bytes: bytes.byteLength,
    ciphertext_sha256: bodySha256,
    ciphertext_bytes: bytes.byteLength + 16,
    body_iv_base64: "",
    wrapped_dek_base64: "",
    wrap_iv_base64: "",
    key_version: 1,
    aad_version: 1,
  }
}
