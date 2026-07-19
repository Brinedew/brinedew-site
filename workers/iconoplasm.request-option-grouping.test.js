import assert from "node:assert/strict"
import test from "node:test"

import { groupGenerationRequestVisionOptions } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function option({ visionId, emulsionId, previews = [], imageCount = previews.length }) {
  return {
    vision_id: visionId,
    emulsion_id: emulsionId,
    label: emulsionId,
    primary_label: emulsionId,
    secondary_label: visionId,
    search_text: `${emulsionId} ${visionId}`,
    image_count: imageCount,
    live_count: imageCount,
    score: imageCount,
    vote_h_index: imageCount ? 1 : 0,
    preview_assets: previews.map((asset_sha256, index) => ({
      asset_sha256,
      gene_symbol: `GENE${index + 1}`,
      preview_rank: index + 1,
    })),
  }
}

test("request picker groups edited IDs but uses only the base row content", () => {
  const baseFirst = "a".repeat(64)
  const baseSecond = "c".repeat(64)
  const edited = "b".repeat(64)
  const grouped = groupGenerationRequestVisionOptions([
    option({
      visionId: "image-edit:edited-15527",
      emulsionId: "A1-15527-e",
      previews: [edited],
      imageCount: 9,
    }),
    option({
      visionId: "anima-v1-15527",
      emulsionId: "A1-15527",
      previews: [baseFirst, baseSecond],
      imageCount: 2,
    }),
    option({
      visionId: "anima-v1-193",
      emulsionId: "A1-193",
      previews: ["d".repeat(64)],
    }),
  ])

  assert.equal(grouped.length, 2)
  const family = grouped.find((item) => item.emulsion_family_id === "A1-15527")
  assert.ok(family)
  assert.equal(family.primary_label, "A1-15527")
  assert.equal(family.vision_id, "anima-v1-15527")
  assert.equal(family.image_count, 2)
  assert.equal(family.live_count, 2)
  assert.equal(family.score, 2)
  assert.deepEqual(family.member_vision_ids, ["anima-v1-15527", "image-edit:edited-15527"])
  assert.deepEqual(family.member_emulsion_ids, ["A1-15527", "A1-15527-e"])
  assert.deepEqual(
    family.preview_assets.map((preview) => preview.asset_sha256),
    [baseFirst, baseSecond],
  )
  assert.doesNotMatch(
    family.preview_assets.map((preview) => preview.asset_sha256).join(" "),
    new RegExp(edited),
  )
  assert.match(family.search_text, /A1-15527-e/)
})

test("request picker removes repeated trailing edit suffixes from the family label", () => {
  const [family] = groupGenerationRequestVisionOptions([
    option({
      visionId: "image-edit:standalone",
      emulsionId: "A1-900-e-e",
      previews: ["e".repeat(64)],
    }),
  ])

  assert.equal(family.primary_label, "A1-900")
  assert.equal(family.vision_id, "image-edit:standalone")
  assert.deepEqual(family.member_emulsion_ids, ["A1-900-e-e"])
  assert.equal(family.preview_assets.length, 1)
})

test("request picker deduplicates identical thumbnails within the base row", () => {
  const duplicate = "f".repeat(64)
  const [family] = groupGenerationRequestVisionOptions([
    option({
      visionId: "anima-v1-901",
      emulsionId: "A1-901",
      previews: [duplicate, duplicate],
    }),
    option({
      visionId: "image-edit:901",
      emulsionId: "A1-901-e",
      previews: ["1".repeat(64)],
    }),
  ])

  assert.deepEqual(
    family.preview_assets.map((preview) => preview.asset_sha256),
    [duplicate],
  )
})
