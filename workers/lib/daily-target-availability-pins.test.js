import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDailyTargetAvailabilityPinKey,
  collectDailyTargetHorizonExclusions,
  parseDailyTargetAvailabilityPin,
  readDailyTargetAvailabilityPin,
  selectDailyTargetAvailabilityReplacement,
  writeDailyTargetAvailabilityPin,
} from "./daily-target-availability-pins.js"

test("horizon exclusions require every consecutive day and include canonical families", () => {
  const entries = [
    {
      date: "2026-08-04",
      uniprot: "Q-ACTUAL",
      geneSurname: "ACTUAL",
      canonicalUniprot: "Q-CANONICAL",
      canonicalGeneSurname: "CANONICAL",
    },
    { date: "2026-08-05", uniprot: "Q-TWO", geneSurname: "TWO" },
    { date: "2026-08-06", uniprot: "Q-THREE", geneSurname: "THREE" },
  ]
  assert.deepEqual(
    collectDailyTargetHorizonExclusions(entries, {
      firstDate: "2026-08-04",
      dayCount: 3,
    }),
    {
      forbiddenUniprotIds: ["Q-ACTUAL", "Q-CANONICAL", "Q-TWO", "Q-THREE"],
      forbiddenGeneSurnames: ["ACTUAL", "CANONICAL", "TWO", "THREE"],
    },
  )
  assert.equal(
    collectDailyTargetHorizonExclusions(entries.slice(1), {
      firstDate: "2026-08-04",
      dayCount: 2,
    }),
    null,
  )
})

test("availability pins are bound to the exact selector salt and pool fingerprint", async () => {
  const values = new Map()
  const kv = {
    async get(key) {
      return values.get(key) || null
    },
    async put(key, value) {
      values.set(key, value)
    },
  }

  await writeDailyTargetAvailabilityPin(kv, {
    date: "2027-01-02",
    salt: "selector-v2",
    selectionPoolFingerprint: "pool-a",
    originalUniprotId: "q-old",
    replacementUniprotId: "q-new",
    rejectedUniprotIds: ["q-old", "Q-OLD"],
    forbiddenUniprotIds: ["q-one", "q-two"],
    forbiddenGeneSurnames: ["slc", "SLC"],
  })

  const pin = await readDailyTargetAvailabilityPin(kv, {
    date: "2027-01-02",
    salt: "selector-v2",
    selectionPoolFingerprint: "pool-a",
  })
  assert.equal(pin.uniprot_id, "Q-NEW")
  assert.deepEqual(pin.rejected_uniprot_ids, ["Q-OLD"])
  assert.deepEqual(pin.forbidden_gene_surnames, ["SLC"])
  assert.equal(
    parseDailyTargetAvailabilityPin(values.get(buildDailyTargetAvailabilityPinKey("2027-01-02")), {
      date: "2027-01-02",
      salt: "selector-v2",
      selectionPoolFingerprint: "pool-b",
    }),
    null,
  )
})

test("replacement chooser rejects AlphaFold and every family already in the horizon", async () => {
  const proteins = new Map([
    ["Q-CANONICAL", { uniprot: "Q-CANONICAL", gene_surname: "SLC", structure_source: "pdb" }],
    ["Q-AF", { uniprot: "Q-AF", gene_surname: "UNUSED", structure_source: "alphafold" }],
    ["Q-SAME-FAMILY", { uniprot: "Q-SAME-FAMILY", gene_surname: "ZNF", structure_source: "pdb" }],
    ["Q-GOOD", { uniprot: "Q-GOOD", gene_surname: "OUTSIDE", structure_source: "swissmodel" }],
  ])
  const result = await selectDailyTargetAvailabilityReplacement({
    candidateIds: ["Q-CANONICAL", "Q-AF", "Q-SAME-FAMILY", "Q-GOOD"],
    forbiddenUniprotIds: ["Q-CANONICAL"],
    forbiddenGeneSurnames: ["ZNF"],
    rejectedUniprotIds: [],
    loadProtein: async (uniprot) => proteins.get(uniprot) || null,
  })

  assert.equal(result.protein.uniprot, "Q-GOOD")
  assert.deepEqual(result.rejectedUniprotIds, ["Q-AF"])
})

test("replacement chooser treats missing surnames as stable one-member families", async () => {
  const result = await selectDailyTargetAvailabilityReplacement({
    candidateIds: ["Q-ORPHAN", "Q-GOOD"],
    forbiddenGeneSurnames: ["__UNFAMILIED__:Q-ORPHAN"],
    loadProtein: async (uniprot) => ({
      uniprot,
      gene_surname: null,
      structure_source: "pdb",
    }),
  })
  assert.equal(result.protein.uniprot, "Q-GOOD")
})
