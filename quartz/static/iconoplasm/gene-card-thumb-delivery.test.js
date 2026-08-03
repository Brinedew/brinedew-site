import assert from "node:assert/strict"
import test from "node:test"

import { installGeneCardThumbnailDelivery } from "./gene-card-thumb-delivery.js"

test("archive thumbnails bind through the shared tab-scoped delivery policy", async () => {
  const canonical =
    "https://iconoplasm.brinedew.bio/gene-cards/v1/T/TP53/fingerprint/TP53-iconoplasm-gene-card.png"
  const image = {
    getAttribute(name) {
      return name === "data-iconoplasm-canonical-image-src" ? canonical : ""
    },
  }
  const calls = []
  const delivery = {
    install(documentRef) {
      calls.push(["install", documentRef])
    },
    bind(target, url) {
      calls.push(["bind", target, url])
    },
    async ensure(url) {
      calls.push(["ensure", url])
      return url
    },
  }
  const documentRef = {
    querySelectorAll(selector) {
      assert.equal(selector, "img.gene-card-thumb[data-iconoplasm-canonical-image-src]")
      return [image]
    },
  }

  const result = await installGeneCardThumbnailDelivery({ documentRef, delivery })

  assert.equal(result[0].status, "fulfilled")
  assert.deepEqual(
    calls.map(([name]) => name),
    ["install", "bind", "ensure", "bind"],
  )
  assert.deepEqual(
    calls.filter(([name]) => name === "bind").map(([, target, url]) => [target, url]),
    [
      [image, canonical],
      [image, canonical],
    ],
  )
  assert.deepEqual(
    calls.find(([name]) => name === "ensure"),
    ["ensure", canonical],
  )
})
