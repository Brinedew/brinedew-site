const ENCODER = new TextEncoder()

// Lowercase hex SHA-256 of bytes, or of the UTF-8 encoding of a string.
export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : ENCODER.encode(String(value))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
