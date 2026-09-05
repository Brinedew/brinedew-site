import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createFinalizationMigrationCostAdapter } from "./operation-cost-migration-adapter.js"
import { createAuthoringStreamMigrationCostAdapter } from "./operation-cost-authoring-migration-adapter.js"
import { createUploadReservationMigrationCostAdapter } from "./operation-cost-upload-migration-adapter.js"
import { createOperationCostD1Adapter } from "./operation-cost-d1-adapter.js"
import { createOperationCostQueryRegistry } from "./operation-cost-query-registry.js"
import { createReplicaOperationCostAdapter } from "./operation-cost-replica-adapter.js"
import {
  registerGeneIdentity,
  createManifestationUploadIntent,
  seedSystemManifestation,
  submitTagsDerivative,
} from "./caretaker/manifestation-authority.js"
import { storage, command, sha } from "./caretaker/manifestation-authority-test-support.js"
import { drainManifestationAuthorityProjectionOutbox } from "../lib/iconoplasm-manifestation-authority-projection.js"
import { drainManifestationPublicCardPublicationWakes } from "../iconoplasm-manifestation-publication-wake.js"
import {
  encryptManifestationProse,
  sha256Hex,
} from "../lib/iconoplasm-manifestation-body-crypto.js"
import { encryptManifestationTags } from "../lib/iconoplasm-manifestation-tags-crypto.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const identities = { executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }

test(
  "local workerd D1 receipts fit migration and diagnosis reservations at catalogue scale",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local cost verification')}}",
        compatibilityDate: "2025-11-12",
        d1Databases: ["DB", "AUTHORING", "PRIMARY"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      const source = readFileSync(
        new URL("../../migrations-iconoplasm/0028_add_finalization_jobs.sql", import.meta.url),
        "utf8",
      )
      for (const sql of source.split(";").filter((sql) => sql.trim())) await db.prepare(sql).run()
      await db
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<19024)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,completed_at)
      SELECT 'GENE'||n, 'completed', '2026-09-01' FROM ids`,
        )
        .run()
      const migration = createFinalizationMigrationCostAdapter({ db, ...identities })
      const step = await migration.prepare({ max_rows: 19024, max_unfinished: 0 })
      await assert.rejects(
        migration.dispatch(await migration.prepare({ max_rows: 19023, max_unfinished: 0 })),
      )
      const migrated = await migration.dispatch(step)
      for (const meter of ["rows_read", "rows_written"])
        assert.ok(migrated.actual[meter] <= step.bound[meter], meter)
      t.diagnostic(
        JSON.stringify({ operation: "migration-0094", bound: step.bound, actual: migrated.actual }),
      )
      const reader = createOperationCostD1Adapter({
        db,
        registry: createOperationCostQueryRegistry(),
        resource: "iconoplasm",
        ...identities,
      })
      for (const statement of [
        { query_id: "finalization-summary", arguments: {} },
        {
          query_id: "finalization-summary-for-symbols",
          arguments: { symbols: ["GENE19024", "MISSING"] },
        },
      ]) {
        const prepared = await reader.prepare({ statements: [statement] })
        const receipt = await reader.dispatch(prepared)
        assert.ok(receipt.actual.rows_read <= prepared.bound.rows_read)
        t.diagnostic(
          JSON.stringify({
            operation: statement.query_id,
            bound: prepared.bound,
            actual: receipt.actual,
          }),
        )
      }

      const authoring = await runtime.getD1Database("AUTHORING")
      const schema = new DatabaseSync(":memory:")
      try {
        const root = new URL("../../migrations-iconoplasm-authoring/", import.meta.url)
        for (const file of readdirSync(root)
          .filter((name) => name.endsWith(".sql") && name < "0012")
          .sort()) {
          schema.exec(readFileSync(new URL(file, root), "utf8"))
        }
        const definitions = schema
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid",
          )
          .all()
        for (let index = 0; index < definitions.length; index += 20) {
          await authoring.batch(
            definitions.slice(index, index + 20).map(({ sql }) => authoring.prepare(sql)),
          )
        }
      } finally {
        schema.close()
      }
      await authoring
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        )
        .run()
      await authoring
        .prepare(
          `INSERT INTO icono_manifestation_snapshot_leases
      (snapshot_id,consumer_id,authority_epoch,watermark_event_sequence,status,expires_at)
      VALUES ('old','consumer',1,0,'building','2026-09-07')`,
        )
        .run()
      const stream = createAuthoringStreamMigrationCostAdapter({ db: authoring, ...identities })
      const prepared = await stream.prepare({ max_leases: 1, max_schema_rows: 256 })
      await authoring
        .prepare(
          "CREATE INDEX unexpected_lease_index ON icono_manifestation_snapshot_leases(status)",
        )
        .run()
      await assert.rejects(stream.dispatch(prepared))
      const columns = await authoring
        .prepare("PRAGMA table_info(icono_manifestation_snapshot_leases)")
        .all()
      assert.ok(columns.results.every((column) => column.name !== "stream_version"))
      await authoring.prepare("DROP INDEX unexpected_lease_index").run()
      const receipt = await stream.dispatch(prepared)
      for (const meter of ["rows_read", "rows_written"])
        assert.ok(receipt.actual[meter] <= prepared.bound[meter], meter)
      assert.equal(
        (await authoring.prepare("SELECT status FROM icono_manifestation_snapshot_leases").first())
          .status,
        "expired",
      )
      t.diagnostic(
        JSON.stringify({
          operation: "authoring-migration-0012",
          bound: prepared.bound,
          actual: receipt.actual,
        }),
      )
      const strictUploads = createUploadReservationMigrationCostAdapter({
        db: authoring,
        ...identities,
      })
      const strictPrepared = await strictUploads.prepare({})
      const strictReceipt = await strictUploads.dispatch(strictPrepared)
      for (const meter of ["rows_read", "rows_written"])
        assert.ok(strictReceipt.actual[meter] <= strictPrepared.bound[meter], meter)
      t.diagnostic(
        JSON.stringify({
          operation: "authoring-migration-0013",
          bound: strictPrepared.bound,
          actual: strictReceipt.actual,
        }),
      )
      await authoring
        .prepare(
          "INSERT INTO icono_authority_state(singleton,schema_version,authority_epoch,authority_mode) VALUES(1,1,1,'authoritative')",
        )
        .run()
      await authoring
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_gene_identities(gene_id,canonical_symbol) SELECT 'gene-'||n, 'SYMBOL'||n FROM ids`,
        )
        .run()
      const replica = createReplicaOperationCostAdapter({
        env: {
          ICONOPLASM_AUTHORING_DB: authoring,
          ICONOPLASM_AUTHORITY_REPLICA_TOKEN: "test-replica",
          ICONOPLASM_AUTHORING_CURSOR_SECRET: "s".repeat(64),
        },
        ...identities,
      })
      const total = { rows_read: 0, rows_written: 0, requests: 0 }
      const runReplica = async (input) => {
        const step = await replica.prepare(input)
        const receipt = await replica.dispatch(step)
        assert.equal(receipt.result.status, 200, JSON.stringify(receipt.result.body))
        for (const meter of Object.keys(total)) {
          assert.ok(receipt.actual[meter] <= step.bound[meter], `${step.route}: ${meter}`)
          total[meter] += receipt.actual[meter]
        }
        return receipt.result.body
      }
      const snapshot = await runReplica({
        method: "POST",
        path: "/api/iconoplasm/authority/snapshots",
        body: { consumer_id: "cost-probe", snapshot_id: "cost-probe-snapshot" },
      })
      await runReplica({
        method: "GET",
        path: `/api/iconoplasm/authority/snapshots/${snapshot.snapshot_id}`,
      })
      let page
      let pages = 0
      do {
        const query = new URLSearchParams({ limit: "250" })
        if (page) query.set("cursor", page.parts_resume_cursor)
        page = await runReplica({
          method: "GET",
          path: `/api/iconoplasm/authority/snapshots/${snapshot.snapshot_id}/parts?${query}`,
        })
        assert.ok(++pages <= 100)
      } while (page.has_more)
      assert.equal(page.total_parts, 20000)
      await runReplica({
        method: "POST",
        path: `/api/iconoplasm/authority/snapshots/${snapshot.snapshot_id}/complete`,
        body: {
          completion_cursor: page.parts_resume_cursor,
          total_parts: page.total_parts,
          manifest_sha256: page.manifest_sha256,
        },
      })
      const events = await runReplica({
        method: "GET",
        path: `/api/iconoplasm/authority/events?cursor=${encodeURIComponent(page.resume_cursor)}`,
      })
      await runReplica({
        method: "POST",
        path: "/api/iconoplasm/authority/events/ack",
        body: { consumer_id: "cost-probe", resume_cursor: events.resume_cursor },
      })
      assert.ok(total.rows_read < 25000)
      assert.ok(total.rows_written < 20)
      t.diagnostic(
        JSON.stringify({ operation: "complete-20000-gene-replica", pages, actual: total }),
      )

      const primary = await runtime.getD1Database("PRIMARY")
      const primarySchema = new DatabaseSync(":memory:")
      try {
        const root = new URL("../../migrations-iconoplasm/", import.meta.url)
        for (const file of readdirSync(root)
          .filter((name) => name.endsWith(".sql"))
          .sort())
          primarySchema.exec(readFileSync(new URL(file, root), "utf8"))
        const definitions = primarySchema
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid",
          )
          .all()
        for (let index = 0; index < definitions.length; index += 20)
          await primary.batch(
            definitions.slice(index, index + 20).map(({ sql }) => primary.prepare(sql)),
          )
      } finally {
        primarySchema.close()
      }
      await primary
        .prepare(
          "INSERT INTO icono_manifestation_projection_authority(singleton,mode,authority_epoch) VALUES(1,'authoritative',1)",
        )
        .run()
      await registerGeneIdentity(authoring, {
        geneId: "gene_cost_select",
        canonicalSymbol: "COSTSELECT",
      })
      const bodyEnv = {
        ICONOPLASM_AUTHORING_BODY_KEY_VERSION: "1",
        ICONOPLASM_AUTHORING_BODY_KEK_V1: Buffer.from(new Uint8Array(32).fill(11)).toString(
          "base64",
        ),
        ICONOPLASM_AUTHORING_STORAGE_ZONE: "cost-test",
        ICONOPLASM_AUTHORING_STORAGE_HOST: "cost-storage.invalid",
        ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "local-test",
      }
      const prose = "文".repeat(4000)
      const revisionStorage = {
        ...storage(1),
        ...(await encryptManifestationProse(bodyEnv, {
          geneId: "gene_cost_select",
          revisionId: "revision_cost_select",
          prose,
        })),
      }
      const derivativeStorage = {
        ...storage(2),
        ...(await encryptManifestationTags(bodyEnv, {
          derivativeId: "derivative_cost_select",
          revisionId: "revision_cost_select",
          sourceBodySha256: revisionStorage.body_sha256,
          tags: "tagged!\n{}",
        })),
      }
      for (const [entityKind, entityId, envelope] of [
        ["revision", "revision_cost_select", revisionStorage],
        ["derivative", "derivative_cost_select", derivativeStorage],
      ]) {
        await createManifestationUploadIntent(authoring, {
          entityKind,
          entityId,
          objectKey: envelope.object_key,
          ciphertextSha256: envelope.ciphertext_sha256,
          bodyBytes: envelope.body_bytes,
          actorKind: "migration",
          uploadIntentId: `intent_${entityKind}`,
          leaseToken: `lease_${entityKind}`,
        })
      }
      await seedSystemManifestation(authoring, {
        geneId: "gene_cost_select",
        storage: revisionStorage,
        expectedHeadVersion: 0,
        expectedCanonicalRevisionId: null,
        manifestationId: "manifestation_cost_select",
        revisionId: "revision_cost_select",
        selectionId: "selection_cost_seed",
        ...command("command_cost_seed", "a", null, "migration"),
      })
      await submitTagsDerivative(authoring, {
        revisionId: "revision_cost_select",
        derivativeId: "derivative_cost_select",
        status: "complete",
        sourceBodySha256: revisionStorage.body_sha256,
        tagsSha256: await sha256Hex("tagged!"),
        tagsBytes: 7,
        fieldsSha256: await sha256Hex("{}"),
        fieldsBytes: 2,
        storage: derivativeStorage,
        recipeId: "recipe",
        recipeVersion: "1",
        providerId: "provider",
        modelId: "model",
        taggerConfigSha256: sha("e"),
        expectedGeneRevision: 1,
        ...command("command_cost_derivative", "b"),
      })
      await authoring
        .prepare(
          `WITH RECURSIVE ids(n) AS
        (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<255)
        INSERT INTO icono_gene_aliases(alias_symbol,gene_id,alias_kind)
        SELECT 'COST_ALIAS_'||n,'gene_cost_select','previous' FROM ids`,
        )
        .run()
      const previousEvent = await authoring
        .prepare(
          "SELECT event_type,payload_json FROM icono_manifestation_events WHERE command_id='command_cost_derivative'",
        )
        .first()
      // Build a valid unprojected history through the production triggers,
      // rather than removing constraints to make the large fixture possible.
      for (let start = 1; start <= 300; start += 20) {
        const statements = []
        for (let index = start; index < start + 20; index++) {
          const id = `command_cost_history_${index}`
          const payload = JSON.parse(previousEvent.payload_json)
          payload.canonical.gene_revision = index + 2
          statements.push(
            authoring
              .prepare(
                "UPDATE icono_manifestation_heads SET gene_revision=? WHERE gene_id='gene_cost_select'",
              )
              .bind(index + 2),
            authoring
              .prepare(
                `INSERT INTO icono_authoring_command_receipts
              (command_id,command_type,actor_kind,gene_id,request_sha256,response_json)
              VALUES (?,'manifestation.tags_select','service','gene_cost_select',?,'{}')`,
              )
              .bind(id, sha("f")),
            authoring
              .prepare(
                `INSERT INTO icono_manifestation_events
              (event_uuid,command_id,event_type,gene_id,gene_revision,payload_json)
              VALUES (?,?,?,'gene_cost_select',?,?)`,
              )
              .bind(
                `event_cost_history_${index}`,
                id,
                previousEvent.event_type,
                index + 2,
                JSON.stringify(payload),
              ),
          )
        }
        await authoring.batch(statements)
      }
      let publicationWakes = 0
      const writer = createReplicaOperationCostAdapter({
        env: {
          ...bodyEnv,
          ICONOPLASM_AUTHORING_DB: authoring,
          ICONOPLASM_DB: primary,
          ICONOPLASM_AUTHORITY_REPLICA_TOKEN: "test-replica",
        },
        ...identities,
        async onAuthorityEvent(event, scopedEnv) {
          assert.notEqual(scopedEnv.ICONOPLASM_AUTHORING_DB, authoring)
          assert.notEqual(scopedEnv.ICONOPLASM_DB, primary)
          const result = await drainManifestationAuthorityProjectionOutbox({
            authoringDb: scopedEnv.ICONOPLASM_AUTHORING_DB,
            primaryDb: scopedEnv.ICONOPLASM_DB,
            priorityEventId: event.event_id,
            limit: 1,
            projectPublicMaterialEvent: (accepted) =>
              drainManifestationPublicCardPublicationWakes(scopedEnv.ICONOPLASM_DB, {
                authorityEventId: accepted.event_id,
                wakeCardPublication: async () => {
                  publicationWakes++
                },
              }),
          })
          assert.equal(result.published, 1, JSON.stringify(result))
        },
      })
      const selection = await writer.prepare({
        method: "POST",
        path: "/api/iconoplasm/authority/revisions/revision_cost_select/tags-derivative-head",
        body: {
          command_id: "command_cost_select",
          manifestation_derivative_id: "derivative_cost_select",
          expected_derivative_head_version: 0,
          expected_gene_revision: 302,
        },
      })
      const selected = await writer.dispatch(selection)
      assert.equal(selected.result.status, 200, JSON.stringify(selected.result))
      assert.equal(publicationWakes, 1)
      assert.equal(
        (
          await authoring
            .prepare(
              "SELECT count(*) AS n FROM icono_manifestation_events WHERE gene_id='gene_cost_select' AND projection_status='published'",
            )
            .first()
        ).n,
        250,
      )
      assert.equal(
        (
          await primary
            .prepare(
              "SELECT accepted_tags_derivative_id FROM icono_manifestation_canonical_projection WHERE gene_id='gene_cost_select'",
            )
            .first()
        ).accepted_tags_derivative_id,
        "derivative_cost_select",
      )
      for (const meter of Object.keys(total))
        assert.ok(
          selected.actual[meter] <= selection.bound[meter],
          `${meter}: ${JSON.stringify(selected.actual)}`,
        )
      t.diagnostic(
        JSON.stringify({
          operation: "derivative-select-and-publish",
          bound: selection.bound,
          actual: selected.actual,
        }),
      )
      const replayed = await writer.dispatch(selection)
      assert.equal(replayed.result.status, 200)
      assert.equal(replayed.result.body.replayed, true)
      assert.equal(publicationWakes, 1)
      const nativeFetch = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url)
        if (url.hostname !== "cost-storage.invalid") return nativeFetch(input, init)
        const item = [revisionStorage, derivativeStorage].find(
          (item) => url.pathname === `/cost-test/${item.object_key}`,
        )
        assert.ok(item, "unexpected private object request")
        return new Response(item.ciphertext)
      }
      t.after(() => {
        globalThis.fetch = nativeFetch
      })
      for (const [kind, id] of [
        ["revisions", "revision_cost_select"],
        ["derivatives", "derivative_cost_select"],
      ]) {
        const step = await writer.prepare({
          method: "GET",
          path: `/api/iconoplasm/authority/${kind}/${id}/body`,
        })
        const body = await writer.dispatch(step)
        assert.equal(body.result.status, 200, JSON.stringify(body.result))
        assert.equal(
          body.result.body[kind === "revisions" ? "body_plain" : "tags_text"],
          kind === "revisions" ? prose : "tagged!",
        )
        assert.ok(body.actual.rows_read <= step.bound.rows_read)
        assert.equal(body.actual.rows_written, 0)
        t.diagnostic(
          JSON.stringify({ operation: step.route, bound: step.bound, actual: body.actual }),
        )
      }
    } finally {
      await runtime.dispose()
    }
  },
)
