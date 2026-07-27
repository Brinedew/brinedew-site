import assert from "node:assert/strict"
import test from "node:test"

import {
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

test("large-family representative rotates across dates without gaining extra slots", async () => {
  const rows = [
    { uniprot: "SLC_A", gene_surname: "SLC" },
    { uniprot: "SLC_B", gene_surname: "SLC" },
    { uniprot: "SLC_C", gene_surname: "SLC" },
    { uniprot: "TP53_A", gene_surname: "TP53" },
  ]
  const eligibleIds = rows.map((row) => row.uniprot)
  const slcRepresentatives = new Set()

  for (let day = 1; day <= 31; day += 1) {
    const ids = await buildFamilyBalancedDailyCandidateIds(
      rows,
      eligibleIds,
      "test-salt",
      `2026-07-${String(day).padStart(2, "0")}`,
    )
    const slcIds = ids.filter((id) => id.startsWith("SLC_"))
    assert.equal(slcIds.length, 1)
    slcRepresentatives.add(slcIds[0])
  }

  assert.ok(slcRepresentatives.size > 1)
})
