import assert from "node:assert/strict"
import test from "node:test"

import { openManifestationBody } from "./lib/iconoplasm-manifestation-body-reader.js"
import { normalizeManifestationProse } from "./lib/iconoplasm-manifestation-prose.js"
import { normalizeManifestationTags } from "./lib/iconoplasm-manifestation-tags.js"
import { sha256Hex } from "./lib/iconoplasm-sha256.js"

// B-859: the reader that turns a stored body object into text. The row says
// what the plain text hashes to; an object that hashes to that is the text, and
// anything else is refused. Failure modes, written before the code:
// 1. Bytes that miss the recorded hash or length are accepted.
// 2. The prose and Tags limits stop being enforced now that nothing encrypts.

test("plain bytes that hash to the row are the text, and anything else is refused", async () => {
  const bytes = new TextEncoder().encode("A caretaker-written line.
A second line with café.")
  const ids = { bodySha256: await sha256Hex(bytes), bodyBytes: bytes.byteLength }
  assert.equal(
    new TextDecoder().decode(await openManifestationBody(bytes, ids)),
    "A caretaker-written line.
A second line with café.",
  )

  const damaged = Uint8Array.from(bytes)
  damaged[0] ^= 1
  await assert.rejects(openManifestationBody(damaged, ids))
  await assert.rejects(openManifestationBody(bytes, { ...ids, bodyBytes: bytes.byteLength + 1 }))
})

test("prose validation rejects empty, control, and character overflow", () => {
  assert.throws(() => normalizeManifestationProse("   "))
  assert.throws(() => normalizeManifestationProse("bad\u0000text"))
  assert.throws(() => normalizeManifestationProse("a".repeat(4001)))
  assert.equal(normalizeManifestationProse("😀".repeat(4000)).codePoints, 4000)
  assert.equal(normalizeManifestationProse("a\r\nb").prose, "a\nb")
})

test("Tags validation keeps the 32 KiB ceiling", () => {
  assert.equal(normalizeManifestationTags("x".repeat(32 * 1024)).bytes.byteLength, 32 * 1024)
  assert.throws(() => normalizeManifestationTags("x".repeat(32 * 1024 + 1)), /32768/)
})
