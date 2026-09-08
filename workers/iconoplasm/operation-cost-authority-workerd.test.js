import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"
import { createMigrationInventoryCostAdapter } from "./operation-cost-migration-inventory.js"
import { inspectReleaseSchema } from "../../scripts/inspect-operation-cost-release.mjs"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
const endpoint = "https://test/api/iconoplasm/admin/cost/operations"
const clock = Date.parse("2026-09-08T12:00:00Z")

test(
  "HTTP migration admission registers and executes inventory through real Durable Object SQLite",
  { timeout: 30000 },
  async () => {
    const bundled = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      stdin: {
        resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
        contents: `
          import { createOperationCostAuthority } from './workers/iconoplasm/operation-cost-http.js';
          const clock = ${clock};
          export class TestAuthority {
            constructor(state, env) {
              const storage = {
                sql: {exec: (...args) => {
                  try { return state.storage.sql.exec(...args); }
                  catch (error) { console.error('test storage failure', error.stack); throw error; }
                }},
                transactionSync: (fn) => state.storage.transactionSync(fn)
              };
              this.authority = createOperationCostAuthority(storage, env, {
                now: () => clock,
                usage: {
                  refresh: async () => ({day:'2026-09-08', measured_at:clock, rows_read:0, rows_written:0, requests:0}),
                  current: () => null
                }
              });
              state.blockConcurrencyWhile(async () => this.authority.initialize());
            }
            fetch(request) { return this.authority.fetch(request); }
          }
          export default {fetch(request,env) {
            const forwarded = new Request(request);
            forwarded.headers.set('x-iconoplasm-cost-principal','admin');
            return env.AUTHORITY.get(env.AUTHORITY.idFromName('same-owner')).fetch(forwarded);
          }};
        `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: "2025-04-01",
        durableObjects: { AUTHORITY: { className: "TestAuthority", useSQLite: true } },
        d1Databases: ["DB", "ICONOPLASM_DB", "ICONOPLASM_AUTHORING_DB"],
      }),
    )
    try {
      for (const binding of ["DB", "ICONOPLASM_DB", "ICONOPLASM_AUTHORING_DB"]) {
        const db = await runtime.getD1Database(binding)
        await db.exec(
          "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        )
        await db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").bind("0001_test.sql").run()
      }
      async function send(suffix, body) {
        const result = await runtime.dispatchFetch(endpoint + suffix, {
          method: body === undefined ? "GET" : "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        const text = await result.text()
        if (!result.ok && result.status === 428) throw new Error(JSON.parse(text).code)
        assert.ok(result.ok, `${suffix || "discovery"}: ${result.status}: ${text}`)
        return JSON.parse(text)
      }
      const discovery = await send("")
      const primary = await runtime.getD1Database("ICONOPLASM_DB")
      await primary.exec("CREATE TABLE icono_gene_catalog (id INTEGER PRIMARY KEY)")
      await primary.exec(
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<21000) INSERT INTO icono_gene_catalog SELECT x FROM n",
      )
      const sizeAdapter = createMigrationInventoryCostAdapter({
        db: primary,
        resource: "iconoplasm",
      })
      const prepared = await sizeAdapter.prepare({
        statements: [{ query_id: "catalog-migration-size", arguments: {} }],
      })
      const measured = await sizeAdapter.dispatch(prepared)
      assert.equal(measured.result[0].results[0].capped_count, 20001)
      assert.ok(measured.actual.rows_read <= prepared.bound.rows_read)
      assert.equal(measured.actual.rows_written, 0)
      assert.ok(discovery.features.includes("shared-capacity-snapshot"))
      assert.equal((await send("/capacity")).remaining.rows_read, 1_000_000)
      for (const resource of ["geneguessr", "iconoplasm", "iconoplasm-authoring"]) {
        const adapter = discovery.adapters.find(
          (item) => item.id === `${resource}-migration-inventory`,
        )
        assert.ok(adapter)
        const id = `${resource}-real-inventory`
        await send("/register", {
          id,
          adapter_id: adapter.id,
          resource: adapter.resource,
          executable_sha256: adapter.executable_sha256,
          schema_sha256: adapter.schema_sha256,
          prediction: { rows_read: 3076, rows_written: 0, requests: 1 },
          expires_at: clock + 60000,
        })
        const result = await send("/execute", {
          operation_id: id,
          adapter_id: adapter.id,
          step_id: "inventory",
          arguments: {
            statements: [
              { query_id: "applied-migrations", arguments: {} },
              { query_id: "schema-objects", arguments: {} },
            ],
          },
        })
        assert.equal(result.result[0].results[0].name, "0001_test.sql")
        assert.ok(result.result[1].results.some((row) => row.name === "d1_migrations"))
        assert.ok(result.usage.rows_read <= 3076)
        const receipt = await send("/receipt", { id })
        assert.equal(receipt.plan.status, "active")
      }
      const inspection = await inspectReleaseSchema({
        send: (suffix, method, body) => send(suffix, method === "GET" ? undefined : body),
        releaseId: "test-release",
        now: clock,
      })
      assert.equal(inspection.schemas.length, 3)
      assert.ok(inspection.capacity.used.rows_read > 0)
      assert.ok(
        inspection.schemas.every(
          (schema) => schema.object_count > 0 && schema.usage.rows_written === 0,
        ),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
