import assert from "node:assert/strict"
import test from "node:test"

import {
  decryptManifestationProse,
  encryptManifestationProse,
  normalizeManifestationProse,
  rewrapManifestationDek,
} from "./lib/iconoplasm-manifestation-body-crypto.js"
import {
  decryptManifestationTags,
  encryptManifestationTags,
  normalizeManifestationTags,
} from "./lib/iconoplasm-manifestation-tags-crypto.js"

function base64(bytes) {
  return Buffer.from(bytes).toString("base64")
}

const env = {
  ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
  ICONOPLASM_AUTHORING_BODY_KEK_V1: base64(new Uint8Array(32).fill(7)),
  ICONOPLASM_AUTHORING_BODY_KEK_V2: base64(new Uint8Array(32).fill(9)),
}

const identity = {
  revisionId: "mrev_12345678-1234-4234-8234-123456789abc",
  geneId: "gene_12345678-1234-4234-8234-123456789abc",
}

test("manifestation prose encryption round-trips exact normalized text", async () => {
  const encrypted = await encryptManifestationProse(env, {
    ...identity,
    prose: "A caretaker-written line.\r\nA second line with café.",
  })
  assert.equal(encrypted.prose, "A caretaker-written line.\nA second line with café.")
  assert.equal(encrypted.body_sha256.length, 64)
  assert.equal(encrypted.ciphertext_sha256.length, 64)
  assert.ok(encrypted.ciphertext_bytes > encrypted.body_bytes)

  const prose = await decryptManifestationProse(env, {
    ...identity,
    ciphertext: encrypted.ciphertext,
    bodySha256: encrypted.body_sha256,
    bodyBytes: encrypted.body_bytes,
    bodyIvBase64: encrypted.body_iv_base64,
    wrappedDekBase64: encrypted.wrapped_dek_base64,
    wrapIvBase64: encrypted.wrap_iv_base64,
    keyVersion: encrypted.key_version,
    aadVersion: encrypted.aad_version,
  })
  assert.equal(prose, encrypted.prose)
})

test("ciphertext cannot be moved to another gene or revision", async () => {
  const encrypted = await encryptManifestationProse(env, { ...identity, prose: "Bound body" })
  await assert.rejects(
    decryptManifestationProse(env, {
      ...identity,
      geneId: "gene_aaaaaaaa-1234-4234-8234-123456789abc",
      ciphertext: encrypted.ciphertext,
      bodySha256: encrypted.body_sha256,
      bodyBytes: encrypted.body_bytes,
      bodyIvBase64: encrypted.body_iv_base64,
      wrappedDekBase64: encrypted.wrapped_dek_base64,
      wrapIvBase64: encrypted.wrap_iv_base64,
      keyVersion: encrypted.key_version,
    }),
  )
})

test("DEKs can be rewrapped without rewriting ciphertext", async () => {
  const encrypted = await encryptManifestationProse(env, { ...identity, prose: "Rotate me" })
  const rewrapped = await rewrapManifestationDek(env, {
    ...identity,
    wrappedDekBase64: encrypted.wrapped_dek_base64,
    wrapIvBase64: encrypted.wrap_iv_base64,
    fromKeyVersion: 1,
    toKeyVersion: 2,
  })
  const prose = await decryptManifestationProse(
    { ...env, ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "2" },
    {
      ...identity,
      ciphertext: encrypted.ciphertext,
      bodySha256: encrypted.body_sha256,
      bodyBytes: encrypted.body_bytes,
      bodyIvBase64: encrypted.body_iv_base64,
      wrappedDekBase64: rewrapped.wrapped_dek_base64,
      wrapIvBase64: rewrapped.wrap_iv_base64,
      keyVersion: rewrapped.key_version,
    },
  )
  assert.equal(prose, "Rotate me")
})

test("prose validation rejects empty, control, and character overflow", () => {
  assert.throws(() => normalizeManifestationProse("   "))
  assert.throws(() => normalizeManifestationProse("bad\u0000text"))
  assert.throws(() => normalizeManifestationProse("a".repeat(4001)))
  assert.equal(normalizeManifestationProse("😀".repeat(4000)).codePoints, 4000)
})

test("Tags use a distinct 32 KiB envelope namespace and cannot cross-decrypt as prose", async () => {
  const tagsEnv = env
  const derivativeId = "derivative_crypto_0001"
  const revisionId = "revision_crypto_0001"
  const geneId = "gene_crypto_0001"
  const sourceBodySha256 = "a".repeat(64)
  const encryptedTags = await encryptManifestationTags(tagsEnv, {
    derivativeId,
    revisionId,
    sourceBodySha256,
    tags: "female scientist, green eyes, detailed laboratory",
  })
  assert.equal(
    await decryptManifestationTags(tagsEnv, {
      derivativeId,
      revisionId,
      sourceBodySha256,
      ciphertext: encryptedTags.ciphertext,
      ciphertextSha256: encryptedTags.ciphertext_sha256,
      ciphertextBytes: encryptedTags.ciphertext_bytes,
      bodySha256: encryptedTags.body_sha256,
      bodyBytes: encryptedTags.body_bytes,
      bodyIvBase64: encryptedTags.body_iv_base64,
      wrappedDekBase64: encryptedTags.wrapped_dek_base64,
      wrapIvBase64: encryptedTags.wrap_iv_base64,
      keyVersion: encryptedTags.key_version,
      aadVersion: encryptedTags.aad_version,
    }),
    encryptedTags.tags,
  )
  await assert.rejects(
    decryptManifestationProse(tagsEnv, {
      revisionId,
      geneId,
      ciphertext: encryptedTags.ciphertext,
      bodySha256: encryptedTags.body_sha256,
      bodyBytes: encryptedTags.body_bytes,
      bodyIvBase64: encryptedTags.body_iv_base64,
      wrappedDekBase64: encryptedTags.wrapped_dek_base64,
      wrapIvBase64: encryptedTags.wrap_iv_base64,
      keyVersion: encryptedTags.key_version,
      aadVersion: encryptedTags.aad_version,
    }),
  )
  assert.equal(normalizeManifestationTags("x".repeat(32 * 1024)).bytes.byteLength, 32 * 1024)
  assert.throws(() => normalizeManifestationTags("x".repeat(32 * 1024 + 1)), /32768/)
})
