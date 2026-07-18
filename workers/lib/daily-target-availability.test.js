import assert from "node:assert/strict"
import test from "node:test"

import {
  selectAvailableDailyTarget,
  shouldReplaceRecordedDailyTarget,
} from "./daily-target-availability.js"

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
    isCandidateIneligible(candidate) {
      return candidate.uniprot === "AF_ONLY"
    },
  })

  assert.equal(result.protein?.uniprot, "GOOD2")
  assert.equal(result.structureMeta?.r2Key, "pdb/GOOD2.bcif")
  assert.equal(result.skippedIneligible, 1)
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
  assert.equal(result.skippedIneligible, 0)
  assert.deepEqual(result.rejected, [
    { uniprot_id: "MISSING1", reason: "no_structure_metadata" },
    { uniprot_id: "MISSING2", reason: "no_structure_metadata" },
  ])
})

test("automatic selection never accepts an ineligible initial candidate", async () => {
  const checked = []
  const result = await selectAvailableDailyTarget({
    initialProtein: protein("AF_ONLY"),
    eligibleIds: ["AF_ONLY", "GOOD"],
    startIndex: 0,
    loadProtein: async (uniprot) => protein(uniprot),
    resolveStructureMeta: async (candidate) => ({
      r2Key: `pdb/${candidate.uniprot}.bcif`,
    }),
    isStructureAvailable: async (_meta, candidate) => {
      checked.push(candidate.uniprot)
      return true
    },
    isCandidateIneligible: (candidate) => candidate.uniprot === "AF_ONLY",
  })

  assert.equal(result.protein?.uniprot, "GOOD")
  assert.equal(result.skippedIneligible, 1)
  assert.deepEqual(checked, ["GOOD"])
})

test("a recorded target can change only when its structure failed before any guess", () => {
  const incident = {
    existingUniprot: "Q96T52",
    selectedUniprot: "Q96T54",
    rejected: [{ uniprot_id: "Q96T52", reason: "structure_unreachable" }],
  }
  assert.equal(shouldReplaceRecordedDailyTarget({ ...incident, totalGuesses: 0 }), true)
  assert.equal(shouldReplaceRecordedDailyTarget({ ...incident, totalGuesses: 1 }), false)
  assert.equal(
    shouldReplaceRecordedDailyTarget({
      ...incident,
      rejected: [{ uniprot_id: "Q96T52", reason: "no_structure_metadata" }],
      totalGuesses: 0,
    }),
    true,
  )
  assert.equal(
    shouldReplaceRecordedDailyTarget({
      ...incident,
      selectedUniprot: "Q96T52",
      totalGuesses: 0,
    }),
    false,
  )
})
