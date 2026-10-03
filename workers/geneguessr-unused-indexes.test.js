// Two indexes of the GeneGuessr database that no query needs, and what dropping them saves (B-964,
// B-966). D1 counts every index entry a statement writes as a row written, so an index nobody needs
// is paid for on every write. Everything runs on a real local D1 (Miniflare) with production's
// tables and indexes as `sqlite_master` listed them on 2026-10-03; each statement's own receipt
// (`rows_read`, `rows_written`) and `EXPLAIN QUERY PLAN` are the evidence. The controls recreate the
// index on the same data, so "before" and "after" are one run apart, not two code versions apart.
//
// Failure modes this file proves, written before the code:
//   U1  an aggregate reader, without `idx_daily_guess_aggregate_day_count`, stops being an index
//       search on `day` through the primary key (a table scan), or reads more than the day's rows
//       (the top 5 of the day reads 151 rows with the index and all of them without: a daily
//       recap and an admin click, against a row written on every guess)
//   U2  a guess still writes the second index entry: a steady-state guess costs 2 rows, a first
//       guess of a protein 3; the target is 1 and 2
//   U3  the code does not drop that index on first use, the drop costs D1 rows, or it runs a
//       statement more than once per isolate
//   U4  a statement that reads or writes `users` or `stats` plans through
//       `idx_users_leaderboard_opt_in` other than the one-time build of `leaderboard_streaks`, or
//       that build, without the index, reads more than half a row an account (the planner's own
//       choice reads a row an account, so the build pins its join order)
//   U5  a new account or a change of the public choice still writes the index entry (6 and 3 rows;
//       5 and 2 is the target)
//   U6  the leaderboard module drops the `users` index more than once per isolate, or for rows
import assert from "node:assert/strict"
import test from "node:test"

import {
  LEADERBOARD_ORACLE_SQL,
  accountPopulation,
  ensureAccountTables,
  meteredDb,
  openCatalogDb,
  seedAccounts,
} from "./daily-selection-pool-test-d1.js"

const DAY = "2026-10-03"
let copies = 0
const copy = (module) => import(`./lib/${module}.js?copy=${(copies += 1)}`)

const AGGREGATE_TABLE = `CREATE TABLE IF NOT EXISTS daily_guess_aggregate (
    day TEXT NOT NULL, target_uniprot TEXT, guess_uniprot TEXT NOT NULL, guess_gene TEXT,
    guess_count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    PRIMARY KEY (day, guess_uniprot))`
const AGGREGATE_INDEX = `CREATE INDEX IF NOT EXISTS idx_daily_guess_aggregate_day_count
    ON daily_guess_aggregate(day, guess_count)`
const indexNames = async (db, table) =>
  (
    await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
      .bind(table)
      .all()
  ).results.map((row) => row.name)

// A statement's plan, one line a step.
async function plan(db, { sql, args }) {
  const answer = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...args)
    .all()
  return answer.results.map((row) => row.detail)
}

// Runs `body` and returns what each statement it ran was charged, with the SQL and bound values
// of every one (to explain them afterwards).
async function receiptsOf(db, body) {
  const seen = []
  const metered = meteredDb(db, { before: (sql, args) => seen.push({ sql, args: args ?? [] }) })
  const result = await body(metered)
  return { metered, seen, result, read: metered.totalRead(), written: metered.totalWritten() }
}

test("U1-U3: the per-guess aggregate without its second index reads the same rows, writes one fewer per guess, and the code drops the index for no rows", async (t) => {
  const { db, dispose } = await openCatalogDb()
  try {
    // Production before the change: the table, its two indexes, and a viral day's 3,000 distinct
    // guessed proteins with their counts.
    await db.batch([db.prepare(AGGREGATE_TABLE), db.prepare(AGGREGATE_INDEX)])
    const proteins = Array.from({ length: 3000 }, (_, index) => ({
      uniprot: `P${String(index).padStart(5, "0")}`,
      gene: `GENE${index}`,
      count: 1 + ((index * 7919) % 40),
    }))
    await db
      .prepare(
        `INSERT INTO daily_guess_aggregate (day, target_uniprot, guess_uniprot, guess_gene, guess_count, updated_at)
         SELECT ?, 'P00007', json_extract(value, '$.uniprot'), json_extract(value, '$.gene'), json_extract(value, '$.count'), 1
         FROM json_each(?)`,
      )
      .bind(DAY, JSON.stringify(proteins))
      .run()
    assert.ok(
      (await indexNames(db, "daily_guess_aggregate")).includes(
        "idx_daily_guess_aggregate_day_count",
      ),
    )

    // U3: the first use in an isolate drops the index; the second runs no schema statement.
    const aggregates = await copy("guess-aggregates")
    const first = await receiptsOf(db, (metered) =>
      aggregates.getWinnersCount(metered, { day: DAY }),
    )
    const drop = first.metered.receipts.filter((receipt) => /DROP INDEX/.test(receipt.sql))
    assert.equal(drop.length, 1, "the first use drops the index")
    assert.equal(drop[0].rows_written, 0, "and it writes no D1 row")
    assert.equal(
      (await indexNames(db, "daily_guess_aggregate")).includes(
        "idx_daily_guess_aggregate_day_count",
      ),
      false,
    )
    const second = await receiptsOf(db, (metered) =>
      aggregates.getWinnersCount(metered, { day: DAY }),
    )
    assert.equal(
      second.metered.receipts.filter((receipt) => /DROP INDEX|CREATE/.test(receipt.sql)).length,
      0,
      "the same isolate runs no schema statement again",
    )
    t.diagnostic(`DROP INDEX on ${proteins.length} rows: ${JSON.stringify(drop[0])}`)

    // U1: the four readers, without the index, then with it.
    const readers = [
      (metered) => aggregates.getDailyGuessAggregates(metered, { day: DAY, limit: 5 }),
      (metered) => aggregates.getWinnersCount(metered, { day: DAY }),
      (metered) =>
        aggregates.getGuessAggregatesForDateRange(metered, {
          startDay: "2026-10-01",
          endDay: DAY,
          limit: 50,
        }),
    ]
    const readAll = (target) =>
      receiptsOf(target, async (metered) => {
        const answers = []
        for (const read of readers) answers.push(await read(metered))
        return answers
      })
    const without = await readAll(db)
    await db.prepare(AGGREGATE_INDEX).run()
    const withIndex = await readAll(db)
    await db.prepare("DROP INDEX idx_daily_guess_aggregate_day_count").run()

    assert.deepEqual(without.result, withIndex.result, "the readers answer the same")
    assert.equal(without.result[0].guesses.length, 5)
    for (const [index, name] of [
      "top 5 of the day",
      "winners of the day",
      "range of days",
    ].entries()) {
      const a = without.metered.receipts[index]
      const b = withIndex.metered.receipts[index]
      t.diagnostic(`${name}: ${a.rows_read} rows read without the index, ${b.rows_read} with it`)
      // Dropping the index adds at most an index entry and its row for each guessed protein of the
      // day to a reader; the winners and the range read the same rows either way.
      assert.ok(
        a.rows_read <= b.rows_read + 2 * proteins.length,
        `${name}: ${a.rows_read} rows read without the index, ${b.rows_read} with it`,
      )
    }
    for (const statement of without.seen) {
      const lines = await plan(db, statement)
      assert.ok(
        lines.some((line) =>
          /SEARCH daily_guess_aggregate USING (COVERING )?INDEX sqlite_autoindex_daily_guess_aggregate_1 \(day/.test(
            line,
          ),
        ),
        `an index search on day through the primary key: ${lines.join(" | ")}`,
      )
      assert.equal(
        lines.some((line) => /SCAN daily_guess_aggregate/.test(line)),
        false,
        "no table scan",
      )
    }
    const planWith = []
    await db.prepare(AGGREGATE_INDEX).run()
    for (const statement of withIndex.seen) planWith.push((await plan(db, statement)).join(" | "))
    await db.prepare("DROP INDEX idx_daily_guess_aggregate_day_count").run()
    t.diagnostic(`with the index the planner chose it: ${planWith.join(" || ")}`)

    // U2: what a guess costs, with the index (control) and without it.
    const record = (metered, uniprot) =>
      aggregates.recordDailyGuessAggregates(metered, {
        day: DAY,
        targetUniprot: "P00007",
        guesses: [{ uniprot, protein: { gene: "G" } }],
      })
    const cost = async (uniprot) =>
      (await receiptsOf(db, (metered) => record(metered, uniprot))).written
    const after = { steady: await cost("P00100"), first: await cost("NEW00001") }
    await db.prepare(AGGREGATE_INDEX).run()
    const before = { steady: await cost("P00101"), first: await cost("NEW00002") }
    await db.prepare("DROP INDEX idx_daily_guess_aggregate_day_count").run()
    t.diagnostic(
      `rows written by a guess, steady / first of a protein today: before ${before.steady} / ${before.first}, after ${after.steady} / ${after.first}`,
    )
    assert.deepEqual(before, { steady: 2, first: 3 }, "the control is what production wrote")
    assert.deepEqual(after, { steady: 1, first: 2 })
  } finally {
    await dispose()
  }
})

test("U4-U6: no statement plans through the users index, the build without it reads under half a row an account, and a new account and a switch write one row fewer", async (t) => {
  const { db, dispose } = await openCatalogDb()
  try {
    const OPT_IN_INDEX = "CREATE INDEX idx_users_leaderboard_opt_in ON users (leaderboard_opt_in)"
    // The fill as it was written before B-966: left to choose its join order, the planner took the
    // index when it existed and a scan of `users` when it did not.
    const OLD_FILL = `INSERT INTO leaderboard_streaks (user_id, last_played_date, current_streak, total_wins)
      SELECT s.user_id, date(s.last_played_date), s.current_streak, s.total_wins
      FROM stats s INNER JOIN users u ON u.discord_id = s.user_id
      WHERE u.leaderboard_opt_in = 1 AND s.current_streak > 0 AND date(s.last_played_date) IS NOT NULL
      ON CONFLICT(user_id) DO UPDATE SET last_played_date = excluded.last_played_date,
        current_streak = excluded.current_streak, total_wins = excluded.total_wins`
    const board = await copy("leaderboard-streaks")
    await seedAccounts(db, accountPopulation(10000))
    await db.prepare(OPT_IN_INDEX).run() // production before the change
    assert.ok((await indexNames(db, "users")).includes("idx_users_leaderboard_opt_in"))

    // The join the board replaced, for the cost to compare against.
    const join = await receiptsOf(db, (metered) =>
      metered.prepare(LEADERBOARD_ORACLE_SQL).bind(5).all(),
    )

    // The build the module runs, with the index there.
    const withIndex = await receiptsOf(db, (metered) => board.readLeaderboard(metered, 5))
    const fill = withIndex.seen.find((statement) =>
      statement.sql.trim().startsWith("INSERT INTO leaderboard_streaks"),
    )
    assert.ok(fill, "the build ran")
    const newWith = withIndex.metered.receipts.find((receipt) =>
      receipt.sql.startsWith("INSERT INTO leaderboard_streaks"),
    )
    const fillPlan = await plan(db, fill)
    assert.equal(
      fillPlan.some((line) => /idx_users_leaderboard_opt_in/.test(line)),
      false,
      `the build plans on primary keys: ${fillPlan.join(" | ")}`,
    )

    // The control: the old fill on the same accounts, with the index and without it.
    const oldFill = { sql: OLD_FILL, args: [] }
    await db.prepare("DELETE FROM leaderboard_streaks").run()
    const oldWith = await receiptsOf(db, (metered) => metered.prepare(OLD_FILL).run())
    const oldPlanWith = await plan(db, oldFill)
    assert.ok(
      oldPlanWith.some((line) => /idx_users_leaderboard_opt_in/.test(line)),
      "the old build chose the index",
    )

    // U6: the retire function runs once per isolate and writes nothing.
    const retiring = await copy("leaderboard-streaks")
    const retire = await receiptsOf(db, (metered) => retiring.retireLeaderboardOptInIndex(metered))
    const again = await receiptsOf(db, (metered) => retiring.retireLeaderboardOptInIndex(metered))
    assert.equal(retire.metered.receipts.length, 1)
    assert.equal(retire.written, 0, "the drop writes no D1 row")
    assert.equal(again.metered.receipts.length, 0, "and the same isolate does not run it again")
    assert.equal((await indexNames(db, "users")).includes("idx_users_leaderboard_opt_in"), false)

    await db.prepare("DELETE FROM leaderboard_streaks").run()
    const oldWithout = await receiptsOf(db, (metered) => metered.prepare(OLD_FILL).run())
    await db.prepare("DELETE FROM leaderboard_streaks").run()
    const newWithout = await receiptsOf(db, (metered) => metered.prepare(fill.sql).run())
    t.diagnostic(
      `the build at 10,000 accounts, rows read: the old fill ${oldWith.read} with the index and ${oldWithout.read} without; the fill now ${newWith.rows_read} with the index and ${newWithout.read} without; the join the board replaced ${join.read}`,
    )
    assert.ok(
      newWithout.read <= 0.5 * 10000,
      `the build reads ${newWithout.read} rows at 10,000 accounts without the index`,
    )
    assert.ok(
      newWithout.read < oldWithout.read,
      "pinning the join order is what makes dropping safe",
    )
    assert.equal(newWithout.written, oldWith.written, "and it writes the same board")

    // U4: every other statement that touches the accounts, explained on a database that has the
    // index, plans on primary keys.
    await db.prepare(OPT_IN_INDEX).run()
    const touching = [
      {
        sql: "SELECT user_id FROM leaderboard_streaks WHERE last_played_date = date('now') ORDER BY current_streak DESC, total_wins DESC, user_id ASC LIMIT 5",
        args: [],
      },
      {
        sql: "UPDATE stats SET current_streak = ?, total_wins = ?, last_played_date = ? WHERE user_id = ?",
        args: [3, 9, DAY, "u0000001"],
      },
      {
        sql: "INSERT OR REPLACE INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date) VALUES (?, 1, 1, 1, 1, ?)",
        args: ["u0000002", DAY],
      },
      { sql: "DELETE FROM stats WHERE user_id = ?", args: ["u0000003"] },
      {
        sql: "UPDATE users SET leaderboard_opt_in = ?, updated_at = ? WHERE discord_id = ?",
        args: [1, 2, "u0000004"],
      },
      {
        sql: "UPDATE users SET leaderboard_opt_in = 0, updated_at = ? WHERE account_id = ?",
        args: [2, "a"],
      },
    ]
    for (const statement of touching) {
      const lines = await plan(db, statement)
      assert.equal(
        lines.some((line) => /idx_users_leaderboard_opt_in/.test(line)),
        false,
        `${statement.sql.slice(0, 60)}: ${lines.join(" | ")}`,
      )
    }

    // U5: what a new account and a switch of the public choice cost, with the index and without.
    const newAccount = (metered, id) =>
      metered
        .prepare(
          `INSERT INTO users (discord_id, username, email, avatar_url, tier, premium_until, created_at, updated_at, leaderboard_opt_in)
           VALUES (?, 'N', NULL, 'https://cdn.discordapp.com/avatars/1/a.png', 'registered', NULL, 1, 1, 0)`,
        )
        .bind(id)
        .run()
    const switchChoice = (metered, id) =>
      metered
        .prepare("UPDATE users SET leaderboard_opt_in = 1, updated_at = 2 WHERE discord_id = ?")
        .bind(id)
        .run()
    const cost = async (id) => ({
      account: (await receiptsOf(db, (metered) => newAccount(metered, id))).written,
      switched: (await receiptsOf(db, (metered) => switchChoice(metered, id))).written,
    })
    const before = await cost("fresh-with-index")
    await db.prepare("DROP INDEX idx_users_leaderboard_opt_in").run()
    const after = await cost("fresh-without-index")
    t.diagnostic(
      `rows written by a new account / a switch (the board's trigger adds its own): before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
    )
    assert.equal(before.account - after.account, 1, "a new account writes one row fewer")
    assert.equal(before.switched - after.switched, 1, "a switch writes one row fewer")
  } finally {
    await dispose()
  }
})

test("ensureAccountTables models production after the drop", async () => {
  const { db, dispose } = await openCatalogDb()
  try {
    await ensureAccountTables(db)
    assert.deepEqual(
      (await indexNames(db, "users")).filter((name) => !name.startsWith("sqlite_")).sort(),
      [
        "idx_users_account_id",
        "idx_users_iconoplasm_emulsion_public_id",
        "idx_users_iconoplasm_emulsion_recent",
        "idx_users_username",
      ],
    )
  } finally {
    await dispose()
  }
})
