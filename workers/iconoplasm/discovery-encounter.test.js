import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  recordDiscoveryEncounterAtomically,
  mergeDiscoverySymbolsAtomically,
} from "./discovery-encounter.js"

test(
  "real D1 discovery saves preserve exact counts through concurrency, seeding and rollback",
  { timeout: 60000 },
  async (t) => {
    const req = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      req.resolve("wrangler/package.json"),
    )("miniflare")
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
      const schema = new DatabaseSync(":memory:")
      try {
        const dir = new URL("../../migrations-iconoplasm/", import.meta.url)
        for (const file of readdirSync(dir)
          .filter((n) => n.endsWith(".sql"))
          .sort())
          schema.exec(readFileSync(new URL(file, dir), "utf8"))
        const definitions = schema
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
          )
          .all()
        for (let i = 0; i < definitions.length; i += 20)
          await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      } finally {
        schema.close()
      }
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<20000)
      INSERT INTO icono_gene_discoveries(user_id,gene_symbol) SELECT 'large', 'G'||i FROM n`,
        )
        .run()
      const receipts = []
      const measured = {
        prepare: (sql) => db.prepare(sql),
        batch: async (statements) => {
          const results = await db.batch(statements)
          receipts.push(
            results.reduce(
              (sum, r) => ({
                reads: sum.reads + r.meta.rows_read,
                writes: sum.writes + r.meta.rows_written,
              }),
              { reads: 0, writes: 0 },
            ),
          )
          return results
        },
      }
      const input = {
        userId: "large",
        geneSymbol: "TP53",
        source: "extension_hover",
        trigger: "hover_dwell",
        dwellMs: 900,
      }
      const first = await recordDiscoveryEncounterAtomically(measured, input)
      assert.equal(first.created, true)
      assert.equal(first.row.encounter_count, 1)
      const repeat = await recordDiscoveryEncounterAtomically(measured, {
        ...input,
        source: "gene_page",
        trigger: "gene_page_view",
        dwellMs: null,
      })
      assert.equal(repeat.created, false)
      assert.equal(repeat.row.encounter_count, 2)
      assert.equal(repeat.row.first_source, "extension_hover")
      assert.equal(repeat.row.first_discovered_at, first.row.first_discovered_at)
      assert.equal(repeat.row.last_source, "gene_page")
      const parallel = await Promise.all(
        Array.from({ length: 20 }, () =>
          recordDiscoveryEncounterAtomically(measured, { ...input, geneSymbol: "EGFR" }),
        ),
      )
      assert.equal(parallel.filter((r) => r.created).length, 1)
      assert.equal(
        (
          await db
            .prepare(
              "SELECT encounter_count FROM icono_gene_discoveries WHERE user_id='large' AND gene_symbol='EGFR'",
            )
            .first()
        ).encounter_count,
        20,
      )
      const shared = await db
        .prepare("SELECT * FROM icono_shared_gene_discoveries WHERE gene_symbol='EGFR'")
        .first()
      assert.equal(shared.non_admin_discoverer_count, 1)
      assert.equal(shared.non_admin_encounter_count, 20)
      await recordDiscoveryEncounterAtomically(measured, {
        ...input,
        isAdmin: true,
        geneSymbol: "ADMIN",
      })
      assert.equal(
        await db
          .prepare("SELECT * FROM icono_shared_gene_discoveries WHERE gene_symbol='ADMIN'")
          .first(),
        null,
      )
      await recordDiscoveryEncounterAtomically(measured, {
        ...input,
        geneSymbol: "INS",
        seedOnly: true,
      })
      const seed = await recordDiscoveryEncounterAtomically(measured, {
        ...input,
        geneSymbol: "INS",
        seedOnly: true,
      })
      assert.equal(seed.created, false)
      assert.equal(seed.row, null)
      assert.equal(receipts.at(-1).writes, 0)
      assert.equal(
        (
          await db
            .prepare(
              "SELECT non_admin_encounter_count FROM icono_shared_gene_discoveries WHERE gene_symbol='INS'",
            )
            .first()
        ).non_admin_encounter_count,
        1,
      )
      await db
        .prepare(
          "CREATE TRIGGER test_reject_shared BEFORE INSERT ON icono_shared_gene_discoveries WHEN NEW.gene_symbol='FAIL' BEGIN SELECT RAISE(ABORT,'test shared failure'); END",
        )
        .run()
      await assert.rejects(
        recordDiscoveryEncounterAtomically(measured, { ...input, geneSymbol: "FAIL" }),
        /test shared failure/,
      )
      assert.equal(
        await db
          .prepare(
            "SELECT * FROM icono_gene_discoveries WHERE user_id='large' AND gene_symbol='FAIL'",
          )
          .first(),
        null,
      )
      assert.ok(
        receipts.every((r) => r.reads <= 5 && r.writes <= 8),
        JSON.stringify(receipts),
      )
      t.diagnostic(
        JSON.stringify({
          first: receipts[0],
          repeat: receipts[1],
          seedReplay: receipts.at(-1),
          historyRows: 20000,
          parallelEncounters: 20,
        }),
      )
      const symbols = Array.from({ length: 200 }, (_, i) => `B${i}`)
      await mergeDiscoverySymbolsAtomically(measured, { userId: "large", symbols })
      const merged = receipts.at(-1)
      await mergeDiscoverySymbolsAtomically(measured, { userId: "large", symbols })
      const replay = receipts.at(-1)
      assert.equal(replay.writes, 0)
      assert.ok(merged.reads <= 1200 && merged.writes <= 1600, JSON.stringify(merged))
      assert.ok(replay.reads <= 1200, JSON.stringify(replay))
      assert.equal(
        (
          await db
            .prepare(
              "SELECT encounter_count FROM icono_gene_discoveries WHERE user_id='large' AND gene_symbol='B199'",
            )
            .first()
        ).encounter_count,
        1,
      )
      const before = await db
        .prepare("SELECT * FROM icono_shared_gene_discoveries WHERE gene_symbol='TP53'")
        .first()
      await db
        .prepare(
          "CREATE TRIGGER test_reject_personal BEFORE INSERT ON icono_gene_discoveries WHEN NEW.gene_symbol='ROLLBACK' BEGIN SELECT RAISE(ABORT,'test personal failure'); END",
        )
        .run()
      await assert.rejects(
        mergeDiscoverySymbolsAtomically(measured, { userId: "new", symbols: ["TP53", "ROLLBACK"] }),
        /test personal failure/,
      )
      assert.deepEqual(
        await db
          .prepare("SELECT * FROM icono_shared_gene_discoveries WHERE gene_symbol='TP53'")
          .first(),
        before,
      )
      assert.equal(
        await db
          .prepare(
            "SELECT * FROM icono_gene_discoveries WHERE user_id='new' AND gene_symbol='TP53'",
          )
          .first(),
        null,
      )
      t.diagnostic(JSON.stringify({ merge200: merged, mergeReplay200: replay }))
    } finally {
      await runtime.dispose()
    }
  },
)
