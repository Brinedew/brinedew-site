import assert from "node:assert/strict"
import test from "node:test"

import {
  iconoplasmGeneBlotWebpDimensions,
  iconoplasmGeneCardPngDimensions,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

test("materialized print dimensions are verified from the PNG header", () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47], 0)
  png.set([0x49, 0x48, 0x44, 0x52], 12)
  png.set([0x00, 0x00, 0x06, 0x00], 16)
  png.set([0x00, 0x00, 0x08, 0x00], 20)

  assert.deepEqual(iconoplasmGeneCardPngDimensions(png), { width: 1536, height: 2048 })
  assert.equal(iconoplasmGeneCardPngDimensions(new Uint8Array([1, 2, 3])), null)
})

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
