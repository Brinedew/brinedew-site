import assert from "node:assert/strict"
import test from "node:test"

import { createEmulsionFavoriteStore, normalizeEmulsionFamilyId } from "./emulsion-favorites.js"

test("favorite IDs normalize edited emulsion variants to their visible family", () => {
  assert.equal(normalizeEmulsionFamilyId(" a1-255-e-e "), "A1-255")
  assert.equal(normalizeEmulsionFamilyId("../../bad"), "")
})

test("favorite store updates optimistically and persists the final state", async () => {
  var writes = []
  var store = createEmulsionFavoriteStore({
    readFavorites: async function () {
      return { favorite_emulsion_ids: ["A1-255"] }
    },
    writeFavorite: async function (id, favorite) {
      writes.push([id, favorite])
    },
  })
  await store.load()
  assert.equal(store.has("A1-255-e"), true)
  var promise = store.toggle("A1-306")
  assert.equal(store.has("A1-306"), true)
  assert.equal(store.isPending("A1-306"), true)
  await promise
  assert.deepEqual(writes, [["A1-306", true]])
  assert.equal(store.isPending("A1-306"), false)
})

test("favorite store rolls back a failed optimistic write", async () => {
  var store = createEmulsionFavoriteStore({
    readFavorites: async function () {
      return { favorite_emulsion_ids: ["A1-255"] }
    },
    writeFavorite: async function () {
      throw new Error("network down")
    },
  })
  await store.load()
  await assert.rejects(store.toggle("A1-255"), /network down/)
  assert.equal(store.has("A1-255"), true)
  assert.equal(store.isPending("A1-255"), false)
})
