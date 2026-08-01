import assert from "node:assert/strict"
import test from "node:test"

import { buildIconoplasmCollectionVisibleUrl } from "./iconoplasm-collection-route-state.js"

test("default gallery progress stays out of the visible URL", () => {
  assert.equal(
    buildIconoplasmCollectionVisibleUrl(
      "https://iconoplasm.brinedew.bio/?order=newest&page=7&after=opaque&offset=72&cursor=old&anchor=TP53&anchorOffset=-210&utm_source=launch#gallery",
      {
        order: "newest",
        defaultOrder: "newest",
        scope: "personal",
        seed: "ignored",
      },
    ),
    "/?utm_source=launch#gallery",
  )
})

test("shareable collection choices remain visible without scroll coordinates", () => {
  assert.equal(
    buildIconoplasmCollectionVisibleUrl(
      "https://iconoplasm.brinedew.bio/?page=3&offset=24&anchor=PRL&anchorOffset=90&campaign=summer",
      {
        order: "random",
        defaultOrder: "newest",
        scope: "shared",
        seed: "stable-seed",
      },
    ),
    "/?campaign=summer&order=random&scope=shared&seed=stable-seed",
  )
})

test("non-random collection routes never leak a stale random seed", () => {
  assert.equal(
    buildIconoplasmCollectionVisibleUrl(
      "https://iconoplasm.brinedew.bio/?order=random&seed=stale&page=2",
      {
        order: "symbol",
        defaultOrder: "newest",
        scope: "personal",
        seed: "stale",
      },
    ),
    "/?order=symbol",
  )
})
