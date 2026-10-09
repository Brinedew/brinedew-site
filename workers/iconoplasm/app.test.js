import assert from "node:assert/strict"
import test from "node:test"

import {
  publishIconoplasmGeneStableObject,
  refreshIconoplasmRegisteredGeneSummaries,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"
import { MAX_GENES_PER_REQUEST, REGISTER_MAX_PORTRAITS, createIconoplasmApp } from "./app.js"

// B-1063: the factory's portrait registration, through the real Hono app, Zod,
// Drizzle, the D1 schema of every production migration and the real card
// publisher. Failure modes written before the route:
// 1. a caller without the factory's token writes rows; or the router swallows
//    a request it doesn't own instead of handing it to the legacy handler;
// 2. new portraits don't reach the gene's live card, or arrive without the
//    `candidate_added` event the catalogue builder follows;
// 3. re-sending a registration rewrites rows (and their trigger-maintained
//    counters) or duplicates events;
// 4. a portrait of a gene the catalogue doesn't carry is stored as an orphan;
// 5. a malformed body, or more genes than one request can rebuild, writes
//    anything;
// 6. one gene's failed card build hides the others' success or loses rows;
// 7. the summaries the admin pages, readers' shelves and the request picker
//    still read (gene rollup, emulsion examples, vision marks) miss the new
//    portraits, because only the old ingest refreshed them.
const TOKEN = "factory-token-0000000000000000000000001"
const sha = (char) => char.repeat(64)

function harness({ failOn = null } = {}) {
  const db = iconoplasmDatabase()
  for (const [symbol, name] of [
    ["TP53", "tumor protein p53"],
    ["WEE1", "WEE1 G2 checkpoint kinase"],
  ])
    db.database
      .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
      .run(symbol, name)
  db.database.exec(`CREATE TEMP TABLE portrait_writes (n INTEGER);
    CREATE TEMP TRIGGER count_portrait_updates AFTER UPDATE ON icono_portrait_assets
    BEGIN INSERT INTO portrait_writes VALUES (1); END;`)
  const cards = new Map()
  const legacyCalls = []
  const app = createIconoplasmApp({
    legacy: async (request) => {
      legacyCalls.push(`${request.method} ${new URL(request.url).pathname}`)
      return new Response("legacy", { status: 299 })
    },
    publishGene: (env, symbol) => {
      if (failOn === symbol) throw new Error("Bunny Storage PUT failed (503)")
      return publishIconoplasmGeneStableObject(env, symbol, {
        readManifestation: async () => null,
        objects: {
          async writeStable(key, value) {
            cards.set(key, value)
            return { key, hash: "e".repeat(64), size: 1 }
          },
        },
      })
    },
    refreshSummaries: refreshIconoplasmRegisteredGeneSummaries,
  })
  const env = { ICONOPLASM_DB: db, ICONOPLASM_ADMIN_TOKEN: TOKEN }
  const register = async (body, { token = TOKEN } = {}) => {
    const response = await app.request(
      "/api/iconoplasm/admin/portraits/register",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    )
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const rows = (sql, ...args) => db.database.prepare(sql).all(...args)
  return { app, env, db, cards, legacyCalls, register, rows }
}

const portrait = (symbol, char, extra = {}) => ({
  symbol,
  asset_sha256: sha(char),
  width: 768,
  height: 1024,
  vision_id: "anima-v1-23013",
  emulsion_id: "C9-23013",
  sample_label: `${symbol}-0`,
  sample_number: 0,
  ...extra,
})

test("only the factory's token registers, and every other request reaches the legacy handler", async () => {
  const h = harness()
  const refused = await h.register(
    { created_by: "drain:local", portraits: [portrait("TP53", "a")] },
    { token: "wrong" },
  )
  assert.equal(refused.status, 401)
  assert.equal(h.rows("SELECT * FROM icono_portrait_assets").length, 0)

  const legacy = await h.app.request("/api/iconoplasm/admin/ingest", { method: "POST" }, h.env)
  assert.equal(legacy.status, 299)
  const page = await h.app.request("/api/iconoplasm/genes/TP53", {}, h.env)
  assert.equal(page.status, 299)
  assert.deepEqual(h.legacyCalls, [
    "POST /api/iconoplasm/admin/ingest",
    "GET /api/iconoplasm/genes/TP53",
  ])

  // An error thrown behind the router reaches the Worker's error reporting as it is.
  const throwing = createIconoplasmApp({
    legacy: async () => {
      throw new Error("legacy exploded")
    },
    publishGene: async () => null,
  })
  await assert.rejects(throwing.request("/anything", {}, h.env), /legacy exploded/)

  // Cloudflare's own daily read limit answers 503 with the reset, for the factory to wait out.
  const walled = createIconoplasmApp({
    legacy: async () => {
      throw new Error("D1_ERROR: Exceeded D1's free tier daily row read limit")
    },
    publishGene: async () => null,
  })
  const wall = await walled.request("/anything", {}, h.env)
  assert.equal(wall.status, 503)
  const body = await wall.json()
  assert.equal(body.code, "D1_ACCOUNT_READ_LIMIT")
  assert.match(body.reset_at, /T00:00:0\d\.\d{3}Z$/, "the next 00:00 UTC, plus Cloudflare's slack")
  assert.equal(Number(wall.headers.get("Retry-After")), body.retry_after_seconds)
})

test("new portraits land on the gene's card with one candidate_added event each", async () => {
  const h = harness()
  const result = await h.register({
    created_by: "drain:local",
    portraits: [portrait("TP53", "a"), portrait("TP53", "b", { sample_number: 1 })],
  })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.ok, true)
  assert.equal(result.body.added, 2)
  const stored = h.rows(
    "SELECT asset_sha256, r2_key_full, width, emulsion_id, status FROM icono_portrait_assets ORDER BY asset_sha256",
  )
  assert.deepEqual(
    stored.map((row) => [row.asset_sha256, row.r2_key_full, row.width, row.status]),
    [
      // Same second, no votes: the tie goes to the lower hash, and its election approves it.
      [sha("a"), `portraits/v1/aa/${sha("a")}/full.webp`, 768, "approved"],
      [sha("b"), `portraits/v1/bb/${sha("b")}/full.webp`, 768, "draft"],
    ],
  )
  assert.deepEqual(
    h
      .rows(
        "SELECT action, to_asset_sha256 FROM icono_publish_events WHERE action = 'candidate_added' ORDER BY id",
      )
      .map((row) => row.to_asset_sha256),
    [sha("a"), sha("b")],
  )
  const card = h.cards.get("genes/v3/TP53.json")
  assert.equal(card.candidate_count, 2)
  assert.equal(card.portrait.status, "published")
  assert.equal(result.body.genes[0].winner_asset_sha256, card.portrait.asset_sha256)
  assert.deepEqual(
    h
      .rows("SELECT current_asset_sha256, total_assets FROM icono_admin_gene_rollup")
      .map((row) => ({ ...row })),
    [{ current_asset_sha256: sha("a"), total_assets: 2 }],
  )
  assert.deepEqual(
    h
      .rows("SELECT emulsion_id FROM icono_user_emulsion_option_rollup")
      .map((row) => row.emulsion_id),
    ["C9-23013"],
  )
  assert.deepEqual(
    h.rows("SELECT vision_id FROM icono_vision_rollup_dirty").map((row) => row.vision_id),
    ["anima-v1-23013"],
  )
})

test("re-sending a registration rewrites no row and adds no event", async () => {
  const h = harness()
  const body = { created_by: "drain:local", portraits: [portrait("TP53", "a")] }
  await h.register(body)
  const events = h.rows("SELECT COUNT(*) AS n FROM icono_publish_events")[0].n
  h.db.database.exec("DELETE FROM portrait_writes")
  h.cards.clear()
  const again = await h.register(body)
  assert.equal(again.body.ok, true)
  assert.equal(again.body.added, 0)
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM portrait_writes")[0].n, 0)
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM icono_publish_events")[0].n, events)
  assert.ok(h.cards.has("genes/v3/TP53.json"), "the card is rebuilt again")

  // A changed factory value is written; the site's status stays.
  h.db.database.exec("UPDATE icono_portrait_assets SET status = 'approved'")
  await h.register({
    created_by: "drain:local",
    portraits: [portrait("TP53", "a", { is_stale: true })],
  })
  assert.deepEqual(
    { ...h.rows("SELECT is_stale, status FROM icono_portrait_assets")[0] },
    { is_stale: 1, status: "approved" },
  )
})

test("a portrait of a gene the catalogue doesn't carry is refused, and the rest register", async () => {
  const h = harness()
  const result = await h.register({
    created_by: "drain:local",
    portraits: [portrait("ADGRE4P", "c"), portrait("WEE1", "d")],
  })
  assert.equal(result.body.ok, false)
  assert.deepEqual(
    result.body.genes.map((gene) => [gene.symbol, gene.ok]),
    [
      ["ADGRE4P", false],
      ["WEE1", true],
    ],
  )
  assert.deepEqual(
    h.rows("SELECT gene_symbol FROM icono_portrait_assets").map((row) => row.gene_symbol),
    ["WEE1"],
  )
})

test("a malformed body, or more genes than one request can rebuild, writes nothing", async () => {
  const h = harness()
  const badSha = await h.register({
    created_by: "drain:local",
    portraits: [{ ...portrait("TP53", "a"), asset_sha256: "not-a-hash" }],
  })
  assert.equal(badSha.status, 400)
  const tooMany = await h.register({
    created_by: "drain:local",
    portraits: Array.from({ length: MAX_GENES_PER_REQUEST + 1 }, (_, index) =>
      portrait(`GENE${index}`, "a"),
    ),
  })
  assert.equal(tooMany.status, 400)
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM icono_portrait_assets")[0].n, 0)
})

test("one gene's failed card build is reported, and its rows and the other genes stand", async () => {
  const h = harness({ failOn: "TP53" })
  const result = await h.register({
    created_by: "drain:local",
    portraits: [portrait("TP53", "a"), portrait("WEE1", "d")],
  })
  assert.equal(result.body.ok, false)
  assert.deepEqual(
    result.body.genes.map((gene) => [gene.symbol, gene.ok]),
    [
      ["TP53", false],
      ["WEE1", true],
    ],
  )
  assert.match(result.body.genes[0].error, /PUT failed/)
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM icono_portrait_assets")[0].n, 2)
  assert.ok(h.cards.has("genes/v3/WEE1.json"))
})

// 2026-10-09, 20:04 UTC: building one D1 statement per row cost a 96-portrait
// registration 60 ms of CPU, and Cloudflare killed the call. Whatever its size,
// a registration writes its rows with one statement per table.
test("a full registration writes all its rows with two statements", async () => {
  const h = harness()
  const batches = []
  const batch = h.db.batch.bind(h.db)
  h.db.batch = async (statements) => {
    batches.push(statements.length)
    return batch(statements)
  }
  const portraits = Array.from({ length: REGISTER_MAX_PORTRAITS }, (_, index) =>
    portrait(index % 2 ? "TP53" : "WEE1", "", {
      asset_sha256: index.toString(16).padStart(64, "0"),
      sample_number: index,
    }),
  )
  const result = await h.register({ created_by: "drain:local", portraits })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.added, REGISTER_MAX_PORTRAITS)
  assert.equal(batches[0], 2, "the portrait rows and their events, one statement each")
  assert.equal(
    h.rows("SELECT COUNT(*) AS n FROM icono_portrait_assets")[0].n,
    REGISTER_MAX_PORTRAITS,
  )
  assert.equal(
    h.rows("SELECT COUNT(*) AS n FROM icono_publish_events WHERE action = 'candidate_added'")[0].n,
    REGISTER_MAX_PORTRAITS,
  )
})
