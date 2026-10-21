import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

import { handlePostDailyRecap } from "./discord.js"
import { handlePostDailyFeed } from "./discord-feed.js"
import {
  DISCORD_SWITCHES,
  DISCORD_SWITCHES_KV_KEY,
  discordSwitchIsOn,
  readDiscordSwitches,
  writeDiscordSwitches,
} from "./discord-integration-switches.js"
import { createIconoplasmDailyDigestHandlers } from "./iconoplasm-daily-digest-route.js"

// The admin panel's Discord tab against Miniflare's KV (the real binding's
// JSON round trip), then each poster with its switch off: none may reach Discord.

async function realKv(t) {
  const require = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare")
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('local')}}",
      compatibilityDate: "2026-08-01",
      kvNamespaces: ["KV"],
    }),
  )
  t.after(() => runtime.dispose())
  return runtime.getKVNamespace("KV")
}

function forbidDiscord(t) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    throw new Error(`nothing may be fetched while switched off: ${url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
}

test(
  "untouched switches are on; a save changes only the named switch",
  { timeout: 60000 },
  async (t) => {
    const KV = await realKv(t)
    const env = { KV }
    const fresh = await readDiscordSwitches(env)
    assert.deepEqual(
      fresh.switches,
      Object.fromEntries(DISCORD_SWITCHES.map(({ id }) => [id, true])),
    )
    assert.equal(fresh.updated_at, null)

    const saved = await writeDiscordSwitches(env, {
      changes: { iconoplasm_digest: false },
      updatedBy: "owner",
      now: new Date("2026-10-21T20:00:00Z"),
    })
    assert.equal(saved.ok, true)
    const after = await readDiscordSwitches(env)
    assert.equal(after.switches.iconoplasm_digest, false)
    assert.equal(after.switches.iconoplasm_comments, true)
    assert.equal(after.updated_by, "owner")
    assert.equal(after.updated_at, "2026-10-21T20:00:00.000Z")
    assert.equal(await discordSwitchIsOn(env, "iconoplasm_digest"), false)

    await writeDiscordSwitches(env, { changes: { blog_feed: false }, updatedBy: "owner" })
    const both = await readDiscordSwitches(env)
    assert.equal(both.switches.iconoplasm_digest, false, "an earlier save survives a later one")
    assert.equal(both.switches.blog_feed, false)

    for (const changes of [{}, { nonsense: true }, { blog_feed: "off" }, null]) {
      const refused = await writeDiscordSwitches(env, { changes, updatedBy: "owner" })
      assert.equal(refused.ok, false, JSON.stringify(changes))
    }
    assert.deepEqual((await readDiscordSwitches(env)).switches, both.switches)
  },
)

test("an unreadable setting counts as off", async () => {
  const env = {
    KV: {
      get: async () => {
        throw new Error("KV unavailable")
      },
    },
  }
  assert.equal(await discordSwitchIsOn(env, "iconoplasm_comments"), false)
  await assert.rejects(() => discordSwitchIsOn(env, "not_a_switch"), TypeError)
})

test(
  "switched off, the digest route, the blog feed and the recap post nothing",
  { timeout: 60000 },
  async (t) => {
    const KV = await realKv(t)
    const env = {
      KV,
      DISCORD_BOT_TOKEN: "bot",
      DISCORD_ICONOPLASM_CHANNEL_ID: "1",
      DISCORD_FEED_CHANNEL_ID: "2",
      DISCORD_GENEGUESSR_CHANNEL_ID: "3",
    }
    await KV.put(
      DISCORD_SWITCHES_KV_KEY,
      JSON.stringify({
        switches: { iconoplasm_digest: false, blog_feed: false, geneguessr_recap: false },
      }),
    )
    forbidDiscord(t)

    const handlers = createIconoplasmDailyDigestHandlers({
      isAdmin: async () => true,
      json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
      fetchImpl: async () => {
        throw new Error("the digest must not reach Discord while switched off")
      },
      now: () => new Date("2026-10-21T03:00:00Z"),
    })
    const form = new FormData()
    form.append("day", "2026-10-20")
    form.append("content", "digest")
    const webp = new Uint8Array(16)
    webp.set(
      [..."RIFF"].map((c) => c.charCodeAt(0)),
      0,
    )
    webp.set(
      [..."WEBP"].map((c) => c.charCodeAt(0)),
      8,
    )
    form.append("image", new Blob([webp], { type: "image/webp" }), "digest.webp")
    const response = await handlers["admin_daily_digest.post"]({
      request: new Request("https://iconoplasm.test/api/iconoplasm/admin/daily-digest/post", {
        method: "POST",
        body: form,
      }),
      env,
      done: (_id, res) => res,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, switched_off: true })
    assert.equal(
      await KV.get("iconoplasm_digest_posted:2026-10-20"),
      null,
      "no day is marked posted",
    )

    assert.deepEqual(await handlePostDailyFeed(env), { ok: true, skipped: "switched_off" })
    assert.deepEqual(await handlePostDailyRecap(env, { day: "2026-10-20" }), {
      ok: true,
      skipped: "switched_off",
      day: "2026-10-20",
    })
  },
)
