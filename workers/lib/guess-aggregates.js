const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS daily_guess_aggregate (
    day TEXT NOT NULL,
    target_uniprot TEXT,
    guess_uniprot TEXT NOT NULL,
    guess_gene TEXT,
    guess_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (day, guess_uniprot)
  );
`

// A guess bumps one row of this table, and D1 counts every index entry a statement writes as a
// row written. The primary key (day, guess_uniprot) is the one index the readers need: all four
// ask for `day = ?` or a range of days, which its leftmost column serves as well as a second index
// on (day, guess_count) did, and that second index cost one more row on every guess whose count
// moved (2 rows a guess, 1 now) and one more on the first guess of a protein each day (3, now 2)
// (B-964). The readers read the same rows through the primary key, and the top 5 of the day sorts
// them either way (workers/geneguessr-unused-indexes.test.js proves both on plans and receipts).
// The drop is `IF EXISTS` and writes 0 rows (30 read on a populated table). Delete the statement
// once production's `sqlite_master` no longer lists the index.
const DROP_RETIRED_INDEX_SQL = `DROP INDEX IF EXISTS idx_daily_guess_aggregate_day_count`

let schemaEnsured = false

export async function ensureGuessAggregateSchema(db) {
  if (schemaEnsured) return
  await db.prepare(CREATE_TABLE_SQL).run()
  await db.prepare(DROP_RETIRED_INDEX_SQL).run()
  schemaEnsured = true
}

function normalizeGuessUniprot(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim().toUpperCase()
  return normalized ? normalized : null
}

function normalizeGuessGene(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

export function buildGuessAggregateCounts(guesses) {
  const counts = new Map()
  const entries = Array.isArray(guesses) ? guesses : []

  for (const entry of entries) {
    const guessUniprot = normalizeGuessUniprot(entry?.uniprot)
    if (!guessUniprot) continue
    const gene = normalizeGuessGene(entry?.protein?.gene)
    const current = counts.get(guessUniprot)
    if (current) {
      current.guessCount += 1
      if (!current.guessGene && gene) current.guessGene = gene
    } else {
      counts.set(guessUniprot, { guessUniprot, guessGene: gene, guessCount: 1 })
    }
  }

  return Array.from(counts.values())
}

export async function recordDailyGuessAggregates(db, { day, targetUniprot, guesses }) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, reason: "invalid_day" }
  }

  const guessRows = buildGuessAggregateCounts(guesses)
  if (guessRows.length === 0) {
    return { ok: true, inserted: 0 }
  }

  await ensureGuessAggregateSchema(db)

  const updatedAt = Date.now()
  const normalizedTarget = normalizeGuessUniprot(targetUniprot)
  const stmt = db.prepare(`
    INSERT INTO daily_guess_aggregate (day, target_uniprot, guess_uniprot, guess_gene, guess_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, guess_uniprot) DO UPDATE SET
      guess_count = guess_count + excluded.guess_count,
      guess_gene = COALESCE(excluded.guess_gene, daily_guess_aggregate.guess_gene),
      target_uniprot = COALESCE(excluded.target_uniprot, daily_guess_aggregate.target_uniprot),
      updated_at = excluded.updated_at
  `)

  for (const row of guessRows) {
    await stmt
      .bind(day, normalizedTarget, row.guessUniprot, row.guessGene, row.guessCount, updatedAt)
      .run()
  }

  return { ok: true, inserted: guessRows.length }
}

export async function getDailyGuessAggregates(db, { day, limit = 25 }) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, reason: "invalid_day" }
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100))
  await ensureGuessAggregateSchema(db)

  const rows = await db
    .prepare(
      `
      SELECT day, target_uniprot, guess_uniprot, guess_gene, guess_count
      FROM daily_guess_aggregate
      WHERE day = ?
      ORDER BY guess_count DESC, guess_uniprot ASC
      LIMIT ?
    `,
    )
    .bind(day, safeLimit)
    .all()

  const results = Array.isArray(rows?.results) ? rows.results : []
  const totalGuesses = results.reduce((sum, r) => sum + (Number(r.guess_count) || 0), 0)

  return {
    ok: true,
    day,
    totalGuesses,
    guesses: results.map((r) => ({
      uniprot: r.guess_uniprot,
      gene: r.guess_gene || null,
      count: Number(r.guess_count) || 0,
    })),
  }
}

export async function getWinnersCount(db, { day }) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, reason: "invalid_day" }
  }

  await ensureGuessAggregateSchema(db)

  // Winners are guesses where guess_uniprot matches target_uniprot
  const row = await db
    .prepare(
      `
      SELECT COALESCE(SUM(guess_count), 0) AS winners_count
      FROM daily_guess_aggregate
      WHERE day = ? AND guess_uniprot = target_uniprot
    `,
    )
    .bind(day)
    .first()

  return {
    ok: true,
    day,
    winnersCount: Number(row?.winners_count) || 0,
  }
}

export async function getGuessAggregatesForDateRange(db, { startDay, endDay, limit = 50 }) {
  const isValidDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (!isValidDay(startDay) || !isValidDay(endDay)) {
    return { ok: false, reason: "invalid_day" }
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 50))
  await ensureGuessAggregateSchema(db)

  const rows = await db
    .prepare(
      `
      SELECT
        guess_uniprot,
        MAX(guess_gene) AS guess_gene,
        SUM(guess_count) AS guess_count
      FROM daily_guess_aggregate
      WHERE day >= ? AND day <= ?
      GROUP BY guess_uniprot
      ORDER BY guess_count DESC, guess_uniprot ASC
      LIMIT ?
    `,
    )
    .bind(startDay, endDay, safeLimit)
    .all()

  const results = Array.isArray(rows?.results) ? rows.results : []
  const totalGuesses = results.reduce((sum, r) => sum + (Number(r.guess_count) || 0), 0)

  return {
    ok: true,
    startDay,
    endDay,
    totalGuesses,
    guesses: results.map((r) => ({
      uniprot: r.guess_uniprot,
      gene: r.guess_gene || null,
      count: Number(r.guess_count) || 0,
    })),
  }
}
