import assert from "node:assert/strict"
import test from "node:test"

import {
  iconoplasmPublishedPortraitUrl,
  iconoplasmPublishedGeneRecordIsDiscoveryCandidate,
} from "./iconoplasm-gene-discovery.js"

const PORTRAIT_SHA = "a".repeat(64)

test("catalog discovery candidacy ignores non-authoritative portrait metadata", () => {
  const complete = { s: "TP53", n: "tumor protein p53", p: { asset_sha256: PORTRAIT_SHA } }
  const missingName = { ...complete, n: "" }
  const missingPortrait = { ...complete, p: null }

  assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(complete), true)
  assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(missingName), false)
  assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(missingPortrait), true)
  assert.equal(
    iconoplasmPublishedPortraitUrl(complete),
    `https://iconoplasm.brinedew.bio/portraits/v1/aa/${PORTRAIT_SHA}/medium.webp`,
  )
  assert.equal(iconoplasmPublishedPortraitUrl(complete, "unsupported"), "")
})
