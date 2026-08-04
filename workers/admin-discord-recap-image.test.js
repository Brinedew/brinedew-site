import assert from "node:assert/strict"
import test from "node:test"

import {
  handleAdminDiscordRecapImageStatus,
  handleAdminDiscordRecapImageStatuses,
  handleAdminDiscordRecapImageUpload,
} from "./admin.js"

function buildAdminEnv(bucket) {
  return {
    ADMIN_DISCORD_USER_ID: "admin-user",
    GAME_SESSIONS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => Response.json({ user_id: "admin-user" }),
      }),
    },
    STRUCTURES_BUCKET: bucket,
  }
}

function adminRequest(url, init = {}) {
  const headers = new Headers(init.headers)
  headers.set("Cookie", "session=test-session")
  return new Request(url, { ...init, headers })
}

test("admin upload stores an image under its exact target identity", async () => {
  const writes = []
  let storedBytes = null
  const env = buildAdminEnv({
    async put(key, bytes, options) {
      writes.push({ key, bytes, options })
      storedBytes = new Uint8Array(bytes)
    },
    async get() {
      return storedBytes ? { arrayBuffer: async () => storedBytes.buffer.slice(0) } : null
    },
  })
  const request = adminRequest("https://example.test/api/admin/discord-recap-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      day: "2026-08-02",
      uniprot_id: "p08134",
      image_base64: "iVBORw0KGgo=",
    }),
  })

  const response = await handleAdminDiscordRecapImageUpload(request, env)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.uniprot_id, "P08134")
  assert.equal(body.render_contract, "molstar-recap-v3")
  assert.equal(body.verified_bytes, 8)
  assert.equal(writes[0].key, "discord-recap-images/v2/2026-08-02/P08134/molstar-recap-v3.png")
  assert.equal(writes[0].options.customMetadata.uniprotId, "P08134")
})

test("admin upload rejects an unbound day-only image", async () => {
  const env = buildAdminEnv({ put: async () => assert.fail("must not write") })
  const request = adminRequest("https://example.test/api/admin/discord-recap-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day: "2026-08-02", image_base64: "iVBORw0KGgo=" }),
  })

  const response = await handleAdminDiscordRecapImageUpload(request, env)
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /uniprot_id/)
})

test("admin status checks only the requested target identity", async () => {
  const reads = []
  const env = buildAdminEnv({
    async head(key) {
      reads.push(key)
      return null
    },
  })
  const request = adminRequest(
    "https://example.test/api/admin/discord-recap-image?day=2026-08-02&uniprot=P08134",
  )

  const response = await handleAdminDiscordRecapImageStatus(request, env)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.exists, false)
  assert.equal(body.uniprot_id, "P08134")
  assert.deepEqual(reads, ["discord-recap-images/v2/2026-08-02/P08134/molstar-recap-v3.png"])
})

test("admin can visually inspect exact stored bytes with a unique filename", async () => {
  const storedBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const env = buildAdminEnv({
    async get() {
      return { arrayBuffer: async () => storedBytes.buffer.slice(0) }
    },
  })
  const request = adminRequest(
    "https://example.test/api/admin/discord-recap-image?day=2026-08-02&uniprot=P08134&download=1",
  )

  const response = await handleAdminDiscordRecapImageStatus(request, env)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/png")
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(
    response.headers.get("content-disposition"),
    'inline; filename="geneguessr-2026-08-02-P08134-molstar-recap-v3.png"',
  )
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), storedBytes)
})

test("annual recap status checks never exceed five concurrent storage reads", async () => {
  let active = 0
  let maxActive = 0
  const reads = []
  const env = buildAdminEnv({
    async head(key) {
      reads.push(key)
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return null
    },
  })
  const identities = Array.from(
    { length: 17 },
    (_, index) =>
      `2026-08-${String(index + 1).padStart(2, "0")}~P${String(index + 1).padStart(5, "0")}`,
  )
  const request = adminRequest(
    `https://example.test/api/admin/discord-recap-images?images=${encodeURIComponent(identities.join(","))}`,
  )

  const response = await handleAdminDiscordRecapImageStatuses(request, env)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.count, 17)
  assert.equal(Object.keys(body.days).length, 17)
  assert.equal(reads.length, 17)
  assert.equal(maxActive, 5)
})
