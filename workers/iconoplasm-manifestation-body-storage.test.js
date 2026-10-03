import assert from "node:assert/strict"
import test from "node:test"

import {
  createManifestationBodyObjectKey,
  deleteManifestationBodyObject,
  putManifestationBodyObject,
  readManifestationBodyObject,
  writeManifestationBodyObject,
} from "./lib/iconoplasm-manifestation-body-storage.js"
import { sha256Hex } from "./lib/iconoplasm-sha256.js"

const env = {
  ICONOPLASM_AUTHORING_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_AUTHORING_STORAGE_ZONE: "iconoplasm-authoring",
  ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "private-test-key",
  ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: "1000",
}

test("private body storage PUT verifies exact authenticated bytes without using the CDN", async () => {
  const originalFetch = globalThis.fetch
  const objects = new Map()
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    assert.equal(init.headers.AccessKey, "private-test-key")
    assert.match(
      String(url),
      /^https:\/\/storage\.bunnycdn\.com\/iconoplasm-authoring\/private\/manifestations\/v1\//,
    )
    if (init.method === "PUT") {
      objects.set(String(url), new Uint8Array(init.body))
      return new Response(null, { status: 201 })
    }
    const bytes = objects.get(String(url))
    if (!bytes) return new Response(null, { status: 404 })
    return new Response(bytes, { status: 200, headers: { etag: '"cipher-etag"' } })
  }
  try {
    const key = await createManifestationBodyObjectKey({
      locatorId: "mbody_12345678123442348234123456789abc",
    })
    assert.doesNotMatch(key, /mrev_|revision/i)
    const body = new TextEncoder().encode("A plain manifestation body.")
    const result = await putManifestationBodyObject(env, key, body, {
      expectedSha256: await sha256Hex(body),
    })
    assert.equal(result.ok, true)
    assert.equal(result.etag, '"cipher-etag"')
    assert.deepEqual((await readManifestationBodyObject(env, key)).bytes, body)
    assert.ok(calls.every((call) => !call.url.includes("b-cdn.net")))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("private body storage waits through Bunny's measured read-after-write window", async () => {
  const originalFetch = globalThis.fetch
  let reads = 0
  const ciphertext = new Uint8Array(32).fill(17)
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "PUT") return new Response(null, { status: 201 })
    reads += 1
    if (reads === 1) return new Response(null, { status: 404 })
    return new Response(ciphertext, { status: 200, headers: { etag: '"eventual-etag"' } })
  }
  try {
    const key = await createManifestationBodyObjectKey({
      locatorId: "mbody_cccccccc123442348234123456789abc",
    })
    const result = await putManifestationBodyObject(env, key, ciphertext, {
      expectedSha256: await sha256Hex(ciphertext),
    })
    assert.equal(result.etag, '"eventual-etag"')
    assert.equal(reads, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("private body deletion is confirmed by an authenticated missing read", async () => {
  const originalFetch = globalThis.fetch
  let exists = true
  globalThis.fetch = async (_url, init = {}) => {
    assert.equal(init.headers.AccessKey, "private-test-key")
    if (init.method === "DELETE") {
      exists = false
      return new Response(null, { status: 200 })
    }
    return exists
      ? new Response(new Uint8Array(24), { status: 200 })
      : new Response(null, { status: 404 })
  }
  try {
    const key = await createManifestationBodyObjectKey({
      locatorId: "mbody_aaaaaaaa123442348234123456789abc",
    })
    assert.deepEqual(await deleteManifestationBodyObject(env, key), {
      ok: true,
      already_missing: false,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("private body deletion waits for Bunny to stop serving the deleted object", async () => {
  const originalFetch = globalThis.fetch
  let reads = 0
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === "DELETE") return new Response(null, { status: 200 })
    reads += 1
    return reads === 1
      ? new Response(new Uint8Array(24), { status: 200 })
      : new Response(null, { status: 404 })
  }
  try {
    const key = await createManifestationBodyObjectKey({
      locatorId: "mbody_dddddddd123442348234123456789abc",
    })
    assert.deepEqual(await deleteManifestationBodyObject(env, key), {
      ok: true,
      already_missing: false,
    })
    assert.equal(reads, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("body object locators are random authority-only identifiers, not revision-derived paths", async () => {
  const first = await createManifestationBodyObjectKey()
  const second = await createManifestationBodyObjectKey()
  assert.match(first, /^private\/manifestations\/v1\/[a-f0-9]{2}\/mbody_[a-f0-9]{32}\.bin$/)
  assert.match(second, /^private\/manifestations\/v1\/[a-f0-9]{2}\/mbody_[a-f0-9]{32}\.bin$/)
  assert.notEqual(first, second)
})

test("authoring storage never falls back to portrait credentials or zone", async () => {
  const portraitOnly = {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "portrait-key",
  }
  const key = await createManifestationBodyObjectKey({
    locatorId: "mbody_bbbbbbbb123442348234123456789abc",
  })
  await assert.rejects(
    readManifestationBodyObject(portraitOnly, key),
    /Private manifestation body storage is not configured/,
  )
})

// B-859: the plain bodies are as short as one byte; the old 17-byte floor was
// the envelope's, and the conversion spends exactly one request per call.
test("a one-byte body is a valid object, and one write or read is one request", async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, init = {}) => {
    calls.push(init.method)
    if (init.method === "PUT") return new Response(null, { status: 503 })
    return new Response(new Uint8Array([65]), { status: 200 })
  }
  try {
    const key = await createManifestationBodyObjectKey({
      locatorId: "mbody_eeeeeeee123442348234123456789abc",
    })
    assert.deepEqual(
      (await readManifestationBodyObject(env, key, { maxAttempts: 1 })).bytes,
      new Uint8Array([65]),
    )
    await assert.rejects(
      writeManifestationBodyObject(env, key, new Uint8Array([65]), { maxAttempts: 1 }),
      /PUT failed \(503\)|request failed \(503\)/,
    )
    assert.deepEqual(calls, ["GET", "PUT"], "maxAttempts: 1 never retries")
    await assert.rejects(writeManifestationBodyObject(env, key, new Uint8Array(0)), TypeError)
    await assert.rejects(
      writeManifestationBodyObject(env, key, new Uint8Array(64 * 1024 + 1)),
      TypeError,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
