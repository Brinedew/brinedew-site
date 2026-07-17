import assert from "node:assert/strict"
import test from "node:test"

import { createPortraitDelivery } from "./portrait-delivery.js"

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
  }
}

function controlledImages() {
  const images = []
  class ControlledImage {
    constructor() {
      images.push(this)
      this.onload = null
      this.onerror = null
      this._src = ""
    }
    set src(value) {
      this._src = value
    }
    get src() {
      return this._src
    }
  }
  return { ImageCtor: ControlledImage, images }
}

test("one failed primary probe switches 100 simultaneous portraits to the fallback", async () => {
  const storage = memoryStorage()
  const controlled = controlledImages()
  const delivery = createPortraitDelivery({
    sessionStorageRef: storage,
    ImageCtor: controlled.ImageCtor,
    timeoutMs: 10_000,
  })
  const requests = Array.from({ length: 100 }, (_, index) =>
    delivery.ensure(
      `https://iconoplasmportraits.b-cdn.net/portraits/v1/${String(index).padStart(2, "0")}.webp`,
    ),
  )

  assert.equal(controlled.images.length, 1)
  controlled.images[0].onerror()
  const resolved = await Promise.all(requests)

  assert.equal(controlled.images.length, 1)
  assert.ok(resolved.every((url) => url.startsWith("https://iconoplasm.brinedew.bio/portraits/")))
  assert.equal(delivery.state().source, "fallback")
})

test("one successful primary probe releases every portrait to Bunny", async () => {
  const controlled = controlledImages()
  const delivery = createPortraitDelivery({
    sessionStorageRef: memoryStorage(),
    ImageCtor: controlled.ImageCtor,
    timeoutMs: 10_000,
  })
  const requests = Array.from({ length: 100 }, (_, index) =>
    delivery.ensure(`https://iconoplasm.brinedew.bio/portraits/v1/${index}.webp`),
  )

  assert.equal(controlled.images.length, 1)
  controlled.images[0].onload()
  const resolved = await Promise.all(requests)

  assert.ok(
    resolved.every((url) => url.startsWith("https://iconoplasmportraits.b-cdn.net/portraits/")),
  )
  assert.equal(delivery.state().source, "primary")
})

test("the head-started gene probe is adopted instead of duplicated", async () => {
  const controlled = controlledImages()
  let settleHeadProbe
  const headProbe = new Promise((resolve) => {
    settleHeadProbe = resolve
  })
  const delivery = createPortraitDelivery({
    sessionStorageRef: memoryStorage(),
    ImageCtor: controlled.ImageCtor,
  })
  delivery.adopt(headProbe)
  const requests = Array.from({ length: 100 }, (_, index) =>
    delivery.ensure(`https://iconoplasmportraits.b-cdn.net/portraits/v1/head-${index}.webp`),
  )

  assert.equal(controlled.images.length, 0)
  settleHeadProbe("fallback")
  const resolved = await Promise.all(requests)

  assert.equal(controlled.images.length, 0)
  assert.ok(resolved.every((url) => url.startsWith("https://iconoplasm.brinedew.bio/portraits/")))
})

test("the chosen source survives reloads in the same tab without another probe", async () => {
  const storage = memoryStorage()
  const firstImages = controlledImages()
  const first = createPortraitDelivery({
    sessionStorageRef: storage,
    ImageCtor: firstImages.ImageCtor,
    timeoutMs: 10_000,
  })
  const initial = first.ensure("https://iconoplasmportraits.b-cdn.net/portraits/v1/a.webp")
  firstImages.images[0].onerror()
  await initial

  const reloadImages = controlledImages()
  const reload = createPortraitDelivery({
    sessionStorageRef: storage,
    ImageCtor: reloadImages.ImageCtor,
  })
  const resolved = await reload.ensure("https://iconoplasmportraits.b-cdn.net/portraits/v1/b.webp")

  assert.equal(reloadImages.images.length, 0)
  assert.equal(resolved, "https://iconoplasm.brinedew.bio/portraits/v1/b.webp")
})

test("both failed sources do not create an infinite source flip", () => {
  const delivery = createPortraitDelivery({ sessionStorageRef: memoryStorage(), ImageCtor: null })
  delivery.markFailed("primary")
  assert.equal(delivery.state().source, "fallback")
  delivery.markFailed("fallback")
  assert.equal(delivery.state().source, "fallback")
  assert.deepEqual(delivery.state().failed.sort(), ["fallback", "primary"])
})
