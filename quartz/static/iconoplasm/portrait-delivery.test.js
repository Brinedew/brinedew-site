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

function fakeDocument() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    dispatchError(target) {
      listeners.get("error")?.({ target })
    },
  }
}

function fakeImage() {
  const attributes = new Map()
  return {
    tagName: "IMG",
    isConnected: true,
    currentSrc: "",
    getAttribute(name) {
      return attributes.get(name) || ""
    },
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
  }
}

test("one failed accelerator probe switches 100 simultaneous portraits to canonical URLs", async () => {
  const controlled = controlledImages()
  const delivery = createPortraitDelivery({
    sessionStorageRef: memoryStorage(),
    ImageCtor: controlled.ImageCtor,
  })
  const requests = Array.from({ length: 100 }, (_, index) =>
    delivery.ensure(`https://iconoplasm.brinedew.bio/portraits/v1/${index}.webp`),
  )

  await Promise.resolve()
  assert.equal(controlled.images.length, 1)
  controlled.images[0].onerror()
  const resolved = await Promise.all(requests)

  assert.ok(resolved.every((url) => url.startsWith("https://iconoplasm.brinedew.bio/portraits/")))
  assert.deepEqual(delivery.state(), { state: "canonical", failed: ["accelerator"] })
})

test("one successful accelerator probe releases every portrait to Bunny", async () => {
  const controlled = controlledImages()
  const delivery = createPortraitDelivery({
    sessionStorageRef: memoryStorage(),
    ImageCtor: controlled.ImageCtor,
  })
  const requests = Array.from({ length: 100 }, (_, index) =>
    delivery.ensure(`https://iconoplasm.brinedew.bio/portraits/v1/${index}.webp`),
  )

  await Promise.resolve()
  controlled.images[0].onload()
  const resolved = await Promise.all(requests)

  assert.ok(
    resolved.every((url) => url.startsWith("https://iconoplasmportraits.b-cdn.net/portraits/")),
  )
  assert.deepEqual(delivery.state(), { state: "accelerator", failed: [] })
})

test("the source decision survives reloads in the same tab", async () => {
  const storage = memoryStorage()
  const controlled = controlledImages()
  const first = createPortraitDelivery({
    sessionStorageRef: storage,
    ImageCtor: controlled.ImageCtor,
  })
  const initial = first.ensure("https://iconoplasm.brinedew.bio/portraits/v1/a.webp")
  await Promise.resolve()
  controlled.images[0].onerror()
  await initial

  const reload = createPortraitDelivery({
    sessionStorageRef: storage,
    ImageCtor: controlledImages().ImageCtor,
  })
  assert.equal(
    await reload.ensure("https://iconoplasm.brinedew.bio/portraits/v1/b.webp"),
    "https://iconoplasm.brinedew.bio/portraits/v1/b.webp",
  )
})

test("a late accelerator URL is rebound after the tab already chose canonical delivery", async () => {
  const controlled = controlledImages()
  const delivery = createPortraitDelivery({
    sessionStorageRef: memoryStorage(),
    ImageCtor: controlled.ImageCtor,
  })
  const initial = delivery.ensure("https://iconoplasm.brinedew.bio/portraits/v1/before.webp")
  await Promise.resolve()
  controlled.images[0].onerror()
  await initial

  const documentRef = fakeDocument()
  const after = fakeImage()
  delivery.install(documentRef)
  delivery.bind(after, "https://iconoplasmportraits.b-cdn.net/portraits/v1/after.webp")
  assert.equal(after.getAttribute("src"), "https://iconoplasm.brinedew.bio/portraits/v1/after.webp")

  after.setAttribute("src", "https://iconoplasmportraits.b-cdn.net/portraits/v1/after.webp")
  documentRef.dispatchError(after)
  assert.equal(after.getAttribute("src"), "https://iconoplasm.brinedew.bio/portraits/v1/after.webp")
})

test("both failed sources enter terminal failure without flipping forever", () => {
  const delivery = createPortraitDelivery({ sessionStorageRef: memoryStorage(), ImageCtor: null })
  delivery.reportFailure("https://iconoplasmportraits.b-cdn.net/portraits/v1/a.webp")
  delivery.reportFailure("https://iconoplasm.brinedew.bio/portraits/v1/a.webp")
  assert.deepEqual(delivery.state(), {
    state: "terminal_failure",
    failed: ["accelerator", "canonical"],
  })
})
