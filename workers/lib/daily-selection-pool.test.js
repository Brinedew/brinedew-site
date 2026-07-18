import assert from "node:assert/strict"
import test from "node:test"

import { getDailySelectionProteinIds } from "./protein-store.js"

test("daily selection uses a stable ordered pool independent of transient structure failures", async () => {
  const calls = []
  const db = {
    prepare(sql) {
      calls.push(sql)
      return {
        all: async () => ({
          results: [{ uniprot: "Q96T52" }, { uniprot: "Q96T53" }, { uniprot: "Q96T54" }],
        }),
      }
    },
  }

  const ids = await getDailySelectionProteinIds(db)

  assert.deepEqual(ids, ["Q96T52", "Q96T53", "Q96T54"])
  assert.equal(calls.length, 1)
  assert.match(calls[0], /ORDER BY p\.id ASC/)
  assert.doesNotMatch(calls[0], /structure_failures/)
})
