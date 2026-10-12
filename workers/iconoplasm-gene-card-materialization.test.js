import assert from "node:assert/strict"
import test from "node:test"

import { iconoplasmGeneBlotWebpDimensions } from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

test("canonical blot WebP dimensions are verified before immutable storage", () => {
  const webp = new Uint8Array(30)
  webp.set([...Buffer.from("RIFF")], 0)
  webp.set([...Buffer.from("WEBP")], 8)
  webp.set([...Buffer.from("VP8X")], 12)
  webp.set([10, 0, 0, 0], 16)
  webp.set([0, 0, 0, 0], 20)
  webp.set([0xff, 0x02, 0x00], 24)
  webp.set([0xff, 0x03, 0x00], 27)
  assert.deepEqual(iconoplasmGeneBlotWebpDimensions(webp), { width: 768, height: 1024 })
  assert.equal(iconoplasmGeneBlotWebpDimensions(new Uint8Array([1, 2, 3])), null)
})
