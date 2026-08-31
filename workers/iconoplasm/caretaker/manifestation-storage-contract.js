import {
  authorityError,
  normalizeSha256,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"

export function storageFields(raw) {
  const storage = raw && typeof raw === "object" ? raw : {}
  const bodySha256 = normalizeSha256(storage.body_sha256, "body_sha256")
  const ciphertextSha256 = normalizeSha256(storage.ciphertext_sha256, "ciphertext_sha256")
  const bodyBytes = Number(storage.body_bytes)
  const ciphertextBytes = Number(storage.ciphertext_bytes)
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 1 || bodyBytes > 16 * 1024) {
    throw authorityError("INVALID_BODY_SIZE", "Manifestation body size is invalid")
  }
  if (
    !Number.isSafeInteger(ciphertextBytes) ||
    ciphertextBytes < 17 ||
    ciphertextBytes > 64 * 1024
  ) {
    throw authorityError("INVALID_CIPHERTEXT_SIZE", "Manifestation ciphertext size is invalid")
  }
  const keyVersion = Number(storage.key_version)
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw authorityError("INVALID_KEY_VERSION", "Manifestation key version is invalid")
  }
  const objectKey = String(storage.object_key || "").trim()
  if (!/^private\/manifestations\/v1\/[a-f0-9]{2}\/[A-Za-z0-9_-]{8,128}\.bin$/.test(objectKey)) {
    throw authorityError("INVALID_OBJECT_KEY", "Manifestation object key is invalid")
  }
  for (const field of ["body_iv_base64", "wrapped_dek_base64", "wrap_iv_base64"]) {
    if (!/^[A-Za-z0-9_-]{12,256}$/.test(String(storage[field] || ""))) {
      throw authorityError("INVALID_ENCRYPTION_METADATA", `${field} is invalid`)
    }
  }
  return {
    body_sha256: bodySha256,
    body_bytes: bodyBytes,
    object_key: objectKey,
    ciphertext_sha256: ciphertextSha256,
    ciphertext_bytes: ciphertextBytes,
    body_iv_base64: String(storage.body_iv_base64),
    wrapped_dek_base64: String(storage.wrapped_dek_base64),
    wrap_iv_base64: String(storage.wrap_iv_base64),
    key_version: keyVersion,
    aad_version: 1,
    object_etag: String(storage.object_etag || "").trim() || null,
    verified_at: normalizeTimestamp(storage.verified_at),
  }
}

// ARCHITECTURE FENCE [IPD-012]
