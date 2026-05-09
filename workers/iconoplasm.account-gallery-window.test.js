import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const source = readFileSync(
  new URL("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js", import.meta.url),
  "utf8",
)

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    if (this.sql.includes("COUNT(*) AS discovered_count")) {
      const [userId] = this.args
      return {
        discovered_count: this.db.rows.filter((row) => row.user_id === String(userId)).length,
      }
    }
    if (this.sql.includes("FROM icono_gene_discoveries")) {
      const [userId, symbol] = this.args
      return this.db.discovery(userId, symbol)
    }
    return null
  }

  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    throw new Error(`Unexpected write in account gallery window test: ${this.sql}`)
  }

  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, args: this.args })
    if (!this.sql.includes("FROM icono_gene_discoveries d")) {
      throw new Error(`Unexpected SQL in account gallery window test: ${this.sql}`)
    }
    const userId = String(this.args[0] || "")
    const limit = Number(this.args[this.args.length - 1] || 24)
    let rows = this.db.rows
      .filter((row) => row.user_id === userId)
      .map((row) => this.db.enrich(row))
    if (this.sql.includes("ORDER BY d.gene_symbol ASC")) {
      const cursor = this.args.length === 3 ? String(this.args[1] || "").toUpperCase() : ""
      rows = rows
        .filter((row) => !cursor || row.gene_symbol > cursor)
        .sort((left, right) => String(left.gene_symbol).localeCompare(String(right.gene_symbol)))
    } else {
      const hasCursor = this.args.length === 5
      const cursorTime = hasCursor ? String(this.args[1] || "") : ""
      const cursorSymbol = hasCursor ? String(this.args[3] || "").toUpperCase() : ""
      rows = rows
        .filter((row) => {
          if (!hasCursor) return true
          if (String(row.last_encountered_at || "") < cursorTime) return true
          return String(row.last_encountered_at || "") === cursorTime && row.gene_symbol > cursorSymbol
        })
        .sort((left, right) => {
          return (
            String(right.last_encountered_at || "").localeCompare(String(left.last_encountered_at || "")) ||
            String(left.gene_symbol).localeCompare(String(right.gene_symbol))
          )
        })
    }
    return { results: rows.slice(0, limit) }
  }
}

class FakeDb {
  constructor() {
    this.calls = []
    this.rows = [
      this.row("user-123", "INS", "2026-01-03T00:00:00Z", 2),
      this.row("user-123", "PRL", "2026-01-02T00:00:00Z", 1),
      this.row("user-123", "RHO", "2026-01-01T00:00:00Z", 7),
      this.row("user-123", "TP53", "2026-01-05T00:00:00Z", 18),
      this.row("user-123", "BRCA1", "2026-01-04T00:00:00Z", 11),
    ]
  }

  row(userId, symbol, lastEncounteredAt, score) {
    return {
      user_id: userId,
      gene_symbol: symbol,
      first_discovered_at: lastEncounteredAt,
      last_encountered_at: lastEncounteredAt,
      encounter_count: 1,
      first_source: "test",
      last_source: "test",
      first_trigger: "test",
      last_trigger: "test",
      image_score: score,
    }
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  discovery(userId, symbol) {
    return this.rows.find(
      (row) => row.user_id === String(userId) && row.gene_symbol === String(symbol).toUpperCase(),
    )
  }

  enrich(row) {
    return {
      ...row,
      full_name: `${row.gene_symbol} full name`,
      weight_kg: null,
      age_years: null,
      uniqueness_rank: null,
      image_upvotes: Math.max(0, Number(row.image_score || 0)),
      image_downvotes: 0,
      published_at: row.last_encountered_at,
      asset_created_at: row.last_encountered_at,
    }
  }
}

class FakeGameSessions {
  constructor(sessions = {}) {
    this.sessions = sessions
  }

  idFromName(name) {
    return String(name || "")
  }

  get(id) {
    const session = this.sessions[String(id || "")]
    return {
      fetch: async () => (session ? Response.json(session) : new Response("missing", { status: 404 })),
    }
  }
}

function completeMobileCardVM(symbol, version = "test-vm-version") {
  const normalized = String(symbol || "").toUpperCase()
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: version,
    data_source: "published_card_catalog",
    symbol: normalized,
    full_name: `${normalized} full name`,
    display_color: "#423D37",
    portrait: {
      status: "published",
      url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
      width: 768,
      height: 1024,
      asset_sha256: "7b".repeat(32),
      candidate_image_id: 1,
      vision_id: "artist-random-v1",
      emulsion_id: `A1-${normalized}`,
    },
    field_status: {
      symbol: "present",
      full_name: "present",
      color: "present",
      portrait: "present",
    },
    payload: {
      symbol: normalized,
      full_name: `${normalized} full name`,
      color: "#423D37",
      portrait: { status: "published" },
    },
  }
}

function completeCardCatalogArtifact(symbols, version = "test-vm-version") {
  const cards = symbols.map((symbol) => completeMobileCardVM(symbol, version))
  return {
    schema: "iconoplasm.cardCatalog.v1",
    artifact_version: version,
    snapshot_version: version,
    artifact_validated_at: "2026-05-09T00:00:00.000Z",
    source: "published_card_catalog",
    catalog_gene_count: cards.length,
    card_count: cards.length,
    cards,
  }
}

function buildEnv({ db = new FakeDb(), version = "test-vm-version" } = {}) {
  const symbols = ["INS", "PRL", "RHO", "TP53", "BRCA1"]
  const kvStore = new Map([[`iconoplasm:card-catalog:${version}`, JSON.stringify(completeCardCatalogArtifact(symbols, version))]])
  return {
    ICONOPLASM_DB: db,
    GAME_SESSIONS: new FakeGameSessions({
      "session:abc": { user_id: "user-123", username: "alex" },
    }),
    KV: {
      async get(key) {
        if (key === "iconoplasm:gallery-version") return version
        return kvStore.get(key) || null
      },
      async put(key, value) {
        kvStore.set(key, value)
      },
    },
  }
}

test("account gallery window returns strict rich cards for newest without full shelf sort", async () => {
  const db = new FakeDb()
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2", {
      headers: { Cookie: "session=abc" },
    }),
    buildEnv({ db }),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.schema, "iconoplasm.accountGalleryWindow.v1")
  assert.equal(payload.order, "newest")
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["TP53", "BRCA1"],
  )
  assert.equal(payload.has_more, true)
  assert.equal(payload.discovered_count, 5)
  assert.ok(payload.next_cursor)
  assert.equal(payload.diagnostics.d1_composed, 0)
  assert.equal(payload.diagnostics.d1_window_rows, 2)
  assert.equal(payload.diagnostics.source, "published_card_catalog")
  assert.equal(payload.diagnostics.artifact_version, "test-vm-version")
  assert.equal(payload.missing.length, 0)
  assert.ok(
    db.calls.some(
      (call) =>
        call.method === "all" &&
        call.sql.includes("ORDER BY d.last_encountered_at DESC, d.gene_symbol ASC") &&
        call.sql.includes("LIMIT ?"),
    ),
  )
})

test("account gallery newest window puts the newly discovered 101st gene first", async () => {
  const db = new FakeDb()
  db.rows = ["INS", "RHO", "PRL"].map((symbol, index) =>
    db.row("user-123", symbol, `2026-04-29T00:0${index}:00Z`, index),
  )
  db.rows = db.rows.concat(Array.from({ length: 97 }, (_, index) => {
    const number = String(index + 1).padStart(3, "0")
    return db.row("user-123", `G${number}`, `2026-04-29T00:${number.slice(1)}:00Z`, index)
  }))
  db.rows.push(db.row("user-123", "NEW101", "2026-04-30T00:00:00Z", 0))
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db, version: "test-vm-version-101" })
  const allSymbols = db.rows.map((row) => row.gene_symbol)
  env.KV.put(
    "iconoplasm:card-catalog:test-vm-version-101",
    JSON.stringify(completeCardCatalogArtifact(allSymbols, "test-vm-version-101")),
  )

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=3", {
      headers: { Cookie: "session=abc" },
    }),
    env,
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.discovered_count, 101)
  assert.equal(payload.cards[0]?.symbol, "NEW101")
  assert.equal(payload.items[0]?.discovery?.last_encountered_at, "2026-04-30T00:00:00Z")
})

test("account gallery window paginates symbol order with a stable cursor", async () => {
  const env = buildEnv()
  const first = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&limit=2", {
      headers: { Cookie: "session=abc" },
    }),
    env,
  )
  const firstPayload = await first.json()
  const second = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request(
      `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&limit=2&cursor=${encodeURIComponent(firstPayload.next_cursor)}`,
      { headers: { Cookie: "session=abc" } },
    ),
    env,
  )
  const secondPayload = await second.json()

  assert.deepEqual(
    firstPayload.cards.map((card) => card.symbol),
    ["BRCA1", "INS"],
  )
  assert.deepEqual(
    secondPayload.cards.map((card) => card.symbol),
    ["PRL", "RHO"],
  )
})

test("account gallery window rejects metric orders until a real order index exists", async () => {
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=votes&limit=2", {
      headers: { Cookie: "session=abc" },
    }),
    buildEnv(),
  )
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.code, "ORDER_INDEX_NOT_READY")
  assert.deepEqual(payload.supported_orders.sort(), ["newest", "symbol"])
})

test("account gallery endpoint block does not sort a bounded discovery slice for metric orders", () => {
  const start = source.lastIndexOf('if (path === "/api/iconoplasm/account-gallery-window"')
  const end = source.indexOf('if (path === "/api/iconoplasm/discoveries/merge"', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const block = source.slice(start, end)

  assert.doesNotMatch(block, /sortDiscoveryRowsForOrder/)
  assert.match(block, /ORDER_INDEX_NOT_READY/)
  assert.match(block, /ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS/)
})

test("account gallery endpoint block reads cards from the published artifact, not per-gene KV", () => {
  const start = source.lastIndexOf('if (path === "/api/iconoplasm/account-gallery-window"')
  const end = source.indexOf('if (path === "/api/iconoplasm/discoveries/merge"', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const block = source.slice(start, end)

  assert.match(block, /readPublishedCardCatalogArtifact/)
  assert.doesNotMatch(block, /readMobileCardVMFromSharedSnapshot/)
  assert.doesNotMatch(block, /versionInfo\.previous/)
})

test("account gallery endpoint has an explicit budget class", () => {
  assert.match(source, /if \(path === "\/api\/iconoplasm\/account-gallery-window"\) return "account_gallery_window"/)
  assert.match(source, /if \(family === "account_gallery_window"\) return "first_party_read"/)
})
