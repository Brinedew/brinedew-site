// THE ONLY LEADERBOARD READ MODEL: DO NOT DUPLICATE.
//
// "Top Streaks" lists the public accounts whose streak is alive (played today or yesterday, UTC),
// longest streak first. The facts it needs live in three places: the streak and the last played
// day on `stats`, the public choice on `users`, and "alive" in the clock. No index spans two
// tables and a clock, so the join over every account (SCAN stats, a `users` lookup for each row)
// cost about 0.3 rows an account on production's shape (29,585 rows at 100,000 accounts), and the
// page reads it on every desktop load (B-959). A streak is never zeroed when a player stops, so
// scanning `stats` in streak order does not stop early either: private and abandoned long streaks
// stand above the live public ones.
//
// `leaderboard_streaks` holds exactly the accounts the join could ever show: public, streak above
// 0, a played day. Its covering index starts with the played day, so the board asks for the first
// `limit` of today and the first `limit` of yesterday, each a short walk down one index range, and
// reads `users` only for the names of the entries it returns. That is about 4 x limit + 8 rows
// whatever the number of accounts, stale and private accounts included.
//
// The table is created by this code on first use, like the other tables the GeneGuessr worker
// owns: a normal deploy applies no migration to this database. One batch creates the table, its
// index and the four triggers, and fills the table from `stats` and `users`; a batch is one
// transaction, so no write can land between the fill and the triggers. Four triggers keep it
// equal to the join: `stats` after an insert (a first game, the import), after an update of the
// streak, the wins or the played day (every finished game), after a delete; and `users` after the
// public choice changes (the switch, a Discord login, an account erasure). Each recomputes the one
// account it names, so a statement that does not touch a public account writes no extra row.
//
// A table rebuild that drops `stats` or `users` also drops its triggers. Drop `leaderboard_streaks`
// too and the next read rebuilds it.
const MEMBER_WHERE = (userId) =>
  `s.user_id = ${userId}
     AND u.leaderboard_opt_in = 1
     AND s.current_streak > 0
     AND date(s.last_played_date) IS NOT NULL`

const UPSERT_MEMBER_SQL = (userFilter) => `
  INSERT INTO leaderboard_streaks (user_id, last_played_date, current_streak, total_wins)
  SELECT s.user_id, date(s.last_played_date), s.current_streak, s.total_wins
  FROM stats s
  INNER JOIN users u ON u.discord_id = s.user_id
  WHERE ${userFilter}
  ON CONFLICT(user_id) DO UPDATE SET
    last_played_date = excluded.last_played_date,
    current_streak = excluded.current_streak,
    total_wins = excluded.total_wins`

// One account's row, made equal to what the join says about it: written when it qualifies, removed
// when it does not.
const refreshMemberSql = (userId) => `
  ${UPSERT_MEMBER_SQL(MEMBER_WHERE(userId))};
  DELETE FROM leaderboard_streaks
  WHERE user_id = ${userId}
    AND NOT EXISTS (
      SELECT 1 FROM stats s
      INNER JOIN users u ON u.discord_id = s.user_id
      WHERE ${MEMBER_WHERE(userId)}
    );`

const LEADERBOARD_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS leaderboard_streaks (
     user_id TEXT PRIMARY KEY,
     last_played_date TEXT NOT NULL,
     current_streak INTEGER NOT NULL,
     total_wins INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_leaderboard_streaks_board
   ON leaderboard_streaks (last_played_date, current_streak DESC, total_wins DESC, user_id)`,
  `CREATE TRIGGER IF NOT EXISTS leaderboard_streaks_stats_ai
   AFTER INSERT ON stats
   BEGIN ${refreshMemberSql("NEW.user_id")} END`,
  `CREATE TRIGGER IF NOT EXISTS leaderboard_streaks_stats_au
   AFTER UPDATE OF current_streak, total_wins, last_played_date ON stats
   BEGIN ${refreshMemberSql("NEW.user_id")} END`,
  `CREATE TRIGGER IF NOT EXISTS leaderboard_streaks_stats_ad
   AFTER DELETE ON stats
   BEGIN DELETE FROM leaderboard_streaks WHERE user_id = OLD.user_id; END`,
  `CREATE TRIGGER IF NOT EXISTS leaderboard_streaks_users_au
   AFTER UPDATE OF leaderboard_opt_in ON users
   WHEN OLD.leaderboard_opt_in IS NOT NEW.leaderboard_opt_in
   BEGIN ${refreshMemberSql("NEW.discord_id")} END`,
  // The fill: every account the join could show today.
  UPSERT_MEMBER_SQL(
    `u.leaderboard_opt_in = 1 AND s.current_streak > 0 AND date(s.last_played_date) IS NOT NULL`,
  ),
]

// The first `limit` entries of one day, in the order of the index (streak, wins, id).
const ONE_DAY_SQL = (day) => `
  SELECT * FROM (
    SELECT user_id, last_played_date, current_streak, total_wins
    FROM leaderboard_streaks
    WHERE last_played_date = ${day}
    ORDER BY current_streak DESC, total_wins DESC, user_id ASC
    LIMIT ?
  )`

// Today's and yesterday's first `limit` entries merged in the board's order: streak, then wins,
// then the earlier played day, then id, which is the order the join used.
const LEADERBOARD_SQL = `
  SELECT
    users.discord_id AS user_id,
    users.username AS username,
    users.avatar_url AS avatar_url,
    board.current_streak AS current_streak,
    board.total_wins AS total_wins,
    board.last_played_date AS last_played_date
  FROM (
    ${ONE_DAY_SQL("date('now')")}
    UNION ALL
    ${ONE_DAY_SQL("date('now', '-1 day')")}
  ) AS board
  INNER JOIN users ON users.discord_id = board.user_id
  ORDER BY
    board.current_streak DESC,
    board.total_wins DESC,
    board.last_played_date ASC,
    users.discord_id ASC
  LIMIT ?`

const selectBoard = async (db, limit) => {
  const answer = await db.prepare(LEADERBOARD_SQL).bind(limit, limit, limit).all()
  return Array.isArray(answer?.results) ? answer.results : []
}

// The top `limit` live public streaks, each as `{ user_id, username, avatar_url, current_streak,
// total_wins, last_played_date }`.
export async function readLeaderboard(db, limit) {
  try {
    return await selectBoard(db, limit)
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || error))) throw error
    await db.batch(LEADERBOARD_SCHEMA_SQL.map((sql) => db.prepare(sql)))
    return selectBoard(db, limit)
  }
}
