import assert from "node:assert/strict"
import test from "node:test"

import {
  groupGenerationRequestVisionOptions,
  resolveGenerationRequestReferenceFromOptionRows,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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
    preview_assets: previews.map((preview, index) => ({
      ...(typeof preview === "string" ? { asset_sha256: preview } : preview),
      gene_symbol: (typeof preview === "object" && preview?.gene_symbol) || `GENE${index + 1}`,
      preview_rank: (typeof preview === "object" && preview?.preview_rank) || index + 1,
    })),
  }
}

test("request picker groups edited variants into their inspectable emulsion family", () => {
  const grouped = groupGenerationRequestVisionOptions([
    option({
      visionId: "image-edit:edited-15527",
      emulsionId: "A1-15527-e",
      previews: ["b".repeat(64)],
    }),
    option({
      visionId: "anima-v1-15527",
      emulsionId: "A1-15527",
      previews: ["a".repeat(64), "c".repeat(64)],
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
  assert.deepEqual(family.member_vision_ids, ["anima-v1-15527", "image-edit:edited-15527"])
  assert.deepEqual(family.member_emulsion_ids, ["A1-15527", "A1-15527-e"])
  assert.deepEqual(
    family.preview_assets.map((preview) => preview.asset_sha256),
    ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
  )
  assert.match(family.search_text, /A1-15527-e/)
  assert.equal(family.image_count, 3)
})

test("request picker keeps a standalone edited family selectable", () => {
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
})

test("request picker replaces an edit ancestor with its edited descendant", () => {
  const sourceSha = "1".repeat(64)
  const editedSha = "2".repeat(64)
  const unrelatedSha = "3".repeat(64)
  const [family] = groupGenerationRequestVisionOptions([
    option({
      visionId: "anima-v1-15527",
      emulsionId: "A1-15527",
      previews: [
        { asset_sha256: sourceSha, gene_symbol: "TP53", medium_url: "source.webp" },
        { asset_sha256: unrelatedSha, gene_symbol: "SPRR1B" },
      ],
    }),
    option({
      visionId: "image-edit:edited-15527",
      emulsionId: "A1-15527-e",
      previews: [
        {
          asset_sha256: editedSha,
          gene_symbol: "TP53",
          lineage_root_asset_sha256: sourceSha,
          lineage_depth: 1,
          edit_ancestor_asset_sha256s: [sourceSha],
          medium_url: "edited.webp",
        },
      ],
    }),
  ])

  assert.deepEqual(
    family.preview_assets.map((preview) => preview.asset_sha256),
    [editedSha, unrelatedSha],
  )
  assert.equal(family.preview_assets[0].medium_url, "edited.webp")
})

test("request picker preserves sibling edits from the same source", () => {
  const sourceSha = "4".repeat(64)
  const firstEditSha = "5".repeat(64)
  const secondEditSha = "6".repeat(64)
  const [family] = groupGenerationRequestVisionOptions([
    option({
      visionId: "anima-v1-901",
      emulsionId: "A1-901",
      previews: [{ asset_sha256: sourceSha, gene_symbol: "TP53" }],
    }),
    option({
      visionId: "image-edit:first",
      emulsionId: "A1-901-e",
      previews: [
        {
          asset_sha256: firstEditSha,
          gene_symbol: "TP53",
          edit_ancestor_asset_sha256s: [sourceSha],
        },
      ],
    }),
    option({
      visionId: "image-edit:second",
      emulsionId: "A1-901-e-e",
      previews: [
        {
          asset_sha256: secondEditSha,
          gene_symbol: "TP53",
          edit_ancestor_asset_sha256s: [sourceSha],
        },
      ],
    }),
  ])

  assert.deepEqual(
    family.preview_assets.map((preview) => preview.asset_sha256),
    [firstEditSha, secondEditSha],
  )
})

test("request picker keeps only the leaf of a multi-step edit chain", () => {
  const sourceSha = "7".repeat(64)
  const firstEditSha = "8".repeat(64)
  const secondEditSha = "9".repeat(64)
  const [family] = groupGenerationRequestVisionOptions([
    option({
      visionId: "anima-v1-902",
      emulsionId: "A1-902",
      previews: [sourceSha],
    }),
    option({
      visionId: "image-edit:first-step",
      emulsionId: "A1-902-e",
      previews: [
        {
          asset_sha256: firstEditSha,
          edit_ancestor_asset_sha256s: [sourceSha],
        },
      ],
    }),
    option({
      visionId: "image-edit:second-step",
      emulsionId: "A1-902-e-e",
      previews: [
        {
          asset_sha256: secondEditSha,
          lineage_depth: 2,
          edit_ancestor_asset_sha256s: [firstEditSha, sourceSha],
        },
      ],
    }),
  ])

  assert.deepEqual(
    family.preview_assets.map((preview) => preview.asset_sha256),
    [secondEditSha],
  )
})

test("request creation snapshots the exact visible family preview", () => {
  const sourceSha = "a".repeat(64)
  const editedSha = "b".repeat(64)
  const rows = [
    {
      vision_id: "anima-v1-15527",
      emulsion_id: "A1-15527",
      preview_assets_json: JSON.stringify([
        { asset_sha256: sourceSha, gene_symbol: "TP53", preview_rank: 1 },
      ]),
    },
    {
      vision_id: "image-edit:edited-15527",
      emulsion_id: "A1-15527-e",
      preview_assets_json: JSON.stringify([
        {
          asset_sha256: editedSha,
          gene_symbol: "TP53",
          lineage_root_asset_sha256: sourceSha,
          lineage_depth: 1,
          edit_ancestor_asset_sha256s: [sourceSha],
          preview_rank: 1,
        },
      ]),
    },
  ]

  assert.equal(
    resolveGenerationRequestReferenceFromOptionRows(rows, {
      requestedVisionId: "anima-v1-15527",
    })?.asset_sha256,
    editedSha,
  )
  assert.equal(
    resolveGenerationRequestReferenceFromOptionRows(rows, {
      requestedVisionId: "anima-v1-15527",
      requestedReferenceAssetSha256: editedSha,
    })?.asset_sha256,
    editedSha,
  )
  assert.equal(
    resolveGenerationRequestReferenceFromOptionRows(rows, {
      requestedVisionId: "anima-v1-15527",
      requestedReferenceAssetSha256: sourceSha,
    }),
    null,
  )
})
