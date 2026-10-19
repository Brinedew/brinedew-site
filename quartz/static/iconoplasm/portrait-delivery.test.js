import assert from "node:assert/strict"
import test from "node:test"

import { imageUrl, portraitDelivery } from "./portrait-delivery.js"

// Golden URLs as cards carry them today (B-1087).
test("images of every vintage load from the image host; other URLs are untouched", () => {
  const cases = [
    [
      "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp",
      "https://img.brinedew.bio/portraits/v1/aa/asset/medium.webp",
    ],
    [
      "https://iconoplasmportraits.b-cdn.net/portraits/v1/aa/asset/medium.webp?v=2",
      "https://img.brinedew.bio/portraits/v1/aa/asset/medium.webp?v=2",
    ],
    ["/gene-cards/TP53/thumb.webp", "https://img.brinedew.bio/gene-cards/TP53/thumb.webp"],
    [
      "https://img.brinedew.bio/portraits/v1/aa/asset/full.webp",
      "https://img.brinedew.bio/portraits/v1/aa/asset/full.webp",
    ],
    ["https://cdn.discordapp.com/avatars/1/a.png", "https://cdn.discordapp.com/avatars/1/a.png"],
    [
      "https://iconoplasmportraits.b-cdn.net/genes/v3/TP53.json",
      "https://iconoplasmportraits.b-cdn.net/genes/v3/TP53.json",
    ],
    ["data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
    ["", ""],
  ]
  for (const [input, expected] of cases) assert.equal(imageUrl(input), expected, input)
})

test("bind writes the image-host URL into each attribute", async () => {
  const attributes = new Map()
  const element = {
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  }
  portraitDelivery.bind(element, {
    src: "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp",
    srcset: "",
  })
  assert.equal(attributes.get("src"), "https://img.brinedew.bio/portraits/v1/aa/asset/medium.webp")
  assert.equal(attributes.has("srcset"), false)
  assert.equal(
    await portraitDelivery.ensure("/portraits/v1/bb/asset/thumb.webp"),
    "https://img.brinedew.bio/portraits/v1/bb/asset/thumb.webp",
  )
})
