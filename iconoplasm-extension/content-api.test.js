import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: the content-to-worker bridge preserves request cancellation.

const source = await readFile(new URL("./content-api.js", import.meta.url), "utf8")

function loadFactory() {
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmContentApi.createExtensionApiFetch
}

test("content API bridge propagates abort to the real service-worker fetch", async () => {
  const createExtensionApiFetch = loadFactory()
  const messages = []
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message)
      if (message.type === "CANCEL_ICONOPLASM_API_FETCH") callback({ ok: true, canceled: true })
    },
  }
  const fetchImpl = createExtensionApiFetch({ runtime })
  const controller = new AbortController()

  const request = fetchImpl("https://iconoplasm.brinedew.bio/api/public/v1/test", {
    signal: controller.signal,
  })
  controller.abort()

  await assert.rejects(request, { name: "AbortError" })
  assert.equal(messages[0].type, "ICONOPLASM_API_FETCH")
  assert.equal(messages[1].type, "CANCEL_ICONOPLASM_API_FETCH")
  assert.equal(messages[1].requestId, messages[0].requestId)
})

test("content API bridge returns a fetch-shaped immutable GET response", async () => {
  const createExtensionApiFetch = loadFactory()
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback({ ok: true, status: 200, text: JSON.stringify({ requestId: message.requestId }) })
    },
  }
  const fetchImpl = createExtensionApiFetch({ runtime })
  const response = await fetchImpl(
    "https://iconoplasm.brinedew.bio/api/public/v1/card-snapshots/v1/genes/TP53",
  )

  assert.equal(response.ok, true)
  assert.equal(response.status, 200)
  assert.match((await response.json()).requestId, /^api-/)
})
