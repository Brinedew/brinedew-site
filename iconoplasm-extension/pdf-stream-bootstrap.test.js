import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("./pdf-stream-bootstrap.js", import.meta.url), "utf8")

function runBootstrap({ mimeHandler, fetchImpl, runtime, search = "", replace = () => {} }) {
  class TestURL extends URL {
    static createObjectURL() {
      return "blob:firefox-native-pdf"
    }
  }
  const context = {
    chrome: { mimeHandler, runtime },
    console: { error() {} },
    fetch: fetchImpl,
    location: { search, replace },
    URL: TestURL,
    URLSearchParams,
    Blob,
    ArrayBuffer,
    Uint8Array,
  }
  context.globalThis = context
  vm.runInNewContext(source, context, { filename: "pdf-stream-bootstrap.js" })
  return context.IconoplasmPdfStreamBootstrap.outcome
}

test("consumes the one-shot MIME stream immediately and exactly once", async () => {
  let streamReads = 0
  let fetches = 0
  const outcomePromise = runBootstrap({
    mimeHandler: {
      async getStreamInfo() {
        streamReads += 1
        return { streamUrl: "blob:pdf", originalUrl: "file:///paper.pdf" }
      },
    },
    async fetchImpl(url) {
      fetches += 1
      assert.equal(url, "blob:pdf")
      return {
        ok: true,
        async arrayBuffer() {
          return Uint8Array.from([37, 80, 68, 70]).buffer
        },
      }
    },
  })

  const outcome = await outcomePromise
  assert.equal(streamReads, 1)
  assert.equal(fetches, 1)
  assert.equal(outcome.kind, "stream")
  assert.deepEqual(Array.from(outcome.bytes), [37, 80, 68, 70])
})

test("falls back to Chrome's native viewer when stream acquisition fails", async () => {
  let fallbacks = 0
  const outcome = await runBootstrap({
    mimeHandler: {
      async getStreamInfo() {
        throw new Error("not a valid handler context")
      },
      async abortAndFallbackToNativeHandler() {
        fallbacks += 1
      },
    },
    async fetchImpl() {
      throw new Error("fetch must not run")
    },
  })

  assert.equal(outcome.kind, "aborted")
  assert.equal(fallbacks, 1)
})

test("keeps the explicit manual reader available when the API is unavailable", async () => {
  const outcome = await runBootstrap({
    mimeHandler: undefined,
    async fetchImpl() {
      throw new Error("fetch must not run")
    },
  })

  assert.equal(outcome.kind, "manual")
})

test("consumes Firefox-owned bytes once and hands the same bytes to the native viewer", async () => {
  const messages = []
  const replacements = []
  const outcome = await runBootstrap({
    search: "?geckoSource=source-1",
    replace: (url) => replacements.push(url),
    runtime: {
      async sendMessage(message) {
        messages.push(message)
        if (message.type === "PDF_BYTE_STORE_DESCRIBE") {
          return {
            ok: true,
            size: 4,
            metadata: { url: "https://example.test/paper.pdf", tabId: 7 },
          }
        }
        if (message.type === "PDF_BYTE_STORE_READ") {
          return { ok: true, bytes: Uint8Array.from([37, 80, 68, 70]).buffer }
        }
        if (message.type === "PDF_RELEASE_OWNED_SOURCE") return { ok: true }
        throw new Error(`Unexpected message: ${message.type}`)
      },
    },
    async fetchImpl() {
      throw new Error("fetch must not run")
    },
  })

  assert.equal(outcome.kind, "stream")
  assert.equal(outcome.ownership, "firefox-response-filter")
  assert.deepEqual(Array.from(outcome.bytes), [37, 80, 68, 70])
  assert.equal(messages.filter((message) => message.type === "PDF_BYTE_STORE_READ").length, 1)
  assert.equal(messages.filter((message) => message.type === "PDF_RELEASE_OWNED_SOURCE").length, 1)
  outcome.handBack()
  assert.deepEqual(replacements, ["blob:firefox-native-pdf"])
})
