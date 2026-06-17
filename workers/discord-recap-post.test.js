import { test } from "node:test"
import assert from "node:assert/strict"

import { postRecapToDiscord } from "./discord.js"

const ENV = {
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_GENEGUESSR_CHANNEL_ID: "987654321",
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

test("posts multipart with a file when an image is provided", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "msg1" }), { status: 200 }),
    async (calls) => {
      const { messageId } = await postRecapToDiscord(ENV, {
        day: "2026-06-03",
        content: "recap text",
        screenshotBytes: new Uint8Array([1, 2, 3, 4]),
      })
      assert.equal(messageId, "msg1")
      assert.equal(calls.length, 1)
      // Multipart: body is FormData, and we do NOT set a JSON content-type.
      assert.ok(calls[0].init.body instanceof FormData)
      assert.equal(calls[0].init.headers["Content-Type"], undefined)
    },
  )
})

test("posts a plain JSON body (text-only) when no image is available", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "msg2" }), { status: 200 }),
    async (calls) => {
      const { messageId } = await postRecapToDiscord(ENV, {
        day: "2026-06-03",
        content: "text-only recap",
        screenshotBytes: null,
      })
      assert.equal(messageId, "msg2")
      assert.equal(calls[0].init.headers["Content-Type"], "application/json")
      const payload = JSON.parse(calls[0].init.body)
      assert.equal(payload.content, "text-only recap")
    },
  )
})

test("treats empty byte arrays as no image", async () => {
  await withMockedFetch(
    () => new Response(JSON.stringify({ id: "msg3" }), { status: 200 }),
    async (calls) => {
      await postRecapToDiscord(ENV, {
        day: "2026-06-03",
        content: "x",
        screenshotBytes: new Uint8Array([]),
      })
      assert.equal(calls[0].init.headers["Content-Type"], "application/json")
    },
  )
})

test("throws on a non-OK Discord response so the failure is recorded", async () => {
  await withMockedFetch(
    () => new Response("bad", { status: 403 }),
    async () => {
      await assert.rejects(
        postRecapToDiscord(ENV, { day: "2026-06-03", content: "x", screenshotBytes: null }),
        /Discord API 403/,
      )
    },
  )
})
