import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import { parseHTML } from "linkedom"

// ARCHITECTURE FENCE [IPD-008]: hover readiness ends at decoded first paint,
// not at a cache insert or a fire-and-forget prewarm message.

async function loadTooltipModule() {
  const source = await readFile(new URL("./content-tooltip.js", import.meta.url), "utf8")
  const sandbox = { globalThis: {} }
  vm.runInNewContext(source, sandbox)
  return sandbox.globalThis.IconoplasmContentTooltip
}

test("frame image requests wait for readiness and settle only on matching results, cancellation or deadlines", async () => {
  const api = await loadTooltipModule()
  const posted = []
  const timers = new Set()
  const controller = api.createPersistentFrameController({
    windowRef: {
      setTimeout(fn) {
        timers.add(fn)
        return fn
      },
      clearTimeout(fn) {
        timers.delete(fn)
      },
    },
    documentRef: {
      createElement() {
        return {
          dataset: {},
          setAttribute() {},
          contentWindow: {
            postMessage(data) {
              posted.push(data)
            },
          },
        }
      },
    },
    getHost: () => ({
      appendChild(frame) {
        frame.isConnected = true
      },
    }),
    frameUrl: "chrome-extension://test/frame.html",
    frameOrigin: "chrome-extension://test",
  })
  const url = "https://cdn.example/portrait.webp"
  const first = controller.loadImage(url, 2500)
  assert.equal(posted.length, 0)
  const frame = controller.getFrame()
  controller.markReady(frame.contentWindow)
  assert.equal(posted.length, 1)
  const result = {
    type: "ICONOPLASM_FRAME_IMAGE_RESULT",
    requestId: posted[0].requestId,
    url,
    ok: true,
  }
  assert.equal(controller.acceptImageResult({}, result), false)
  assert.equal(
    controller.acceptImageResult(frame.contentWindow, { ...result, url: "wrong" }),
    false,
  )
  assert.equal(controller.acceptImageResult(frame.contentWindow, result), true)
  assert.equal(await first, url)
  assert.equal(timers.size, 0)

  const signal = new AbortController()
  const second = controller.loadImage(url, 2500, signal.signal)
  signal.abort()
  await assert.rejects(second, { name: "AbortError" })
  assert.equal(posted.at(-1).type, "ICONOPLASM_FRAME_CANCEL_IMAGE")
  const third = controller.loadImage(url, 2500)
  timers.values().next().value()
  await assert.rejects(third, /timed out/)
  assert.equal(posted.at(-1).type, "ICONOPLASM_FRAME_CANCEL_IMAGE")
  assert.equal(timers.size, 0)
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

// B-913: the one writer of the page's transient notice (the login prompt, a refused vote).
//
// Ways this can fail, written before the code:
//  1. a second notice shown while the first is still up is cut short by the first one's timer;
//  2. the sentence goes into the page as HTML (it comes from the server's JSON);
//  3. the notice never leaves, or leaves before its duration;
//  4. an enormous message is shown whole, or a message that is not text (or is blank) puts an
//     empty notice on the page;
//  5. a missing notice element throws inside a vote callback.
function toastRig() {
  const { document } = parseHTML("<!doctype html><html><body></body></html>")
  const toast = document.createElement("div")
  toast.className = "iconoplasm-auth-toast"
  document.body.appendChild(toast)
  let nextId = 1
  const timers = new Map()
  const windowRef = {
    setTimeout(callback, delay) {
      const id = nextId++
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }
  return {
    toast,
    windowRef,
    timers,
    visible: () => toast.classList.contains("iconoplasm-auth-toast-visible"),
  }
}

test("a notice shows its text, stays for its duration and then leaves", async () => {
  const api = await loadTooltipModule()
  const rig = toastRig()
  api.showToast(rig.toast, "Voting is paused until 00:00 UTC.", {
    durationMs: 7000,
    windowRef: rig.windowRef,
  })
  assert.equal(rig.toast.textContent, "Voting is paused until 00:00 UTC.")
  assert.equal(rig.visible(), true)
  assert.equal(rig.timers.size, 1)
  assert.equal([...rig.timers.values()][0].delay, 7000)
  const [[, timer]] = [...rig.timers.entries()]
  timer.callback()
  assert.equal(rig.visible(), false)
})

test("a second notice replaces the first and gets its own full duration", async () => {
  const api = await loadTooltipModule()
  const rig = toastRig()
  api.showToast(rig.toast, "First.", { durationMs: 2600, windowRef: rig.windowRef })
  const firstTimers = [...rig.timers.keys()]
  api.showToast(rig.toast, "Second.", { durationMs: 7000, windowRef: rig.windowRef })
  assert.equal(rig.toast.textContent, "Second.")
  assert.equal(rig.timers.size, 1, "the first notice's timer must be cancelled")
  assert.equal(
    firstTimers.some((id) => rig.timers.has(id)),
    false,
  )
  assert.equal([...rig.timers.values()][0].delay, 7000)
})

test("the sentence is shown as text, never as markup", async () => {
  const api = await loadTooltipModule()
  const rig = toastRig()
  api.showToast(rig.toast, "<img src=x onerror=alert(1)><b>Paused</b>", {
    windowRef: rig.windowRef,
  })
  assert.equal(rig.toast.children.length, 0)
  assert.equal(rig.toast.textContent, "<img src=x onerror=alert(1)><b>Paused</b>")
})

test("an enormous message is bounded; a blank or non-text one shows nothing", async () => {
  const api = await loadTooltipModule()
  const rig = toastRig()
  api.showToast(rig.toast, "x".repeat(5000), { windowRef: rig.windowRef })
  assert.equal(rig.toast.textContent.length <= 300, true)
  assert.equal(rig.toast.textContent.length > 0, true)

  for (const message of [{ not: "text" }, "", "   ", null, undefined, 42]) {
    const blank = toastRig()
    api.showToast(blank.toast, message, { windowRef: blank.windowRef })
    assert.equal(blank.visible(), false, `${JSON.stringify(message)} must not open a notice`)
    assert.equal(blank.timers.size, 0)
  }
})

test("a missing notice element does nothing", async () => {
  const api = await loadTooltipModule()
  const rig = toastRig()
  assert.doesNotThrow(() => api.showToast(null, "Paused", { windowRef: rig.windowRef }))
  assert.equal(rig.timers.size, 0)
})
