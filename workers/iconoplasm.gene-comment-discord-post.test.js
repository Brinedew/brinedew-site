import { test } from "node:test"
import assert from "node:assert/strict"

import { postIconoplasmGeneCommentToDiscord } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const ENV = {
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_ICONOPLASM_CHANNEL_ID: "123456789",
}

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original
  })
}

test("text-only post: header line with suppressed link, then bolded user inline", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "1" }), { status: 200 }),
    async (calls) => {
      await postIconoplasmGeneCommentToDiscord(ENV, {
        symbol: "INS",
        username: "ada",
        body: "This portrait nails the insulin vibe.",
      })
      assert.equal(calls.length, 1)
      assert.equal(calls[0].init.headers["Content-Type"], "application/json")
      const payload = JSON.parse(calls[0].init.body)
      // Header: "New comment on **INS** gene: <link>" with the link embed-suppressed.
      assert.match(
        payload.content,
        /^New comment on \*\*INS\*\* gene: <https:\/\/iconoplasm\.brinedew\.bio\/gene\/INS>\n\n/,
      )
      // Author bolded inline in front of the message.
      assert.match(payload.content, /\n\n\*\*ada\*\*: This portrait nails the insulin vibe\.$/)
      assert.deepEqual(payload.allowed_mentions, { parse: [] })
    },
  )
})

test("with image: multipart form-data with the card PNG attached", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "2" }), { status: 200 }),
    async (calls) => {
      await postIconoplasmGeneCommentToDiscord(ENV, {
        symbol: "INS",
        username: "ada",
        body: "fresh card please",
        imageBytes: new Uint8Array([1, 2, 3, 4]),
      })
      assert.ok(calls[0].init.body instanceof FormData)
      // Multipart: no explicit JSON content-type (the form sets the boundary).
      assert.equal(calls[0].init.headers["Content-Type"], undefined)
    },
  )
})

test("empty byte array falls back to a text-only JSON post", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "3" }), { status: 200 }),
    async (calls) => {
      await postIconoplasmGeneCommentToDiscord(ENV, {
        symbol: "INS",
        username: "ada",
        body: "hi there",
        imageBytes: new Uint8Array([]),
      })
      assert.equal(calls[0].init.headers["Content-Type"], "application/json")
    },
  )
})

test("does nothing when channel or token is not configured", async () => {
  await withMockedFetch(
    () => {
      throw new Error("fetch must not be called without config")
    },
    async (calls) => {
      await postIconoplasmGeneCommentToDiscord({}, { symbol: "INS", username: "ada", body: "hi" })
      assert.equal(calls.length, 0)
    },
  )
})

test("skips empty symbol or body", async () => {
  await withMockedFetch(
    () => {
      throw new Error("fetch must not be called for empty input")
    },
    async (calls) => {
      await postIconoplasmGeneCommentToDiscord(ENV, { symbol: "", username: "ada", body: "hi" })
      await postIconoplasmGeneCommentToDiscord(ENV, { symbol: "INS", username: "ada", body: "   " })
      assert.equal(calls.length, 0)
    },
  )
})

test("ellipsizes very long comment bodies under Discord's cap", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "4" }), { status: 200 }),
    async (calls) => {
      await postIconoplasmGeneCommentToDiscord(ENV, {
        symbol: "INS",
        username: "ada",
        body: "x".repeat(5000),
      })
      const payload = JSON.parse(calls[0].init.body)
      assert.ok(payload.content.length < 2000, "must stay under Discord's 2000 char cap")
      // Link sits in the header; the ellipsized body ends the message.
      assert.match(payload.content, /gene: <https:/)
      assert.match(payload.content, /…$/)
    },
  )
})

test("a Discord API failure never throws (best-effort)", async () => {
  await withMockedFetch(
    () => new Response("rate limited", { status: 429 }),
    async () => {
      await assert.doesNotReject(
        postIconoplasmGeneCommentToDiscord(ENV, { symbol: "INS", username: "ada", body: "hi" }),
      )
    },
  )
})
