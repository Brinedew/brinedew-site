// Test support for the gene blot backlog (B-898 Stage 1, step B). A real SQLite
// database behind the D1 prepare/bind/first/all/run/batch surface, built from
// the checked-in migrations the backlog reads, plus a Bunny Storage stub that
// serves stable gene objects (genes/v3/<SYMBOL>.json) from a map. Both count
// what they were asked so a test can assert reads, not just results.
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const MIGRATIONS = [
  "0001_publish_tables.sql",
  "0012_add_publish_admin_override.sql",
  "0059_published_gene_routes.sql",
  "0060_card_catalog_publication_audit.sql",
  "0079_gene_blot_materializations.sql",
  "0112_gene_blot_backlog_watermark.sql",
]

class SqliteD1Statement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql)
    this.args = []
  }
  bind(...args) {
    this.args = args
    return this
  }
  async first(column) {
    this.db.queries.push(this.sql)
    const row = this.db.sqlite.prepare(this.sql).get(...this.args) ?? null
    if (!row) return null
    return column ? (row[column] ?? null) : row
  }
  async all() {
    this.db.queries.push(this.sql)
    const results = this.db.sqlite.prepare(this.sql).all(...this.args)
    this.db.rowsRead += results.length
    return { results, success: true, meta: { rows_read: results.length } }
  }
  async run() {
    this.db.queries.push(this.sql)
    const result = this.db.sqlite.prepare(this.sql).run(...this.args)
    this.db.rowsWritten += Number(result.changes || 0)
    return { success: true, meta: { changes: Number(result.changes || 0) } }
  }
}

export class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:")
    this.queries = []
    this.rowsRead = 0
    this.rowsWritten = 0
    // 0059 seeds route membership from the catalog and 0079 references it.
    this.sqlite.exec("CREATE TABLE IF NOT EXISTS icono_gene_catalog (gene_symbol TEXT PRIMARY KEY)")
    for (const name of MIGRATIONS) {
      this.sqlite.exec(
        readFileSync(new URL(`../migrations-iconoplasm/${name}`, import.meta.url), "utf8"),
      )
    }
  }
  prepare(sql) {
    return new SqliteD1Statement(this, sql)
  }
  async batch(statements) {
    const results = []
    for (const statement of statements) results.push(await statement.run())
    return results
  }
  exec(sql, ...args) {
    return this.sqlite.prepare(sql).run(...args)
  }
  writesSince(mark) {
    return this.rowsWritten - mark
  }
  // Seeds one gene: catalog membership, route membership, the current winner
  // (null = no portrait), and optionally a rendered blot row.
  seedGene(symbol, { winner = null, route = true, blot = null } = {}) {
    this.exec("INSERT OR IGNORE INTO icono_gene_catalog (gene_symbol) VALUES (?)", symbol)
    if (route)
      this.exec(
        "INSERT OR IGNORE INTO icono_published_gene_routes (gene_symbol) VALUES (?)",
        symbol,
      )
    this.exec(
      `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by)
       VALUES (?, ?, 'test')
       ON CONFLICT(gene_symbol) DO UPDATE SET current_asset_sha256 = excluded.current_asset_sha256`,
      symbol,
      winner,
    )
    if (blot) this.seedBlot(symbol, blot)
  }
  seedBlot(
    symbol,
    { fingerprint, portraitSha, rendererRevision, objectKey = null, blotSha = "9".repeat(64) },
  ) {
    this.exec(
      `INSERT INTO icono_gene_blot_materializations
         (gene_symbol, blot_fingerprint, portrait_asset_sha256, blot_asset_sha256, object_key, width, height, renderer_revision)
       VALUES (?, ?, ?, ?, ?, 768, 1024, ?)
       ON CONFLICT(gene_symbol) DO UPDATE SET
         blot_fingerprint = excluded.blot_fingerprint,
         portrait_asset_sha256 = excluded.portrait_asset_sha256,
         renderer_revision = excluded.renderer_revision`,
      symbol,
      fingerprint,
      portraitSha,
      blotSha,
      objectKey ||
        `blots/v1/${symbol[0]}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`,
      rendererRevision,
    )
  }
  // Appends a publish event and returns its id.
  event(symbol, action, { to = null, from = null } = {}) {
    const result = this.exec(
      "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor) VALUES (?, ?, ?, ?, 'test')",
      symbol,
      from,
      to,
      action,
    )
    return Number(result.lastInsertRowid)
  }
  watermark() {
    const row = this.sqlite
      .prepare(
        "SELECT through_event_id FROM icono_gene_blot_backlog_watermark WHERE watermark_key = 'candidate'",
      )
      .get()
    return row ? Number(row.through_event_id) : null
  }
  queriesSince(mark) {
    return this.queries.slice(mark)
  }
}

export const STORAGE_ZONE = "test-zone"

export function stableObjectPath(symbol) {
  return `/${STORAGE_ZONE}/genes/v3/${symbol}.json`
}

// A projected gene record as the stable object carries it. `blot` is the
// re-published form (status ready) when provided.
export function stableGeneObject(
  symbol,
  { portraitSha = null, fullName = `${symbol} full name`, blot = null } = {},
) {
  return {
    symbol,
    canonical_symbol: symbol,
    full_name: fullName,
    color: "#423D37",
    portrait: portraitSha
      ? {
          status: "published",
          asset_sha256: portraitSha,
          hero_url: `https://iconoplasm.brinedew.bio/portraits/${portraitSha}/full.webp`,
        }
      : null,
    portrait_candidates: portraitSha ? [{ asset_sha256: portraitSha, is_current: true }] : [],
    candidate_count: portraitSha ? 1 : 0,
    ...(blot ? { blot } : {}),
    stable_object_version: 3,
    published_at: "2026-10-01T22:00:00.000Z",
  }
}

// Installs a fetch stub for the authenticated Bunny Storage host. `objects` maps
// storage paths (see stableObjectPath) to a stable object, a JSON string, or a
// behaviour: { status } answers that HTTP status, { throw: true } rejects.
export function installStableObjectStorage(t, objects) {
  const reads = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url instanceof Request ? url.url : String(url))
    if (parsed.hostname !== "storage.test") return originalFetch(url, init)
    reads.push(parsed.pathname)
    const value = objects.get(parsed.pathname)
    if (value === undefined) return new Response(null, { status: 404 })
    if (value && typeof value === "object" && value.throw) throw new Error("storage socket reset")
    if (value && typeof value === "object" && value.status)
      return new Response(null, { status: value.status })
    const body = typeof value === "string" ? value : JSON.stringify(value)
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  return reads
}

export function backlogEnv(db) {
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: STORAGE_ZONE,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.test",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-password",
    ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
  }
}

export function backlogRequest(method = "POST", query = "") {
  return new Request(`https://iconoplasm.brinedew.bio/api/iconoplasm/admin/blots/backlog${query}`, {
    method,
  })
}
