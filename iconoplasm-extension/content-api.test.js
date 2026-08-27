import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: the content-to-worker bridge preserves request cancellation.

const source = await readFile(new URL("./content-api.js", import.meta.url), "utf8")

function loadClientFactory() {
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmContentApi.createExtensionRuntimeClient
}

function loadFactory() {
  const createClient = loadClientFactory()
  return (chrome, options) => createClient(chrome, options).fetch
}

test("portrait invalidation rejects pending metadata and stops every runtime lane", async () => {
  let calls = 0
  let notices = 0
  const runtime = {
    sendMessage(message) {
      calls++
      if (message.type === "GET_PORTRAIT_SOURCE_PLAN")
        throw new Error("Extension context invalidated.")
    },
  }
  const client = loadClientFactory()({ runtime }, { onContextInvalidated: () => notices++ })
  const pending = client.fetch("/test")
  const assertion = assert.rejects(pending, { code: "ICONOPLASM_CONTEXT_INVALIDATED" })
  await assert.rejects(client.sendMessage({ type: "GET_PORTRAIT_SOURCE_PLAN" }), {
    code: "ICONOPLASM_CONTEXT_INVALIDATED",
  })
  await assertion
  await assert.rejects(client.sendMessage({ type: "REFRESH_CARD_SNAPSHOT" }))
  assert.equal(calls, 2)
  assert.equal(notices, 1)
})

test("cached hovers detect a removed runtime without issuing a request", () => {
  let notices = 0
  const runtime = {
    id: "installed-extension",
    sendMessage() {
      throw new Error("must not send")
    },
  }
  const client = loadClientFactory()({ runtime }, { onContextInvalidated: () => notices++ })
  assert.equal(client.checkConnected(), true)
  runtime.id = undefined
  assert.equal(client.checkConnected(), false)
  assert.equal(client.checkConnected(), false)
  assert.equal(notices, 1)
})

for (const failureMode of ["throw", "callback"]) {
  test(`invalidated extension context is terminal and reported once (${failureMode})`, async () => {
    let calls = 0
    let notices = 0
    const runtime = {
      lastError: null,
      sendMessage(_message, callback) {
        calls++
        if (failureMode === "throw") throw new Error("Extension context invalidated.")
        runtime.lastError = { message: "Extension context invalidated." }
        callback()
        runtime.lastError = null
      },
    }
    const fetch = loadFactory()({ runtime }, { onContextInvalidated: () => notices++ })
    for (let i = 0; i < 100; i++) {
      await assert.rejects(fetch("https://iconoplasm.brinedew.bio/api/public/v1/test"), {
        code: "ICONOPLASM_CONTEXT_INVALIDATED",
      })
    }
    assert.equal(calls, 1)
    assert.equal(notices, 1)
  })
}

test("a temporarily missing background process is not permanent invalidation", async () => {
  let calls = 0
  let notices = 0
  const runtime = {
    lastError: null,
    sendMessage(_message, callback) {
      calls++
      if (calls === 1)
        throw new Error("Could not establish connection. Receiving end does not exist.")
      callback({ ok: true, status: 200, text: "{}" })
    },
  }
  const fetch = loadFactory()({ runtime }, { onContextInvalidated: () => notices++ })
  await assert.rejects(fetch("/test"))
  assert.equal((await fetch("/test")).status, 200)
  assert.equal(notices, 0)
})

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
