import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: hover readiness ends at decoded first paint,
// not at a cache insert or a fire-and-forget prewarm message.

async function loadTooltipModule() {
  const source = await readFile(new URL("./content-tooltip.js", import.meta.url), "utf8")
  const sandbox = { globalThis: {} }
  vm.runInNewContext(source, sandbox)
  return sandbox.globalThis.IconoplasmContentTooltip
}

test("background callbacks use browser background priority and can be superseded", async () => {
  const tooltipModule = await loadTooltipModule()
  const posted = []
  let runTask
  const windowRef = {
    scheduler: {
      postTask(task, options) {
        posted.push(options)
        runTask = task
        return new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("superseded"), { name: "AbortError" })),
            { once: true },
          )
        })
      },
    },
  }
  const controller = new AbortController()
  let ran = false
  const scheduled = tooltipModule.postBackgroundTask(
    () => {
      ran = true
    },
    { windowRef, signal: controller.signal, delay: 25 },
  )

  assert.equal(posted.length, 1)
  assert.equal(posted[0].priority, "background")
  assert.equal(posted[0].delay, 25)
  assert.equal(posted[0].signal, controller.signal)
  controller.abort()
  assert.equal(await scheduled, false)
  assert.equal(ran, false)
  assert.equal(typeof runTask, "function")
})

test("one persistent renderer survives retries and rejects stale or raw portrait payloads", async () => {
  const tooltipModule = await loadTooltipModule()
  const posted = []
  const host = {
    children: [],
    appendChild(node) {
      node.isConnected = true
      node.parentNode = this
      this.children.push(node)
      return node
    },
  }
  let createCount = 0
  const documentRef = {
    createElement(tagName) {
      assert.equal(tagName, "iframe")
      createCount += 1
      const classes = new Set()
      const attributes = new Map()
      return {
        isConnected: false,
        dataset: {},
        className: "",
        classList: {
          add(value) {
            classes.add(value)
          },
          remove(value) {
            classes.delete(value)
          },
          contains(value) {
            return classes.has(value)
          },
        },
        setAttribute(name, value) {
          attributes.set(name, String(value))
        },
        removeAttribute(name) {
          attributes.delete(name)
        },
        hasAttribute(name) {
          return attributes.has(name)
        },
        contentWindow: {
          postMessage(message, origin) {
            posted.push({ message, origin })
          },
        },
      }
    },
  }
  const controller = tooltipModule.createPersistentFrameController({
    documentRef,
    getHost: () => host,
    frameUrl: "chrome-extension://test/lit-archival-frame.html",
    frameOrigin: "chrome-extension://test",
  })

  // Initialization retry and rich -> simple -> rich reuse one browsing context.
  const firstFrame = controller.ensure()
  const firstWindow = firstFrame.contentWindow
  assert.equal(controller.ensure(), firstFrame)
  controller.show("A hover card")
  controller.park()
  assert.equal(controller.show("A hover card"), firstFrame)
  assert.equal(controller.getFrame().contentWindow, firstWindow)
  assert.equal(createCount, 1)
  assert.equal(host.children.length, 1)

  // Cold payloads may carry the raw URL only as an adapter request input. The
  // renderer receives neither that URL nor a model-level fallback while cold.
  const rawPortraitUrl = "https://iconoplasm.example/portraits/A/medium.webp"
  const portraitState = tooltipModule.createAdapterOwnedPortraitState(rawPortraitUrl, "")
  assert.equal(portraitState.requestSrc, rawPortraitUrl)
  assert.equal(portraitState.frameSrc, "")
  const coldA1 = {
    requestId: "A-1",
    symbol: "A",
    portraitSrc: portraitState.frameSrc,
    model: { portraitSrc: portraitState.frameSrc },
  }
  const pendingB2 = { requestId: "B-2", symbol: "B", portraitSrc: "" }
  controller.post(coldA1)
  controller.post(pendingB2)
  assert.equal(posted.length, 0)
  assert.equal(JSON.stringify(firstFrame.__iconoPendingPayload).includes(rawPortraitUrl), false)

  // READY flushes exactly the newest pending request and makes its identity authoritative.
  assert.equal(controller.markReady(firstWindow), true)
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    {
      message: pendingB2,
      origin: "chrome-extension://test",
    },
  ])
  assert.equal(firstFrame.dataset.iconoFrameActiveRequest, "B-2")

  let resolveOldA
  let resolveNewA
  const oldA = new Promise((resolve) => {
    resolveOldA = resolve
  })
  const newA = new Promise((resolve) => {
    resolveNewA = resolve
  })

  controller.post({ requestId: "A-1", symbol: "A", portraitSrc: "" })
  const oldHydration = controller.postHydrated("A-1", oldA, (source) => ({
    requestId: "A-1",
    symbol: "A",
    portraitSrc: source,
  }))
  controller.post({ requestId: "B-2", symbol: "B", portraitSrc: "" })
  controller.post({ requestId: "A-3", symbol: "A", portraitSrc: "" })
  const newHydration = controller.postHydrated("A-3", newA, (source) => ({
    requestId: "A-3",
    symbol: "A",
    portraitSrc: source,
  }))

  resolveOldA("data:image/webp;base64,old-a")
  assert.equal(await oldHydration, false)
  assert.equal(
    posted.some((entry) => entry.message.portraitSrc === "data:image/webp;base64,old-a"),
    false,
  )

  resolveNewA("data:image/webp;base64,new-a")
  assert.equal(await newHydration, true)
  assert.equal(posted.at(-1).message.requestId, "A-3")
  assert.equal(posted.at(-1).message.portraitSrc, "data:image/webp;base64,new-a")
  assert.equal(createCount, 1)
})

test("newly shown cards wait 500ms before they can navigate", async () => {
  const [content, frame, css] = await Promise.all([
    readFile(new URL("./content.js", import.meta.url), "utf8"),
    readFile(new URL("./lit-archival-frame.js", import.meta.url), "utf8"),
    readFile(new URL("./content.css", import.meta.url), "utf8"),
  ])

  assert.match(content, /TOOLTIP_NAVIGATION_DELAY_MS = 500/)
  assert.match(content, /tooltipNavigationArmedAt = Date\.now\(\) \+ TOOLTIP_NAVIGATION_DELAY_MS/)
  assert.match(content, /Date\.now\(\) < tooltipNavigationArmedAt/)
  assert.match(content, /navigationArmedAt: tooltipNavigationArmedAt/)
  assert.match(frame, /Date\.now\(\) < Number\([\s\S]*navigationArmedAt/)
  assert.doesNotMatch(css, /touch-sheet|tooltip-backdrop/)
})

test("raw file PDF wrappers do not initialize a second extension surface", async () => {
  const content = await readFile(new URL("./content.js", import.meta.url), "utf8")

  assert.match(content, /window\.location\.protocol === "file:"/)
  assert.match(content, /if \(isOuterRawFilePdfDocument\) return/)
})

test("hover portrait discovery is snapshot-keyed and independent of rich-detail success", async () => {
  const content = await readFile(new URL("./content.js", import.meta.url), "utf8")

  assert.match(
    content,
    /ICONOPLASM_PORTRAIT_LOCATOR_PREFIX\}\$\{encodeURIComponent\(revision\)\}\/portraits\//,
  )
  assert.match(content, /adoptCardSnapshotRevision\(payload\.cardSnapshotVersion\)/)
  assert.match(content, /changes\.iconoplasm_card_snapshot_version\?\.newValue/)
  assert.match(content, /REFRESH_CARD_SNAPSHOT/)
  assert.match(content, /retryVisible && activeTooltipAnchor\?\.isConnected/)
  assert.match(content, /portraitLocatorStore\.hydratePersistentCache\(\)/)
  assert.match(content, /const hoverGeneDetailPromise =/)
  assert.match(content, /const hoverPortraitLocatorPromise =/)
  assert.match(content, /hoverPortraitLocatorPromise\.then\(\(portraitLocator\) =>/)
  assert.match(content, /published portrait locator\/detail mismatch; portrait suppressed/)
})

test("DO NOT DELETE: extension fonts resolve from the extension runtime on every host", async () => {
  const [css, runtimeSource, manifestSource, frameHtml, pdfReaderHtml] = await Promise.all([
    readFile(new URL("./generated/shared-card-label.css", import.meta.url), "utf8"),
    readFile(new URL("./generated/iconoplasm-font-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("./manifest.json", import.meta.url), "utf8"),
    readFile(new URL("./lit-archival-frame.html", import.meta.url), "utf8"),
    readFile(new URL("./pdf-reader.html", import.meta.url), "utf8"),
  ])
  const addedFaces = []
  const requestedPaths = []
  const warnings = []
  class FakeFontFace {
    constructor(family, source, descriptors) {
      this.family = family
      this.source = source
      this.descriptors = descriptors
    }
  }
  const sandbox = {
    chrome: {
      runtime: {
        getURL(path) {
          requestedPaths.push(path)
          return `chrome-extension://unit-test/${path}`
        },
      },
    },
    console: { warn: (...args) => warnings.push(args) },
    document: {
      fonts: {
        add(face) {
          addedFaces.push(face)
        },
      },
    },
    FontFace: FakeFontFace,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtimeSource, sandbox)

  assert.equal(addedFaces.length, 5)
  assert.deepEqual(requestedPaths, [
    "fonts/IBMPlexMono-Regular.woff2",
    "fonts/IBMPlexMono-Medium.woff2",
    "fonts/LeagueSpartan-800.woff2",
    "fonts/SpecialElite-Regular.woff2",
    "fonts/Caveat-400.woff2",
  ])
  for (const face of addedFaces) {
    assert.match(face.source, /^url\("chrome-extension:\/\/unit-test\/fonts\//)
    assert.equal(face.descriptors.display, "swap")
    assert.equal(face.descriptors.style, "normal")
  }
  assert.deepEqual(Array.from(sandbox.IconoplasmExtensionFonts.install()), [])
  const failedInstall = sandbox.IconoplasmExtensionFonts.install({
    FontFaceCtor: class BrokenFontFace {
      constructor() {
        throw new Error("synthetic font failure")
      }
    },
    fontSet: { add() {} },
    runtime: sandbox.chrome.runtime,
  })
  assert.deepEqual(Array.from(failedInstall), [])
  assert.equal(warnings.length, 1)

  const firefoxFaces = []
  const firefoxSandbox = {
    browser: {
      runtime: {
        getURL(path) {
          return `moz-extension://unit-test/${path}`
        },
      },
    },
    console: { warn() {} },
    document: { fonts: { add: (face) => firefoxFaces.push(face) } },
    FontFace: FakeFontFace,
  }
  firefoxSandbox.globalThis = firefoxSandbox
  vm.runInNewContext(runtimeSource, firefoxSandbox)
  assert.equal(firefoxFaces.length, 5)
  for (const face of firefoxFaces) {
    assert.match(face.source, /^url\("moz-extension:\/\/unit-test\/fonts\//)
  }

  assert.doesNotMatch(runtimeSource, /__MSG_@@extension_id__|(?:chrome|moz|safari-web)-extension:/)
  assert.doesNotMatch(css, /(?:^|\n)\s*@font-face\s*\{/)
  assert.doesNotMatch(css, /\.\.\/fonts\//)

  const manifest = JSON.parse(manifestSource)
  const contentScripts = manifest.content_scripts.find((entry) =>
    entry.matches?.includes("<all_urls>"),
  )
  assert.ok(contentScripts)
  assert.ok(
    contentScripts.js.indexOf("generated/iconoplasm-font-runtime.js") <
      contentScripts.js.indexOf("content.js"),
  )
  const exposedResources = manifest.web_accessible_resources.flatMap((entry) => entry.resources)
  assert.ok(exposedResources.includes("generated/iconoplasm-font-runtime.js"))
  assert.ok(
    frameHtml.indexOf('src="generated/iconoplasm-font-runtime.js"') <
      frameHtml.indexOf('href="generated/shared-card-label.css"'),
  )
  assert.ok(
    pdfReaderHtml.indexOf('src="generated/iconoplasm-font-runtime.js"') <
      pdfReaderHtml.indexOf('href="generated/shared-card-label.css"'),
  )
})

test("image-only identity is visible before portrait readiness and hover motion stays sub-perceptual", async () => {
  const [frameHtml, css] = await Promise.all([
    readFile(new URL("./lit-archival-frame.html", import.meta.url), "utf8"),
    readFile(new URL("./content.css", import.meta.url), "utf8"),
  ])

  assert.match(frameHtml, /#iconoplasm-root \.icono-image-only-overlay\s*\{\s*opacity:\s*1;/)
  assert.match(css, /opacity 60ms linear/)
  assert.match(css, /transform 60ms cubic-bezier/)
})

test("frame prewarm acknowledges decoded paint readiness and defers rough decoration", async () => {
  const frameSource = await readFile(new URL("./lit-archival-frame.js", import.meta.url), "utf8")
  const posted = []
  const listeners = new Map()
  const rafQueue = []
  let releaseDecode
  let roughHydrationCount = 0
  const slot = {
    markup: "",
    replaceChildren(fragment) {
      this.markup = String((fragment && fragment.markup) || "")
    },
    querySelectorAll() {
      return []
    },
    querySelector() {
      return null
    },
  }
  const frameRoot = { classList: { remove() {} } }
  const documentRef = {
    body: {},
    documentElement: { setAttribute() {} },
    getElementById(id) {
      return id === "lit-archival-card-slot" ? slot : frameRoot
    },
    createRange() {
      return {
        selectNodeContents() {},
        createContextualFragment(markup) {
          return { markup }
        },
      }
    },
    addEventListener() {},
  }
  class FakeImage {
    constructor() {
      this.handlers = new Map()
    }
    addEventListener(type, callback) {
      this.handlers.set(type, callback)
    }
    set src(_value) {
      queueMicrotask(() => this.handlers.get("load")?.())
    }
    decode() {
      return new Promise((resolve) => {
        releaseDecode = resolve
      })
    }
  }
  class FakeElement {}
  const parent = {
    postMessage(message) {
      posted.push(message)
    },
  }
  const sandbox = {
    console,
    document: documentRef,
    Image: FakeImage,
    Element: FakeElement,
    parent,
    requestAnimationFrame(callback) {
      rafQueue.push(callback)
      return rafQueue.length
    },
    addEventListener(type, callback) {
      listeners.set(type, callback)
    },
    IconoplasmCardShared: {
      escapeHtml(value) {
        return String(value == null ? "" : value)
      },
      hydrateRoughLoops() {
        roughHydrationCount += 1
      },
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(frameSource, sandbox)

  const portraitSrc = "data:image/webp;base64,paint-ready"
  listeners.get("message")({
    data: { type: "ICONOPLASM_LIT_ARCHIVAL_PREWARM", sources: [portraitSrc] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    posted.some((message) => message.type === "ICONOPLASM_LIT_ARCHIVAL_PREWARMED"),
    false,
  )

  releaseDecode()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    posted.some((message) => message.type === "ICONOPLASM_LIT_ARCHIVAL_PREWARMED"),
    false,
  )
  rafQueue.shift()?.(0)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    JSON.stringify(
      posted.find((message) => message.type === "ICONOPLASM_LIT_ARCHIVAL_PREWARMED")?.sources,
    ),
    JSON.stringify([portraitSrc]),
  )

  listeners.get("message")({
    data: {
      type: "ICONOPLASM_LIT_ARCHIVAL_RENDER",
      requestId: "1",
      cardVariant: "image-only",
      symbol: "TP53",
      pageUrl: "https://example.test/gene/TP53",
      gene: { symbol: "TP53", full_name: "tumor protein p53" },
      portraitSrc,
      portraitDimensions: { width: 384, height: 512 },
    },
  })
  assert.match(slot.markup, /icono-image-only-link--loaded/)
  assert.match(slot.markup, /tumor protein p53/)
  assert.equal(roughHydrationCount, 0)
  rafQueue.shift()?.(0)
  assert.equal(roughHydrationCount, 0)
  rafQueue.shift()?.(0)
  assert.equal(roughHydrationCount, 1)
})
