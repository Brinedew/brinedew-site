// The gene page's Discord invite card, published to the CDN (B-1102). The card used to ask
// discord.com for the counts and cdn.discordapp.com for the icon from every reader's browser, signed
// in or not, against the privacy page's promise. A cron step now writes `community/v1/discord.json`
// and the page reads that. Discord and Bunny Storage are a fake `fetch` that records every request;
// the invite body is the real one Discord returned for kx8FVzUrpf on 2026-10-17 (with the inviter
// and channel it also sends, which must never reach the object).
//
// Failure modes this file proves, written before the code:
//   D1  the object carries more than the card draws (the inviter, the channel, the guild id), or
//       the icon as anything but an embedded image
//   D2  Discord down, slow, refusing or answering without counts overwrites the last good object
//       (the card would lose its counts) instead of leaving it
//   D3  the job writes when nothing changed, or does not write when a count or the icon did
//   D4  an icon that cannot be embedded fails the publication instead of leaving the bundled one;
//       a guild id or icon hash that is not Discord's shape is put in a URL at all
//   D5  the Worker's scheduled handler does not run it at its minutes, or lets a storage failure
//       pass as success
//   D6  an unconfigured store throws instead of saying so
//   D7  the page, the publisher, the Iconoplasm page policy and the pull zone name different
//       addresses, or the policy still lets the page talk to discord.com
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { afterEach, beforeEach, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_RECURRING_CRON,
} from "./iconoplasm-background-schedule.js"
import { DISCORD_INVITE_OBJECT_KEY } from "./lib/iconoplasm-published-card-objects.js"
import { publishDiscordInviteObject } from "./lib/discord-invite-publication.js"

const ZONE = "test-zone"
const BUNNY = {
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: ZONE,
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-storage-password",
  ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
  ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
}
// A real 1 x 1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)
const GUILD = "1289484665966563438"
const ICON = "ab4ef830bb6158e061cc4d6eddeccd22"
const realInvite = (overrides = {}) => ({
  type: 0,
  code: "kx8FVzUrpf",
  expires_at: null,
  guild_id: GUILD,
  guild: { id: GUILD, name: "brinedew.bio", icon: ICON, ...overrides.guild },
  channel: { id: "1289484666532663339", type: 0, name: "general" },
  inviter: {
    id: "263719430421856257",
    username: "someone",
    avatar: "hash",
    global_name: "Someone",
  },
  approximate_member_count: 31,
  approximate_presence_count: 5,
  ...overrides,
  ...(overrides.guild
    ? { guild: { id: GUILD, name: "brinedew.bio", icon: ICON, ...overrides.guild } }
    : {}),
})
const at = (minute, hour = 12) => Date.UTC(2026, 9, 17, hour, minute)

let network

beforeEach(() => {
  network = fakeNetwork()
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
})
afterEach(() => mock.restoreAll())

function fakeNetwork() {
  const storage = new Map()
  const calls = []
  let invite = { status: 200, body: realInvite() }
  let icon = { status: 200, body: PNG, type: "image/png" }
  let failWrites = false
  mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input?.url || input))
    const method = String(init.method || "GET").toUpperCase()
    calls.push({ method, host: url.host, path: url.pathname, search: url.search })
    if (url.host === "storage.bunnycdn.com") {
      const key = url.pathname.slice(`/${ZONE}/`.length)
      if (method === "PUT") {
        if (failWrites) return new Response("boom", { status: 500 })
        storage.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()))
        return new Response("{}", { status: 201 })
      }
      const stored = storage.get(key)
      return stored
        ? new Response(stored, { status: 200, headers: { "content-type": "application/json" } })
        : new Response("not found", { status: 404 })
    }
    if (url.host === "discord.com") {
      if (invite.throws) throw new DOMException("The operation was aborted", "AbortError")
      return new Response(JSON.stringify(invite.body ?? {}), {
        status: invite.status,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.host === "cdn.discordapp.com") {
      if (icon.throws) throw new DOMException("The operation was aborted", "AbortError")
      return new Response(icon.body ?? "not found", {
        status: icon.status,
        headers: { "content-type": icon.type ?? "image/png" },
      })
    }
    throw new Error(`unexpected request to ${url.host}`)
  })
  return {
    storage,
    calls,
    invite: (value) => {
      invite = value
    },
    icon: (value) => {
      icon = value
    },
    failWrites: (value) => {
      failWrites = value
    },
    object: () =>
      storage.has(DISCORD_INVITE_OBJECT_KEY)
        ? JSON.parse(Buffer.from(storage.get(DISCORD_INVITE_OBJECT_KEY)).toString("utf8"))
        : null,
    puts: () => calls.filter((call) => call.method === "PUT"),
  }
}

const publish = () => publishDiscordInviteObject({ ...BUNNY })

test("D1: the object is the card's counts and icon and nothing else", async () => {
  const result = await publish()
  assert.deepEqual(
    { ok: result.ok, published: result.published, members: result.members, icon: result.icon },
    { ok: true, published: true, members: 31, icon: true },
  )
  const object = network.object()
  assert.deepEqual(Object.keys(object).sort(), ["icon", "members", "online"])
  assert.deepEqual([object.online, object.members], [5, 31])
  assert.match(object.icon, /^data:image\/png;base64,/)
  assert.ok(Buffer.from(object.icon.split(",")[1], "base64").equals(PNG))
  const raw = Buffer.from(network.storage.get(DISCORD_INVITE_OBJECT_KEY)).toString("utf8")
  for (const secret of [GUILD, "263719430421856257", "someone", "general", ICON]) {
    assert.ok(!raw.includes(secret), `the object leaks ${secret}`)
  }
  const discord = network.calls.filter((call) => call.host === "discord.com")
  assert.deepEqual(
    discord.map((call) => call.path + call.search),
    ["/api/v10/invites/kx8FVzUrpf?with_counts=true"],
  )
  assert.deepEqual(
    network.calls.filter((call) => call.host === "cdn.discordapp.com").map((call) => call.path),
    [`/icons/${GUILD}/${ICON}.png`],
  )
})

test("D2: when Discord does not give counts, the last good object stays", async () => {
  await publish()
  const before = network.object()
  for (const [answer, reason] of [
    [{ status: 503, body: { message: "unavailable" } }, "discord_503"],
    [{ status: 429, body: { message: "rate limited" } }, "discord_429"],
    [{ throws: true }, "discord_unreachable"],
    [{ status: 200, body: realInvite({ approximate_member_count: 0 }) }, "discord_no_counts"],
    [{ status: 200, body: { code: "kx8FVzUrpf", guild: { id: GUILD } } }, "discord_no_counts"],
  ]) {
    network.invite(answer)
    const writes = network.puts().length
    const result = await publish()
    assert.equal(result.ok, false)
    assert.equal(result.reason, reason)
    assert.equal(network.puts().length, writes, `${reason} wrote`)
    assert.deepEqual(network.object(), before)
  }
})

test("D3: the job writes when a count or the icon moved and not when nothing did", async () => {
  await publish()
  assert.equal(network.puts().length, 1)
  assert.equal((await publish()).published, false)
  assert.equal(network.puts().length, 1, "an unchanged card is not rewritten")

  network.invite({ status: 200, body: realInvite({ approximate_presence_count: 9 }) })
  assert.equal((await publish()).published, true)
  assert.equal(network.object().online, 9)

  network.icon({ status: 200, body: Buffer.concat([PNG, Buffer.from("x")]), type: "image/png" })
  assert.equal((await publish()).published, true)
  assert.equal(network.puts().length, 3)
  assert.equal(
    network.calls.filter((call) => call.method === "PURGE" || /purge/i.test(call.path)).length,
    0,
    "never purges",
  )
})

test("D4: an icon that cannot be embedded leaves the page's own icon and still publishes the counts", async () => {
  for (const answer of [
    { status: 404, body: "nope", type: "text/plain" },
    { status: 200, body: "<html>", type: "text/html" },
    { throws: true },
    { status: 200, body: Buffer.alloc(300 * 1024), type: "image/png" },
  ]) {
    network.storage.clear()
    network.icon(answer)
    const result = await publish()
    assert.deepEqual([result.ok, result.icon], [true, false])
    assert.equal(network.object().icon, null)
    assert.equal(network.object().members, 31)
  }

  network.storage.clear()
  const iconFetches = () => network.calls.filter((c) => c.host === "cdn.discordapp.com").length
  const before = iconFetches()
  for (const guild of [
    { icon: "../../evil" },
    { icon: null },
    { id: "evil.example" },
    { id: "1/../../x" },
  ]) {
    network.invite({ status: 200, body: realInvite({ guild }) })
    const result = await publish()
    assert.equal(result.ok, true)
    assert.equal(network.object().icon, null)
  }
  assert.equal(iconFetches(), before, "a malformed id or hash is never put in a URL")
})

test("D5: the Worker's scheduled handler runs it at its minutes, and a storage failure is not a success", async () => {
  const scheduled = (minute, extra = {}) =>
    worker.scheduled(
      { cron: ICONOPLASM_RECURRING_CRON, scheduledTime: at(minute) },
      { ...BUNNY, ...extra },
      { waitUntil() {} },
    )
  for (const minute of ICONOPLASM_BACKGROUND_MINUTES.discordInvite) {
    network.storage.clear()
    await scheduled(minute)
    assert.equal(network.object()?.members, 31, `minute ${minute} published the card`)
  }
  network.storage.clear()
  await scheduled(ICONOPLASM_BACKGROUND_MINUTES.discordInvite[0], {
    ICONOPLASM_SCHEMA_TRANSITION: "1",
  })
  assert.equal(network.object(), null, "a schema transition pauses it with the other jobs")

  network.failWrites(true)
  await assert.rejects(
    scheduled(ICONOPLASM_BACKGROUND_MINUTES.discordInvite[0]),
    /PUT failed|External portrait PUT failed/,
  )
})

test("D6: with no store configured the job says so instead of throwing", async () => {
  const result = await publishDiscordInviteObject({})
  assert.equal(result.ok, false)
  assert.equal(result.reason, "storage_unconfigured")
  assert.equal(result.members, 31)
})

test("D7: the page, the publisher, the page policy and the pull zone agree, and the page never talks to Discord", () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8")
  const app = read("../quartz/static/iconoplasm/app.js")
  assert.ok(
    app.includes(`"https://img.brinedew.bio/${DISCORD_INVITE_OBJECT_KEY}"`),
    "the page reads the object the publisher writes",
  )
  assert.ok(
    !/discord\.com\/api|cdn\.discordapp\.com\/icons/.test(app),
    "the page asks Discord nothing",
  )

  const edge = read("../scripts/prepare-iconoplasm-edge-assets.mjs")
  const connect = edge.match(/"connect-src ([^"]*)"/)[1].split(" ")
  assert.ok(connect.includes("https://img.brinedew.bio"))
  assert.ok(
    !connect.some((source) => /discord/.test(source)),
    "the policy lets the page reach Discord",
  )

  const zone = JSON.parse(read("../bunny/the-only-iconoplasm-pull-zone-policy.json"))
  const rule = zone.edgeRules.find((candidate) => /60 s edge cache/.test(candidate.description))
  assert.ok(
    rule.triggers[0].patternMatches.includes(
      `*/${DISCORD_INVITE_OBJECT_KEY.split("/").slice(0, 2).join("/")}/*`,
    ),
  )
  assert.ok(rule.purgeOnChange.includes("community/v1/*"))
  assert.ok(zone.ensureAccessControlOriginHeaderExtensions.includes("json"))
})
