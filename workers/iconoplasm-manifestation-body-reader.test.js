import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyManifestationBody,
  openManifestationBody,
} from "./lib/iconoplasm-manifestation-body-reader.js"
import { normalizeManifestationProse } from "./lib/iconoplasm-manifestation-prose.js"
import { normalizeManifestationTags } from "./lib/iconoplasm-manifestation-tags.js"
import {
  encryptLegacyProse,
  encryptLegacyTags,
  legacyKeyEnvironment,
} from "./lib/iconoplasm-body-object-test-support.js"
import { sha256Hex } from "./lib/iconoplasm-sha256.js"

// B-859: the reader that turns a stored body object into text. The row says
// what the plain text hashes to; an object that hashes to that is the text, an
// object that hashes to the row's envelope hash is opened with the key, and
// anything else is refused. Failure modes, written before the code:
// 1. An envelope is moved to another gene, revision or derivative and still
//    opens (its identity is bound into the envelope).
// 2. A Tags envelope opens as prose, or the reverse.
// 3. Plain bytes that miss the hash are accepted, or an envelope with no key
//    is guessed at.
// 4. The prose and Tags limits stop being enforced now that nothing encrypts.

const env = legacyKeyEnvironment()
const IDS = {
  revisionId: "mrev_12345678-1234-4234-8234-123456789abc",
  geneId: "gene_12345678-1234-4234-8234-123456789abc",
}

function storageOf(encrypted) {
  return {
    ciphertext_sha256: encrypted.ciphertext_sha256,
    ciphertext_bytes: encrypted.ciphertext_bytes,
    body_iv_base64: encrypted.body_iv_base64,
    wrapped_dek_base64: encrypted.wrapped_dek_base64,
    wrap_iv_base64: encrypted.wrap_iv_base64,
    key_version: encrypted.key_version,
    aad_version: encrypted.aad_version,
  }
}

test("plain bytes that hash to the row are the text, and need no key", async () => {
  const bytes = new TextEncoder().encode("A caretaker-written line.\nA second line with café.")
  const ids = {
    ...IDS,
    bodySha256: await sha256Hex(bytes),
    bodyBytes: bytes.byteLength,
  }
  const storage = { ciphertext_sha256: ids.bodySha256, ciphertext_bytes: bytes.byteLength + 16 }
  assert.equal(await classifyManifestationBody(bytes, storage, ids), "plain")
  const opened = await openManifestationBody({}, "prose", bytes, storage, ids)
  assert.equal(opened.legacy, false)
  assert.equal(
    new TextDecoder().decode(opened.bytes),
    "A caretaker-written line.\nA second line with café.",
  )

  const damaged = Uint8Array.from(bytes)
  damaged[0] ^= 1
  assert.equal(await classifyManifestationBody(damaged, storage, ids), "damaged")
  await assert.rejects(openManifestationBody({}, "prose", damaged, storage, ids))
})

test("a legacy prose envelope opens with the key and is bound to its gene and revision", async () => {
  const encrypted = await encryptLegacyProse(env, { ...IDS, prose: "Bound body" })
  const ids = { ...IDS, bodySha256: encrypted.body_sha256, bodyBytes: encrypted.body_bytes }
  const storage = storageOf(encrypted)
  assert.equal(await classifyManifestationBody(encrypted.ciphertext, storage, ids), "legacy")
  const opened = await openManifestationBody(env, "prose", encrypted.ciphertext, storage, ids)
  assert.equal(opened.legacy, true)
  assert.equal(new TextDecoder().decode(opened.bytes), "Bound body")

  for (const moved of [
    { ...ids, geneId: "gene_aaaaaaaa-1234-4234-8234-123456789abc" },
    { ...ids, revisionId: "mrev_aaaaaaaa-1234-4234-8234-123456789abc" },
  ]) {
    await assert.rejects(openManifestationBody(env, "prose", encrypted.ciphertext, storage, moved))
  }
  await assert.rejects(
    openManifestationBody({}, "prose", encrypted.ciphertext, storage, ids),
    /ICONOPLASM_AUTHORING_BODY_KEK_V1/,
    "an envelope with no key is refused, not guessed at",
  )
  await assert.rejects(
    openManifestationBody(legacyKeyEnvironment(9), "prose", encrypted.ciphertext, storage, ids),
    "an envelope opened with the wrong key is refused",
  )
})

test("a legacy Tags envelope is bound to its derivative and cannot be opened as prose", async () => {
  const sourceBodySha256 = "a".repeat(64)
  const ids = {
    derivativeId: "derivative_crypto_0001",
    revisionId: "revision_crypto_0001",
    geneId: "gene_crypto_0001",
    sourceBodySha256,
  }
  const encrypted = await encryptLegacyTags(env, {
    ...ids,
    tags: "female scientist, green eyes, detailed laboratory\n{}",
  })
  const withBody = { ...ids, bodySha256: encrypted.body_sha256, bodyBytes: encrypted.body_bytes }
  const storage = storageOf(encrypted)
  const opened = await openManifestationBody(env, "tags", encrypted.ciphertext, storage, withBody)
  assert.equal(new TextDecoder().decode(opened.bytes), encrypted.tags)
  await assert.rejects(openManifestationBody(env, "prose", encrypted.ciphertext, storage, withBody))
  await assert.rejects(
    openManifestationBody(env, "tags", encrypted.ciphertext, storage, {
      ...withBody,
      derivativeId: "derivative_other_0001",
    }),
  )
})

test("prose validation rejects empty, control, and character overflow", () => {
  assert.throws(() => normalizeManifestationProse("   "))
  assert.throws(() => normalizeManifestationProse("bad\u0000text"))
  assert.throws(() => normalizeManifestationProse("a".repeat(10001)))
  assert.equal(normalizeManifestationProse("a".repeat(10000)).codePoints, 10000)
  // B-977: 99.9% of the 19,188 workstation manifestations are under 9,289 characters.
  assert.equal(normalizeManifestationProse("😀".repeat(4096)).codePoints, 4096)
  assert.throws(() => normalizeManifestationProse("😀".repeat(4097)), /16384 UTF-8 bytes/)
  assert.equal(normalizeManifestationProse("a\r\nb").prose, "a\nb")
})

test("Tags validation keeps the 32 KiB ceiling", () => {
  assert.equal(normalizeManifestationTags("x".repeat(32 * 1024)).bytes.byteLength, 32 * 1024)
  assert.throws(() => normalizeManifestationTags("x".repeat(32 * 1024 + 1)), /32768/)
})
