import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const byteStoreSource = readFileSync(new URL("./pdf-byte-store.js", import.meta.url), "utf8")
const ownershipSource = readFileSync(new URL("./pdf-gecko-ownership.js", import.meta.url), "utf8")

function makeRuntime({ enabled = true } = {}) {
  const listeners = {
    before: null,
    headers: null,
    message: null,
    navigation: null,
    storage: null,
  }
  const filters = []
  const tabUpdates = []
  const browser = {
    runtime: {
      id: "firefox-local-pdf-probe@brinedew.bio",
      getURL(path) {
        return `moz-extension://test/${path}`
      },
      onMessage: {
        addListener(listener) {
          listeners.message = listener
        },
      },
    },
    storage: {
      local: { get: async () => ({ iconoplasm_pdf_highlighting_enabled: enabled }) },
      onChanged: {
        addListener(listener) {
          listeners.storage = listener
        },
      },
    },
    tabs: {
      async update(tabId, update) {
        tabUpdates.push({ tabId, update })
      },
    },
    webNavigation: {
      onBeforeNavigate: {
        addListener(listener) {
          listeners.navigation = listener
        },
      },
    },
    webRequest: {
      filterResponseData(requestId) {
        const writes = []
        const filter = {
          requestId,
          writes,
          write(bytes) {
            writes.push(bytes)
          },
          close() {
            filter.closed = true
          },
          disconnect() {
            filter.disconnected = true
          },
        }
        filters.push(filter)
        return filter
      },
      onBeforeRequest: {
        addListener(listener, filter, extraInfo) {
          listeners.before = listener
          listeners.beforeFilter = filter
          listeners.beforeExtraInfo = extraInfo
        },
      },
      onHeadersReceived: {
        addListener(listener, filter, extraInfo) {
          listeners.headers = listener
          listeners.filter = filter
          listeners.extraInfo = extraInfo
        },
      },
    },
  }
  const context = vm.createContext({
    browser,
    console,
    crypto: { randomUUID: () => "source-1" },
    Date,
    Map,
    Set,
    setTimeout() {},
    TextEncoder,
    Uint8Array,
    URL,
  })
  vm.runInContext(byteStoreSource, context, { filename: "pdf-byte-store.js" })
  vm.runInContext(ownershipSource, context, { filename: "pdf-gecko-ownership.js" })
  return { context, browser, listeners, filters, tabUpdates }
}

test("Firefox routes enabled top-level local PDFs into the private manual reader", async () => {
  const runtime = makeRuntime()
  await Promise.resolve()
  runtime.listeners.navigation({
    frameId: 0,
    tabId: 12,
    url: "file:///D:/Papers/BRCA1%20review.PDF",
  })
  await Promise.resolve()
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.tabUpdates)), [
    {
      tabId: 12,
      update: {
        url: "moz-extension://test/pdf-reader.html?geckoLocalFile=file%3A%2F%2F%2FD%3A%2FPapers%2FBRCA1%2520review.PDF",
      },
    },
  ])

  runtime.listeners.navigation({ frameId: 1, tabId: 12, url: "file:///D:/Papers/TP53.pdf" })
  runtime.listeners.navigation({ frameId: 0, tabId: 12, url: "file:///D:/Papers/notes.txt" })
  assert.equal(runtime.tabUpdates.length, 1)
})

test("Firefox leaves local PDFs native when PDF highlighting is disabled", async () => {
  const runtime = makeRuntime({ enabled: false })
  await Promise.resolve()
  runtime.listeners.navigation({ frameId: 0, tabId: 12, url: "file:///D:/Papers/TP53.pdf" })
  await Promise.resolve()
  assert.deepEqual(runtime.tabUpdates, [])
})

test("Firefox never opens a response filter for local file navigation", async () => {
  const runtime = makeRuntime()
  await Promise.resolve()
  assert.equal(
    runtime.listeners.before({
      requestId: "local-file",
      tabId: 12,
      url: "file:///D:/Papers/TP53.pdf",
    }),
    undefined,
  )
  assert.equal(runtime.filters.length, 0)
})

test("Firefox driver captures one complete PDF and emits only the inert shell", async () => {
  const runtime = makeRuntime()
  await Promise.resolve()
  runtime.listeners.before({
    requestId: "request-1",
    tabId: 9,
    url: "https://example.test/paper.pdf",
  })
  assert.equal(
    JSON.stringify(runtime.listeners.filter),
    JSON.stringify({ urls: ["<all_urls>"], types: ["main_frame"] }),
  )
  assert.equal(
    JSON.stringify(runtime.listeners.beforeFilter),
    JSON.stringify({ urls: ["<all_urls>"], types: ["main_frame"] }),
  )
  assert.equal(JSON.stringify(runtime.listeners.beforeExtraInfo), JSON.stringify(["blocking"]))
  assert.equal(
    JSON.stringify(runtime.listeners.extraInfo),
    JSON.stringify(["blocking", "responseHeaders"]),
  )

  const result = runtime.listeners.headers({
    requestId: "request-1",
    tabId: 9,
    url: "https://example.test/paper.pdf",
    statusCode: 200,
    responseHeaders: [
      { name: "Content-Type", value: "application/pdf" },
      { name: "Content-Length", value: "6" },
      { name: "Content-Encoding", value: "gzip" },
      { name: "X-Test", value: "kept" },
    ],
  })
  assert.equal(runtime.filters.length, 1)
  assert.match(
    result.responseHeaders.find((header) => header.name === "Content-Type").value,
    /^text\/html/,
  )
  assert.equal(
    result.responseHeaders.some((header) => header.name.toLowerCase() === "content-length"),
    false,
  )

  runtime.filters[0].ondata({ event: "data", data: Uint8Array.from([1, 2, 3]).buffer })
  runtime.filters[0].ondata({ event: "data", data: Uint8Array.from([4, 5, 6]).buffer })
  runtime.filters[0].onstop()
  assert.equal(runtime.filters[0].closed, true)
  assert.match(
    new TextDecoder().decode(runtime.filters[0].writes.at(-1)),
    /data-iconoplasm-gecko-pdf-source="source-1"/,
  )
  const description = runtime.context.IconoplasmPdfByteStore.describe("source-1")
  assert.equal(description.size, 6)
  assert.equal(description.metadata.url, "https://example.test/paper.pdf")
  assert.deepEqual(
    [...new Uint8Array(runtime.context.IconoplasmPdfByteStore.read("source-1", 1, 3))],
    [2, 3, 4],
  )
})

test("Firefox driver rejects attachments, ranges, and non-PDF responses", async () => {
  const runtime = makeRuntime()
  await Promise.resolve()
  const base = {
    requestId: "request-2",
    tabId: 4,
    url: "https://example.test/paper.pdf",
    statusCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/pdf" }],
  }
  runtime.listeners.before(base)
  assert.equal(
    runtime.listeners.headers({
      ...base,
      responseHeaders: [
        ...base.responseHeaders,
        { name: "Content-Disposition", value: "attachment; filename=paper.pdf" },
      ],
    }),
    undefined,
  )
  runtime.listeners.before({ ...base, requestId: "request-range" })
  assert.equal(
    runtime.listeners.headers({ ...base, requestId: "request-range", statusCode: 206 }),
    undefined,
  )
  runtime.listeners.before({ ...base, requestId: "request-html" })
  assert.equal(
    runtime.listeners.headers({
      ...base,
      requestId: "request-html",
      responseHeaders: [{ name: "Content-Type", value: "text/html" }],
    }),
    undefined,
  )
  assert.equal(runtime.filters.length, 3)
  runtime.listeners.before(base)
  assert.notEqual(runtime.listeners.headers(base), undefined)
})
