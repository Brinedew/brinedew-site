import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import { createDiscoveryOrdinalDictionary } from "./discovery-compact-state.js"
import {
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactDiscoveryChronology,
  readCompactUserState,
  readSharedCompactState,
} from "./discovery-compact-store.js"
import {
  claimCompactDiscoveryMigrationLease,
  importLegacyDiscoveryUser,
  migrateLegacyDiscoveryPage,
  readCompactDiscoveryActivation,
} from "./discovery-compact-migrate.js"
import { migrateIconoplasmCompactDiscoveryForScheduled } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  ensureDiscoveryDictionaryForNames,
  loadDiscoveryDictionaryForNames,
  readDiscoveryDictionaryMeta,
} from "./discovery-ordinal-store.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

const migrationRoot = new URL("../../migrations-iconoplasm/", import.meta.url)

const SCHEMA_OBJECT_QUERY =
  "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND (name LIKE 'icono_discovery%' OR name LIKE 'idx_icono_discovery%') ORDER BY name"

function sqlStatements(sql) {
  return String(sql || "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter(Boolean)
}

function legacyStatements(basename) {
  return sqlStatements(readFileSync(new URL(basename, migrationRoot), "utf8"))
}

async function withD1(run) {
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
    return await run(await runtime.getD1Database("DB"))
  } finally {
    await runtime.dispose()
  }
}

async function applyStatements(db, statements) {
  for (const statement of statements) await db.prepare(statement).run()
}

function compactMigrationStatements() {
  return sqlStatements(
    readFileSync(new URL("0106_compact_discovery_state_v2.sql", migrationRoot), "utf8"),
  )
}

test(
  "the committed migration installs the exact compact schema and no catalog-sized ordinal seed",
  { timeout: 60000 },
  async (t) => {
    await withD1(async (db) => {
      await applyStatements(db, legacyStatements("0007_add_gene_catalog.sql"))
      await applyStatements(db, legacyStatements("0018_add_gene_catalog_aliases.sql"))
      await applyStatements(db, legacyStatements("0023_add_gene_discoveries.sql"))
      await applyStatements(db, legacyStatements("0041_shared_gene_discovery_rollup.sql"))
      await db
        .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
        .bind("TP53", "Tumor protein p53")
        .run()
      await db
        .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
        .bind("BRCA1", "BRCA1 DNA repair associated")
        .run()
      await db
        .prepare(
          `INSERT INTO icono_gene_discoveries
           (user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger)
           VALUES ('reader', 'TP53', 'extension_hover', 'extension_hover', 'hover_dwell', 'hover_dwell')`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO icono_gene_discoveries
           (user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger)
           VALUES ('reader', 'RETIRED1', 'extension_hover', 'extension_hover', 'hover_dwell', 'hover_dwell')`,
        )
        .run()

      await applyStatements(db, compactMigrationStatements())

      const shared = await readSharedCompactState(db)
      assert.equal(shared.state_version, 0)
      const activationBeforeExecutor = await readCompactDiscoveryActivation(db)
      assert.equal(activationBeforeExecutor.total_legacy_rows, 0)
      assert.equal(activationBeforeExecutor.migrated_rows, 0)
      assert.deepEqual(await readDiscoveryDictionaryMeta(db), { version: 1 })
      const seeded = await loadDiscoveryDictionaryForNames(db, ["BRCA1", "TP53", "RETIRED1"])
      assert.equal(seeded.byName.size, 0)

      // Bounded transfer: only touched names acquire ordinals, historical
      // symbols stay resolvable as inactive entries, catalog size is irrelevant.
      const lookup = await ensureDiscoveryDictionaryForNames(db, ["BRCA1", "TP53", "RETIRED1"], {
        preserveHistorical: true,
      })
      assert.equal(lookup.byName.get("BRCA1"), 0)
      assert.equal(lookup.byName.get("TP53"), 1)
      assert.equal(lookup.byName.get("RETIRED1"), 2)
      const retired = await db
        .prepare(
          "SELECT canonical, active FROM icono_discovery_ordinals_v2 WHERE name = 'RETIRED1'",
        )
        .first()
      assert.equal(retired.canonical, "RETIRED1")
      assert.equal(Number(retired.active), 0)
      const rows = await db
        .prepare("SELECT COUNT(*) AS total FROM icono_discovery_ordinals_v2")
        .first("total")
      assert.equal(Number(rows), 3)

      // Migration schema parity with the executable schema used by tests.
      const migratedTables = (await db.prepare(SCHEMA_OBJECT_QUERY).all()).results.map(
        (row) => row.name,
      )
      await withD1(async (fresh) => {
        for (const statement of DISCOVERY_COMPACT_SCHEMA_SQL.split(";")
          .map((sql) => sql.trim().replace(/\s+/g, " "))
          .filter(Boolean)) {
          await fresh.exec(statement)
        }
        const schemaObjects = (await fresh.prepare(SCHEMA_OBJECT_QUERY).all()).results.map(
          (row) => row.name,
        )
        assert.deepEqual(schemaObjects, migratedTables)
      })
      console.log(
        "B764_MIGRATION_RECEIPT",
        JSON.stringify({
          dictionary_version: 1,
          catalog_seeded_ordinals: Number(seeded.byName.size),
          touched_ordinals: Number(rows),
          tables: migratedTables.length,
        }),
      )
    })
  },
)

test(
  "the admitted scheduled executor resumes its durable cursor and alone activates compact discovery",
  { timeout: 60000 },
  async (t) => {
    await withD1(async (db) => {
      await applyStatements(db, legacyStatements("0007_add_gene_catalog.sql"))
      await applyStatements(db, legacyStatements("0018_add_gene_catalog_aliases.sql"))
      await applyStatements(db, legacyStatements("0023_add_gene_discoveries.sql"))
      await applyStatements(db, legacyStatements("0041_shared_gene_discovery_rollup.sql"))
      for (let index = 0; index < 9; index += 1) {
        const symbol = `TEST${index}`
        await db
          .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
          .bind(symbol, symbol)
          .run()
        await db
          .prepare(
            `INSERT INTO icono_gene_discoveries
             (user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger)
             VALUES ('reader', ?, 'extension_hover', 'extension_hover', 'hover_dwell', 'hover_dwell')`,
          )
          .bind(symbol)
          .run()
      }
      await applyStatements(db, compactMigrationStatements())

      const leaseOne = await claimCompactDiscoveryMigrationLease(db, {
        token: "executor-one",
        now: "2026-09-19T00:00:00.000Z",
      })
      const overlapping = await claimCompactDiscoveryMigrationLease(db, {
        token: "executor-two",
        now: "2026-09-19T00:00:01.000Z",
      })
      assert.ok(leaseOne)
      assert.equal(overlapping, null)
      await db
        .prepare(
          "UPDATE icono_discovery_compact_activation_v2 SET lease_token='', lease_until='' WHERE singleton=1",
        )
        .run()

      const refused = await migrateIconoplasmCompactDiscoveryForScheduled({ ICONOPLASM_DB: db })
      assert.equal(refused.pending, true)
      const activationAfterMissingAuthority = await db
        .prepare(
          "SELECT status, lease_token, lease_until FROM icono_discovery_compact_activation_v2",
        )
        .first()
      assert.equal(activationAfterMissingAuthority.status, "pending")
      assert.equal(activationAfterMissingAuthority.lease_token, "")
      assert.equal(activationAfterMissingAuthority.lease_until, "")

      const refusedAuthorityCalls = []
      const capacityRefused = await migrateIconoplasmCompactDiscoveryForScheduled({
        ICONOPLASM_DB: db,
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
          idFromName: () => "global",
          get: () => ({
            async fetch(request) {
              refusedAuthorityCalls.push(new URL(request.url).pathname)
              return Response.json(
                { ok: false, code: "MUTATION_PROVIDER_HEADROOM_RESERVED" },
                { status: 429 },
              )
            },
          }),
        },
      })
      assert.equal(capacityRefused.code, "MUTATION_PROVIDER_HEADROOM_RESERVED")
      assert.deepEqual(refusedAuthorityCalls, ["/reserve-mutation-writes"])
      const activationAfterRefusedAuthority = await db
        .prepare("SELECT lease_token, lease_until FROM icono_discovery_compact_activation_v2")
        .first()
      assert.equal(activationAfterRefusedAuthority.lease_token, "")
      assert.equal(activationAfterRefusedAuthority.lease_until, "")

      const authorityCalls = []
      const env = {
        ICONOPLASM_DB: db,
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
          idFromName: () => "global",
          get: () => ({
            async fetch(request) {
              const body = await request.json()
              authorityCalls.push({ path: new URL(request.url).pathname, body })
              return Response.json({ ok: true, operation_id: body.operation_id })
            },
          }),
        },
      }
      const firstMeter = createOperationCostD1Meter(db)
      const first = await migrateIconoplasmCompactDiscoveryForScheduled({
        ...env,
        ICONOPLASM_DB: firstMeter.db,
      })
      const firstActual = firstMeter.finish()
      assert.equal(first.complete, true)
      assert.equal(first.pending, false)
      assert.equal(first.pages, 2)
      assert.equal(first.migrated_rows, 9)
      assert.equal(first.measured_legacy_rows, 9)
      assert.equal(first.denominator_complete, true)
      assert.equal(first.bounded_rows_per_wake, 512)
      assert.equal(first.bounded_rows_per_day, 49152)
      assert.equal(first.maximum_remaining_days, 0)
      assert.ok(firstActual.rows_written <= first.reserved_write_units, JSON.stringify(firstActual))
      t.diagnostic(JSON.stringify({ firstActual, reserved: first.reserved_write_units }))
      assert.equal(
        authorityCalls.filter((call) => call.path === "/reserve-mutation-writes").length,
        2,
      )
      assert.equal(
        authorityCalls.filter((call) => call.path.includes("complete-mutation")).length,
        2,
      )
      assert.equal((await readCompactUserState(db, "reader")).member_count, 9)
    })
  },
)

test(
  "a migrated legacy user imports into compact state with exact first/last/count",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      await applyStatements(db, legacyStatements("0007_add_gene_catalog.sql"))
      await applyStatements(db, legacyStatements("0018_add_gene_catalog_aliases.sql"))
      await applyStatements(db, legacyStatements("0023_add_gene_discoveries.sql"))
      await applyStatements(db, legacyStatements("0041_shared_gene_discovery_rollup.sql"))
      await db
        .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
        .bind("TP53", "Tumor protein p53")
        .run()
      await db
        .prepare(
          `INSERT INTO icono_gene_discoveries
           (user_id, gene_symbol, first_discovered_at, last_encountered_at, encounter_count,
            first_source, last_source, first_trigger, last_trigger, first_dwell_ms, last_dwell_ms)
           VALUES ('reader', 'TP53', '2026-01-03 04:05:06', '2026-01-04 05:06:07', 3,
            'extension_hover', 'extension_hover', 'hover_dwell', 'hover_dwell', 900, 1200)`,
        )
        .run()
      await applyStatements(db, compactMigrationStatements())
      await ensureDiscoveryDictionaryForNames(db, ["TP53"], { preserveHistorical: true })
      const lookup = await loadDiscoveryDictionaryForNames(db, ["TP53"])
      const dictionary = createDiscoveryOrdinalDictionary(
        [...lookup.byOrdinal.entries()].map(([ordinal, symbol]) => ({ symbol, ordinal })),
        { version: lookup.version },
      )
      const result = await importLegacyDiscoveryUser({
        db,
        userId: "reader",
        dictionary,
        legacyRows: (
          await db.prepare("SELECT * FROM icono_gene_discoveries WHERE user_id = 'reader'").all()
        ).results,
        nowSeconds: 1,
      })
      assert.deepEqual(result, { ok: true, imported: 1, events: 3, batches: 1, remaining: 0 })
      const state = await readCompactUserState(db, "reader")
      assert.equal(state.member_count, 1)
      const chronology = await readCompactDiscoveryChronology(db, "reader")
      assert.deepEqual(
        chronology.active_events.map((event) => event.at),
        [1767413106, 1767503167, 1767503167],
      )
      const outbox = await db
        .prepare("SELECT payload_json FROM icono_discovery_shared_delivery_outbox_v2")
        .all()
      assert.equal(outbox.results.length, 1)
    })
  },
)

test(
  "migration admission covers eight cold users with maximum retained encounter history",
  { timeout: 60000 },
  async (t) => {
    await withD1(async (db) => {
      for (const migration of [
        "0007_add_gene_catalog.sql",
        "0018_add_gene_catalog_aliases.sql",
        "0023_add_gene_discoveries.sql",
        "0041_shared_gene_discovery_rollup.sql",
      ])
        await applyStatements(db, legacyStatements(migration))
      for (let index = 0; index < 8; index += 1) {
        const symbol = `COLD${index}`
        await db
          .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
          .bind(symbol, symbol)
          .run()
        await db
          .prepare(
            `INSERT INTO icono_gene_discoveries
             (user_id,gene_symbol,encounter_count,first_source,last_source,first_trigger,last_trigger)
             VALUES (?, ?, 32, 'extension_hover', 'extension_hover', 'hover_dwell', 'hover_dwell')`,
          )
          .bind(`reader-${index}`, symbol)
          .run()
      }
      await applyStatements(db, compactMigrationStatements())
      const reservations = []
      const meter = createOperationCostD1Meter(db)
      const result = await migrateIconoplasmCompactDiscoveryForScheduled({
        ICONOPLASM_DB: meter.db,
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
          idFromName: () => "global",
          get: () => ({
            async fetch(request) {
              const body = await request.json()
              if (new URL(request.url).pathname === "/reserve-mutation-writes")
                reservations.push(body)
              return Response.json({ ok: true, operation_id: body.operation_id })
            },
          }),
        },
      })
      const actual = meter.finish()
      assert.equal(result.complete, true)
      assert.equal(result.migrated_rows, 8)
      assert.equal(reservations.length, 1)
      assert.equal(reservations[0].units, 204)
      assert.ok(actual.rows_written <= reservations[0].units, JSON.stringify(actual))
      t.diagnostic(JSON.stringify({ actual, reserved: reservations[0].units }))
    })
  },
)

test(
  "overlapping scheduled migration loser never completes the shared reservation and winner failure stays uncertain",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      await applyStatements(db, legacyStatements("0007_add_gene_catalog.sql"))
      await applyStatements(db, legacyStatements("0018_add_gene_catalog_aliases.sql"))
      await applyStatements(db, legacyStatements("0023_add_gene_discoveries.sql"))
      await applyStatements(db, legacyStatements("0041_shared_gene_discovery_rollup.sql"))
      await db
        .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53','TP53')")
        .run()
      await db
        .prepare(
          `INSERT INTO icono_gene_discoveries
           (user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger)
           VALUES ('reader','TP53','extension_hover','extension_hover','hover_dwell','hover_dwell')`,
        )
        .run()
      await applyStatements(db, compactMigrationStatements())

      let releaseMigration
      let migrationStarted
      const migrationStartedPromise = new Promise((resolve) => {
        migrationStarted = resolve
      })
      const migrationGate = new Promise((resolve) => {
        releaseMigration = resolve
      })
      const calls = []
      const reservationOperationIds = []
      const leaseTokens = []
      const failingDb = {
        prepare(sql) {
          const statement = db.prepare(sql)
          if (String(sql).includes("SET lease_token = ?")) {
            return {
              bind(...values) {
                leaseTokens.push(values[0])
                return statement.bind(...values)
              },
            }
          }
          if (String(sql).includes("SELECT *") && String(sql).includes("icono_gene_discoveries")) {
            return {
              bind() {
                return this
              },
              async all() {
                migrationStarted()
                await migrationGate
                throw new Error("injected migration failure after admission")
              },
            }
          }
          return statement
        },
      }
      const env = {
        ICONOPLASM_DB: failingDb,
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
          idFromName: () => "global",
          get: () => ({
            async fetch(request) {
              const path = new URL(request.url).pathname
              calls.push(path)
              if (path === "/reserve-mutation-writes") {
                reservationOperationIds.push((await request.json()).operation_id)
              }
              return Response.json({ ok: true })
            },
          }),
        },
      }

      const winner = migrateIconoplasmCompactDiscoveryForScheduled(env)
      await migrationStartedPromise
      const loser = await migrateIconoplasmCompactDiscoveryForScheduled(env)
      assert.equal(loser.code, "DISCOVERY_MIGRATION_LEASE_HELD")
      assert.deepEqual(calls, ["/reserve-mutation-writes", "/reserve-mutation-writes"])
      assert.equal(reservationOperationIds.length, 2)
      assert.equal(reservationOperationIds[0], reservationOperationIds[1])
      assert.equal(leaseTokens.length, 2)
      assert.notEqual(leaseTokens[0], leaseTokens[1])
      assert.match(leaseTokens[0], /^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
      assert.match(leaseTokens[1], /^[0-9a-f]{8}-[0-9a-f-]{27}$/i)
      releaseMigration()
      await assert.rejects(winner, /injected migration failure after admission/)
      assert.deepEqual(calls, ["/reserve-mutation-writes", "/reserve-mutation-writes"])
    })
  },
)

test(
  "an expired migration lease is taken over by a unique token and the stale owner cannot mutate or advance",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      await applyStatements(db, legacyStatements("0007_add_gene_catalog.sql"))
      await applyStatements(db, legacyStatements("0018_add_gene_catalog_aliases.sql"))
      await applyStatements(db, legacyStatements("0023_add_gene_discoveries.sql"))
      await applyStatements(db, legacyStatements("0041_shared_gene_discovery_rollup.sql"))
      await db
        .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53','TP53')")
        .run()
      await db
        .prepare(
          `INSERT INTO icono_gene_discoveries
           (user_id, gene_symbol, first_source, last_source, first_trigger, last_trigger)
           VALUES ('reader','TP53','extension_hover','extension_hover','hover_dwell','hover_dwell')`,
        )
        .run()
      await applyStatements(db, compactMigrationStatements())

      const staleToken = crypto.randomUUID()
      const replacementToken = crypto.randomUUID()
      assert.notEqual(staleToken, replacementToken)
      assert.ok(
        await claimCompactDiscoveryMigrationLease(db, {
          token: staleToken,
          now: "2026-09-19T00:00:00.000Z",
        }),
      )
      assert.ok(
        await claimCompactDiscoveryMigrationLease(db, {
          token: replacementToken,
          now: "2026-09-19T00:02:00.000Z",
        }),
      )

      const beforeStaleAttempt = await readCompactDiscoveryActivation(db)
      const staleAttempt = await migrateLegacyDiscoveryPage({ db, leaseToken: staleToken })
      assert.equal(staleAttempt.code, "DISCOVERY_MIGRATION_LEASE_LOST")
      assert.deepEqual(await readCompactDiscoveryActivation(db), beforeStaleAttempt)
      assert.equal(await readCompactUserState(db, "reader"), null)

      const replacement = await migrateLegacyDiscoveryPage({ db, leaseToken: replacementToken })
      assert.equal(replacement.complete, true)
      assert.equal(replacement.migrated_rows, 1)
      assert.equal((await readCompactUserState(db, "reader")).member_count, 1)
      const activation = await readCompactDiscoveryActivation(db)
      assert.equal(activation.status, "complete")
      assert.equal(activation.migrated_rows, 1)
    })
  },
)
