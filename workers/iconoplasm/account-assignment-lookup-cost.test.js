import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createAssignmentLookupMigrationCostAdapter } from "./operation-cost-counter-migration-adapters.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import { projectAuthorityAccountStatus } from "./caretaker/authority-account-projection.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "account assignment lookup preserves priority and ties with bounded reads across 20000 tenures",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('assignment cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm-authoring/", import.meta.url)
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && parseInt(name) < 16)
        .sort())
        schema.exec(readFileSync(new URL(file, root), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      for (const { name } of schema
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
          const columns = Object.keys(row)
          await db
            .prepare(
              `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            )
            .bind(...Object.values(row))
            .run()
        }
      }
      await db
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_authority_accounts(account_id,public_credit_label) VALUES ('account_history','History caretaker'),('account_empty','Empty caretaker')",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO icono_gene_identities(gene_id,canonical_symbol) VALUES ('gene_history','HISTORY')",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_caretaker_assignments(caretaker_assignment_id,gene_id,account_id,status,
        entitlement_policy_version,invited_by_account_id,ended_at,end_reason,created_at)
      SELECT printf('assignment_%05d',n),'gene_history','account_history','ended','test','account_history',
        '2026-09-01T00:00:00.000Z','history','2026-08-31T00:00:00.000Z' FROM ids`,
        )
        .run()
      const args = {
        accountId: "account_history",
        status: "disabled",
        sourceEventId: "account_cost_event",
        sourceEventSequence: 1,
        occurredAt: "2026-09-06T12:00:00.000Z",
      }
      await assert.rejects(
        projectAuthorityAccountStatus(db, args),
        /idx_icono_account_assignment_projection/,
      )
      const adapter = createAssignmentLookupMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      const limits = { max_assignments: 20000, max_schema_rows: 512 }
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ ...limits, max_assignments: 19999 })),
      )
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='idx_icono_account_assignment_projection'",
            )
            .first()
        ).n,
        0,
      )
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).n, 0)
      const prepared = await adapter.prepare(limits)
      const { actual } = await adapter.dispatch(prepared)
      assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
      assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
      t.diagnostic(
        JSON.stringify({ operation: "assignment-index-migration", actual, bound: prepared.bound }),
      )

      async function selectedAssignment(accountId, legacy = false) {
        const meter = createOperationCostD1Meter(db)
        let selected
        const intercepted = {
          batch: (statements) => db.batch(statements),
          prepare(sql) {
            if (!sql.includes("INDEXED BY idx_icono_account_assignment_projection"))
              return db.prepare(sql)
            if (legacy)
              sql = sql.replace(
                "idx_icono_account_assignment_projection",
                "idx_icono_caretaker_account_history",
              )
            return {
              bind(...parameters) {
                return {
                  async first() {
                    selected = await meter.db
                      .prepare(sql)
                      .bind(...parameters)
                      .first()
                    throw new Error("assignment-selection-observed")
                  },
                }
              },
            }
          },
        }
        await assert.rejects(
          projectAuthorityAccountStatus(intercepted, { ...args, accountId }),
          /assignment-selection-observed/,
        )
        return { selected, actual: meter.finish() }
      }
      const legacy = await selectedAssignment("account_history", true)
      assert.equal(legacy.selected.caretaker_assignment_id, "assignment_20000")
      assert.ok(legacy.actual.rows_read >= 20000)
      const ended = await selectedAssignment("account_history")
      assert.equal(
        ended.selected.caretaker_assignment_id,
        "assignment_20000",
        "preserve exact stable ID tie-break",
      )
      assert.ok(ended.actual.rows_read <= 4, JSON.stringify(ended.actual))
      await db
        .prepare(
          `INSERT INTO icono_caretaker_assignments(caretaker_assignment_id,gene_id,account_id,status,
      entitlement_policy_version,invited_by_account_id,created_at)
      VALUES ('assignment_open','gene_history','account_history','pending_acceptance','test','account_history','2020-01-01T00:00:00.000Z')`,
        )
        .run()
      const open = await selectedAssignment("account_history")
      assert.equal(
        open.selected.caretaker_assignment_id,
        "assignment_open",
        "open tenure outranks newer ended tenures",
      )
      assert.ok(open.actual.rows_read <= 4, JSON.stringify(open.actual))
      const empty = await selectedAssignment("account_empty")
      assert.equal(empty.selected, null)
      assert.ok(empty.actual.rows_read <= 4, JSON.stringify(empty.actual))
      t.diagnostic(
        JSON.stringify({
          operation: "assignment-selection",
          legacy: legacy.actual,
          ended: ended.actual,
          open: open.actual,
          empty: empty.actual,
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
