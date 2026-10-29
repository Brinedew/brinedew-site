// B-1188: the admin gallery. Two modes (Canonical: one card per live gene; All
// candidates: every stored portrait), four sorts (name, votes, recency,
// mismatch first), four filters (mismatch, pinned, missing, stale) and a search.
//
// No view's price grows with readers. The name and recency sorts read their
// page by an index: the page's size, not the site's. A filter, a search, the
// mismatch sort and the Canonical vote sort read a set that the genome bounds
// (about 20,000 genes), at most four rows a gene. The All candidates vote sort
// reads every vote summary, up to two rows a candidate, because an index ranked by
// score would cost every reader's vote one more row written (see migration
// 0146). Then the page's facts are read from where they are true: the
// published card and the pin from icono_publish_state, the votes from
// icono_vote_asset_summary, the counts from the portraits, and the vote winner
// from the election itself (electGeneAuthorityWinner).
//
// Chesterton's fence: this used to read icono_admin_gene_rollup, a copy of all
// of that, kept for speed. On 2026-10-29 the copy showed the wrong card for 903
// genes (160 card changes it missed, 743 retired genes it kept), left out 591
// live genes, and its "recency" was the time of a 2026-08-20 mass rebuild for
// 13,186 genes. Every sort but name read the whole copy or the whole portrait
// table: up to 248,926 rows a click, under a stated price of 2,000. The cost
// test (admin-gallery-cost.test.js) holds each view to its bound.
import { electGeneAuthorityWinner } from "./vote-authority/gene-authority-election.js"
import { CARETAKER_SUPERVOTES_SQL } from "./caretaker/caretaker-supervote.js"
import { caretakerElectionInput } from "./votes/gene-votes.js"

export const ADMIN_GALLERY_MODES = Object.freeze(["live", "all", "side-by-side"])
export const ADMIN_GALLERY_SORTS = Object.freeze(["name", "votes", "recency", "mismatch"])
export const ADMIN_GALLERY_FILTERS = Object.freeze([
  "all",
  "mismatch",
  "pinned",
  "missing",
  "stale",
])

// A candidate that could become a gene's card: what the copy's candidate_count
// counted. A gene with none is "missing".
const ELIGIBLE = `COALESCE(pa.autopick_eligible, 1) = 1 AND COALESCE(pa.status, 'draft') <> 'rejected'`

// Genes whose published card names a portrait that is not stored.
const BROKEN_GENES = `SELECT ps.gene_symbol FROM icono_publish_state ps
   WHERE ps.current_asset_sha256 <> ''
     AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets pa
                      WHERE pa.gene_symbol = ps.gene_symbol
                        AND pa.asset_sha256 = ps.current_asset_sha256)`
const PINNED_GENES = `SELECT gene_symbol FROM icono_publish_state
   INDEXED BY idx_icono_publish_state_pinned WHERE admin_override = 1`
const STALE_GENES = `SELECT DISTINCT gene_symbol FROM icono_portrait_assets
   INDEXED BY idx_icono_portrait_assets_stale WHERE is_stale = 1`
const MISSING_GENES = `SELECT gc.gene_symbol FROM icono_gene_catalog gc
   WHERE NOT EXISTS (SELECT 1 FROM icono_portrait_assets pa
                      WHERE pa.gene_symbol = gc.gene_symbol AND ${ELIGIBLE})`
const FILTER_GENES = Object.freeze({
  mismatch: BROKEN_GENES,
  pinned: PINNED_GENES,
  stale: STALE_GENES,
  missing: MISSING_GENES,
})
// The same test for one gene of a set that a filter or a search has already
// narrowed: two reads by key, instead of the whole genome's cards.
const brokenGene = (gene) => `EXISTS (SELECT 1 FROM icono_publish_state ps
   WHERE ps.gene_symbol = ${gene} AND ps.current_asset_sha256 <> ''
     AND NOT EXISTS (SELECT 1 FROM icono_portrait_assets b
                      WHERE b.gene_symbol = ${gene} AND b.asset_sha256 = ps.current_asset_sha256))`

// ?1 is the search pattern and ?2 the search as an exact symbol; ?3 and ?4 are
// LIMIT and OFFSET. Every paged statement is bound with all four: SQLite gives a
// statement as many slots as its highest number, used or not.
const CATALOG_MATCH = `(gc.gene_symbol LIKE ?1 ESCAPE '\\' OR gc.full_name LIKE ?1 ESCAPE '\\')`
// All candidates also finds a retired gene's portraits by its exact symbol.
const SEARCH_GENES = `SELECT gc.gene_symbol FROM icono_gene_catalog gc WHERE ${CATALOG_MATCH}
   UNION SELECT ?2 WHERE EXISTS (SELECT 1 FROM icono_portrait_assets WHERE gene_symbol = ?2)`
const PAGE = `LIMIT ?3 OFFSET ?4`

function likePattern(query) {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function rowsOf(result) {
  return Array.isArray(result?.results) ? result.results : []
}

function totalOf(rows) {
  return rows.length ? Number(rows[0].total_rows || 0) : 0
}

// Canonical keys for a gene set: each is read by the gene's own index range.
function canonicalSetOrder(sort) {
  if (sort === "votes")
    // The votes on the gene's published card, as the unfiltered vote sort.
    return {
      keys: `(SELECT v.score FROM icono_publish_state p CROSS JOIN icono_vote_asset_summary v
                ON v.gene_symbol = p.gene_symbol AND v.asset_sha256 = p.current_asset_sha256
               WHERE p.gene_symbol = k.gene_symbol AND v.vote_count > 0) AS card_score,
             (SELECT v.upvotes FROM icono_publish_state p CROSS JOIN icono_vote_asset_summary v
                ON v.gene_symbol = p.gene_symbol AND v.asset_sha256 = p.current_asset_sha256
               WHERE p.gene_symbol = k.gene_symbol AND v.vote_count > 0) AS card_upvotes`,
      where: "card_score IS NOT NULL",
      order: "card_score DESC, card_upvotes DESC, gene_symbol",
    }
  if (sort === "recency")
    return {
      keys: `(SELECT MAX(p.rowid) FROM icono_portrait_assets p
               WHERE p.gene_symbol = k.gene_symbol) AS newest`,
      where: "newest IS NOT NULL",
      order: "newest DESC",
    }
  if (sort === "mismatch")
    return {
      keys: `${brokenGene("k.gene_symbol")} AS broken,
             (SELECT COUNT(*) FROM icono_portrait_assets p
                INDEXED BY idx_icono_portrait_assets_stale
               WHERE p.gene_symbol = k.gene_symbol AND p.is_stale = 1) AS stale_n`,
      where: "",
      order: "broken DESC, stale_n DESC, gene_symbol",
    }
  return { keys: "0 AS unused", where: "", order: "gene_symbol" }
}

function candidateSetOrder(sort) {
  if (sort === "votes")
    return {
      where: "vs.vote_count > 0",
      order: "vs.score DESC, vs.upvotes DESC, c.gene_symbol, c.asset_sha256",
    }
  if (sort === "recency") return { where: "", order: "pa.rowid DESC" }
  if (sort === "mismatch")
    return {
      where: "",
      order: `${brokenGene("c.gene_symbol")} DESC, COALESCE(pa.is_stale, 0) DESC,
              c.gene_symbol, COALESCE(vs.score, 0) DESC, pa.created_at DESC`,
    }
  return {
    where: "",
    order: "c.gene_symbol, COALESCE(vs.score, 0) DESC, pa.created_at DESC",
  }
}

const CANDIDATE_NAME_ORDER = `pa.gene_symbol, COALESCE(vs.score, 0) DESC, pa.created_at DESC`

async function cachedTotal(db, sql, key) {
  const row = await db.prepare(sql).bind(key).first()
  return row ? Math.max(0, Number(row.total || 0) || 0) : null
}

const LIVE_GENES_TOTAL = `SELECT genes AS total FROM icono_admin_dashboard_summary WHERE summary_key = ?`
const ALL_CANDIDATES_TOTAL = `SELECT total FROM icono_admin_gallery_count_cache WHERE count_key = ?`

// Mismatch first, with nothing to narrow it: broken genes (or their
// candidates), then stale ones, then the rest by name. The first two are small
// sets read whole; the rest is paged by the name index past them.
async function mismatchFirst(db, { live, offset, limit }) {
  const [broken, stale] = (
    await db.batch(
      live
        ? [
            db.prepare(`SELECT b.gene_symbol FROM (${BROKEN_GENES}) b
                          CROSS JOIN icono_gene_catalog gc ON gc.gene_symbol = b.gene_symbol
                         ORDER BY b.gene_symbol`),
            db.prepare(`SELECT s.gene_symbol, COUNT(*) AS n
                          FROM icono_portrait_assets s INDEXED BY idx_icono_portrait_assets_stale
                          CROSS JOIN icono_gene_catalog gc ON gc.gene_symbol = s.gene_symbol
                         WHERE s.is_stale = 1
                         GROUP BY s.gene_symbol ORDER BY n DESC, s.gene_symbol`),
          ]
        : [
            db.prepare(`SELECT pa.gene_symbol, pa.asset_sha256 FROM (${BROKEN_GENES}) b
                          CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol = b.gene_symbol
                          LEFT JOIN icono_vote_asset_summary vs
                            ON vs.gene_symbol = pa.gene_symbol AND vs.asset_sha256 = pa.asset_sha256
                         ORDER BY ${CANDIDATE_NAME_ORDER}`),
            db.prepare(`SELECT pa.gene_symbol, pa.asset_sha256
                          FROM icono_portrait_assets pa INDEXED BY idx_icono_portrait_assets_stale
                          LEFT JOIN icono_vote_asset_summary vs
                            ON vs.gene_symbol = pa.gene_symbol AND vs.asset_sha256 = pa.asset_sha256
                         WHERE pa.is_stale = 1
                         ORDER BY ${CANDIDATE_NAME_ORDER}`),
          ],
    )
  ).map(rowsOf)
  const brokenGenes = [...new Set(broken.map((row) => row.gene_symbol))]
  const head = live
    ? [...broken, ...stale.filter((row) => !brokenGenes.includes(row.gene_symbol))].map((row) => ({
        gene_symbol: row.gene_symbol,
      }))
    : [...broken, ...stale.filter((row) => !brokenGenes.includes(row.gene_symbol))]
  const page = head.slice(offset, offset + limit)
  if (page.length === limit) return page
  const exclude = JSON.stringify(live ? head.map((row) => row.gene_symbol) : brokenGenes)
  const rest = live
    ? db.prepare(`SELECT gene_symbol FROM icono_gene_catalog
                   WHERE gene_symbol NOT IN (SELECT value FROM json_each(?1))
                   ORDER BY gene_symbol LIMIT ?2 OFFSET ?3`)
    : db.prepare(`SELECT pa.gene_symbol, pa.asset_sha256 FROM icono_portrait_assets pa
                    LEFT JOIN icono_vote_asset_summary vs
                      ON vs.gene_symbol = pa.gene_symbol AND vs.asset_sha256 = pa.asset_sha256
                   WHERE COALESCE(pa.is_stale, 0) = 0
                     AND pa.gene_symbol NOT IN (SELECT value FROM json_each(?1))
                   ORDER BY ${CANDIDATE_NAME_ORDER} LIMIT ?2 OFFSET ?3`)
  const more = rowsOf(
    await rest.bind(exclude, limit - page.length, Math.max(0, offset - head.length)).all(),
  )
  return [...page, ...more]
}

// Walks an index in order and keeps each gene's first row until the page is
// full. A gene's later rows are skipped here rather than by a NOT EXISTS
// probe, which read all of the gene's rows for every row walked: a batch of 72
// TP53 portraits cost 72 x 72 reads. `sql` ends in LIMIT ?1; each pass reads
// four times more of the index than the last.
async function firstPerGene(db, sql, { offset, limit }) {
  const want = offset + limit
  for (let take = want * 4; ; take *= 4) {
    const rows = rowsOf(await db.prepare(sql).bind(take).all())
    const genes = [...new Set(rows.map((row) => row.gene_symbol))]
    if (genes.length >= want || rows.length < take)
      return genes.slice(offset, want).map((gene_symbol) => ({ gene_symbol }))
  }
}

// The page's genes: their keys, in order, and the view's total (null where
// the view lists a subset no counter keeps, the votes and recency sorts).
async function pickGenes(db, { sort, filter, search, offset, limit }) {
  const binds = [search ? likePattern(search) : "", search, limit, offset]
  if (filter === "all" && !search) {
    if (sort === "mismatch")
      return {
        keys: await mismatchFirst(db, { live: true, offset, limit }),
        total: await cachedTotal(db, LIVE_GENES_TOTAL, "default"),
      }
    if (sort === "votes")
      // Each gene at the votes on its published card: one read of the card's
      // summary per gene, so the genome bounds it. The catalogue is checked
      // after the sort, for the rows the page takes, not for every voted card.
      return {
        keys: rowsOf(
          await db
            .prepare(
              `WITH cards AS MATERIALIZED (
                 SELECT ps.gene_symbol, vs.score, vs.upvotes FROM icono_publish_state ps
                   CROSS JOIN icono_vote_asset_summary vs
                     ON vs.gene_symbol = ps.gene_symbol AND vs.asset_sha256 = ps.current_asset_sha256
                  WHERE vs.vote_count > 0
                  ORDER BY vs.score DESC, vs.upvotes DESC, ps.gene_symbol)
               SELECT c.gene_symbol FROM cards c
                WHERE EXISTS (SELECT 1 FROM icono_gene_catalog gc WHERE gc.gene_symbol = c.gene_symbol)
                ${PAGE}`,
            )
            .bind(...binds)
            .all(),
        ),
        total: null,
      }
    if (sort === "recency")
      // Each gene at its newest portrait; rowid is the order portraits arrived in.
      return {
        keys: await firstPerGene(
          db,
          `SELECT pa.gene_symbol FROM icono_portrait_assets pa
             CROSS JOIN icono_gene_catalog gc ON gc.gene_symbol = pa.gene_symbol
            ORDER BY pa.rowid DESC LIMIT ?1`,
          { offset, limit },
        ),
        total: null,
      }
    const keys = rowsOf(
      await db
        .prepare(`SELECT gene_symbol FROM icono_gene_catalog ORDER BY gene_symbol ${PAGE}`)
        .bind(...binds)
        .all(),
    )
    return { keys, total: await cachedTotal(db, LIVE_GENES_TOTAL, "default") }
  }
  const { keys, where, order } = canonicalSetOrder(sort)
  const source =
    filter === "all"
      ? `SELECT gc.gene_symbol FROM icono_gene_catalog gc WHERE ${CATALOG_MATCH}`
      : `SELECT f.gene_symbol FROM (${FILTER_GENES[filter]}) f
           CROSS JOIN icono_gene_catalog gc ON gc.gene_symbol = f.gene_symbol
          ${search ? `WHERE ${CATALOG_MATCH}` : ""}`
  const rows = rowsOf(
    await db
      .prepare(
        `WITH matched AS (${source}),
              keyed AS (SELECT k.gene_symbol, ${keys} FROM matched k)
         SELECT gene_symbol, COUNT(*) OVER () AS total_rows FROM keyed
          ${where ? `WHERE ${where}` : ""}
          ORDER BY ${order} ${PAGE}`,
      )
      .bind(...binds)
      .all(),
  )
  return { keys: rows, total: totalOf(rows) }
}

// The page's candidates, as (gene_symbol, asset_sha256), and the total.
async function pickCandidates(db, { sort, filter, search, offset, limit }) {
  if (filter === "missing") return { keys: [], total: 0 }
  const binds = [search ? likePattern(search) : "", search, limit, offset]
  if (filter === "all" && !search) {
    if (sort === "mismatch")
      return {
        keys: await mismatchFirst(db, { live: false, offset, limit }),
        total: await cachedTotal(db, ALL_CANDIDATES_TOTAL, "all:all"),
      }
    const sql = {
      name: `SELECT pa.gene_symbol, pa.asset_sha256 FROM icono_portrait_assets pa
               LEFT JOIN icono_vote_asset_summary vs
                 ON vs.gene_symbol = pa.gene_symbol AND vs.asset_sha256 = pa.asset_sha256
              ORDER BY ${CANDIDATE_NAME_ORDER} ${PAGE}`,
      // Every summary, read whole and sorted: one row a candidate. A summary
      // whose portrait is gone drops out when the page's facts are read.
      votes: `SELECT gene_symbol, asset_sha256 FROM icono_vote_asset_summary
               WHERE vote_count > 0
               ORDER BY score DESC, upvotes DESC, gene_symbol, asset_sha256 ${PAGE}`,
      recency: `SELECT gene_symbol, asset_sha256 FROM icono_portrait_assets
                 ORDER BY rowid DESC ${PAGE}`,
    }[sort]
    const keys = rowsOf(
      await db
        .prepare(sql)
        .bind(...binds)
        .all(),
    )
    return {
      keys,
      total: sort === "votes" ? null : await cachedTotal(db, ALL_CANDIDATES_TOTAL, "all:all"),
    }
  }
  const source =
    filter === "all"
      ? `SELECT pa.gene_symbol, pa.asset_sha256 FROM (${SEARCH_GENES}) g
           CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol = g.gene_symbol`
      : filter === "stale"
        ? `SELECT gene_symbol, asset_sha256 FROM icono_portrait_assets
             INDEXED BY idx_icono_portrait_assets_stale WHERE is_stale = 1`
        : `SELECT pa.gene_symbol, pa.asset_sha256 FROM (${FILTER_GENES[filter]}) g
             CROSS JOIN icono_portrait_assets pa ON pa.gene_symbol = g.gene_symbol`
  const { where, order } = candidateSetOrder(sort)
  const rows = rowsOf(
    await db
      .prepare(
        `WITH cand AS (${source})
         SELECT c.gene_symbol, c.asset_sha256, COUNT(*) OVER () AS total_rows
           FROM cand c
           CROSS JOIN icono_portrait_assets pa
             ON pa.gene_symbol = c.gene_symbol AND pa.asset_sha256 = c.asset_sha256
           LEFT JOIN icono_vote_asset_summary vs
             ON vs.gene_symbol = c.gene_symbol AND vs.asset_sha256 = c.asset_sha256
          WHERE 1 = 1 ${filter !== "all" && search ? `AND c.gene_symbol IN (${SEARCH_GENES})` : ""}
            ${where ? `AND ${where}` : ""}
          ORDER BY ${order} ${PAGE}`,
      )
      .bind(...binds)
      .all(),
  )
  return { keys: rows, total: totalOf(rows) }
}

function count(value) {
  return Math.max(0, Number(value || 0) || 0)
}

// Every fact a card shows, for a page's genes, from where it is true: four
// reads by each gene's own key, one D1 batch.
export async function readAdminGeneFacts(db, symbols) {
  const genes = [...new Set(symbols)].filter(Boolean)
  const facts = new Map()
  if (!genes.length) return facts
  const wanted = JSON.stringify(genes)
  const [candidates, states, catalog, caretakers] = (
    await db.batch([
      db
        .prepare(
          `SELECT pa.gene_symbol, pa.asset_sha256, pa.status, pa.autopick_eligible, pa.is_stale,
                  pa.is_legacy, pa.created_at, pa.vision_id, pa.artist_tag, pa.artist_name,
                  pa.candidate_image_id, vs.asset_sha256 AS summary_asset_sha256,
                  vs.upvotes, vs.downvotes, vs.score, vs.vote_count
             FROM json_each(?1) AS wanted
             CROSS JOIN icono_portrait_assets AS pa ON pa.gene_symbol = wanted.value
             LEFT JOIN icono_vote_asset_summary AS vs
               ON vs.gene_symbol = pa.gene_symbol AND vs.asset_sha256 = pa.asset_sha256`,
        )
        .bind(wanted),
      db
        .prepare(
          `SELECT ps.gene_symbol, ps.current_asset_sha256, ps.admin_override, ps.updated_at
             FROM json_each(?1) AS wanted
             CROSS JOIN icono_publish_state AS ps ON ps.gene_symbol = wanted.value`,
        )
        .bind(wanted),
      db
        .prepare(
          `SELECT gc.gene_symbol, gc.full_name
             FROM json_each(?1) AS wanted
             CROSS JOIN icono_gene_catalog AS gc ON gc.gene_symbol = wanted.value`,
        )
        .bind(wanted),
      db
        .prepare(
          `SELECT s.gene_symbol, s.asset_sha256, s.direction, s.active, s.assignment_status
             FROM json_each(?1) AS wanted
             CROSS JOIN (${CARETAKER_SUPERVOTES_SQL}) AS s ON s.gene_symbol = wanted.value`,
        )
        .bind(wanted),
    ])
  ).map(rowsOf)
  for (const symbol of genes)
    facts.set(symbol, {
      gene_symbol: symbol,
      full_name: "",
      in_catalog: false,
      current: null,
      admin_override: false,
      published_at: "",
      candidates: [],
      caretaker: null,
    })
  for (const row of catalog) {
    const fact = facts.get(row.gene_symbol)
    fact.full_name = String(row.full_name || "")
    fact.in_catalog = true
  }
  for (const row of states) {
    const fact = facts.get(row.gene_symbol)
    fact.current = String(row.current_asset_sha256 || "") || null
    fact.admin_override = count(row.admin_override) > 0
    fact.published_at = String(row.updated_at || "")
  }
  for (const row of caretakers) facts.get(row.gene_symbol).caretaker = caretakerElectionInput(row)
  for (const row of candidates) facts.get(row.gene_symbol).candidates.push(row)
  for (const fact of facts.values()) {
    const rows = fact.candidates
    const status = (row) => String(row.status || "draft").toLowerCase()
    const eligible = (row) => (row.autopick_eligible ?? 1) === 1 && status(row) !== "rejected"
    fact.counts = {
      total_assets: rows.length,
      candidate_count: rows.filter(eligible).length,
      approved_count: rows.filter((row) => status(row) === "approved").length,
      rejected_count: rows.filter((row) => status(row) === "rejected").length,
      stale_count: rows.filter((row) => count(row.is_stale) > 0).length,
      legacy_count: rows.filter((row) => count(row.is_legacy) > 0).length,
    }
    fact.last_asset_at = rows.reduce((last, row) => {
      const at = String(row.created_at || "")
      return at > last ? at : last
    }, "")
    fact.live = fact.current ? rows.find((row) => row.asset_sha256 === fact.current) || null : null
    fact.current_asset_missing = Boolean(fact.current && !fact.live)
    // What the votes would publish, with any pin set aside: the "vote winner"
    // the admin compares the card with.
    fact.leader = electGeneAuthorityWinner({
      candidates: rows,
      summaries: rows
        .filter((row) => row.summary_asset_sha256)
        .map((row) => ({ ...row, asset_sha256: row.summary_asset_sha256 })),
      caretaker: fact.caretaker,
      currentAssetSha: fact.current,
      adminOverride: false,
    }).winner
    fact.leader_row = fact.leader
      ? rows.find((row) => row.asset_sha256 === fact.leader.asset_sha256) || null
      : null
  }
  return facts
}

function text(value, max) {
  return String(value ?? "").slice(0, max)
}

function canonicalRow(fact, portraitUrl) {
  const live = fact.live || {}
  const leader = fact.leader_row || {}
  const liveSha = fact.current || null
  const leaderSha = fact.leader?.asset_sha256 || null
  return {
    gene_symbol: fact.gene_symbol,
    full_name: text(fact.full_name || fact.gene_symbol, 255),
    ...fact.counts,
    live_sha: liveSha,
    admin_override: fact.admin_override,
    live_vision_id: text(live.vision_id, 255),
    live_artist_tag: text(live.artist_tag, 255),
    live_artist_name: text(live.artist_name, 255),
    live_upvotes: count(live.upvotes),
    live_downvotes: count(live.downvotes),
    live_score: Number(live.score || 0),
    live_status: text(fact.live ? live.status || "draft" : "", 32),
    live_small_url: portraitUrl(liveSha, "small"),
    live_medium_url: portraitUrl(liveSha, "medium"),
    leader_sha: leaderSha,
    leader_vision_id: text(leader.vision_id, 255),
    leader_artist_tag: text(leader.artist_tag, 255),
    leader_artist_name: text(leader.artist_name, 255),
    leader_upvotes: count(leader.upvotes),
    leader_downvotes: count(leader.downvotes),
    leader_score: Number(leader.score || 0),
    leader_small_url: portraitUrl(leaderSha, "small"),
    leader_medium_url: portraitUrl(leaderSha, "medium"),
    has_mismatch: fact.current_asset_missing,
    current_asset_missing: fact.current_asset_missing,
    has_stale: fact.counts.stale_count > 0,
    missing: fact.counts.candidate_count === 0,
    updated_at: text(fact.published_at || fact.last_asset_at, 64),
  }
}

function candidateRow(fact, row, portraitUrl) {
  const sha = row.asset_sha256
  return {
    gene_symbol: fact.gene_symbol,
    full_name: text(fact.full_name || fact.gene_symbol, 255),
    asset_sha256: sha,
    ...fact.counts,
    status: text(row.status || "draft", 32),
    autopick_eligible: (row.autopick_eligible ?? 1) === 1,
    is_stale: count(row.is_stale) > 0,
    is_legacy: count(row.is_legacy) > 0,
    is_live: fact.current === sha,
    admin_override: fact.admin_override,
    has_mismatch: fact.current_asset_missing,
    current_asset_missing: fact.current_asset_missing,
    missing: false,
    has_stale: count(row.is_stale) > 0,
    vision_id: text(row.vision_id, 255),
    artist_tag: text(row.artist_tag, 255),
    artist_name: text(row.artist_name, 255),
    image_upvotes: count(row.upvotes),
    image_downvotes: count(row.downvotes),
    image_score: Number(row.score || 0),
    small_url: portraitUrl(sha, "small"),
    medium_url: portraitUrl(sha, "medium"),
    full_url: portraitUrl(sha, "full"),
    updated_at: text(row.created_at, 64),
  }
}

/**
 * One page of the admin gallery. `portraitUrl(sha, rendition)` builds a
 * portrait's address. Inputs are already normalized by the route; `query` is
 * upper-cased.
 */
export async function readAdminGallery(
  db,
  { page = 1, limit = 60, filter = "all", sort = "name", query = "", mode = "live" },
  { portraitUrl },
) {
  const offset = (page - 1) * limit
  const options = { sort, filter, search: query, offset, limit }
  if (mode === "all") {
    const { keys, total } = await pickCandidates(db, options)
    const facts = await readAdminGeneFacts(
      db,
      keys.map((key) => key.gene_symbol),
    )
    const rows = keys.flatMap((key) => {
      const fact = facts.get(key.gene_symbol)
      const row = fact?.candidates.find((item) => item.asset_sha256 === key.asset_sha256)
      return row ? [candidateRow(fact, row, portraitUrl)] : []
    })
    return { page, limit, total, count: rows.length, mode, rows }
  }
  const { keys, total } = await pickGenes(db, options)
  const facts = await readAdminGeneFacts(
    db,
    keys.map((key) => key.gene_symbol),
  )
  const rows = keys.map((key) => canonicalRow(facts.get(key.gene_symbol), portraitUrl))
  return { page, limit, total, count: rows.length, mode, rows }
}
