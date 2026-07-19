import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

await import("./content-scanner.js")
await import("./content-lifecycle.js")

const nodeFilter = {
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
}

function exactGeneMatcher(symbols) {
  return {
    findMatches(text) {
      const matches = []
      for (const symbol of symbols) {
        let index = String(text).indexOf(symbol)
        while (index >= 0) {
          matches.push({ symbol, index, length: symbol.length })
          index = String(text).indexOf(symbol, index + symbol.length)
        }
      }
      return matches.sort((left, right) => left.index - right.index)
    },
  }
}

function createRuntime(html, options = {}) {
  const { document, window } = parseHTML(html)
  const geneMap = {
    TP53: { c: "#123456" },
    BRCA1: { c: "#654321" },
    EGFR: { c: "#abcdef" },
  }
  const scanner = globalThis.IconoplasmContentScanner.createPageScanner({
    documentRef: document,
    nodeFilter,
    getGeneMap: () => geneMap,
    getMatcher: () => exactGeneMatcher(Object.keys(geneMap)),
  })
  const controller = globalThis.IconoplasmContentLifecycle.createMutationScanController({
    documentRef: document,
    windowRef: window,
    MutationObserverCtor: options.MutationObserverCtor || window.MutationObserver,
    scanPage: scanner.scanPage,
    shouldIgnoreNode(node) {
      const element = node?.nodeType === 3 ? node.parentElement : node
      return !element || Boolean(element.closest?.(".iconoplasm-gene"))
    },
  })
  return { document, window, scanner, controller }
}

function settleMutations(window) {
  return new Promise((resolve) => window.setTimeout(resolve, 20))
}

test("scanner accepts a text node as a dirty root", () => {
  const { document, scanner } = createRuntime("<html><body><div id='row'>TP53</div></body></html>")
  const textNode = document.querySelector("#row").firstChild

  assert.equal(scanner.scanPage(textNode), 1)
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 1)
  assert.equal(document.querySelector(".iconoplasm-gene").dataset.geneLabel, "TP53")
})

test("pagination-style textContent replacement is re-highlighted", async () => {
  const { document, window, scanner, controller } = createRuntime(
    "<html><body><div id='row'>TP53</div></body></html>",
  )
  controller.start()
  scanner.scanPage(document.body)
  await settleMutations(window)

  document.querySelector("#row").textContent = "BRCA1"
  await settleMutations(window)

  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 1)
  assert.equal(document.querySelector(".iconoplasm-gene").dataset.geneLabel, "BRCA1")
  controller.stop()
})

test("virtualized-row character data changes are re-highlighted", async () => {
  let mutationCallback
  let observedOptions
  class CapturingMutationObserver {
    constructor(callback) {
      mutationCallback = callback
    }
    observe(_root, options) {
      observedOptions = options
    }
    disconnect() {}
  }
  const { document, window, controller } = createRuntime(
    "<html><body><div id='row'>ordinary text</div></body></html>",
    { MutationObserverCtor: CapturingMutationObserver },
  )
  controller.start()
  const textNode = document.querySelector("#row").firstChild
  textNode.data = "EGFR"
  mutationCallback([{ type: "characterData", target: textNode }])
  await settleMutations(window)

  assert.equal(observedOptions.characterData, true)
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 1)
  assert.equal(document.querySelector(".iconoplasm-gene").dataset.geneLabel, "EGFR")
  controller.stop()
})

test("gene-data messaging times out and ignores a late callback", async () => {
  let callback
  const chromeApi = {
    runtime: {
      lastError: null,
      sendMessage(_message, responseCallback) {
        callback = responseCallback
      },
    },
  }

  const result = await globalThis.IconoplasmContentLifecycle.requestGeneData(chromeApi, {
    timeoutMs: 10,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  })
  callback({ genes: { TP53: {} } })

  assert.equal(result, null)
})
