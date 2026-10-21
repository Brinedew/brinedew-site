// B-733: what the community did on Iconoplasm in one UTC day, for the daily
// digest post in #iconoplasm (docs/ICONOPLASM_DAILY_DIGEST.md). The GitHub
// Actions job (scripts/post-iconoplasm-daily-digest.mjs) reads this through the
// admin route, draws the picture and sends it back to be posted.
//
// Each gene is settled by comparing its state at the start and the end of the
// day, never by replaying every event: a caretaker who hops genes all day shows
// once, on the gene held at midnight; autosaved lore is one change; a portrait
// that wins and loses again the same day is no update.
//
// Cost: two id seeks per event table (about 20 one-row reads each), then only
// the day's own rows. No query reads a whole table except the caretaker tables,
// which hold one row per caretaker or text version.
import { readAccountProfiles } from "../iconoplasm-public-caretakers.js"
import { discordAvatarSource } from "../lib/avatar-proxy.js"

const PAIRS_PER_STATEMENT = 50
const DAY = /^\d{4}-\d{2}-\d{2}$/

export function nextUtcDay(day) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function isDigestDay(day, now = new Date()) {
  if (!DAY.test(String(day || ""))) return false
  const parsed = new Date(`${day}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === day &&
    day < now.toISOString().slice(0, 10)
  )
}

const rows = (result) => (Array.isArray(result?.results) ? result.results : [])

// The smallest id whose row was created on or after `bound` (a YYYY-MM-DD
// prefix, which sorts the same for "2026-10-19 04:54:25" and
// "2026-10-19T04:54:25.000Z"). Ids grow with time in these append-only tables.
const SEEKABLE = Object.freeze({ icono_publish_events: true, icono_gene_comments: true })
async function firstIdOnOrAfter(db, table, bound) {
  if (!SEEKABLE[table]) throw new Error(`not a seekable table: ${table}`)
  const top = await db.prepare(`SELECT max(id) AS id FROM ${table}`).first()
  let lo = 1
  let hi = Number(top?.id || 0) + 1
  const probe = db.prepare(`SELECT id, created_at FROM ${table} WHERE id >= ? ORDER BY id LIMIT 1`)
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const row = await probe.bind(mid).first()
    if (!row || String(row.created_at) >= bound) hi = mid
    else lo = Number(row.id) + 1
  }
  return lo
}

async function dayIdRange(db, table, day) {
  const [from, to] = await Promise.all([
    firstIdOnOrAfter(db, table, day),
    firstIdOnOrAfter(db, table, nextUtcDay(day)),
  ])
  return { from, to }
}

function pairChunks(pairs) {
  const chunks = []
  for (let i = 0; i < pairs.length; i += PAIRS_PER_STATEMENT)
    chunks.push(pairs.slice(i, i + PAIRS_PER_STATEMENT))
  return chunks
}

async function scoresOf(db, pairs) {
  const scores = new Map()
  for (const chunk of pairChunks(pairs)) {
    const result = await db
      .prepare(
        `SELECT gene_symbol, asset_sha256, score FROM icono_vote_asset_summary
          WHERE ${chunk.map(() => "(gene_symbol = ? AND asset_sha256 = ?)").join(" OR ")}`,
      )
      .bind(...chunk.flat())
      .all()
    for (const row of rows(result))
      scores.set(`${row.gene_symbol}:${row.asset_sha256}`, Number(row.score) || 0)
  }
  return scores
}

function firstParagraph(text, max) {
  const paragraph =
    String(text || "")
      .split(/\n\s*\n|\n/)
      .map((part) => part.trim())
      .find(Boolean) || ""
  return paragraph.length > max
    ? `${paragraph.slice(0, paragraph.lastIndexOf(" ", max) > 0 ? paragraph.lastIndexOf(" ", max) : max)}…`
    : paragraph
}

const avatar = (value) => discordAvatarSource(value) || ""

// Canonical portrait updates people caused. A new candidate that wins only
// because it is the newest of a tie (nobody had voted) is not one; it shows
// under new candidates instead.
async function canonicalUpdates(db, events) {
  const byGene = new Map()
  for (const event of events) {
    if (event.action !== "publish") continue
    const current = byGene.get(event.gene_symbol)
    if (current) {
      current.to = event.to_asset_sha256
      current.human ||= event.actor !== "vote_authority"
    } else
      byGene.set(event.gene_symbol, {
        symbol: event.gene_symbol,
        from: event.from_asset_sha256,
        to: event.to_asset_sha256,
        human: event.actor !== "vote_authority",
      })
  }
  const changed = [...byGene.values()].filter((g) => g.from && g.to && g.from !== g.to)
  if (!changed.length) return []
  const scores = await scoresOf(
    db,
    changed.flatMap((g) => [
      [g.symbol, g.from],
      [g.symbol, g.to],
    ]),
  )
  const supervoted = new Set(
    rows(
      await db
        .prepare(
          `SELECT gene_symbol, supervote_asset_sha256 FROM icono_caretaker_assignments
            WHERE status IN ('active', 'suspended') AND supervote_asset_sha256 IS NOT NULL`,
        )
        .all(),
    ).map((row) => `${row.gene_symbol}:${row.supervote_asset_sha256}`),
  )
  const score = (symbol, sha) => scores.get(`${symbol}:${sha}`) || 0
  return changed
    .filter(
      (g) =>
        g.human ||
        supervoted.has(`${g.symbol}:${g.to}`) ||
        supervoted.has(`${g.symbol}:${g.from}`) ||
        score(g.symbol, g.to) > score(g.symbol, g.from),
    )
    .sort(
      (a, b) => score(b.symbol, b.to) - score(a.symbol, a.to) || a.symbol.localeCompare(b.symbol),
    )
    .map((g) => ({ symbol: g.symbol, from_sha: g.from, to_sha: g.to }))
}

// Candidates added in the day that still stand (not rejected, not stale, not
// deleted), grouped by gene, genes with the most new portraits first.
async function newCandidates(db, range) {
  const result = await db
    .prepare(
      `SELECT e.gene_symbol, e.to_asset_sha256 AS sha
         FROM icono_publish_events e
         JOIN icono_portrait_assets a ON a.gene_symbol = e.gene_symbol AND a.asset_sha256 = e.to_asset_sha256
        WHERE e.id >= ? AND e.id < ? AND e.action = 'candidate_added'
          AND lower(a.status) <> 'rejected' AND a.is_stale = 0
        ORDER BY e.id`,
    )
    .bind(range.from, range.to)
    .all()
  const byGene = new Map()
  for (const row of rows(result)) {
    const list = byGene.get(row.gene_symbol) || byGene.set(row.gene_symbol, []).get(row.gene_symbol)
    if (!list.includes(row.sha)) list.push(row.sha)
  }
  return [...byGene]
    .map(([symbol, shas]) => ({ symbol, shas }))
    .sort((a, b) => b.shas.length - a.shas.length || a.symbol.localeCompare(b.symbol))
}

// Caretakers who started in the day and still hold the gene at its end. When
// the same person held another gene when the day began and left it during the
// day, that is where they moved from; genes held only in between don't count.
async function newCaretakers(db, day, end) {
  const started = rows(
    await db
      .prepare(
        `SELECT gene_symbol, account_id FROM icono_caretaker_assignments
          WHERE started_at >= ? AND started_at < ? AND status <> 'pending_acceptance'
            AND (ended_at IS NULL OR ended_at >= ?)
          ORDER BY started_at`,
      )
      .bind(day, end, end)
      .all(),
  )
  if (!started.length) return []
  const left = rows(
    await db
      .prepare(
        `SELECT gene_symbol, account_id FROM icono_caretaker_assignments
          WHERE started_at < ? AND ended_at >= ? AND ended_at < ?`,
      )
      .bind(day, day, end)
      .all(),
  )
  return started.map((row) => {
    const before = left.find(
      (l) => l.account_id === row.account_id && l.gene_symbol !== row.gene_symbol,
    )
    return {
      symbol: row.gene_symbol,
      account_id: row.account_id,
      from_symbol: before?.gene_symbol || null,
    }
  })
}

// Lore readers can see at the end of the day that changed during it: the
// caretaker version the gene uses, shown on the gene page, written that day.
async function newLore(db, day, end) {
  return rows(
    await db
      .prepare(
        `SELECT v.gene_symbol, v.account_id, v.text, v.created_at
           FROM icono_caretaker_text_versions v
           JOIN icono_gene_texts t ON t.gene_symbol = v.gene_symbol AND t.chosen_caretaker_version_id = v.version_id
          WHERE v.created_at >= ? AND v.created_at < ? AND v.readers_see = 1 AND v.withdrawn_at IS NULL
          ORDER BY v.created_at DESC`,
      )
      .bind(day, end)
      .all(),
  ).map((row) => ({
    symbol: row.gene_symbol,
    account_id: row.account_id,
    text: firstParagraph(row.text, 700),
  }))
}

async function newComments(db, day) {
  const range = await dayIdRange(db, "icono_gene_comments", day)
  return rows(
    await db
      .prepare(
        `SELECT gene_symbol, username, avatar_url, body FROM icono_gene_comments
          WHERE id >= ? AND id < ? AND status = 'visible' ORDER BY id DESC`,
      )
      .bind(range.from, range.to)
      .all(),
  ).map((row) => ({
    symbol: row.gene_symbol,
    username: String(row.username || "").slice(0, 80),
    avatar: avatar(row.avatar_url),
    text: firstParagraph(row.body, 600),
  }))
}

export async function readDailyDigest({ iconoplasmDb, accountDb, day }) {
  if (!iconoplasmDb?.prepare) throw new Error("ICONOPLASM_DB binding missing")
  const end = nextUtcDay(day)
  const range = await dayIdRange(iconoplasmDb, "icono_publish_events", day)
  const events = rows(
    await iconoplasmDb
      .prepare(
        `SELECT gene_symbol, action, actor, from_asset_sha256, to_asset_sha256 FROM icono_publish_events
          WHERE id >= ? AND id < ? AND action = 'publish' ORDER BY id`,
      )
      .bind(range.from, range.to)
      .all(),
  )
  const [updates, candidates, caretakers, lore, comments] = await Promise.all([
    canonicalUpdates(iconoplasmDb, events),
    newCandidates(iconoplasmDb, range),
    newCaretakers(iconoplasmDb, day, end),
    newLore(iconoplasmDb, day, end),
    newComments(iconoplasmDb, day),
  ])
  const profiles = await readAccountProfiles(
    accountDb,
    [...caretakers, ...lore].map((x) => x.account_id),
  )
  const person = (accountId) => {
    const profile = profiles.get(accountId)
    return { username: profile?.username || "a caretaker", avatar: avatar(profile?.avatar_url) }
  }
  return {
    day,
    updates,
    caretakers: caretakers.map(({ account_id, ...c }) => ({ ...c, ...person(account_id) })),
    lore: lore.map(({ account_id, ...l }) => ({ ...l, ...person(account_id) })),
    comments,
    candidates,
  }
}
