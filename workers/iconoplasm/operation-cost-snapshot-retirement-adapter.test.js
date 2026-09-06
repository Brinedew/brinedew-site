import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { registerGeneIdentity } from "./caretaker/manifestation-authority.js"
import {
  createManifestationSnapshot,
  readManifestationSnapshotPage,
} from "./caretaker/manifestation-authority-sync.js"
import { createSnapshotRetirementMigrationCostAdapter } from "./operation-cost-snapshot-retirement-adapter.js"

test(
  "retired transport cleanup preserves open v2 snapshots, refuses active v1, and reclaims pages within admission",
  { timeout: 60000 },
  async (t) => {
    const req = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      req.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm-authoring/", import.meta.url)
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && Number.parseInt(name, 10) < 15)
        .sort())
        schema.exec(readFileSync(new URL(file, root), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      for (const { name } of schema
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all())
        for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
          const columns = Object.keys(row)
          await db
            .prepare(
              `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            )
            .bind(...Object.values(row))
            .run()
        }
      await db
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        )
        .run()
      await registerGeneIdentity(db, { geneId: "gene_cleanup", canonicalSymbol: "CLEAN" })
      await db
        .prepare(
          "INSERT INTO icono_manifestation_snapshot_leases(snapshot_id,consumer_id,authority_epoch,watermark_event_sequence,status,expires_at) VALUES('legacy','reader',1,0,'building','2030-01-02')",
        )
        .run()
      const seeded = await db
        .prepare(
          "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10000) INSERT INTO icono_manifestation_snapshot_parts(snapshot_id,ordinal,part_kind,source_key,gene_id,part_json,payload_sha256) SELECT 'legacy',n,'gene_baseline','G'||n,'gene_cleanup',json_object('gene','G'||n,'padding',hex(zeroblob(256))),printf('%064x',n) FROM ids",
        )
        .run()
      const cursorSecret = "local-drop-test-stream-secret-000000000001"
      const lease = await createManifestationSnapshot(db, {
        consumerId: "new-reader",
        cursorSecret,
        now: "2030-01-01T00:00:00.000Z",
      })
      const pageArgs = {
        snapshotId: lease.snapshot_id,
        consumerId: "new-reader",
        cursorSecret,
        now: "2030-01-01T00:00:01.000Z",
      }
      const before = await readManifestationSnapshotPage(db, pageArgs)
      const sourceBefore = (
        await db.prepare("SELECT rowid,* FROM icono_gene_identity_baselines").all()
      ).results
      const adapter = createSnapshotRetirementMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      const args = { max_leases: 1024, max_schema_rows: 512 }
      for (const invalid of [
        null,
        { ...args, max_leases: -1 },
        { ...args, caller_sql: "DROP TABLE other" },
      ])
        await assert.rejects(adapter.prepare(invalid), /ARGUMENTS_INVALID/)
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ ...args, max_leases: 1 })),
        /ROW_BOUND_EXCEEDED|malformed JSON/,
      )
      const prepared = await adapter.prepare(args)
      await assert.rejects(
        adapter.dispatch(prepared),
        /LEGACY_SNAPSHOT_STILL_ACTIVE|malformed JSON/,
      )
      assert.equal(
        await db.prepare("SELECT count(*) AS n FROM icono_manifestation_snapshot_parts").first("n"),
        10000,
      )
      assert.equal(await db.prepare("SELECT count(*) AS n FROM d1_migrations").first("n"), 0)
      await db
        .prepare(
          "UPDATE icono_manifestation_snapshot_leases SET status='expired' WHERE snapshot_id='legacy'",
        )
        .run()
      const { actual } = await adapter.dispatch(prepared)
      for (const meter of ["rows_read", "rows_written", "requests"])
        assert.ok(
          actual[meter] <= prepared.bound[meter],
          `${meter}: ${actual[meter]} > ${prepared.bound[meter]}`,
        )
      assert.deepEqual(await readManifestationSnapshotPage(db, pageArgs), before)
      assert.deepEqual(
        (await db.prepare("SELECT rowid,* FROM icono_gene_identity_baselines").all()).results,
        sourceBefore,
      )
      const removed = await db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_schema WHERE name='icono_manifestation_snapshot_parts'",
        )
        .all()
      assert.equal(removed.results[0].n, 0)
      assert.ok(removed.meta.size_after < seeded.meta.size_after / 2)
      assert.equal(
        await db
          .prepare("SELECT count(*) AS n FROM icono_manifestation_snapshot_leases")
          .first("n"),
        2,
      )
      assert.equal(await db.prepare("SELECT count(*) AS n FROM d1_migrations").first("n"), 1)
      t.diagnostic(
        JSON.stringify({
          rowsRemoved: 10000,
          bytesBefore: seeded.meta.size_after,
          bytesAfter: removed.meta.size_after,
          actual,
          bound: prepared.bound,
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
