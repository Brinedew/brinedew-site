import assert from "node:assert/strict"
import test from "node:test"

import { editRecapOnDiscord, handleRepairPostedRecap } from "./discord.js"

const REPAIR_DAY = "2026-08-03"
const REPAIR_MESSAGE_ID = "1527828214741729370"
const REPAIR_CHANNEL_ID = "1449749419628040315"

function makeRepairEnv({ withImage = true } = {}) {
  const postedKey = `discord_summary_posted:${REPAIR_DAY}`
  const marker = {
    message_id: REPAIR_MESSAGE_ID,
    channel_id: REPAIR_CHANNEL_ID,
    posted_at: 123456789,
  }
  const store = new Map([
    [postedKey, JSON.stringify(marker)],
    [`puzzle_actual:${REPAIR_DAY}`, JSON.stringify({ day: REPAIR_DAY, uniprot_id: "Q9REPAIR" })],
  ])
  const writes = []
  const statement = {
    bind() {
      return this
    },
    async run() {
      return { success: true }
    },
    async first() {
      return {
        uniprot: "Q9REPAIR",
        gene: "NHP2",
        full_name: "H/ACA ribonucleoprotein complex subunit 2",
        winners_count: 0,
      }
    },
    async all() {
      return { results: [] }
    },
  }

  return {
    env: {
      KV: {
        async get(key) {
          return store.get(key) ?? null
        },
        async put(key, value) {
          writes.push({ key, value })
          store.set(key, value)
        },
      },
      DB: { prepare: () => statement },
      STRUCTURES_BUCKET: {
        async get() {
          if (!withImage) return null
          const bytes = new Uint8Array([137, 80, 78, 71])
          return { arrayBuffer: async () => bytes.buffer.slice(0) }
        },
      },
      DISCORD_BOT_TOKEN: "secret",
      DISCORD_GENEGUESSR_CHANNEL_ID: REPAIR_CHANNEL_ID,
    },
    marker,
    postedKey,
    store,
    writes,
  }
}

test("posted recap correction replaces Discord content and attachment in one PATCH", async () => {
  const originalFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return Response.json({ id: "1527828214741729370" })
  }

  try {
    const result = await editRecapOnDiscord(
      { DISCORD_BOT_TOKEN: "secret" },
      {
        day: "2026-07-17",
        channelId: "1449749419628040315",
        messageId: "1527828214741729370",
        content: "Corrected recap",
        screenshotBytes: new Uint8Array([137, 80, 78, 71]),
      },
    )

    assert.equal(result.messageId, "1527828214741729370")
    assert.equal(
      request.url,
      "https://discord.com/api/v10/channels/1449749419628040315/messages/1527828214741729370",
    )
    assert.equal(request.init.method, "PATCH")
    assert.equal(request.init.headers.Authorization, "Bot secret")
    assert.ok(request.init.body instanceof FormData)
    assert.deepEqual(JSON.parse(request.init.body.get("payload_json")), {
      content: "Corrected recap",
      attachments: [{ id: "0", filename: "structure-2026-07-17.png" }],
    })
    assert.equal(request.init.body.get("files[0]").name, "structure-2026-07-17.png")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("posted recap correction rejects an impossible Discord message id change", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ id: "different-message" })

  try {
    const { env, marker, postedKey, store, writes } = makeRepairEnv()
    await assert.rejects(handleRepairPostedRecap(env, { day: REPAIR_DAY }), /different message id/)
    assert.deepEqual(JSON.parse(store.get(postedKey)), marker)
    assert.equal(writes.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("repair leaves the posted marker untouched when the corrected image is missing", async () => {
  const { env, marker, postedKey, store, writes } = makeRepairEnv({ withImage: false })

  const result = await handleRepairPostedRecap(env, { day: REPAIR_DAY })

  assert.deepEqual(result, { ok: false, error: "recap_image_missing", day: REPAIR_DAY })
  assert.deepEqual(JSON.parse(store.get(postedKey)), marker)
  assert.equal(writes.length, 0)
})

test("repair leaves the posted marker untouched when Discord rejects the PATCH", async () => {
  const { env, marker, postedKey, store, writes } = makeRepairEnv()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("provider unavailable", { status: 503 })

  try {
    await assert.rejects(
      handleRepairPostedRecap(env, { day: REPAIR_DAY }),
      /Discord recap edit failed \(503\)/,
    )
    assert.deepEqual(JSON.parse(store.get(postedKey)), marker)
    assert.equal(writes.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("repair retries PATCH the same durable message and never create a duplicate recap", async () => {
  const { env, postedKey, store, writes } = makeRepairEnv()
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    return Response.json({ id: REPAIR_MESSAGE_ID })
  }

  try {
    const first = await handleRepairPostedRecap(env, { day: REPAIR_DAY })
    const second = await handleRepairPostedRecap(env, { day: REPAIR_DAY })

    assert.equal(first.message_id, REPAIR_MESSAGE_ID)
    assert.equal(second.message_id, REPAIR_MESSAGE_ID)
    assert.equal(requests.length, 2)
    for (const request of requests) {
      assert.equal(request.init.method, "PATCH")
      assert.equal(
        request.url,
        `https://discord.com/api/v10/channels/${REPAIR_CHANNEL_ID}/messages/${REPAIR_MESSAGE_ID}`,
      )
    }
    assert.equal(writes.length, 0)
    assert.deepEqual(JSON.parse(store.get(postedKey)), {
      message_id: REPAIR_MESSAGE_ID,
      channel_id: REPAIR_CHANNEL_ID,
      posted_at: 123456789,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
