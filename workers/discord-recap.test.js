// The daily Discord recap, through the real Worker.
//
// Every night at 00:03 UTC the Worker posts the day's GeneGuessr recap to the Discord channel:
// the target, how many players solved it, the top guesses, and the structure image the admin
// rendered (stored on Bunny, under a key that names the day, the exact target and the renderer).
// A day whose post failed is retried by the next run; a posted day is never posted twice; an
// image that was wrong can be corrected in place on the same Discord message.
//
// The Worker runs as it does in production: its `scheduled` cron and its routes, on a real local
// D1 (Miniflare) with the real GeneGuessr migrations. The only fakes are the two third parties it
// talks to over the network, Discord and Bunny Storage. The admin is signed in by a real sealed
// session cookie (B-1069).
//
// ARCHITECTURE FENCE [GG-002]: these tests deliberately distinguish an HTTP acknowledgement
// from exact retrievability of the uploaded image bytes. A storage answer of 200 (Bunny's
// upload success is 201), an acknowledged upload whose bytes cannot be read back and a lost
// acknowledgement are each tested, and the image of a recap is bound to its exact target.
//
// Failure modes this file proves, each written before the code that fixes it:
//   D1  a recap says "No guesses were recorded." for a day with guesses, claims a solve that
//       never happened, or posts the wrong target
//   D2  the structure image is posted for the wrong target, or a missing image stops the post
//       instead of posting text only
//   D3  a day is posted twice, or a failed post marks the day posted
//   D4  the cron stops at a missed day instead of catching up, or goes past the first day the
//       game had no puzzle
//   D5  correcting a posted recap posts a second message, rewrites the posted marker, or marks
//       a failed correction as done
//   G1  an upload is "stored" on a 200 that is not Bunny's 201, or without its exact bytes
//       readable back, or under a key that does not name the target
//   G2  a Bunny write that is slow to become readable, or whose acknowledgement is lost, fails
//       the upload instead of being absorbed
//   G3  the admin's yearly status check opens more than five storage connections at once
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { recordDailyGuessAggregates } from "./lib/guess-aggregates.js"
import {
  geneguessrWorkerEnv,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

const ORIGIN = "https://geneguessr.brinedew.bio"
const CHANNEL = "987654321"
const BOT_CRON_TOKEN = "cron-token"
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_BASE64 = "iVBORw0KGgo="
const BUNNY = {
  ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "storage-access-key",
}
const imageKey = (day, uniprot) => `discord-recap-images/v2/${day}/${uniprot}/molstar-recap-v3.png`

// The target of every recap, and the other proteins its players guessed.
const TARGET = { uniprot: "Q00001", gene: "TP53", full_name: "Cellular tumor antigen p53" }
const OTHER = { uniprot: "Q00002", gene: "BRCA1" }

let db
let dispose
let world

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  await seedCatalog(db, productionShapedCatalogRows().slice(0, 4))
  await db
    .prepare("UPDATE proteins SET gene = ?, full_name = ? WHERE uniprot = ?")
    .bind(TARGET.gene, TARGET.full_name, TARGET.uniprot)
    .run()
  await db
    .prepare("UPDATE proteins SET gene = ? WHERE uniprot = ?")
    .bind(OTHER.gene, OTHER.uniprot)
    .run()
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
  mock.method(globalThis, "fetch", (input, init) => edge(String(input?.url ?? input), init))
})
after(async () => {
  mock.restoreAll()
  await dispose()
})

// ---- the two third parties --------------------------------------------------------------------

// One fresh world per test: Discord's answers and posts, Bunny's objects, and the KV.
function newWorld({ discordStatus = 200, bunny = {}, withKv = {} } = {}) {
  const harness = geneguessrWorkerEnv(db)
  const kv = new Map(Object.entries(withKv))
  const state = {
    kv,
    discord: [],
    discordStatus,
    discordId: null,
    puts: [],
    reads: 0,
    storage: new Map(),
    putStatus: 201,
    lostPuts: 0,
    unreadableReads: 0,
    corruptStore: false,
    headInFlight: 0,
    headPeak: 0,
    admin: "admin-user",
    env: {
      ...harness.env,
      ...BUNNY,
      ...bunny,
      DISCORD_BOT_TOKEN: "discord-token",
      DISCORD_GENEGUESSR_CHANNEL_ID: CHANNEL,
      BOT_CRON_TOKEN,
      ADMIN_DISCORD_USER_ID: "admin-user",
      KV: {
        get: async (key) => kv.get(key) ?? null,
        put: async (key, value) => void kv.set(key, String(value)),
        delete: async (key) => void kv.delete(key),
        list: async ({ prefix = "" } = {}) => ({
          keys: [...kv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
          list_complete: true,
        }),
      },
      SESSION_SECRET: TEST_SESSION_SECRET,
    },
  }
  world = state
  return state
}

async function edge(url, init = {}) {
  const target = new URL(url)
  const method = init.method || "GET"
  if (target.host === "discord.com") {
    const body = init.body
    const form = body instanceof FormData
    const payload = JSON.parse(form ? body.get("payload_json") : body)
    const file = form ? body.get("files[0]") : null
    world.discord.push({
      method,
      path: target.pathname,
      authorization: init.headers?.Authorization,
      multipart: form,
      payload,
      filename: file?.name ?? null,
      image: file ? new Uint8Array(await file.arrayBuffer()) : null,
    })
    if (world.discordStatus !== 200) {
      return Response.json({ message: "Missing Access" }, { status: world.discordStatus })
    }
    const messageId = world.discordId || `message-${world.discord.length}`
    return Response.json({ id: messageId })
  }
  if (target.host === BUNNY.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST) {
    const key = target.pathname.replace(`/${BUNNY.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE}/`, "")
    if (init.headers?.AccessKey !== BUNNY.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD) {
      return new Response("unauthorized", { status: 401 })
    }
    if (method === "PUT") {
      const bytes = new Uint8Array(init.body)
      world.puts.push({ key, bytes })
      // Bunny answers 201. Anything else is a proxy's or a bad zone's answer.
      if (world.putStatus !== 201) return new Response('{"Message":"Not Found"}', { status: 200 })
      if (world.lostPuts > 0) {
        world.lostPuts -= 1
        return new Response(null, { status: 201 })
      }
      world.storage.set(key, world.corruptStore ? new Uint8Array([9, 9, 9]) : bytes)
      world.reads = 0
      return new Response(null, { status: 201 })
    }
    if (method === "HEAD") {
      world.headInFlight += 1
      world.headPeak = Math.max(world.headPeak, world.headInFlight)
      await new Promise((resolve) => setImmediate(resolve))
      world.headInFlight -= 1
      const stored = world.storage.get(key)
      return stored
        ? new Response(null, { status: 200, headers: { "content-length": String(stored.length) } })
        : new Response(null, { status: 404 })
    }
    world.reads += 1
    const stored = world.storage.get(key)
    if (!stored || world.reads <= world.unreadableReads) return new Response(null, { status: 404 })
    return new Response(stored, { status: 200 })
  }
  return new Response("no such host in this test", { status: 599 })
}

// ---- helpers ------------------------------------------------------------------------------------

async function request(path, { method = "GET", headers = {}, body, cron = false } = {}) {
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cron ? { Authorization: `Bearer ${BOT_CRON_TOKEN}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    world.env,
    { waitUntil() {} },
  )
  return { status: response.status, payload: await response.json().catch(() => null), response }
}
const postRecap = (day) =>
  request(`/api/discord/post-recap?day=${day}`, { method: "POST", cron: true })
// The browser's sealed sign-in cookie names whoever `world.admin` is right now.
const asAdmin = async (path, options = {}) =>
  request(path, {
    ...options,
    headers: { Cookie: await sessionCookieFor({ user_id: world.admin }) },
  })

const dayAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const recordPuzzle = (day, uniprot = TARGET.uniprot) =>
  world.kv.set(`puzzle_actual:${day}`, JSON.stringify({ day, uniprot_id: uniprot }))
const posted = (day) => JSON.parse(world.kv.get(`discord_summary_posted:${day}`) || "null")
const guess = (protein) => ({ uniprot: protein.uniprot, protein: { gene: protein.gene } })
async function recordPlayers(day, guesses) {
  await db
    .prepare("DELETE FROM daily_guess_aggregate WHERE day = ?")
    .bind(day)
    .run()
    .catch(() => {})
  await recordDailyGuessAggregates(db, { day, targetUniprot: TARGET.uniprot, guesses })
}
const storeImage = (day, uniprot = TARGET.uniprot) => world.storage.set(imageKey(day, uniprot), PNG)

// ---- the post -----------------------------------------------------------------------------------

test("D1, D2, D3: a recap posts the target, the solvers, the top guesses and the stored image, once", async () => {
  newWorld()
  const day = "2026-07-17"
  recordPuzzle(day)
  storeImage(day)
  await recordPlayers(day, [guess(TARGET), guess(TARGET), guess(OTHER)])

  const first = await postRecap(day)
  assert.equal(first.status, 200)
  assert.equal(first.payload.image_source, "cached_object_storage")
  assert.equal(world.discord.length, 1)
  const [post] = world.discord
  assert.equal(post.method, "POST")
  assert.equal(post.path, `/api/v10/channels/${CHANNEL}/messages`)
  assert.equal(post.authorization, "Bot discord-token")
  assert.equal(post.multipart, true, "with an image the post is multipart")
  assert.equal(post.filename, `structure-${day}.png`)
  assert.deepEqual([...post.image], [...PNG], "the stored bytes, whole")
  assert.equal(
    post.payload.content,
    [
      "GeneGuessr for 17th of July, 2026",
      "**TP53**",
      "Cellular tumor antigen p53",
      "",
      "2 players solved it!",
      "",
      "Top guesses:",
      "1. TP53",
      "2. BRCA1",
      "",
      "Play today's puzzle: <https://geneguessr.brinedew.bio>",
    ].join("\n"),
  )
  assert.equal(posted(day).message_id, first.payload.message_id)
  assert.equal(posted(day).channel_id, CHANNEL)

  const second = await postRecap(day)
  assert.equal(second.status, 200)
  assert.equal(second.payload.skipped, "already_posted")
  assert.equal(world.discord.length, 1, "a posted day is not posted again")
})

test("D1, D2: with no image the recap posts as text, and says what was recorded and no more", async () => {
  newWorld()
  const quiet = "2026-07-10"
  const unsolved = "2026-07-11"
  const solvedByOne = "2026-07-12"
  for (const day of [quiet, unsolved, solvedByOne]) recordPuzzle(day)
  await recordPlayers(unsolved, [guess(OTHER), guess(OTHER)])
  await recordPlayers(solvedByOne, [guess(TARGET)])

  for (const day of [quiet, unsolved, solvedByOne]) assert.equal((await postRecap(day)).status, 200)

  assert.deepEqual(
    world.discord.map((post) => [post.multipart, post.image, post.filename]),
    [
      [false, null, null],
      [false, null, null],
      [false, null, null],
    ],
    "no stored image: a JSON post",
  )
  const [none, noSolve, one] = world.discord.map((post) => post.payload.content)
  assert.match(none, /No guesses were recorded\./)
  assert.doesNotMatch(none, /No solve was recorded|solved it|Top guesses/)
  assert.match(noSolve, /No solve was recorded\./)
  assert.match(noSolve, /1\. BRCA1/)
  assert.match(one, /1 player solved it!/, "one solver is singular")
})

test("D2: a stored image is only ever the image of that day's exact target", async () => {
  newWorld()
  const day = "2026-07-13"
  recordPuzzle(day)
  storeImage(day, OTHER.uniprot)
  assert.equal((await postRecap(day)).status, 200)
  assert.equal(world.discord[0].multipart, false, "another protein's image is not posted")
})

test("D3: a refused post leaves the day unposted and recorded as failed; the next run posts it", async () => {
  newWorld({ discordStatus: 403 })
  const day = "2026-07-14"
  recordPuzzle(day)
  const refused = await postRecap(day)
  assert.equal(refused.status, 500)
  assert.equal(refused.payload.error, "post_failed")
  assert.equal(refused.payload.stage, "discord_post")
  assert.match(refused.payload.details, /Discord API 403/)
  assert.equal(posted(day), null, "a refused post is not posted")
  assert.equal(
    JSON.parse(world.kv.get(`discord_summary_post_failure:${day}`)).stage,
    "discord_post",
  )

  world.discordStatus = 200
  const retried = await postRecap(day)
  assert.equal(retried.status, 200)
  assert.equal(world.kv.has(`discord_summary_post_failure:${day}`), false, "the failure is cleared")
  assert.ok(posted(day))
})

test("a recap for a day with no puzzle, or from a caller without the bot token, posts nothing", async () => {
  newWorld()
  const none = await postRecap("2026-01-01")
  assert.equal(none.payload.skipped, "no_puzzle_data")
  const refused = await request("/api/discord/post-recap?day=2026-01-01", { method: "POST" })
  assert.equal(refused.status, 401)
  assert.equal(world.discord.length, 0)
})

// ---- the cron -----------------------------------------------------------------------------------

const cron = () => worker.scheduled({ cron: "3 0 * * *" }, world.env, { waitUntil() {} })

test("D4: the 00:03 UTC cron posts yesterday, catches up a missed day, and leaves a posted day alone", async () => {
  const [yesterday, missed, earlier] = [dayAgo(1), dayAgo(2), dayAgo(3)]
  newWorld({
    withKv: { [`discord_summary_posted:${earlier}`]: JSON.stringify({ message_id: "old" }) },
  })
  for (const day of [yesterday, missed, earlier]) recordPuzzle(day)

  await cron()

  assert.equal(world.discord.length, 2, "yesterday once, and the one missed day")
  assert.ok(posted(yesterday) && posted(missed))
  assert.equal(posted(earlier).message_id, "old", "an already posted day is left alone")

  await cron()
  assert.equal(world.discord.length, 2, "a second run posts nothing")
})

test("D4: the catch-up stops at the first day the game had no puzzle", async () => {
  const [yesterday, noPuzzle, beforeLaunch] = [dayAgo(1), dayAgo(2), dayAgo(3)]
  newWorld()
  recordPuzzle(yesterday)
  recordPuzzle(beforeLaunch)
  assert.equal(world.kv.has(`puzzle_actual:${noPuzzle}`), false)

  await cron()

  assert.ok(posted(yesterday))
  assert.equal(posted(noPuzzle), null)
  assert.equal(posted(beforeLaunch), null, "nothing past the first day without a puzzle")
  assert.equal(world.discord.length, 1)
})

test("D4: a failed night is posted by the next night's run", async () => {
  newWorld({ discordStatus: 503 })
  const yesterday = dayAgo(1)
  recordPuzzle(yesterday)
  await cron()
  assert.equal(posted(yesterday), null)
  assert.ok(world.kv.has(`discord_summary_post_failure:${yesterday}`))

  world.discordStatus = 200
  await cron()
  assert.ok(posted(yesterday))
})

// ---- correcting a posted recap ------------------------------------------------------------------

const MESSAGE = "1527828214741729370"
function postedRecap(day) {
  newWorld({
    withKv: {
      [`discord_summary_posted:${day}`]: JSON.stringify({
        message_id: MESSAGE,
        channel_id: CHANNEL,
        posted_at: 123456789,
      }),
    },
  })
  recordPuzzle(day)
  world.discordId = MESSAGE
}

test("D5: a correction replaces the content and the image of the same Discord message in one edit", async () => {
  const day = "2026-08-03"
  postedRecap(day)
  storeImage(day)
  const before = world.kv.get(`discord_summary_posted:${day}`)

  const repaired = await asAdmin("/api/admin/repair-posted-recap", {
    method: "POST",
    body: { day },
  })

  assert.equal(repaired.status, 200)
  assert.equal(repaired.payload.message_id, MESSAGE)
  assert.equal(world.discord.length, 1)
  const [edit] = world.discord
  assert.equal(edit.method, "PATCH")
  assert.equal(edit.path, `/api/v10/channels/${CHANNEL}/messages/${MESSAGE}`)
  assert.equal(edit.payload.attachments[0].filename, `structure-${day}.png`)
  assert.match(edit.payload.content, /\*\*TP53\*\*/)
  assert.deepEqual([...edit.image], [...PNG])
  assert.equal(world.kv.get(`discord_summary_posted:${day}`), before, "the marker is not rewritten")
})

test("D5: a correction with no stored image, or one Discord refuses, changes nothing and can be retried", async () => {
  const day = "2026-08-04"
  postedRecap(day)
  const before = world.kv.get(`discord_summary_posted:${day}`)

  const missing = await asAdmin("/api/admin/repair-posted-recap", { method: "POST", body: { day } })
  assert.equal(missing.status, 409)
  assert.equal(missing.payload.error, "recap_image_missing")
  assert.equal(world.discord.length, 0, "nothing is sent without the corrected image")

  storeImage(day)
  world.discordStatus = 403
  const refused = await asAdmin("/api/admin/repair-posted-recap", { method: "POST", body: { day } })
  assert.equal(refused.status, 502)
  assert.equal(refused.payload.error, "recap_repair_failed")
  assert.equal(world.kv.get(`discord_summary_posted:${day}`), before)

  world.discordStatus = 200
  const retried = await asAdmin("/api/admin/repair-posted-recap", { method: "POST", body: { day } })
  assert.equal(retried.status, 200)
  assert.deepEqual(
    world.discord.map((call) => [call.method, call.path.split("/").pop()]),
    [
      ["PATCH", MESSAGE],
      ["PATCH", MESSAGE],
    ],
    "both attempts edit the one message and never post a second",
  )
})

test("D5: a Discord answer naming another message is refused and the marker stays", async () => {
  const day = "2026-08-05"
  postedRecap(day)
  storeImage(day)
  world.discordId = "a-different-message"
  const before = world.kv.get(`discord_summary_posted:${day}`)
  const repaired = await asAdmin("/api/admin/repair-posted-recap", {
    method: "POST",
    body: { day },
  })
  assert.equal(repaired.status, 502)
  assert.match(repaired.payload.details, /different message id/)
  assert.equal(world.kv.get(`discord_summary_post_failure:${day}`), undefined)
  assert.equal(world.kv.get(`discord_summary_posted:${day}`), before)
})

test("a correction needs the admin, and a day that was never posted cannot be corrected", async () => {
  const day = "2026-08-06"
  newWorld()
  recordPuzzle(day)
  const anonymous = await request("/api/admin/repair-posted-recap", {
    method: "POST",
    body: { day },
  })
  assert.equal(anonymous.status, 403)
  world.admin = "someone-else"
  const stranger = await asAdmin("/api/admin/repair-posted-recap", {
    method: "POST",
    body: { day },
  })
  assert.equal(stranger.status, 403)
  world.admin = "admin-user"
  const unposted = await asAdmin("/api/admin/repair-posted-recap", {
    method: "POST",
    body: { day },
  })
  assert.equal(unposted.payload.error, "recap_not_posted")
  assert.equal(world.discord.length, 0)
})

// ---- the image the admin uploads ----------------------------------------------------------------

// The read-after-write delays are real seconds in production; here they run at once, and the
// ones the storage code asked for are kept.
async function withInstantDelays(run) {
  const real = globalThis.setTimeout
  const asked = []
  globalThis.setTimeout = (callback, delay, ...rest) => {
    if ([1000, 2000, 4000, 8000].includes(delay)) asked.push(delay)
    return real(callback, [1000, 2000, 4000, 8000].includes(delay) ? 0 : delay, ...rest)
  }
  try {
    return await run(asked)
  } finally {
    globalThis.setTimeout = real
  }
}
const upload = (body) => asAdmin("/api/admin/discord-recap-image", { method: "POST", body })

test("G1: an upload is stored under its exact day, target and renderer, and read back whole", async () => {
  newWorld()
  const stored = await upload({ day: "2026-08-02", uniprot_id: "p08134", image_base64: PNG_BASE64 })
  assert.equal(stored.status, 200)
  assert.equal(stored.payload.uniprot_id, "P08134")
  assert.equal(stored.payload.render_contract, "molstar-recap-v3")
  assert.equal(stored.payload.verified_bytes, PNG.length)
  assert.equal(stored.payload.key, imageKey("2026-08-02", "P08134"))
  assert.deepEqual([...world.storage.get(imageKey("2026-08-02", "P08134"))], [...PNG])

  // The status of an image names its exact target: the same day for another protein is empty.
  const present = await asAdmin("/api/admin/discord-recap-image?day=2026-08-02&uniprot=P08134")
  assert.equal(present.payload.exists, true)
  assert.equal(present.payload.size, PNG.length)
  const other = await asAdmin("/api/admin/discord-recap-image?day=2026-08-02&uniprot=P01112")
  assert.equal(other.payload.exists, false)
  assert.equal(other.payload.key, imageKey("2026-08-02", "P01112"))

  const image = await asAdmin(
    "/api/admin/discord-recap-image?day=2026-08-02&uniprot=P08134&download=1",
  )
  assert.equal(image.status, 200)
  assert.match(
    image.response.headers.get("content-disposition"),
    /geneguessr-2026-08-02-P08134-molstar-recap-v3\.png/,
  )
})

test("G1: an image with no target, a bad day, bad bytes or a stranger's cookie is refused and stores nothing", async () => {
  newWorld()
  assert.equal((await upload({ day: "2026-08-02", image_base64: PNG_BASE64 })).status, 400)
  assert.equal(
    (await upload({ day: "08/02", uniprot_id: "P08134", image_base64: PNG_BASE64 })).status,
    400,
  )
  assert.equal(
    (await upload({ day: "2026-08-02", uniprot_id: "P08134", image_base64: "bm90IGEgcG5n" }))
      .status,
    400,
  )
  world.admin = "someone-else"
  assert.equal(
    (await upload({ day: "2026-08-02", uniprot_id: "P08134", image_base64: PNG_BASE64 })).status,
    403,
  )
  assert.equal(world.puts.length, 0)
})

test("G1: a 200 is not an upload, and neither is an acknowledged upload whose bytes cannot be read back", async () => {
  await withInstantDelays(async () => {
    newWorld()
    world.putStatus = 200
    const falseSuccess = await upload({
      day: "2026-08-02",
      uniprot_id: "P08134",
      image_base64: PNG_BASE64,
    })
    assert.equal(falseSuccess.status, 502)
    assert.match(falseSuccess.payload.error, /returned 200, expected 201/)

    newWorld()
    world.corruptStore = true
    const wrongBytes = await upload({
      day: "2026-08-02",
      uniprot_id: "P08134",
      image_base64: PNG_BASE64,
    })
    assert.equal(wrongBytes.status, 502)
    assert.match(wrongBytes.payload.error, /exact-byte read-back failed/)
    assert.ok(world.puts.length > 1, "the identical upload is repeated before it gives up")
    assert.ok(world.puts.every((put) => [...put.bytes].join() === [...PNG].join()))
  })
})

test("G2: a write that becomes readable late, or whose acknowledgement is lost, still lands", async () => {
  await withInstantDelays(async (asked) => {
    newWorld()
    world.unreadableReads = 4
    const slow = await upload({ day: "2026-08-02", uniprot_id: "P08134", image_base64: PNG_BASE64 })
    assert.equal(slow.status, 200)
    assert.equal(world.puts.length, 1, "waiting is enough, nothing is uploaded again")
    assert.deepEqual(asked, [1000, 2000, 4000, 8000])

    newWorld()
    world.lostPuts = 3
    const lost = await upload({ day: "2026-08-02", uniprot_id: "P08134", image_base64: PNG_BASE64 })
    assert.equal(lost.status, 200)
    assert.equal(world.puts.length, 4, "the fourth identical upload is the one that landed")
    assert.equal(lost.payload.verified_bytes, PNG.length)
  })
})

test("G3: the yearly status check never has more than five storage requests in flight", async () => {
  newWorld()
  world.storage.set(imageKey("2026-09-01", "Q00000"), PNG)
  const images = Array.from({ length: 40 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10)
    return `${day}~Q${String(index).padStart(5, "0")}`
  })
  const statuses = await asAdmin(`/api/admin/discord-recap-images?images=${images.join(",")}`)
  assert.equal(statuses.status, 200)
  assert.equal(statuses.payload.count, 40)
  assert.ok(world.headPeak > 1 && world.headPeak <= 5, `${world.headPeak} in flight`)
  assert.equal(statuses.payload.days["2026-09-01"].exists, true)
  assert.equal(statuses.payload.days["2026-09-02"].exists, false)
})
