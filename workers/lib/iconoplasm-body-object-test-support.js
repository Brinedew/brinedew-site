// Test-only. Builds body objects as production stores them: plain text since
// B-859, and the encrypted envelopes it wrote before, so tests can prove the
// reader and the plaintext conversion handle both. No production module imports
// this file; the envelope half goes away with the legacy envelope reader (the
// follow-up that deletes the shim).
//
// It is written from the stored format, not from the reader: an AES-256-GCM
// object whose per-object key is wrapped by the key-encryption key
// ICONOPLASM_AUTHORING_BODY_KEK_V<version>, with the additional-authenticated-
// data lines below. If the reader and this file ever disagree, a test fails.
const ENCODER = new TextEncoder()

export const LEGACY_KEY_VERSION = 1

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url")
}

function sha256Hex(bytes) {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) => Buffer.from(digest).toString("hex"))
}

function aad(parts) {
  return ENCODER.encode(parts.map((part) => String(part)).join("\n"))
}

async function encryptEnvelope(env, { plaintext, contentAad, wrapAad }) {
  const kek = await crypto.subtle.importKey(
    "raw",
    Buffer.from(env[`ICONOPLASM_AUTHORING_BODY_KEK_V${LEGACY_KEY_VERSION}`], "base64"),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  )
  const dekBytes = crypto.getRandomValues(new Uint8Array(32))
  const dek = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, [
    "encrypt",
  ])
  const bodyIv = crypto.getRandomValues(new Uint8Array(12))
  const wrapIv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bodyIv, additionalData: aad(contentAad) },
      dek,
      plaintext,
    ),
  )
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: wrapIv, additionalData: aad(wrapAad) },
      kek,
      dekBytes,
    ),
  )
  return {
    ciphertext,
    ciphertext_sha256: await sha256Hex(ciphertext),
    ciphertext_bytes: ciphertext.byteLength,
    body_iv_base64: bytesToBase64Url(bodyIv),
    wrapped_dek_base64: bytesToBase64Url(wrappedDek),
    wrap_iv_base64: bytesToBase64Url(wrapIv),
    key_version: LEGACY_KEY_VERSION,
    aad_version: 1,
  }
}

function normalized(text) {
  return String(text).normalize("NFC").replace(/\r\n?/g, "\n")
}

// A legacy prose body: AAD binds the revision, the gene, the plaintext hash
// and its length.
export async function encryptLegacyProse(env, { revisionId, geneId, prose }) {
  const text = normalized(prose)
  const bytes = ENCODER.encode(text)
  const bodySha256 = await sha256Hex(bytes)
  const encrypted = await encryptEnvelope(env, {
    plaintext: bytes,
    contentAad: [
      "iconoplasm.manifestation.prose.v1",
      revisionId,
      geneId,
      bodySha256,
      bytes.byteLength,
    ],
    wrapAad: ["iconoplasm.manifestation.prose.dek.v1", revisionId, geneId, LEGACY_KEY_VERSION],
  })
  return { prose: text, body_sha256: bodySha256, body_bytes: bytes.byteLength, ...encrypted }
}

// A legacy Tags body (`tags + "\n" + fields json`, already prepared by the
// caller): AAD binds the derivative, its revision, the revision's body hash,
// the plaintext hash and its length.
export async function encryptLegacyTags(env, { derivativeId, revisionId, sourceBodySha256, tags }) {
  const text = normalized(tags)
  const bytes = ENCODER.encode(text)
  const bodySha256 = await sha256Hex(bytes)
  const encrypted = await encryptEnvelope(env, {
    plaintext: bytes,
    contentAad: [
      "iconoplasm.manifestation.tags.v1",
      derivativeId,
      revisionId,
      sourceBodySha256,
      bodySha256,
      bytes.byteLength,
    ],
    wrapAad: [
      "iconoplasm.manifestation.tags.dek.v1",
      derivativeId,
      revisionId,
      sourceBodySha256,
      LEGACY_KEY_VERSION,
    ],
  })
  return { tags: text, body_sha256: bodySha256, body_bytes: bytes.byteLength, ...encrypted }
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

export function legacyKeyEnvironment(fill = 7) {
  return {
    ICONOPLASM_AUTHORING_BODY_KEK_V1: Buffer.from(new Uint8Array(32).fill(fill)).toString("base64"),
  }
}
