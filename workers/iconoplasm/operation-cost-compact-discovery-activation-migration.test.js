import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { createCompactDiscoveryActivationMigrationCostAdapter } from "./operation-cost-compact-discovery-activation-migration-adapter.js"
import { COMPACT_DISCOVERY_ACTIVATION_MIGRATION_STATEMENTS } from "../generated/operation-cost-migrations.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

async function fixture() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('activation migration')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["original"],
    }),
  )
  const db = await runtime.getD1Database("original")
  await db
    .prepare("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)")
    .run()
  const adapter = createCompactDiscoveryActivationMigrationCostAdapter({
    db,
    executable_sha256: "a".repeat(64),
    schema_sha256: "b".repeat(64),
  })
  return { runtime, db, adapter }
}

for (const preexisting of [false, true])
  test(
    `compact discovery activation migration is bounded with preexisting=${preexisting}`,
    { timeout: 120000 },
    async (t) => {
      const { runtime, db, adapter } = await fixture()
      try {
        if (preexisting)
          for (const sql of COMPACT_DISCOVERY_ACTIVATION_MIGRATION_STATEMENTS)
            await db.prepare(sql).run()
        await assert.rejects(adapter.prepare({ caller_sql: "unsafe" }), {
          code: "COST_MIGRATION_ARGUMENTS_INVALID",
        })
        const prepared = await adapter.prepare({})
        const { actual } = await adapter.dispatch(prepared)
        assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
        assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
        assert.deepEqual(
          await db
            .prepare(
              "SELECT singleton,status,cursor_user_id,cursor_gene_symbol,total_legacy_rows,migrated_rows,migrated_users FROM icono_discovery_compact_activation_v2",
            )
            .first(),
          {
            singleton: 1,
            status: "pending",
            cursor_user_id: "",
            cursor_gene_symbol: "",
            total_legacy_rows: 0,
            migrated_rows: 0,
            migrated_users: 0,
          },
        )
        t.diagnostic(JSON.stringify({ actual, bound: prepared.bound }))
      } finally {
        await runtime.dispose()
      }
    },
  )

test("compact discovery activation migration rejects an incompatible existing table", async () => {
  const { runtime, db, adapter } = await fixture()
  try {
    await db.prepare("CREATE TABLE icono_discovery_compact_activation_v2(singleton INTEGER)").run()
    const prepared = await adapter.prepare({})
    await assert.rejects(adapter.dispatch(prepared), /malformed JSON/)
  } finally {
    await runtime.dispose()
  }
})
