import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import {
  collapseGenerationRequestFactorySlotOptions,
  rebuildGenerationRequestFactoryOptionRollupsBatch,
  rebuildUserEmulsionOptionRollupsBatch,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

// B-896: the style picker's examples for a style were four portraits of one
// character, none canonical or upvoted. Both picker rollups ranked "current
// winner, then votes, then newest" across all assets of a style, so one gene's
// fresh batch of drafts filled every slot. Failure modes written before the
// code:
// 1. a style with five or more genes shows five different genes;
// 2. the gene with a fresh batch of drafts contributes one example, not five;
// 3. a current winner comes first, then upvoted portraits, then the rest;
// 4. a gene's example is its own best portrait (its winner over its drafts);
// 5. a style with fewer genes than slots still fills the slots, best per gene
//    first;
// 6. counts (image_count, live_count) are unchanged by the ranking.

const STYLE = "A1-7"
const sha = (label) => label.padEnd(64, "0")

// LPA: six fresh drafts, newest of all. W: an older current winner. U: an old
// draft with three upvotes. C and D: older drafts. W also has a newer draft
// that must not displace its own winner.
const ASSETS = [
  ...Array.from({ length: 6 }, (_, i) => ["LPA", sha(`1${i}`), `2026-10-01T10:0${i}:00Z`]),
  ["W", sha("a1"), "2026-09-01T00:00:00Z"],
  ["W", sha("a2"), "2026-09-30T00:00:00Z"],
  ["U", sha("b1"), "2026-08-01T00:00:00Z"],
  ["C", sha("c1"), "2026-09-10T00:00:00Z"],
  ["D", sha("d1"), "2026-09-05T00:00:00Z"],
]

async function withDatabase(run) {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('test')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
  try {
    const db = await runtime.getD1Database("DB")
    for (const sql of [
      "CREATE TABLE icono_portrait_assets(gene_symbol TEXT,asset_sha256 TEXT,emulsion_id TEXT,vision_id TEXT,created_at TEXT,status TEXT,PRIMARY KEY(gene_symbol,asset_sha256))",
      "CREATE TABLE icono_publish_state(gene_symbol TEXT PRIMARY KEY,current_asset_sha256 TEXT)",
      "CREATE TABLE icono_vote_asset_summary(gene_symbol TEXT,asset_sha256 TEXT,upvotes INTEGER,score INTEGER,PRIMARY KEY(gene_symbol,asset_sha256))",
      "CREATE TABLE icono_generation_request_factory_option_rollup(public_emulsion_code TEXT PRIMARY KEY,emulsion_slot INTEGER,image_count INTEGER,live_count INTEGER,score INTEGER,vote_h_index INTEGER,preview_assets_json TEXT,updated_at TEXT)",
      "CREATE TABLE icono_user_emulsion_option_rollup(emulsion_id TEXT PRIMARY KEY,image_count INTEGER,live_count INTEGER,preview_assets_json TEXT,updated_at TEXT)",
    ])
      await db.prepare(sql).run()
    for (const [gene, asset, createdAt] of ASSETS) {
      await db
        .prepare(
          "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,emulsion_id,vision_id,created_at,status) VALUES (?,?,?,?,?,'draft')",
        )
        .bind(gene, asset, STYLE, `v-${gene}`, createdAt)
        .run()
    }
    await db.prepare("INSERT INTO icono_publish_state VALUES ('W', ?)").bind(sha("a1")).run()
    await db
      .prepare("INSERT INTO icono_vote_asset_summary VALUES ('U', ?, 3, 3)")
      .bind(sha("b1"))
      .run()
    await run(db)
  } finally {
    await runtime.dispose()
  }
}

// Capture a rollup's SQL from the runtime, then execute it against real SQLite.
async function capturedSql(rebuild, marker) {
  let captured = null
  await rebuild(
    {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind() {
              return this
            },
            async all() {
              return { results: [{ public_emulsion_code: STYLE }] }
            },
            async run() {
              if (sql.includes(marker)) captured = sql
              return { success: true }
            },
          }
        },
      },
    },
    ["anima-v1-1"],
  )
  assert.ok(captured, `captured ${marker}`)
  return captured
}

function assertDiverseExamples(previews) {
  const genes = previews.map((row) => row.gene_symbol)
  assert.equal(previews.length, 5)
  assert.equal(new Set(genes).size, 5, `five different genes: ${genes}`)
  assert.equal(genes.filter((gene) => gene === "LPA").length, 1)
  assert.equal(genes[0], "W", "the current winner leads")
  assert.equal(previews[0].asset_sha256, sha("a1"), "a gene shows its own winner")
  assert.equal(previews[0].is_current, 1)
}

test("factory picker examples come from five different genes, winners first", async () => {
  const sql = await capturedSql(
    rebuildGenerationRequestFactoryOptionRollupsBatch,
    "source_assets AS",
  )
  await withDatabase(async (db) => {
    await db
      .prepare(sql)
      .bind(JSON.stringify([STYLE]))
      .run()
    const row = await db
      .prepare(
        "SELECT image_count, live_count, preview_assets_json FROM icono_generation_request_factory_option_rollup WHERE public_emulsion_code = ?",
      )
      .bind(STYLE)
      .first()
    assert.equal(row.image_count, ASSETS.length)
    assert.equal(row.live_count, 1)
    const previews = JSON.parse(row.preview_assets_json)
    assertDiverseExamples(previews)
    assert.equal(previews[1].gene_symbol, "U", "upvoted portraits follow the winner")
  })
})

test("style picker examples come from five different genes, winners first", async () => {
  const sql = await capturedSql(
    (env) => rebuildUserEmulsionOptionRollupsBatch(env, [STYLE]),
    "INSERT INTO icono_user_emulsion_option_rollup",
  )
  await withDatabase(async (db) => {
    await db
      .prepare(sql)
      .bind(JSON.stringify([STYLE]))
      .run()
    const row = await db
      .prepare(
        "SELECT image_count, live_count, preview_assets_json FROM icono_user_emulsion_option_rollup WHERE emulsion_id = ?",
      )
      .bind(STYLE)
      .first()
    assert.equal(row.image_count, ASSETS.length)
    assert.equal(row.live_count, 1)
    assertDiverseExamples(JSON.parse(row.preview_assets_json))
  })
})

test("a style with fewer genes than slots still fills them, best per gene first", async () => {
  const sql = await capturedSql(
    rebuildGenerationRequestFactoryOptionRollupsBatch,
    "source_assets AS",
  )
  await withDatabase(async (db) => {
    await db.prepare("DELETE FROM icono_portrait_assets WHERE gene_symbol IN ('U','C','D')").run()
    await db
      .prepare(sql)
      .bind(JSON.stringify([STYLE]))
      .run()
    const row = await db
      .prepare(
        "SELECT preview_assets_json FROM icono_generation_request_factory_option_rollup WHERE public_emulsion_code = ?",
      )
      .bind(STYLE)
      .first()
    const genes = JSON.parse(row.preview_assets_json).map((preview) => preview.gene_symbol)
    assert.deepEqual(genes.slice(0, 2).sort(), ["LPA", "W"])
    assert.equal(genes.length, 5)
  })
})

// Golden, from the nightly copy of 2026-09-29: style 21103's recipe codes in
// the favorites query's order (live_count, then blots). Its card showed C9's
// three canonical portraits and a candidate, while H9 and G9 held two more
// canonical portraits (2026-10-05, owner's Favorites).
test("a factory style shows every code's canonical portraits before any candidate", () => {
  const preview = (gene_symbol, sha, is_current) => ({
    gene_symbol,
    asset_sha256: sha.padEnd(64, "0"),
    is_current,
  })
  const sources = [
    [
      preview("NELFB", "02ee", true),
      preview("LRP6", "ca56", true),
      preview("ACR", "c3ac", true),
      preview("TH", "f6bc", false),
      preview("HR", "5804", false),
    ],
    [
      preview("EED", "7130", true),
      preview("SUZ12", "eb6d", false),
      preview("RBBP7", "1d80", false),
      preview("JARID2", "7d4d", false),
      preview("EZH2", "649a", false),
    ],
    [preview("KIN", "e6ff", true)],
    [preview("MAPK1", "4554", false), preview("MAP2K1", "b327", false)],
    [preview("KIN", "6df7", false)],
  ].map((preview_assets) => ({ preview_assets, image_count: 1 }))
  const collapsed = collapseGenerationRequestFactorySlotOptions(21103, sources)
  assert.deepEqual(
    collapsed.preview_assets.map((preview) => preview.gene_symbol),
    ["NELFB", "LRP6", "ACR", "EED", "KIN"],
  )
})
