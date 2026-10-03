// The "Top Streaks" object on the CDN (B-965). The box is on the first screen of every desktop; read
// from the Worker it cost a request a visit, and every avatar in it another through `/api/avatar`.
// A cron job now builds `leaderboard/v1/top.json` from the same read model the route uses, with the
// avatars embedded, and the page reads it from the CDN. Everything runs on a real local D1
// (Miniflare) with production's account tables; Bunny Storage and Discord's CDN are a fake `fetch`
// that records every request. The page's side (what it requests, what it draws, what it does when
// the CDN fails) is e2e/geneguessr-direct-structures.e2e.mjs.
//
// Failure modes this file proves, written before the code:
//   P1  the object says more than the board shows (an id, wins, a played day), lists a private or a
//       stale account, or lists them in another order than the route does
//   P2  an avatar that cannot be embedded (not Discord's host, 404, not an image, too big, a fetch
//       that throws) fails the publication or is embedded wrongly instead of leaving a name with no
//       picture; a host that is not Discord's is fetched at all
//   P3  the job writes when nothing changed, does not write when a streak, a name, an order, a
//       visibility or an avatar did, or purges the CDN (a purge re-pulls a stale replica for 30 days)
//   P4  a run reads more than the board's few rows, writes any D1 row, or makes more subrequests
//       than a free-plan invocation may
//   P5  the Worker's scheduled handler does not run it at its minutes, runs it during a schema
//       transition, or lets a storage failure pass as success
//   P6  an unconfigured store throws instead of saying so
//   P7  the page, the publisher, the document policy and the pull zone name different addresses, so
//       the page's fetch is blocked by the policy, or served by a rule that does not cache it for
//       60 s, and nobody sees it because the Worker route answers instead
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { afterEach, beforeEach, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_RECURRING_CRON,
} from "./iconoplasm-background-schedule.js"
import { LEADERBOARD_OBJECT_KEY } from "./lib/iconoplasm-published-card-objects.js"
import { AVATAR_BYTE_LIMIT, publishLeaderboardObject } from "./lib/leaderboard-publication.js"
import { publicContentSecurityPolicy } from "./lib/the-only-public-document-policy-do-not-duplicate.js"
import { readLeaderboard } from "./lib/leaderboard-streaks.js"
import {
  ensureAccountTables,
  geneguessrWorkerEnv,
  isoDay,
  meteredDb,
  openCatalogDb,
} from "./daily-selection-pool-test-d1.js"

const ZONE = "test-zone"
const KEY = "leaderboard/v1/top.json"
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
const OTHER_PNG = Buffer.concat([PNG, Buffer.from("changed")])
const BOARD_MINUTE = ICONOPLASM_BACKGROUND_MINUTES.geneguessrBoard[0]
const at = (minute, hour = 12) => Date.UTC(2026, 9, 3, hour, minute)

let db
let dispose
let metered
let network

beforeEach(async () => {
  ;({ db, dispose } = await openCatalogDb())
  await ensureAccountTables(db)
  metered = meteredDb(db)
  // The board exists on production (built by the first read); the measured runs start from there.
  await readLeaderboard(db, 5)
  network = fakeNetwork()
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
})
afterEach(async () => {
  mock.restoreAll()
  await dispose?.()
})

// Bunny Storage (keyed by object key) and Discord's CDN (keyed by path) behind `fetch`, with every
// request recorded.
function fakeNetwork() {
  const storage = new Map()
  const avatars = new Map()
  const calls = []
  let failWrites = false
  mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input?.url || input))
    const method = String(init.method || "GET").toUpperCase()
    calls.push({ method, host: url.host, path: url.pathname, search: url.search, init })
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
    if (url.host === "cdn.discordapp.com") {
      const answer = avatars.get(url.pathname) ?? { body: PNG, type: "image/png" }
      if (answer.throws) throw new DOMException("The operation was aborted", "AbortError")
      return new Response(answer.body ?? "not found", {
        status: answer.status ?? 200,
        headers: { "content-type": answer.type ?? "image/png" },
      })
    }
    throw new Error(`unexpected request to ${url.host}`)
  })
  return {
    storage,
    avatars,
    calls,
    failWrites: (value) => {
      failWrites = value
    },
    object: () =>
      storage.has(KEY) ? JSON.parse(Buffer.from(storage.get(KEY)).toString("utf8")) : null,
    puts: () => calls.filter((call) => call.method === "PUT"),
  }
}

const avatarUrl = (id) => `https://cdn.discordapp.com/avatars/${id}/hash.png`
async function seed(accounts) {
  const statements = []
  for (const account of accounts) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO users (discord_id, username, avatar_url, leaderboard_opt_in, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 0)`,
        )
        .bind(account.id, account.name, account.avatar ?? null, account.public === false ? 0 : 1),
      db
        .prepare(
          `INSERT OR REPLACE INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          account.id,
          account.wins ?? 40,
          account.wins ?? 40,
          account.streak,
          account.streak,
          isoDay(account.daysAgo ?? 0),
        ),
    )
  }
  await db.batch(statements)
}
const env = () => ({ DB: metered, ...BUNNY })
const publish = () => publishLeaderboardObject(env())

test("P1: the object is the board and nothing else: public live names, in the route's order, with no id, wins or day", async () => {
  await seed([
    { id: "1001", name: "Ada", streak: 12, avatar: avatarUrl("1001") },
    {
      id: "1002",
      name: "Barbara",
      streak: 7,
      avatar: "https://cdn.discordapp.com/embed/avatars/2.png",
    },
    { id: "1003", name: "Chien-Shiung", streak: 3 },
    { id: "1004", name: "Frank Private", streak: 30, public: false, avatar: avatarUrl("1004") },
    { id: "1005", name: "Eve Stale", streak: 9, daysAgo: 5, avatar: avatarUrl("1005") },
    { id: "1006", name: "Gina Zero", streak: 0 },
  ])
  const result = await publish()
  assert.deepEqual(
    {
      ok: result.ok,
      published: result.published,
      entries: result.entries,
      avatars: result.avatars,
    },
    { ok: true, published: true, entries: 3, avatars: 2 },
  )
  const object = network.object()
  assert.deepEqual(Object.keys(object), ["entries"])
  assert.deepEqual(
    object.entries.map((entry) => [entry.rank, entry.username, entry.currentStreak]),
    [
      [1, "Ada", 12],
      [2, "Barbara", 7],
      [3, "Chien-Shiung", 3],
    ],
  )
  for (const entry of object.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["avatarUrl", "currentStreak", "rank", "username"])
  }
  assert.match(object.entries[0].avatarUrl, /^data:image\/png;base64,/)
  assert.equal(
    Buffer.from(object.entries[0].avatarUrl.split(",")[1], "base64").equals(PNG),
    true,
    "the avatar is the bytes Discord sent",
  )
  assert.equal(object.entries[2].avatarUrl, null, "no picture, no avatar")
  const text = JSON.stringify(object)
  for (const hidden of ["Frank", "Eve", "Gina", "1001", "1004", "wins", "last_played"]) {
    assert.equal(text.includes(hidden), false, `the object does not say "${hidden}"`)
  }

  // The route says the same names in the same order; only the picture's address differs.
  const route = await (
    await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/stats/leaderboard?limit=5"),
      { ...geneguessrWorkerEnv(metered).env },
      { waitUntil() {} },
    )
  ).json()
  assert.deepEqual(
    route.entries.map(({ rank, username, currentStreak }) => ({ rank, username, currentStreak })),
    object.entries.map(({ rank, username, currentStreak }) => ({ rank, username, currentStreak })),
  )
  assert.match(route.entries[0].avatarUrl, /^\/api\/avatar\?src=/)
})

test("P2: an avatar that cannot be embedded leaves the name with no picture and never fails the publication", async () => {
  const bad = (answer, id) => network.avatars.set(`/avatars/${id}/hash.png`, answer)
  bad({ status: 404 }, "2001")
  bad({ body: "<html>", type: "text/html" }, "2002")
  bad({ body: Buffer.alloc(AVATAR_BYTE_LIMIT + 1, 1), type: "image/png" }, "2003")
  await seed([
    { id: "2001", name: "Gone", streak: 9, avatar: avatarUrl("2001") },
    { id: "2002", name: "NotAnImage", streak: 8, avatar: avatarUrl("2002") },
    { id: "2003", name: "TooBig", streak: 7, avatar: avatarUrl("2003") },
    {
      id: "2005",
      name: "ElsewhereHost",
      streak: 6,
      avatar: "https://evil.example/avatars/2005/hash.png",
    },
    { id: "2006", name: "Fine", streak: 5, avatar: avatarUrl("2006") },
  ])
  const result = await publish()
  assert.equal(result.ok, true)
  const object = network.object()
  assert.deepEqual(
    object.entries.map((entry) => [entry.username, entry.avatarUrl === null]),
    [
      ["Gone", true],
      ["NotAnImage", true],
      ["TooBig", true],
      ["ElsewhereHost", true],
      ["Fine", false],
    ],
    "every name is there; only the one good picture is",
  )
  assert.equal(
    network.calls.some((call) => call.host === "evil.example"),
    false,
    "a host that is not Discord's is never fetched",
  )
  for (const call of network.calls.filter((item) => item.host === "cdn.discordapp.com")) {
    assert.equal(new URLSearchParams(call.search).get("size"), "64")
    assert.equal(call.init.redirect, "manual", "a redirect is not followed")
  }
  assert.ok(JSON.stringify(object).length < 2_000, "no oversize body was embedded")
})

test("P2b: a fetch that throws (a timeout) is a missing picture, not a failed publication", async () => {
  network.avatars.set("/avatars/2101/hash.png", { throws: true })
  await seed([
    { id: "2101", name: "Slow", streak: 9, avatar: avatarUrl("2101") },
    { id: "2102", name: "Fine", streak: 8, avatar: avatarUrl("2102") },
  ])
  const result = await publish()
  assert.equal(result.ok, true)
  assert.deepEqual(
    network.object().entries.map((entry) => [entry.username, entry.avatarUrl === null]),
    [
      ["Slow", true],
      ["Fine", false],
    ],
  )
})

test("P3: the job writes when the board moved and not when it did not, and never purges", async () => {
  await seed([
    { id: "3001", name: "Ada", streak: 12, avatar: avatarUrl("3001") },
    { id: "3002", name: "Barbara", streak: 7, avatar: avatarUrl("3002") },
  ])
  const first = await publish()
  assert.equal(first.published, true)
  assert.equal(network.puts().length, 1)

  const quiet = await publish()
  assert.equal(quiet.published, false, "nothing changed")
  assert.equal(network.puts().length, 1, "so nothing was written")

  const moved = async (change, expectation) => {
    await change()
    const before = network.puts().length
    const result = await publish()
    assert.equal(result.published, true, expectation)
    assert.equal(network.puts().length, before + 1, expectation)
  }
  await moved(
    () =>
      db
        .prepare("UPDATE stats SET current_streak = 20, total_wins = 50 WHERE user_id = '3002'")
        .run(),
    "a longer streak changes the order",
  )
  assert.deepEqual(
    network.object().entries.map((entry) => entry.username),
    ["Barbara", "Ada"],
  )
  await moved(
    () => db.prepare("UPDATE users SET username = 'Ada L.' WHERE discord_id = '3001'").run(),
    "a name changes the object",
  )
  await moved(
    () => network.avatars.set("/avatars/3001/hash.png", { body: OTHER_PNG, type: "image/png" }),
    "a new picture changes the object",
  )
  await moved(
    () => db.prepare("UPDATE users SET leaderboard_opt_in = 0 WHERE discord_id = '3002'").run(),
    "an account that goes private leaves the object",
  )
  assert.deepEqual(
    network.object().entries.map((entry) => entry.username),
    ["Ada L."],
  )
  await moved(
    () => db.prepare("UPDATE users SET leaderboard_opt_in = 0 WHERE discord_id = '3001'").run(),
    "the last public account leaving writes an empty board",
  )
  assert.deepEqual(network.object(), { entries: [] })
  assert.equal(
    network.calls.some((call) => call.host === "api.bunny.net"),
    false,
    "no purge",
  )
})

test("P4: a run reads a few rows, writes none and makes a handful of subrequests", async (t) => {
  await seed(
    Array.from({ length: 8 }, (_, index) => ({
      id: `400${index}`,
      name: `Player ${index}`,
      streak: 10 - index,
      avatar: avatarUrl(`400${index}`),
    })),
  )
  await publish() // the first run also drops the unused users index (B-966)
  const callsBefore = network.calls.length
  const from = metered.receipts.length
  const result = await publish()
  const receipts = metered.receipts.slice(from)
  const read = receipts.reduce((sum, receipt) => sum + receipt.rows_read, 0)
  const written = receipts.reduce((sum, receipt) => sum + receipt.rows_written, 0)
  const subrequests = network.calls.length - callsBefore
  t.diagnostic(
    `${result.entries} entries, ${result.avatars} avatars: ${read} D1 rows read, ${written} written, ${subrequests} subrequests (an unchanged board)`,
  )
  assert.equal(result.published, false)
  assert.ok(read <= 28, `${read} rows read`)
  assert.equal(written, 0, "no D1 row written")
  assert.equal(result.entries, 5)
  assert.ok(subrequests <= 8, `${subrequests} subrequests for an unchanged board`)
  // A run that writes: five avatar fetches, the storage read, the write and its read-back.
  await db.prepare("UPDATE stats SET current_streak = 99 WHERE user_id = '4007'").run()
  const writing = network.calls.length
  await publish()
  assert.ok(network.calls.length - writing <= 10, `${network.calls.length - writing} subrequests`)
  assert.ok(network.calls.length - writing < 50, "far inside a free-plan invocation's 50")
})

test("P5: the Worker's scheduled handler runs it at its minutes, and a storage failure is not a success", async () => {
  await seed([{ id: "5001", name: "Ada", streak: 12, avatar: avatarUrl("5001") }])
  const harness = geneguessrWorkerEnv(metered)
  const scheduled = (minute, extra = {}) =>
    worker.scheduled(
      { cron: ICONOPLASM_RECURRING_CRON, scheduledTime: at(minute) },
      { ...harness.env, ...BUNNY, ...extra },
      { waitUntil() {} },
    )

  for (const minute of ICONOPLASM_BACKGROUND_MINUTES.geneguessrBoard) {
    network.storage.clear()
    await scheduled(minute)
    assert.deepEqual(
      network.object()?.entries.map((entry) => entry.username),
      ["Ada"],
      `minute ${minute} published the board`,
    )
  }

  network.storage.clear()
  await scheduled(BOARD_MINUTE, { ICONOPLASM_SCHEMA_TRANSITION: "1" })
  assert.equal(network.object(), null, "a schema transition pauses it with the other jobs")

  network.failWrites(true)
  network.storage.clear()
  await assert.rejects(scheduled(BOARD_MINUTE), /PUT failed|External portrait PUT failed/)
})

test("P6: with no store configured the job says so instead of throwing", async () => {
  await seed([{ id: "6001", name: "Ada", streak: 12 }])
  const result = await publishLeaderboardObject({ DB: metered })
  assert.equal(result.ok, false)
  assert.equal(result.reason, "storage_unconfigured")
  assert.equal(result.entries, 1)
  assert.deepEqual(await publishLeaderboardObject({}), { ok: false, reason: "missing_db" })
})

test("P7: the page, the publisher, the document policy and the pull zone agree on one address", () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8")
  const toml = read("../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")
  const cdn = toml.match(/ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL = "([^"]+)"/)[1]
  assert.ok(
    read("../quartz/static/geneguessr/app.js").includes(`"${cdn}/${LEADERBOARD_OBJECT_KEY}"`),
    "the page reads the object the publisher writes, from the CDN the Worker publishes to",
  )
  const connect = (policy) => policy.match(/connect-src ([^;]*)/)[1].split(" ")
  assert.ok(connect(publicContentSecurityPolicy({ geneguessrGame: true })).includes(cdn))
  assert.ok(!connect(publicContentSecurityPolicy()).includes(cdn), "no other document needs it")
  assert.match(publicContentSecurityPolicy({ geneguessrGame: true }), /img-src [^;]*\bdata:/)

  const zone = JSON.parse(read("../bunny/the-only-iconoplasm-pull-zone-policy.json"))
  const rule = zone.edgeRules.find((candidate) => /60 s edge cache/.test(candidate.description))
  assert.ok(
    rule.triggers[0].patternMatches.includes(
      `*/${LEADERBOARD_OBJECT_KEY.split("/").slice(0, 2).join("/")}/*`,
    ),
  )
  assert.ok(rule.purgeOnChange.includes("leaderboard/v1/*"))
  assert.ok(zone.ensureAccessControlOriginHeaderExtensions.includes("json"))
})
