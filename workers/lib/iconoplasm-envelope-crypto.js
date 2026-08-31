const ENCODER = new TextEncoder()

function requireCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("Web Crypto is required for Iconoplasm envelope encryption")
  }
  return globalThis.crypto
}

function keyVersionFromEnv(env) {
  const value = Number.parseInt(String(env?.ICONOPLASM_AUTHORING_BODY_KEY_VERSION || "1"), 10)
  if (!Number.isSafeInteger(value) || value < 1 || value > 9999) {
    throw new Error("ICONOPLASM_AUTHORING_BODY_KEY_VERSION is invalid")
  }
  return value
}

function bytesToBase64Url(bytes) {
  let binary = ""
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

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
  if (!Array.isArray(parts) || parts.length < 2) throw new TypeError("Envelope AAD is invalid")
  return ENCODER.encode(parts.map((part) => String(part)).join("\n"))
}

function hex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}

async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : ENCODER.encode(String(value))
  return hex(new Uint8Array(await requireCrypto().subtle.digest("SHA-256", bytes)))
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

function randomBytes(length) {
  return requireCrypto().getRandomValues(new Uint8Array(length))
}

async function importKek(env, keyVersion) {
  const variableName = `ICONOPLASM_AUTHORING_BODY_KEK_V${keyVersion}`
  const bytes = base64ToBytes(env?.[variableName], variableName)
  if (bytes.byteLength !== 32) throw new Error(`${variableName} must decode to exactly 32 bytes`)
  return requireCrypto().subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ])
}

async function encryptEnvelope(env, { plaintext, contentAad, wrapAadForKeyVersion }) {
  const plainBytes = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext)
  if (!plainBytes.byteLength) throw new TypeError("Envelope plaintext cannot be empty")
  const keyVersion = keyVersionFromEnv(env)
  const bodyIv = randomBytes(12)
  const wrapIv = randomBytes(12)
  const dekBytes = randomBytes(32)
  const dek = await requireCrypto().subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ])
  const kek = await importKek(env, keyVersion)
  try {
    const ciphertext = new Uint8Array(
      await requireCrypto().subtle.encrypt(
        { name: "AES-GCM", iv: bodyIv, additionalData: encodeAad(contentAad) },
        dek,
        plainBytes,
      ),
    )
    const wrappedDek = new Uint8Array(
      await requireCrypto().subtle.encrypt(
        {
          name: "AES-GCM",
          iv: wrapIv,
          additionalData: encodeAad(wrapAadForKeyVersion(keyVersion)),
        },
        kek,
        dekBytes,
      ),
    )
    return Object.freeze({
      ciphertext,
      ciphertext_sha256: await sha256Hex(ciphertext),
      ciphertext_bytes: ciphertext.byteLength,
      body_iv_base64: bytesToBase64Url(bodyIv),
      wrapped_dek_base64: bytesToBase64Url(wrappedDek),
      wrap_iv_base64: bytesToBase64Url(wrapIv),
      key_version: keyVersion,
      aad_version: 1,
    })
  } finally {
    dekBytes.fill(0)
  }
}

async function decryptEnvelope(
  env,
  {
    ciphertext,
    ciphertextSha256,
    ciphertextBytes,
    plaintextSha256,
    plaintextBytes,
    bodyIvBase64,
    wrappedDekBase64,
    wrapIvBase64,
    keyVersion,
    aadVersion,
    contentAad,
    wrapAadForKeyVersion,
  },
) {
  if (Number(aadVersion) !== 1) throw new Error("Unsupported Iconoplasm envelope AAD version")
  const cipherBytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext)
  if (
    (ciphertextBytes != null && cipherBytes.byteLength !== Number(ciphertextBytes)) ||
    (ciphertextSha256 && !equalHex(await sha256Hex(cipherBytes), ciphertextSha256))
  ) {
    throw new Error("Iconoplasm ciphertext integrity verification failed")
  }
  const kek = await importKek(env, Number(keyVersion))
  let dekBytes
  try {
    dekBytes = new Uint8Array(
      await requireCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(wrapIvBase64, "wrap_iv_base64"),
          additionalData: encodeAad(wrapAadForKeyVersion(Number(keyVersion))),
        },
        kek,
        base64ToBytes(wrappedDekBase64, "wrapped_dek_base64"),
      ),
    )
    const dek = await requireCrypto().subtle.importKey(
      "raw",
      dekBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    )
    const plainBytes = new Uint8Array(
      await requireCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(bodyIvBase64, "body_iv_base64"),
          additionalData: encodeAad(contentAad),
        },
        dek,
        cipherBytes,
      ),
    )
    if (
      plainBytes.byteLength !== Number(plaintextBytes) ||
      !equalHex(await sha256Hex(plainBytes), plaintextSha256)
    ) {
      throw new Error("Iconoplasm plaintext integrity verification failed")
    }
    return plainBytes
  } finally {
    dekBytes?.fill(0)
  }
}

async function rewrapEnvelope(
  env,
  { wrappedDekBase64, wrapIvBase64, fromKeyVersion, toKeyVersion, wrapAadForKeyVersion },
) {
  if (Number(fromKeyVersion) === Number(toKeyVersion)) {
    throw new TypeError("Key versions must differ for rewrap")
  }
  const oldKek = await importKek(env, Number(fromKeyVersion))
  const newKek = await importKek(env, Number(toKeyVersion))
  const dekBytes = new Uint8Array(
    await requireCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(wrapIvBase64, "wrap_iv_base64"),
        additionalData: encodeAad(wrapAadForKeyVersion(Number(fromKeyVersion))),
      },
      oldKek,
      base64ToBytes(wrappedDekBase64, "wrapped_dek_base64"),
    ),
  )
  try {
    const nextIv = randomBytes(12)
    const wrappedDek = new Uint8Array(
      await requireCrypto().subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nextIv,
          additionalData: encodeAad(wrapAadForKeyVersion(Number(toKeyVersion))),
        },
        newKek,
        dekBytes,
      ),
    )
    return Object.freeze({
      wrapped_dek_base64: bytesToBase64Url(wrappedDek),
      wrap_iv_base64: bytesToBase64Url(nextIv),
      key_version: Number(toKeyVersion),
    })
  } finally {
    dekBytes.fill(0)
  }
}

export { decryptEnvelope, encryptEnvelope, rewrapEnvelope, sha256Hex }
