import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import { readReconcileAssetKeys, readReconcilePublishState } from "./reconcile-asset-selection.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "workerd reconciliation reads exact input keys independently of popular-gene history",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default { fetch() { return new Response('reconcile selection') } }",
        compatibilityDate: "2025-11-12",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      for (const filename of [
        "0001_publish_tables.sql",
        "0004_portrait_asset_legacy_flags.sql",
        "0012_add_publish_admin_override.sql",
      ]) {
        const source = readFileSync(
          new URL(`../../migrations-iconoplasm/${filename}`, import.meta.url),
          "utf8",
        )
        for (const sql of source
          .replace(/^--.*$/gm, "")
          .split(";")
          .filter((sql) => sql.trim()))
          await db.prepare(sql).run()
      }
      await db
        .prepare(
          `INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_hero,r2_key_thumb,status)
      VALUES('TP53','a','','','rejected'),('TP53','b','','','draft'),('BRCA1','a','','','draft')`,
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) VALUES('TP53','b')",
        )
        .run()
      let reads = 0
      let calls = 0
      const metered = {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                async all() {
                  const result = await db
                    .prepare(sql)
                    .bind(...args)
                    .all()
                  reads += result.meta.rows_read
                  calls++
                  assert.equal(result.meta.rows_written, 0)
                  return result
                },
              }
            },
          }
        },
      }
      const manifest = {
        keep: [
          { symbol: "TP53", asset_sha256: "a" },
          { symbol: "BRCA1", asset_sha256: "a" },
        ],
        legacy: [
          { symbol: "TP53", asset_sha256: "a" },
          { symbol: "TP53", asset_sha256: "missing" },
        ],
        symbols: ["TP53"],
      }
      const before = await readReconcileAssetKeys(metered, manifest)
      assert.deepEqual(
        before.map((row) => [row.gene_symbol, row.asset_sha256, row.status]),
        [["TP53", "a", "rejected"]],
      )
      const initialReads = reads
      assert.ok(initialReads <= 8)
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
      INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_hero,r2_key_thumb)
      SELECT CASE WHEN n%2=0 THEN 'TP53' ELSE 'BRCA1' END, 'history'||n,'','' FROM ids`,
        )
        .run()
      reads = 0
      assert.deepEqual(await readReconcileAssetKeys(metered, manifest), before)
      assert.equal(reads, initialReads)
      reads = 0
      const large = await readReconcileAssetKeys(metered, {
        keep: Array.from({ length: 1001 }, (_, n) => ({
          symbol: n % 2 ? "TP53" : "BRCA1",
          asset_sha256: `history${n + 1}`,
        })),
      })
      assert.equal(large.length, 1001)
      assert.ok(reads <= 4 * 1001 + 8)
      assert.equal(calls, 5) // two small queries and three <=500-key pages
      const largeReads = reads
      const emptyCalls = calls
      assert.deepEqual(await readReconcileAssetKeys(metered), [])
      assert.equal(calls, emptyCalls)
      reads = 0
      assert.equal(
        (await readReconcilePublishState(metered, ["TP53"]))[0].current_asset_sha256,
        "b",
      )
      assert.ok(reads <= 4)
      await assert.rejects(readReconcilePublishState(metered, []), /explicit symbol scope/)
      assert.equal(
        (
          await db
            .prepare(
              "SELECT status FROM icono_portrait_assets WHERE gene_symbol='TP53' AND asset_sha256='b'",
            )
            .first()
        ).status,
        "draft",
      )
      t.diagnostic(
        JSON.stringify({
          unrelated_assets: 60000,
          two_keys_reads: initialReads,
          keys_1001_reads: largeReads,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
