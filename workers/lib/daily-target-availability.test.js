import assert from "node:assert/strict"
import test from "node:test"

import { selectAvailableDailyTarget } from "./daily-target-availability.js"

function protein(uniprot) {
  return { uniprot }
}

test("daily target selection rejects an unreachable canonical source and advances deterministically", async () => {
  const loaded = []
  const checked = []
  const result = await selectAvailableDailyTarget({
    initialProtein: protein("BROKEN1"),
    eligibleIds: ["BEFORE", "BROKEN1", "AF_ONLY", "GOOD2", "AFTER"],
    startIndex: 1,
    async loadProtein(uniprot) {
      loaded.push(uniprot)
      return protein(uniprot)
    },
    async resolveStructureMeta(candidate) {
      return { r2Key: `pdb/${candidate.uniprot}.bcif`, upstreamUrl: `https://${candidate.uniprot}` }
    },
    async isStructureAvailable(meta, candidate) {
      checked.push({ key: meta.r2Key, uniprot: candidate.uniprot })
      return candidate.uniprot === "GOOD2"
    },
    isIneligibleFallback(candidate) {
      return candidate.uniprot === "AF_ONLY"
    },
  })

  assert.equal(result.protein?.uniprot, "GOOD2")
  assert.equal(result.structureMeta?.r2Key, "pdb/GOOD2.bcif")
  assert.deepEqual(result.rejected, [{ uniprot_id: "BROKEN1", reason: "structure_unreachable" }])
  assert.deepEqual(loaded, ["AF_ONLY", "GOOD2"])
  assert.deepEqual(checked, [
    { key: "pdb/BROKEN1.bcif", uniprot: "BROKEN1" },
    { key: "pdb/GOOD2.bcif", uniprot: "GOOD2" },
  ])
})

test("daily target selection reports missing metadata and returns null when no target is playable", async () => {
  const result = await selectAvailableDailyTarget({
    initialProtein: protein("MISSING1"),
    eligibleIds: ["MISSING1", "MISSING2"],
    startIndex: 0,
    loadProtein: async (uniprot) => protein(uniprot),
    resolveStructureMeta: async () => null,
    isStructureAvailable: async () => true,
    maxCandidates: 2,
  })

  assert.equal(result.protein, null)
  assert.equal(result.structureMeta, null)
  assert.deepEqual(result.rejected, [
    { uniprot_id: "MISSING1", reason: "no_structure_metadata" },
    { uniprot_id: "MISSING2", reason: "no_structure_metadata" },
  ])
})
