import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  fetchAdminAssetRepairScope,
  selectStorageAuditQueueRowsToProcess,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

// B-1020: Website Ops' storage audit and repair, scoped to one gene (DLK2,
// 8 assets), read 151,327 production rows on 2026-10-05 and tripped the
// 1,000,000-row operator fence. Ways a scoped call can fail:
// 1. it reads other genes' rows, so its cost grows with the whole catalogue;
// 2. it misses the requested gene: no queue rows, or stale flags left on them;
// 3. it rewrites or deletes other genes' queue rows;
// 4. the row picker hands back another gene's assets.

// The production schema as the migrations leave it: tables, the rows the
// migrations seed (the maintained summary counts row among them), then
// indexes, views and the triggers that keep those counts.
function schemaStatements() {
  const schema = new DatabaseSync(":memory:")
  const migrations = new URL("../../migrations-iconoplasm/", import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((n) => n.endsWith(".sql"))
    .sort())
    schema.exec(readFileSync(new URL(file, migrations), "utf8"))
  const objects = schema
    .prepare(
      `SELECT type, name, sql FROM sqlite_schema
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
        ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid`,
    )
    .all()
  const out = []
  for (const { type, sql } of objects.filter((o) => o.type === "table")) out.push(sql)
  for (const { name } of objects.filter((o) => o.type === "table"))
    for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
      const columns = Object.keys(row)
      const values = columns.map((c) =>
        row[c] === null
          ? "NULL"
          : typeof row[c] === "number" || typeof row[c] === "bigint"
            ? String(row[c])
            : `'${String(row[c]).replaceAll("'", "''")}'`,
      )
      out.push(
        `INSERT INTO "${name}"(${columns.map((c) => `"${c}"`).join(",")}) VALUES(${values.join(",")})`,
      )
    }
  for (const { sql } of objects.filter((o) => o.type !== "table")) out.push(sql)
  return out
}

const sha = (n) => n.toString(16).padStart(64, "0")

// Unrelated genes, each with assets and already-audited queue rows, inserted
// in chunks so one statement stays small.
async function addUnrelated(db, from, genes) {
  for (let start = from; start < from + genes; start += 200) {
    const assets = []
    const queue = []
    for (let g = start; g < Math.min(start + 200, from + genes); g++) {
      for (let a = 0; a < 3; a++) {
        const s = sha(g * 10 + a + 1000)
        assets.push(`('G${g}','${s}','G${g}-${a}','','','approved')`)
        queue.push(
          `('G${g}','${s}','completed','renderable','2026-10-01 00:00:00','2026-10-01 00:00:00')`,
        )
      }
    }
    await db
      .prepare(
        `INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,sample_label,r2_key_full,r2_key_thumb,status) VALUES ${assets.join(",")}`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO icono_storage_audit_queue(gene_symbol,asset_sha256,status,audit_state,last_audited_at,updated_at) VALUES ${queue.join(",")}`,
      )
      .run()
  }
}

test(
  "a storage audit or repair scoped to one gene costs the same beside 2,000 or 12,000 unrelated genes",
  { timeout: 180000 },
  async (t) => {
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
      for (const sql of schemaStatements()) await db.prepare(sql).run()
      // DLK2: a published portrait plus two drafts; one draft is queued from
      // an earlier pass with a stale flag the seed must correct.
      await db
        .prepare(
          `INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,sample_label,r2_key_full,r2_key_thumb,status) VALUES
           ('DLK2','${sha(1)}','DLK2-1','','','approved'),
           ('DLK2','${sha(2)}','DLK2-2','','','draft'),
           ('DLK2','${sha(3)}','DLK2-3','','','draft')`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) VALUES ('DLK2','${sha(1)}')`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO icono_storage_audit_queue(gene_symbol,asset_sha256,status,audit_state,is_current,updated_at)
           VALUES ('DLK2','${sha(2)}','completed','renderable',1,'2026-01-01 00:00:00')`,
        )
        .run()
      await addUnrelated(db, 0, 2000)

      const scoped = async () => {
        const meter = createOperationCostD1Meter(db)
        const env = { ICONOPLASM_DB: meter.db }
        const scope = await fetchAdminAssetRepairScope(env, { requestedSymbols: ["DLK2"] })
        const picked = await selectStorageAuditQueueRowsToProcess(env, {
          requestedSymbols: ["DLK2"],
          limit: 100,
        })
        return { cost: meter.finish(), scope, picked }
      }

      // The first call also builds the persisted summary once; measure the
      // second, which is what an operator's repeated clicks cost.
      await scoped()
      const small = await scoped()

      // 2. Every DLK2 asset is queued, the stale flag is corrected, and
      // 4. the picker returns DLK2 rows only.
      const queued = (
        await db
          .prepare(
            "SELECT asset_sha256, is_current FROM icono_storage_audit_queue WHERE gene_symbol='DLK2' ORDER BY asset_sha256",
          )
          .all()
      ).results
      assert.deepEqual(
        queued.map((r) => [r.asset_sha256, r.is_current]),
        [
          [sha(1), 1],
          [sha(2), 0],
          [sha(3), 0],
        ],
      )
      assert.ok(small.picked.length > 0)
      assert.ok(
        small.picked.every((r) => r.gene_symbol === "DLK2"),
        JSON.stringify(small.picked),
      )
      assert.ok(small.scope.rows.every((r) => r.symbol === "DLK2"))

      // 3. Other genes' queue rows are untouched.
      const touched = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM icono_storage_audit_queue WHERE gene_symbol<>'DLK2' AND updated_at<>'2026-10-01 00:00:00'",
        )
        .first()
      assert.equal(touched.n, 0)

      // 1. Six times the unrelated catalogue costs no more rows.
      await addUnrelated(db, 2000, 10000)
      const large = await scoped()
      assert.ok(
        large.cost.rows_read <= small.cost.rows_read,
        `scoped cost grew with unrelated rows: ${JSON.stringify({ small: small.cost, large: large.cost })}`,
      )
      t.diagnostic(
        `rows read: ${small.cost.rows_read} beside 2,000 genes, ${large.cost.rows_read} beside 12,000`,
      )
      assert.ok(large.cost.rows_read < 1000, JSON.stringify(large.cost))
    } finally {
      await runtime.dispose()
    }
  },
)
