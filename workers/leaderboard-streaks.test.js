// The "Top Streaks" leaderboard reads a bounded number of D1 rows however many accounts exist
// (B-959). Every desktop page load makes one read of `GET /api/stats/leaderboard?limit=5`; the
// join over every account it used to run cost about 3 rows an account (the `stats` row, the
// `users` index entry and the `users` row), so a day of page loads spent the 5,000,000 rows the
// free plan allows after a few hundred accounts. It now reads `leaderboard_streaks`, a small
// table holding exactly the accounts the join could ever show, which triggers keep equal to it.
//
// Everything runs through the real Worker on a real local D1 (Miniflare) with the account
// tables as production has them (columns and indexes read on 2026-10-03). A population is the
// production shape (7.8% public, 28% with a `stats` row) at 1,000, 10,000 and 100,000
// accounts, and an adversarial one in which every long streak is private or no longer played.
//
// Failure modes this file proves, each written before the code that fixes it:
//   L1  the read costs more rows as accounts grow (1,000, 10,000, 100,000 accounts)
//   L2  accounts with long streaks that are private or no longer played crowd out the public
//       accounts that played today or yesterday, or make the read walk past them
//   L3  the board differs from the join it replaces: order and ties (streak, wins, first to
//       reach it, id), the limit, today and yesterday in and the day before out, private and
//       zero-streak accounts out
//   L4  the board drifts after a writer runs: a finished game (a win that extends or restarts
//       the streak, a loss), the visibility switch, a Discord login that flips it, an account
//       erasure, a deleted `stats` row, the one-time import, and a streak that goes stale
//   L5  the first read on a database that has the accounts and no board builds a wrong board,
//       rebuilds on every read, or fails when two reads arrive together
//   L6  the stats write path costs more rows for an account that is not public, or more than 3
//       extra for one that is, or fails when the board cannot be written
// The numbers land in artifacts/b-959/leaderboard-rows-read[.<ROWS_LABEL>].json.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test, { after, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  LEADERBOARD_ORACLE_SQL,
  accountPopulation,
  geneguessrWorkerEnv,
  isoDay,
  meteredDb,
  openCatalogDb,
  seedAccounts,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"
const OUT = process.env.ROWS_OUT || path.join(import.meta.dirname, "..", "artifacts", "b-959")
// Rows a read of the board may cost for `limit` entries: the first `limit` of today and of
// yesterday from a covering index (2 x limit entries), their `users` rows (an index entry and a
// row each, at most 2 x limit more), and a few for the end of each range.
const readBound = (limit) => 4 * limit + 8
const measured = { sizes: {}, writes: {} }

after(() => {
  mkdirSync(OUT, { recursive: true })
  const label = process.env.ROWS_LABEL ? `.${process.env.ROWS_LABEL}` : ""
  writeFileSync(
    path.join(OUT, `leaderboard-rows-read${label}.json`),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        note: "rows_read and rows_written of GET /api/stats/leaderboard?limit=5 through the real Worker on a local D1 with production's account tables; the free plan allows 5,000,000 rows read and 100,000 rows written a day",
        ...measured,
      },
      null,
      2,
    ),
  )
})

// A Worker env on `db` whose sessions answer for the accounts in `sessions` (cookie value to
// user id), and whose result ledger returns what `results` holds for a user. This is as much of
// the Durable Object as the stats routes use.
function accountEnv(db, { sessions = new Map(), results = new Map() } = {}) {
  const harness = geneguessrWorkerEnv(db)
  const base = harness.env.GAME_SESSIONS.get
  harness.env.GAME_SESSIONS.get = (id) => {
    if (id.startsWith("session:")) {
      const userId = sessions.get(id.slice("session:".length))
      return {
        async fetch(input) {
          const url = new URL(typeof input === "string" ? input : input.url)
          if (url.pathname === "/store") return Response.json({ ok: true })
          if (!userId) return new Response("none", { status: 404 })
          return Response.json({ user_id: userId, username: `name-${userId}`, tier: "registered" })
        },
      }
    }
    if (id.startsWith("user_")) {
      const userId = id.slice("user_".length)
      return {
        async fetch(input, init = {}) {
          const url = new URL(typeof input === "string" ? input : input.url)
          if (url.pathname === "/game/results" && !init.method) {
            return Response.json(results.get(userId) || [])
          }
          if (url.pathname === "/game/results/ack") {
            const { date } = JSON.parse(init.body)
            results.set(
              userId,
              (results.get(userId) || []).filter((result) => result.date !== date),
            )
            return Response.json({ ok: true })
          }
          return new Response("unsupported", { status: 404 })
        },
      }
    }
    return base(id)
  }
  return harness.env
}

async function request(env, pathAndQuery, { method = "GET", cookie, body } = {}) {
  for (const logger of ["log", "warn", "info", "error"]) mock.method(console, logger, () => {})
  try {
    const response = await worker.fetch(
      new Request(`${ORIGIN}${pathAndQuery}`, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { waitUntil() {} },
    )
    const text = await response.text()
    return { response, payload: text ? JSON.parse(text) : null }
  } finally {
    mock.restoreAll()
  }
}

// What the page shows: rank, name and streak, from the route.
async function boardFromRoute(env, limit) {
  const { response, payload } = await request(env, `/api/stats/leaderboard?limit=${limit}`)
  assert.equal(response.status, 200)
  return payload.entries.map((entry) => ({
    rank: entry.rank,
    username: entry.username,
    currentStreak: entry.currentStreak,
  }))
}
// What the join it replaces says, run on the same database.
async function boardFromOracle(db, limit) {
  const { results } = await db.prepare(LEADERBOARD_ORACLE_SQL).bind(limit).all()
  return results.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    currentStreak: row.current_streak,
  }))
}
const agrees = async (db, env, limit, message) =>
  assert.deepEqual(
    await boardFromRoute(env, limit),
    await boardFromOracle(db, limit),
    `${message} (limit ${limit})`,
  )

async function population(size, options) {
  const { db, dispose } = await openCatalogDb()
  await seedAccounts(db, accountPopulation(size, options))
  return { db, dispose }
}

// One read through the real Worker with the statements' receipts.
async function meteredRead(db, limit = 5) {
  const metered = meteredDb(db)
  const env = accountEnv(metered)
  const board = await boardFromRoute(env, limit)
  return { board, metered, env }
}

for (const shape of ["production", "adversarial"]) {
  for (const size of [1000, 10000, 100000]) {
    test(`L1/L2: ${size.toLocaleString("en")} ${shape} accounts: the read costs a bounded number of rows and the board is the join's`, async (t) => {
      const { db, dispose } = await population(size, { shape })
      try {
        const oracleRead = meteredDb(db)
        await oracleRead.prepare(LEADERBOARD_ORACLE_SQL).bind(5).all()

        const first = await meteredRead(db)
        const steady = await meteredRead(db)
        measured.sizes[`${shape} ${size}`] = {
          accounts: size,
          shape,
          joinRowsRead: oracleRead.totalRead(),
          firstReadRowsRead: first.metered.totalRead(),
          firstReadRowsWritten: first.metered.totalWritten(),
          steadyReadRowsRead: steady.metered.totalRead(),
          steadyReadRowsWritten: steady.metered.totalWritten(),
          entries: steady.board.length,
        }
        t.diagnostic(JSON.stringify(measured.sizes[`${shape} ${size}`]))

        assert.deepEqual(steady.board, await boardFromOracle(db, 5), "the board is the join's")
        if (shape === "adversarial") {
          assert.equal(steady.board.length, 5, "the live public accounts are all there")
        }
        assert.equal(steady.metered.totalWritten(), 0, "a read writes nothing")
        assert.ok(
          steady.metered.totalRead() <= readBound(5),
          `${steady.metered.totalRead()} rows read at ${size} accounts (bound ${readBound(5)})`,
        )
      } finally {
        await dispose()
      }
    })
  }
}

// A small population with every kind of account, for the checks that compare against the join.
const CAST = [
  // [id, public, streak, wins, played (days ago)]
  ["a1", 1, 12, 40, 0],
  ["a2", 1, 12, 40, 1], // ties a1 on streak and wins; played earlier, so it is listed first
  ["a3", 1, 12, 41, 1], // more wins: first
  ["a4", 1, 7, 9, 0],
  ["a5", 1, 7, 9, 0], // ties a4 completely: id order
  ["a6", 1, 3, 3, 1],
  ["a7", 1, 2, 2, 2], // played the day before yesterday: out
  ["a8", 1, 30, 90, 5], // a long streak nobody continued: out
  ["a9", 0, 25, 80, 0], // private: out
  ["b1", 1, 0, 5, 1], // streak 0: out
  ["b2", 1, 1, 1, 0],
  ["b3", 1, 1, 1, 1],
  ["b4", 1, 4, 4, 0],
  ["c1", 0, 5, 5, 1], // private, played yesterday
  ["c2", 0, 5, 5, 1],
]
async function castDatabase() {
  const { db, dispose } = await openCatalogDb()
  await seedAccounts(
    db,
    CAST.map(([id, isPublic, streak, wins, ago]) => ({
      id,
      username: `name-${id}`,
      avatar: null,
      isPublic: Boolean(isPublic),
      stats: { streak, wins, lastPlayed: isoDay(-ago) },
    })),
  )
  return { db, dispose }
}

test("L3: the board lists what the join lists, in its order, for every limit", async () => {
  const { db, dispose } = await castDatabase()
  try {
    const env = accountEnv(db)
    for (const limit of [1, 2, 3, 5, 8, 13, 25]) await agrees(db, env, limit, "cast")
    const names = (await boardFromRoute(env, 25)).map((entry) => entry.username)
    assert.deepEqual(names, [
      "name-a3",
      "name-a2",
      "name-a1",
      "name-a4",
      "name-a5",
      "name-b4",
      "name-a6",
      "name-b3", // streak 1 played yesterday: ahead of b2, who reached it today
      "name-b2",
    ])
  } finally {
    await dispose()
  }
})

// What the writers run, with the same statements the code runs.
const PROJECTION = `
  INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
  VALUES (?, 1, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    total_played = stats.total_played + 1,
    total_wins = stats.total_wins + excluded.total_wins,
    current_streak = CASE
      WHEN excluded.total_wins = 0 THEN 0
      WHEN stats.last_played_date = date(excluded.last_played_date, '-1 day') THEN stats.current_streak + 1
      ELSE 1 END,
    best_streak = MAX(stats.best_streak, CASE
      WHEN excluded.total_wins = 0 THEN 0
      WHEN stats.last_played_date = date(excluded.last_played_date, '-1 day') THEN stats.current_streak + 1
      ELSE 1 END),
    last_played_date = excluded.last_played_date
  WHERE stats.last_played_date IS NULL OR stats.last_played_date < excluded.last_played_date`
const LOGIN = `
  INSERT INTO users (discord_id, username, avatar_url, tier, leaderboard_opt_in, created_at, updated_at, account_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(discord_id) DO UPDATE SET
    username = excluded.username, avatar_url = excluded.avatar_url, tier = excluded.tier,
    leaderboard_opt_in = excluded.leaderboard_opt_in, updated_at = excluded.updated_at,
    account_id = excluded.account_id`

test("L4: after every kind of writer, the board is still the join", async () => {
  const { db, dispose } = await castDatabase()
  try {
    const sessions = new Map([...CAST.map(([id]) => id), "new1"].map((id) => [`s-${id}`, id]))
    const results = new Map()
    const env = accountEnv(db, { sessions, results })
    // The board is built by the first read; every step below runs against the built board.
    await agrees(db, env, 25, "built")
    const today = isoDay(0)
    const yesterday = isoDay(-1)
    const check = async (message) => {
      for (const limit of [3, 25]) await agrees(db, env, limit, message)
    }
    const finish = async (id, date, won) => {
      results.set(id, [{ date, won }])
      const { response } = await request(env, "/api/stats/update", {
        method: "POST",
        cookie: `session=s-${id}`,
        body: {},
      })
      assert.equal(response.status, 200, `${id} ${date}`)
    }
    const toggle = async (id, optIn) => {
      const { response } = await request(env, "/api/stats/leaderboard-visibility", {
        method: "POST",
        cookie: `session=s-${id}`,
        body: { optIn },
      })
      assert.equal(response.status, 200)
    }

    await finish("a4", today, true) // a4 played today already: the projection ignores a repeat
    await check("a repeat of today's game")
    await finish("a6", today, true) // played yesterday, wins today: streak 3 becomes 4
    await check("a streak extended")
    await finish("a2", today, false) // a loss: streak 0, off the board
    await check("a loss")
    await finish("a7", today, true) // played 2 days ago, wins today: the streak restarts at 1
    await check("a streak restarted")
    await finish("b1", today, true) // streak 0, wins today: on the board at 1
    await check("a first win after a loss")
    await toggle("a1", false)
    await check("a public account turns private")
    await toggle("a9", true) // private with a live streak of 25: on, first
    await check("a private account turns public")
    assert.equal((await boardFromRoute(env, 1))[0].username, "name-a9")
    await toggle("a9", true) // the same value again
    await check("the same choice again")

    // A Discord login upsert that flips the choice (auth.js), and one that does not.
    await db.prepare(LOGIN).bind("a4", "name-a4", null, "registered", 0, 0, 0, null).run()
    await check("a login that turns the board off")
    await db.prepare(LOGIN).bind("a4", "renamed", null, "registered", 1, 0, 0, null).run()
    await check("a login that turns it on and renames")
    await db.prepare(LOGIN).bind("a4", "renamed", null, "registered", 1, 0, 0, null).run()
    await check("a login that changes nothing")
    await db.prepare(LOGIN).bind("new1", "name-new1", null, "registered", 1, 0, 0, null).run()
    await check("a new account")
    await finish("new1", today, true) // its first game: a stats row is inserted
    await check("a first game")

    // Account erasure (workers/iconoplasm/account-erasure, B-987): the person's stats row goes
    // first (the trigger on `stats` takes the board row with it), the `users` row last
    // (brinedew-account-identity.js).
    await db.prepare("DELETE FROM stats WHERE user_id = ?").bind("a3").run()
    await db.prepare("DELETE FROM users WHERE discord_id = ?").bind("a3").run()
    await check("an erased account")

    // The one-time import of a browser's stats (stats.js) is an insert with a streak of its own.
    await db
      .prepare(
        `INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at)
         VALUES ('b3', 9, 9, 9, 9, ?, 1)
         ON CONFLICT(user_id) DO UPDATE SET total_played = excluded.total_played,
           total_wins = excluded.total_wins, current_streak = excluded.current_streak,
           best_streak = excluded.best_streak, migrated_at = excluded.migrated_at`,
      )
      .bind(yesterday)
      .run()
    await check("an import")

    // A row deleted by hand, and a streak that goes stale without any write at all.
    await db.prepare("DELETE FROM stats WHERE user_id = 'b4'").run()
    await check("a deleted stats row")
    await db
      .prepare("UPDATE stats SET last_played_date = ? WHERE user_id = 'a5'")
      .bind(isoDay(-2))
      .run()
    await check("a streak that is two days old")

    // And the projection itself, in the shapes the Worker issues it, on a fresh account.
    await db.prepare(LOGIN).bind("p1", "name-p1", null, "registered", 1, 0, 0, null).run()
    for (const [date, won] of [
      [isoDay(-3), 1],
      [isoDay(-2), 1],
      [isoDay(-1), 1],
      [isoDay(0), 0],
    ]) {
      await db.prepare(PROJECTION).bind("p1", won, won, won, date).run()
      await check(`p1 on ${date}`)
    }
  } finally {
    await dispose()
  }
})

test("L4b: a random sequence of writers never separates the board from the join", async () => {
  const { db, dispose } = await castDatabase()
  try {
    const env = accountEnv(db)
    await agrees(db, env, 25, "built")
    let state = 20261003
    const next = (n) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % n
    }
    const ids = [...CAST.map(([id]) => id), "r1", "r2", "r3"]
    for (const id of ["r1", "r2", "r3"]) {
      await db.prepare(LOGIN).bind(id, `name-${id}`, null, "registered", 1, 0, 0, null).run()
    }
    for (let step = 0; step < 160; step += 1) {
      const id = ids[next(ids.length)]
      const kind = next(6)
      if (kind === 0) {
        await db
          .prepare("UPDATE users SET leaderboard_opt_in = ? WHERE discord_id = ?")
          .bind(next(2), id)
          .run()
      } else if (kind === 1) {
        await db
          .prepare(PROJECTION)
          .bind(id, 1, 1, 1, isoDay(-next(4)))
          .run()
      } else if (kind === 2) {
        await db
          .prepare(PROJECTION)
          .bind(id, 0, 0, 0, isoDay(-next(4)))
          .run()
      } else if (kind === 3) {
        await db
          .prepare(
            "UPDATE stats SET current_streak = ?, total_wins = ?, last_played_date = ? WHERE user_id = ?",
          )
          .bind(next(6), next(6), isoDay(-next(4)), id)
          .run()
      } else if (kind === 4) {
        await db.prepare("DELETE FROM stats WHERE user_id = ?").bind(id).run()
      } else {
        await db
          .prepare(
            `INSERT OR REPLACE INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
             VALUES (?, 1, ?, ?, ?, ?)`,
          )
          .bind(id, next(6), next(6), next(6), isoDay(-next(4)))
          .run()
      }
      await agrees(db, env, [1, 3, 25][step % 3], `step ${step} (${kind}, ${id})`)
    }
  } finally {
    await dispose()
  }
})

test("L5: the first read on a database that has accounts and no board builds the board, once, and survives a race", async (t) => {
  const { db, dispose } = await population(3000, { shape: "production" })
  try {
    const hasBoard = async () =>
      (await db.prepare("SELECT name FROM sqlite_schema WHERE name = 'leaderboard_streaks'").all())
        .results.length
    assert.equal(await hasBoard(), 0)
    // Two first reads at once, as two isolates would make them.
    const metered = meteredDb(db)
    const env = accountEnv(metered)
    const [one, two] = await Promise.all([boardFromRoute(env, 5), boardFromRoute(env, 5)])
    const expected = await boardFromOracle(db, 5)
    assert.deepEqual(one, expected)
    assert.deepEqual(two, expected)
    assert.equal(await hasBoard(), 1)
    const members = (
      await db
        .prepare(
          `SELECT COUNT(*) AS n FROM stats s JOIN users u ON u.discord_id = s.user_id
           WHERE u.leaderboard_opt_in = 1 AND s.current_streak > 0 AND s.last_played_date IS NOT NULL`,
        )
        .all()
    ).results[0].n
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM leaderboard_streaks").all()).results[0].n,
      members,
      "one board row for every account the join could show",
    )
    t.diagnostic(
      `3,000 accounts, ${members} members: the first reads wrote ${metered.totalWritten()} rows`,
    )
    const again = await meteredRead(db)
    assert.equal(again.metered.totalWritten(), 0, "a second read builds nothing")
  } finally {
    await dispose()
  }
})

test("L6: a stats write costs an account that is not public nothing extra, and a public one at most 3 rows, built board or not", async (t) => {
  const { db, dispose } = await castDatabase()
  try {
    const sessions = new Map(CAST.map(([id]) => [`s-${id}`, id]))
    const results = new Map()
    // The D1 rows one finished game writes for one account.
    const costOf = async (id, date) => {
      const metered = meteredDb(db)
      const env = accountEnv(metered, { sessions, results })
      results.set(id, [{ date, won: true }])
      const { response } = await request(env, "/api/stats/update", {
        method: "POST",
        cookie: `session=s-${id}`,
        body: {},
      })
      assert.equal(response.status, 200)
      return metered.totalWritten()
    }
    // c1 and c2 are private, a6 and a2 public; all played yesterday with a streak, and win today.
    // A database whose board has not been built has no triggers, so a stats write there is the
    // stats write it always was.
    const today = isoDay(0)
    const unbuilt = { private: await costOf("c1", today), public: await costOf("a6", today) }
    await agrees(db, accountEnv(db, { sessions, results }), 25, "built")
    const built = { private: await costOf("c2", today), public: await costOf("a2", today) }
    measured.writes = { boardNotBuilt: unbuilt, boardBuilt: built }
    t.diagnostic(`a stats update writes ${JSON.stringify(measured.writes)} rows`)
    assert.deepEqual(unbuilt, { private: 1, public: 1 }, "the stats row and nothing else")
    assert.equal(built.private, 1, "a private account's write is the stats row and nothing else")
    assert.ok(built.public <= 1 + 3, `${built.public} rows for a public account`)
  } finally {
    await dispose()
  }
})
