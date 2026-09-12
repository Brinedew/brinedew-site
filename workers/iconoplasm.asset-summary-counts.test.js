import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import {
  assetSummaryMigrationStatements,
  ASSET_SUMMARY_FIELDS,
} from "../scripts/generate-asset-summary-counts.mjs"
import { fetchStorageAuditRecheckDue } from "./iconoplasm/asset-summary-counts.js"
import { createRequire } from "node:module"
import { createAssetSummaryMigrationCostAdapter } from "./iconoplasm/operation-cost-asset-summary-migration-adapter.js"

function fixture() {
  const db = new DatabaseSync(":memory:")
  const root = new URL("../migrations-iconoplasm/", import.meta.url)
  for (const name of readdirSync(root)
    .filter((n) => n.endsWith(".sql") && parseInt(n) < 104)
    .sort())
    db.exec(readFileSync(new URL(name, root), "utf8"))
  return db
}
const baseline = `SELECT COUNT(*) candidate_assets, COALESCE(SUM(gc.gene_symbol IS NOT NULL),0) catalog_candidate_assets,
  COALESCE(SUM(COALESCE(pa.is_legacy,0)=0 AND lower(COALESCE(pa.status,'draft'))<>'rejected'),0) auditable_assets,
  COALESCE(SUM(gc.gene_symbol IS NOT NULL AND COALESCE(pa.is_legacy,0)=0 AND lower(COALESCE(pa.status,'draft'))<>'rejected'),0) catalog_auditable_assets,
  COALESCE(SUM(COALESCE(pa.is_stale,0)=1),0) stale_assets,COALESCE(SUM(COALESCE(pa.is_legacy,0)=1),0) legacy_assets,
  (SELECT COUNT(*) FROM icono_publish_state WHERE COALESCE(current_asset_sha256,'')<>'') published_live_portraits,
  (SELECT COUNT(*) FROM icono_publish_state ps JOIN icono_gene_catalog gc ON gc.gene_symbol=ps.gene_symbol WHERE COALESCE(ps.current_asset_sha256,'')<>'') catalog_published_live_portraits
  FROM icono_portrait_assets pa LEFT JOIN icono_gene_catalog gc ON gc.gene_symbol=pa.gene_symbol`
const queue = `SELECT COALESCE(SUM(q.audit_state<>'unknown'),0) audited_assets,
  COALESCE(SUM(q.audit_state IN ('renderable','regionally_divergent')),0) verified_renderable_images,
  COALESCE(SUM(q.audit_state='broken'),0) storage_incomplete_assets,
  COALESCE(SUM(q.audit_state='regionally_divergent'),0) storage_regionally_divergent_assets,
  COALESCE(SUM(q.is_current=1 AND q.audit_state='broken'),0) broken_live_images,
  COALESCE(SUM(q.is_current=1 AND q.audit_state IN ('renderable','regionally_divergent')),0) renderable_live_confirmed,
  COALESCE(SUM(q.audit_state='unknown'),0) storage_queue_backlog_assets
  FROM icono_storage_audit_queue q WHERE EXISTS(SELECT 1 FROM icono_portrait_assets pa WHERE pa.gene_symbol=q.gene_symbol AND pa.asset_sha256=q.asset_sha256 AND COALESCE(pa.asset_sha256,'')<>'' AND COALESCE(pa.is_legacy,0)=0 AND lower(COALESCE(pa.status,'draft'))<>'rejected')`

function verify(db) {
  const expected = { ...db.prepare(baseline).get(), ...db.prepare(queue).get() }
  const actual = db
    .prepare("SELECT * FROM icono_asset_summary_counts WHERE summary_key='default'")
    .get()
  for (const key of ASSET_SUMMARY_FIELDS) assert.equal(actual[key], expected[key], key)
  const timed = db
    .prepare(
      "SELECT COUNT(*) n FROM icono_storage_audit_queue q JOIN icono_portrait_assets pa ON pa.gene_symbol=q.gene_symbol AND pa.asset_sha256=q.asset_sha256 WHERE pa.asset_sha256<>'' AND COALESCE(pa.is_legacy,0)=0 AND lower(COALESCE(pa.status,'draft'))<>'rejected' AND q.audit_state<>'unknown' AND datetime(q.last_audited_at) IS NOT NULL",
    )
    .get().n
  for (const name of ["years", "months", "days"])
    assert.equal(
      db.prepare(`SELECT COALESCE(SUM(total),0) n FROM icono_audit_age_${name}`).get().n,
      timed,
      name,
    )
  for (const row of db.prepare("SELECT total,seconds_json FROM icono_audit_age_days").all())
    assert.equal(
      Object.values(JSON.parse(row.seconds_json)).reduce((a, b) => a + b, 0),
      row.total,
    )
}

test("asset/audit counts retain exact meaning across source lifecycle and no-ops", async () => {
  const db = fixture()
  const exec = (sql) => db.exec(sql.replace(/'([abc])'/g, (_, letter) => `'${letter.repeat(64)}'`))
  try {
    db.exec("INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES ('TP53','P53')")
    exec(
      "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) VALUES ('TP53','a','full','thumb'),('TP53','b','full','thumb'),('OUTSIDE','c','full','thumb')",
    )
    exec(
      "INSERT INTO icono_storage_audit_queue(gene_symbol,asset_sha256,audit_state,is_current,last_audited_at) VALUES ('TP53','a','renderable',1,'2026-08-01T04:05:06Z'),('TP53','b','unknown',0,NULL),('OUTSIDE','c','broken',1,'2025-12-31 23:59:59')",
    )
    db.exec(assetSummaryMigrationStatements().join("\n"))
    verify(db)
    const changes = [
      "UPDATE icono_storage_audit_queue SET audit_state='regionally_divergent',last_audited_at='2026-09-12T17:00:00Z' WHERE asset_sha256='b'",
      "UPDATE icono_storage_audit_queue SET audit_state='regionally_divergent',last_audited_at='2026-09-12T17:00:00Z' WHERE asset_sha256='b'",
      "UPDATE icono_portrait_assets SET is_legacy=1,is_stale=1 WHERE asset_sha256='a'",
      "UPDATE icono_portrait_assets SET is_legacy=0,status='rejected' WHERE asset_sha256='a'",
      "UPDATE icono_portrait_assets SET status='draft' WHERE asset_sha256='a'",
      "INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) VALUES ('TP53','a'),('OUTSIDE','c')",
      "INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES ('OUTSIDE','Outside')",
      "DELETE FROM icono_gene_catalog WHERE gene_symbol='OUTSIDE'",
      "UPDATE icono_storage_audit_queue SET last_audited_at='invalid' WHERE asset_sha256='a'",
      "UPDATE icono_storage_audit_queue SET last_audited_at='2026-08-01T04:05:07Z' WHERE asset_sha256='a'",
      "UPDATE icono_storage_audit_queue SET is_current=0,audit_state='broken' WHERE asset_sha256='a'",
      "DELETE FROM icono_portrait_assets WHERE asset_sha256='a'",
      "DELETE FROM icono_storage_audit_queue WHERE asset_sha256='a'",
      "UPDATE icono_publish_state SET current_asset_sha256='' WHERE gene_symbol='TP53'",
      "DELETE FROM icono_storage_audit_queue WHERE asset_sha256='b'",
    ]
    const adapter = {
      prepare(sql) {
        return {
          bind(...args) {
            return { first: async () => db.prepare(sql).get(...args) }
          },
        }
      },
    }
    for (const sql of changes) {
      exec(sql)
      verify(db)
      for (const cutoff of [
        "2024-01-01T00:00:00Z",
        "2025-12-31T23:59:59Z",
        "2026-08-01T04:05:06Z",
        "2026-08-01T04:05:07Z",
        "2026-09-12T17:00:00Z",
        "2027-01-01T00:00:00Z",
      ]) {
        const expected = db
          .prepare(
            "SELECT COUNT(*) n FROM icono_storage_audit_queue q JOIN icono_portrait_assets pa ON pa.gene_symbol=q.gene_symbol AND pa.asset_sha256=q.asset_sha256 WHERE pa.asset_sha256<>'' AND COALESCE(pa.is_legacy,0)=0 AND lower(COALESCE(pa.status,'draft'))<>'rejected' AND q.audit_state<>'unknown' AND datetime(q.last_audited_at)<=datetime(?)",
          )
          .get(cutoff).n
        assert.equal(
          await fetchStorageAuditRecheckDue(adapter, 30, Date.parse(cutoff) + 30 * 86400000),
          expected,
          cutoff,
        )
      }
    }
  } finally {
    db.close()
  }
})

test(
  "summary migration and warm reads have measured D1 costs at catalog scale",
  { timeout: 120000 },
  async () => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = fixture()
    try {
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type<>'trigger' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      // Fixture loading is outside the measured operation. Avoid spending its
      // setup time executing unrelated historical triggers for 100k source rows.
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(
          definitions
            .slice(i, i + 20)
            .filter((x) => !x.sql.startsWith("CREATE TRIGGER"))
            .map((x) => db.prepare(x.sql)),
        )
      await db
        .prepare(
          "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<25000) INSERT INTO icono_gene_catalog(gene_symbol,full_name) SELECT 'G'||x,'Gene '||x FROM n",
        )
        .run()
      await db
        .prepare(
          "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000) INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) SELECT 'G'||((x-1)%25000+1),printf('%064x',x),'full','thumb' FROM n",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) SELECT gene_symbol,printf('%064x',CAST(substr(gene_symbol,2) AS INTEGER)) FROM icono_gene_catalog",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_storage_audit_queue(gene_symbol,asset_sha256,audit_state,is_current,last_audited_at) SELECT gene_symbol,asset_sha256,CASE WHEN rowid%3=0 THEN 'broken' WHEN rowid%3=1 THEN 'regionally_divergent' ELSE 'renderable' END,rowid%2,datetime('0001-01-01','+'||(rowid%2048)||' years','+'||(rowid%86400)||' seconds') FROM icono_portrait_assets WHERE rowid<=50000",
        )
        .run()
      await db
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        )
        .run()
      const adapter = createAssetSummaryMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      const arguments_ = {
        max_assets: 100000,
        max_audit_rows: 50000,
        max_publish_rows: 25000,
        max_audit_days: 2048,
        max_schema_rows: 512,
      }
      // Oversize guards run atomically before the first new table or seed write.
      const refused = await adapter.prepare({ ...arguments_, max_audit_days: 2047 })
      await assert.rejects(() => adapter.dispatch(refused), /malformed JSON/)
      assert.equal(
        (
          await db
            .prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='icono_asset_summary_counts'")
            .first()
        ).n,
        0,
      )
      const prepared = await adapter.prepare(arguments_)
      const { actual: cost } = await adapter.dispatch(prepared)
      console.log(
        "asset summary admitted migration receipt",
        JSON.stringify({ cost, bound: prepared.bound }),
      )
      for (const key of ["rows_read", "rows_written"])
        assert.ok(
          cost[key] <= prepared.bound[key],
          `${key}: ${cost[key]} <= ${prepared.bound[key]}`,
        )
      const read = await db
        .prepare("SELECT * FROM icono_asset_summary_counts WHERE summary_key='default'")
        .all()
      assert.equal(read.results[0].candidate_assets, 100000)
      assert.equal(read.results[0].audited_assets, 50000)
      assert.equal(read.meta.rows_read, 1)
      assert.equal(read.meta.rows_written, 0)
      const expected = await db
        .prepare(
          "SELECT COUNT(*) n FROM icono_storage_audit_queue WHERE datetime(last_audited_at)<=datetime('2026-09-12','-30 days')",
        )
        .first()
      assert.equal(await fetchStorageAuditRecheckDue(db, 30, Date.parse("2026-09-12")), expected.n)
      const historicalTriggers = schema
        .prepare("SELECT sql FROM sqlite_schema WHERE type='trigger'")
        .all()
      for (let i = 0; i < historicalTriggers.length; i += 20)
        await db.batch(historicalTriggers.slice(i, i + 20).map((x) => db.prepare(x.sql)))
      const inserted = await db
        .prepare(
          "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb) VALUES ('G1',printf('%064x',100001),'full','thumb')",
        )
        .run()
      const audited = await db
        .prepare(
          "INSERT INTO icono_storage_audit_queue(gene_symbol,asset_sha256,audit_state,is_current,last_audited_at) VALUES ('G1',printf('%064x',100001),'renderable',1,'2026-09-12T17:00:00Z')",
        )
        .run()
      const repeated = await db
        .prepare(
          "UPDATE icono_storage_audit_queue SET audit_state='renderable',is_current=1,last_audited_at='2026-09-12T17:00:00Z' WHERE gene_symbol='G1' AND asset_sha256=printf('%064x',100001)",
        )
        .run()
      console.log(
        "asset summary full-schema mutation receipts",
        JSON.stringify({ inserted: inserted.meta, audited: audited.meta, repeated: repeated.meta }),
      )
      // D1 charges the source row and its three existing indexes; no maintained
      // counter or calendar row is touched for an unchanged audit.
      assert.equal(repeated.meta.rows_written, 4)
      assert.ok(audited.meta.rows_read < 100)
      assert.ok(audited.meta.rows_written < 32)
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
