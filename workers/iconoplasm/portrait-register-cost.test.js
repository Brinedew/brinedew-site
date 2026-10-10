import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { createIconoplasmApp } from "./app.js"

// B-1072: what registering a portrait writes, measured by the provider's own
// receipts on the complete migrated schema (every index and trigger). The
// register route's rows are most of a portrait's publication cost. On
// 2026-10-10 the Drain's window measured about 25 rows per new portrait for the
// upsert alone; migration 0120 dropped four portrait indexes nothing reads.
// Failure modes:
// 1. An index or trigger is added to icono_portrait_assets without a reader,
//    and every portrait pays for it again.
// 2. Re-registering an unchanged portrait writes anything (the Drain re-sends
//    a split call, and a sweep re-sends whole genes).
// Measured 2026-10-10: 21 rows before migration 0120, 18 after.
const NEW_PORTRAIT_WORST_CASE_ROWS_WRITTEN = 18

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

const TOKEN = "factory-token-0000000000000000000000001"
const sha = (n) => n.toString(16).padStart(64, "0")
const portrait = (symbol, n) => ({
  symbol,
  asset_sha256: sha(n),
  width: 768,
  height: 1024,
  vision_id: "anima-v1-23013",
  emulsion_id: "C9-23013",
  sample_label: `${symbol}-0`,
  sample_number: 0,
})

test(
  "registering a new portrait writes a fixed handful of D1 rows, and re-registering it none",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('register cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((name) => name.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      await db
        .prepare(
          "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53', 'tumor protein p53')",
        )
        .run()
      // A gene that already has portraits, as most registrations find it.
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20)
         INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_medium,r2_key_thumb,status,created_at)
         SELECT 'TP53',printf('%064x',n),'f','m','t','draft','2026-01-01 00:00:00' FROM ids`,
        )
        .run()

      // The route writes in one D1 batch; D1 reports each statement's rows written.
      let written = 0
      const counted = new Proxy(db, {
        get(target, property) {
          if (property === "batch")
            return async (statements) => {
              const results = await target.batch(statements)
              for (const result of results) written += Number(result?.meta?.rows_written || 0)
              return results
            }
          const value = target[property]
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      const app = createIconoplasmApp({
        legacy: async () => new Response("legacy", { status: 299 }),
        // Only the registration's own rows are measured; the card build has its own.
        publishGene: async () => ({ ok: true }),
        refreshSummaries: async () => {},
        accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
      })
      const register = async (portraits) => {
        written = 0
        const response = await app.request(
          "/api/iconoplasm/admin/portraits/register",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify({ created_by: "drain:local", portraits }),
          },
          { ICONOPLASM_DB: counted, ICONOPLASM_ADMIN_TOKEN: TOKEN },
        )
        assert.equal(response.status, 200, await response.clone().text())
        return { rows_written: written }
      }

      const first = await register([portrait("TP53", 100)])
      t.diagnostic(JSON.stringify({ "new portrait": first }))
      assert.ok(
        first.rows_written <= NEW_PORTRAIT_WORST_CASE_ROWS_WRITTEN,
        `a new portrait wrote ${first.rows_written} rows`,
      )

      const again = await register([portrait("TP53", 100)])
      t.diagnostic(JSON.stringify({ "unchanged re-registration": again }))
      assert.equal(again.rows_written, 0, "an unchanged portrait writes nothing")
    } finally {
      await runtime.dispose()
    }
  },
)
