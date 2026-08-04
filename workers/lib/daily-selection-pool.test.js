import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDailySelectionPoolFingerprint,
  buildFamilyBalancedDailyCandidateIds,
  getDailySelectionProteinIds,
} from "./protein-store.js"

test("daily selection uses a stable ordered pool independent of transient structure failures", async () => {
  const calls = []
  const db = {
    prepare(sql) {
      calls.push(sql)
      return {
        all: async () => ({
          results: [
            { uniprot: "Q96T52", gene_surname: "SLC" },
            { uniprot: "Q96T53", gene_surname: "SLC" },
            { uniprot: "Q96T54", gene_surname: "TP53" },
          ],
        }),
      }
    },
  }

  const ids = await getDailySelectionProteinIds(db)

  assert.deepEqual(ids, ["Q96T52", "Q96T53", "Q96T54"])
  assert.equal(calls.length, 1)
  assert.match(calls[0], /SELECT p\.uniprot, p\.gene_surname/)
  assert.match(calls[0], /ORDER BY p\.gene_surname ASC, p\.uniprot ASC/)
  assert.match(calls[0], /LOWER\(TRIM\(p\.structure_source\)\) <> 'alphafold'/)
  assert.doesNotMatch(calls[0], /structure_failures/)
})

test("ARCHITECTURE FENCE [GG-001] daily lottery gives every surname exactly one slot", async () => {
  const rows = [
    { uniprot: "SLC_A", gene_surname: "SLC" },
    { uniprot: "SLC_B", gene_surname: "SLC" },
    { uniprot: "SLC_C", gene_surname: "SLC" },
    { uniprot: "TP53_A", gene_surname: "TP53" },
    { uniprot: "ZNF_A", gene_surname: "ZNF" },
    { uniprot: "ZNF_B", gene_surname: "ZNF" },
  ]

  const ids = await buildFamilyBalancedDailyCandidateIds(
    rows,
    rows.map((row) => row.uniprot),
    "test-salt",
    "2026-07-27",
  )
  const surnameById = new Map(rows.map((row) => [row.uniprot, row.gene_surname]))
  const selectedSurnames = ids.map((id) => surnameById.get(id))

  assert.equal(new Set(selectedSurnames).size, 3)
  assert.deepEqual(selectedSurnames.slice().sort(), ["SLC", "TP53", "ZNF"])
  assert.equal(ids.length, 3)
  assert.equal(ids.filter((id) => id.startsWith("SLC_")).length, 1)
  assert.equal(ids.filter((id) => id.startsWith("ZNF_")).length, 1)
})

test("family-balanced daily sequence is deterministic and input-order independent", async () => {
  const rows = [
    { uniprot: "SLC_B", gene_surname: "slc" },
    { uniprot: "TP53_A", gene_surname: "TP53" },
    { uniprot: "SLC_A", gene_surname: "SLC" },
    { uniprot: "UNKNOWN_A", gene_surname: null },
  ]
  const eligibleIds = rows.map((row) => row.uniprot)

  const first = await buildFamilyBalancedDailyCandidateIds(
    rows,
    eligibleIds,
    "test-salt",
    "2026-07-27",
  )
  const second = await buildFamilyBalancedDailyCandidateIds(
    rows.slice().reverse(),
    eligibleIds.slice().reverse(),
    "test-salt",
    "2026-07-27",
  )

  assert.deepEqual(first, second)
  assert.equal(first.length, 3)
  assert.equal(new Set(first).size, 3)
})

test("daily pool fingerprint is order-independent and changes with membership", async () => {
  const first = await buildDailySelectionPoolFingerprint([
    { surname: "SLC", members: ["SLC_B", "SLC_A"] },
    { surname: "TP53", members: ["TP53_A"] },
  ])
  const reordered = await buildDailySelectionPoolFingerprint([
    { surname: "tp53", members: ["tp53_a"] },
    { surname: "slc", members: ["slc_a", "slc_b"] },
  ])
  const changed = await buildDailySelectionPoolFingerprint([
    { surname: "SLC", members: ["SLC_A"] },
    { surname: "TP53", members: ["TP53_A"] },
  ])

  assert.equal(first, reordered)
  assert.notEqual(first, changed)
})

test("automatic targets do not repeat inside a full surname shuffle-bag", async () => {
  const rows = Array.from({ length: 400 }, (_, index) => ({
    uniprot: `P${String(index).padStart(5, "0")}`,
    gene_surname: `FAMILY_${String(index).padStart(5, "0")}`,
  }))
  const eligibleIds = rows.map((row) => row.uniprot)
  const selected = []

  for (let offset = 0; offset < 365; offset += 1) {
    const date = new Date("2026-08-04T00:00:00.000Z")
    date.setUTCDate(date.getUTCDate() + offset)
    const ids = await buildFamilyBalancedDailyCandidateIds(
      rows,
      eligibleIds,
      "test-salt",
      date.toISOString().slice(0, 10),
    )
    selected.push(ids[0])
  }

  assert.equal(new Set(selected).size, 365)
})

test("large-family representative rotates between complete bag cycles", async () => {
  const rows = [
    { uniprot: "SLC_A", gene_surname: "SLC" },
    { uniprot: "SLC_B", gene_surname: "SLC" },
    { uniprot: "SLC_C", gene_surname: "SLC" },
    { uniprot: "TP53_A", gene_surname: "TP53" },
  ]
  const eligibleIds = rows.map((row) => row.uniprot)
  const first = await buildFamilyBalancedDailyCandidateIds(
    rows,
    eligibleIds,
    "test-salt",
    "2026-07-01",
  )
  const nextCycleDate = new Date("2026-07-01T00:00:00.000Z")
  nextCycleDate.setUTCDate(nextCycleDate.getUTCDate() + 2)
  const nextCycle = await buildFamilyBalancedDailyCandidateIds(
    rows,
    eligibleIds,
    "test-salt",
    nextCycleDate.toISOString().slice(0, 10),
  )
  const firstSlc = first.find((id) => id.startsWith("SLC_"))
  const nextSlc = nextCycle.find((id) => id.startsWith("SLC_"))

  assert.notEqual(firstSlc, nextSlc)
})
