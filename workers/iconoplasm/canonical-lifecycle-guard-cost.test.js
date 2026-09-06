import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createCanonicalLifecycleGuardsMigrationCostAdapter } from "./operation-cost-counter-migration-adapters.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "canonical lifecycle guards retain rejection and use keyed probes beside 20000 unrelated heads",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const directory = new URL("../../migrations-iconoplasm-authoring/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((name) => name.endsWith(".sql") && !name.startsWith("0017_"))
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
      for (const { name } of schema
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
          const columns = Object.keys(row)
          await db
            .prepare(
              `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
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
          "INSERT INTO icono_authority_accounts(account_id,public_credit_label) VALUES ('account_guard','Guard')",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_gene_identities(gene_id,canonical_symbol) SELECT 'gene_'||n,'G'||n FROM ids`,
        )
        .run()
      for (const id of ["current", "other"]) {
        await db
          .prepare(
            "INSERT INTO icono_manifestations(manifestation_id,gene_id,author_account_id,origin) VALUES (?,'gene_1','account_guard','service')",
          )
          .bind(id)
          .run()
        await db
          .prepare(
            "INSERT INTO icono_manifestation_revisions(manifestation_revision_id,manifestation_id,revision_number,body_sha256,body_bytes,author_account_id) VALUES (?,?,1,?,1,'account_guard')",
          )
          .bind(`revision_${id}`, id, "a".repeat(64))
          .run()
        await db
          .prepare(
            "INSERT INTO icono_manifestation_revision_lifecycle(manifestation_revision_id) VALUES (?)",
          )
          .bind(`revision_${id}`)
          .run()
        await db
          .prepare(
            `INSERT INTO icono_manifestation_upload_intents(upload_intent_id,entity_kind,entity_id,object_key,ciphertext_sha256,planned_body_bytes,lease_token,lease_expires_at,actor_kind,created_at)
        VALUES (?,'revision',?,?,?,1,'lease','2999-01-01','service','2026-09-06')`,
          )
          .bind(
            `intent_${id}`,
            `revision_${id}`,
            `private/manifestations/v1/aa/opaque_${id}_${"x".repeat(40)}.bin`,
            "b".repeat(64),
          )
          .run()
        await db
          .prepare(
            `INSERT INTO icono_manifestation_revision_storage_secrets(manifestation_revision_id,object_key,ciphertext_sha256,ciphertext_bytes,body_iv_base64,wrapped_dek_base64,wrap_iv_base64,key_version,verified_at)
        VALUES (?,?,?,17,?,?,?,1,'2026-09-06')`,
          )
          .bind(
            `revision_${id}`,
            `private/manifestations/v1/aa/opaque_${id}_${"x".repeat(40)}.bin`,
            "b".repeat(64),
            "A".repeat(16),
            "B".repeat(32),
            "C".repeat(16),
          )
          .run()
      }
      await db
        .prepare(
          `INSERT INTO icono_manifestation_canonical_selections(canonical_selection_id,gene_id,selected_manifestation_id,selected_revision_id,reason,command_id,head_version,gene_revision)
      VALUES ('selection_current','gene_1','current','revision_current','seed','command_current',1,1)`,
        )
        .run()
      const update =
        "UPDATE icono_manifestations SET status='moderated' WHERE manifestation_id='other'"
      const legacy = createOperationCostD1Meter(db)
      await legacy.db.prepare(update).run()
      assert.ok(legacy.finish().rows_read >= 20000)
      await db
        .prepare("UPDATE icono_manifestations SET status='active' WHERE manifestation_id='other'")
        .run()
      const adapter = createCanonicalLifecycleGuardsMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      const prepared = await adapter.prepare({ max_schema_rows: 512 })
      const migration = await adapter.dispatch(prepared)
      assert.ok(migration.actual.rows_read <= prepared.bound.rows_read)
      assert.ok(migration.actual.rows_written <= prepared.bound.rows_written)
      const measured = createOperationCostD1Meter(db)
      await measured.db.prepare(update).run()
      await measured.db
        .prepare(
          "UPDATE icono_manifestation_revision_lifecycle SET status='moderated' WHERE manifestation_revision_id='revision_other'",
        )
        .run()
      await measured.db
        .prepare(
          "DELETE FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id='revision_other'",
        )
        .run()
      const actual = measured.finish()
      assert.ok(actual.rows_read <= 64, JSON.stringify(actual))
      for (const [sql, error] of [
        [
          "UPDATE icono_manifestations SET status='moderated' WHERE manifestation_id='current'",
          "canonical_manifestation_must_be_reselected_first",
        ],
        [
          "UPDATE icono_manifestation_revision_lifecycle SET status='moderated' WHERE manifestation_revision_id='revision_current'",
          "canonical_revision_must_be_reselected_first",
        ],
        [
          "DELETE FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id='revision_current'",
          "canonical_revision_storage_must_be_reselected_first",
        ],
      ])
        await assert.rejects(db.prepare(sql).run(), new RegExp(error))
      assert.equal(
        (
          await db
            .prepare(
              "SELECT canonical_revision_id FROM icono_manifestation_heads WHERE gene_id='gene_1'",
            )
            .first()
        ).canonical_revision_id,
        "revision_current",
      )
      assert.ok(
        await db
          .prepare(
            "SELECT 1 AS present FROM icono_manifestation_revision_storage_secrets WHERE manifestation_revision_id='revision_current'",
          )
          .first(),
      )
      t.diagnostic(JSON.stringify({ migration: migration.actual, mutations: actual }))
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
