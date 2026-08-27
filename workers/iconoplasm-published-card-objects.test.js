import assert from "node:assert/strict"
import test from "node:test"
import {
  createPublishedCardObjectStore,
  publishedCardObjectKey,
} from "./lib/iconoplasm-published-card-objects.js"

const env = {
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "test-zone",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
}
function fixture({ alterRead, status = 200 } = {}) {
  const objects = new Map()
  const calls = []
  const store = createPublishedCardObjectStore(env, {
    request: async (url, init, key) => {
      calls.push({ method: init.method, key })
      if (init.method === "PUT") {
        if (status === 200) objects.set(key, init.body.slice())
        return new Response(null, { status })
      }
      const bytes = alterRead ? alterRead(objects.get(key)) : objects.get(key)
      return bytes ? new Response(bytes) : new Response(null, { status: 404 })
    },
  })
  return { store, calls, objects }
}

test("immutable object identity ignores property order and changes with actual content", async () => {
  const { store, calls } = fixture()
  const first = await store.write("genes", { symbol: "EZH2", name: "first" })
  const same = await store.write("genes", { name: "first", symbol: "EZH2" })
  const next = await store.write("genes", { symbol: "EZH2", name: "next" })
  assert.equal(first.key, same.key)
  assert.notEqual(first.key, next.key)
  assert.deepEqual((await store.read(first.key)).value, { name: "first", symbol: "EZH2" })
  assert.deepEqual(
    calls.slice(0, 2).map((x) => x.method),
    ["PUT", "GET"],
  )
})

test("PUT success without readable bytes cannot acknowledge publication", async () => {
  const { store } = fixture({ alterRead: () => null })
  await assert.rejects(store.write("genes", { symbol: "EZH2" }), /not yet readable/)
})

test("corrupt bytes and failed uploads cannot acknowledge publication", async () => {
  const corrupt = fixture({ alterRead: () => new TextEncoder().encode("{}") })
  await assert.rejects(corrupt.store.write("genes", { symbol: "EZH2" }), /hash mismatch/)
  await assert.rejects(fixture({ status: 503 }).store.write("genes", {}), /PUT failed/)
})

test("read misses never write or consult a relational database", async () => {
  const { store, calls } = fixture()
  assert.equal(await store.read(publishedCardObjectKey("genes", "a".repeat(64))), null)
  assert.deepEqual(
    calls.map((x) => x.method),
    ["GET"],
  )
})

test("namespace and byte limits fail before an unsafe storage write", async () => {
  const { store, calls } = fixture()
  await assert.rejects(store.read("private/user.json"), /namespace/)
  await assert.rejects(store.write("portraits", { value: "x".repeat(8192) }), /byte limit/)
  assert.equal(calls.length, 0)
})

test("a stalled response body has a deadline", async () => {
  let cancelled = false
  const store = createPublishedCardObjectStore(env, {
    bodyTimeoutMs: 15,
    request: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
      ),
  })
  await assert.rejects(store.read(publishedCardObjectKey("genes", "a".repeat(64))), /timed out/)
  assert.equal(cancelled, true)
})
