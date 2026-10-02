import assert from "node:assert/strict"
import test from "node:test"
import { createIconoplasmCandidateRemoval } from "./iconoplasm-admin-candidate-removal.js"

// B-901: "Deleting multiple candidates in a row becomes bugged ... Couldn't
// delete ABCC11-0. Nothing changed. Asset not found". A delete committed in D1
// but left the gene's stable object listing the candidate until the next
// Actions publisher run, so a reloaded page offered it again and the second
// delete answered 404. Failure modes written before the code:
// 1. a committed delete must rewrite the gene's stable object before the answer;
// 2. deleting a candidate a previous delete already removed (a stale page) is
//    an idempotent success that also republishes the gene, so the stale object
//    heals;
// 3. an asset that never belonged to the gene stays a 404 and republishes
//    nothing;
// 4. a republish that throws after a committed delete must not turn the delete
//    into an error: the remove_candidate event lets the Actions publisher
//    repair the object, and the answer says republished: false;
// 5. a request without an asset is a 400 that touches nothing.

const SHA = "a".repeat(64)

function services(overrides = {}) {
  const calls = { remove: [], wasRemoved: [], republish: [], afterRemoval: [] }
  const removal = createIconoplasmCandidateRemoval({
    remove: async (input) => {
      calls.remove.push(input)
      return overrides.removal || { ok: true, code: "REMOVED", unpublished_current: false }
    },
    wasRemoved: async (symbol, asset) => {
      calls.wasRemoved.push([symbol, asset])
      return overrides.wasRemoved === true
    },
    republish: async (symbol) => {
      calls.republish.push(symbol)
      if (overrides.republishThrows) throw new Error("Bunny PUT refused")
      return { symbol }
    },
    afterRemoval: async (symbol) => {
      calls.afterRemoval.push(symbol)
    },
  })
  return { removal, calls }
}

test("a committed delete republishes the gene before it answers", async () => {
  const { removal, calls } = services()
  const result = await removal({ symbol: "ABCC11", assetSha256: SHA, actorId: "admin" })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.republished, true)
  assert.equal(result.body.already_removed, undefined)
  assert.deepEqual(calls.republish, ["ABCC11"])
  assert.deepEqual(calls.afterRemoval, ["ABCC11"])
})

test("deleting an already removed candidate succeeds and heals the stale object", async () => {
  const { removal, calls } = services({
    removal: { ok: false, changed: false, code: "NOT_FOUND" },
    wasRemoved: true,
  })
  const result = await removal({ symbol: "ABCC11", assetSha256: SHA })
  assert.equal(result.status, 200)
  assert.equal(result.body.already_removed, true)
  assert.equal(result.body.republished, true)
  assert.deepEqual(calls.wasRemoved, [["ABCC11", SHA]])
  assert.deepEqual(calls.republish, ["ABCC11"])
  assert.deepEqual(calls.afterRemoval, [])
})

test("an asset that never belonged to the gene stays a 404", async () => {
  const { removal, calls } = services({
    removal: { ok: false, changed: false, code: "NOT_FOUND" },
    wasRemoved: false,
  })
  const result = await removal({ symbol: "ABCC11", assetSha256: SHA })
  assert.equal(result.status, 404)
  assert.equal(result.body.error, "Asset not found")
  assert.deepEqual(calls.republish, [])
})

test("a failed republish after a committed delete still answers success", async () => {
  const { removal, calls } = services({ republishThrows: true })
  const result = await removal({ symbol: "ABCC11", assetSha256: SHA })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.republished, false)
  assert.deepEqual(calls.republish, ["ABCC11"])
})

test("a request without an asset is refused before anything runs", async () => {
  const { removal, calls } = services()
  const result = await removal({ symbol: "ABCC11", assetSha256: "" })
  assert.equal(result.status, 400)
  assert.deepEqual(calls.remove, [])
  assert.deepEqual(calls.republish, [])
})

test("the removal composition refuses a missing service", () => {
  assert.throws(
    () => createIconoplasmCandidateRemoval({ remove: async () => ({}) }),
    /missing: wasRemoved/,
  )
})
