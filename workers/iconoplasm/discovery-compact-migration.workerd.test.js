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
import { importLegacyDiscoveryUser } from "./discovery-compact-migrate.js"
import {
  ensureDiscoveryDictionaryForNames,
  loadDiscoveryDictionaryForNames,
  readDiscoveryDictionaryMeta,
} from "./discovery-ordinal-store.js"

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
      assert.deepEqual(await readDiscoveryDictionaryMeta(db), { version: 1 })
      const seeded = await loadDiscoveryDictionaryForNames(db, ["BRCA1", "TP53", "RETIRED1"])
      assert.equal(seeded.byName.size, 0)

      // Bounded transfer: only touched names acquire ordinals, historical
      // symbols stay resolvable as inactive entries, catalog size is irrelevant.
      const lookup = await ensureDiscoveryDictionaryForNames(
        db,
        ["BRCA1", "TP53", "RETIRED1"],
        { preserveHistorical: true },
      )
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
