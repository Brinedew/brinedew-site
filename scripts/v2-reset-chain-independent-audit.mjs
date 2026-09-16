import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { runAdmittedMigrations } from "./run-admitted-d1-migrations.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { createMigrationOperationCostAdapters } from "../workers/iconoplasm/operation-cost-migration-adapters.js"
import { createCompactDiscoveryMigrationCostAdapter } from "../workers/iconoplasm/operation-cost-compact-discovery-migration-adapter.js"
import {
  ensureDiscoveryDictionaryForNames,
  loadDiscoveryDictionaryForNames,
} from "../workers/iconoplasm/discovery-ordinal-store.js"

// Admitted-migration regression. No application deployment, production
// credentials or remote calls. This exercises the reviewed replacement through
// the repository's actual admission plan, adapter registry and generator.
const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const migrationName = "0106_compact_discovery_state_v2.sql"
const migrationKey = `iconoplasm/${migrationName}`
const manifest = JSON.parse(read("cloudflare/operation-cost-migration-plan.json"))
const resources = {
  geneguessr: ["migrations", "workers/benchmark/migrations"],
  iconoplasm: ["migrations-iconoplasm"],
  "iconoplasm-authoring": ["migrations-iconoplasm-authoring"],
}
const files = (directory) =>
  readdirSync(new URL(`${directory}/`, root))
    .filter((name) => name.endsWith(".sql"))
    .sort()
const evidenceDirectory = new URL("artifacts/b762-v2-cutover-20260916/", root)
mkdirSync(evidenceDirectory, { recursive: true })
const evidence = { reviewed_source: "fix/v2-cutover-25625563", checks: {} }
function receipt(name, value) {
  evidence.checks[name] = value
  writeFileSync(
    new URL("v2-reset-chain-evidence.json", evidenceDirectory),
    JSON.stringify(evidence, null, 2),
  )
  console.log("V2_RESET_AUDIT", name, JSON.stringify(value))
}

const PRODUCTION_HISTORICAL_JOURNAL = {
  iconoplasm: ["0045_add_gene_comments.sql"],
}

function inventoryHarness(pending106) {
  const calls = []
  const adapters = Object.keys(resources).map((resource) => ({
    id: `${resource}-migration-inventory`,
    resource,
    ...OPERATION_COST_IDENTITIES,
  }))
  return {
    calls,
    options: {
      manifest,
      releaseId: "isolated-cutover-audit",
      inventoryOnly: true,
      files,
      send: async (suffix, method, body) => {
        calls.push({ suffix, method, adapter: body?.adapter_id })
        if (!suffix) return { adapters }
        if (suffix === "/receipt") throw new Error("COST_PREDICTION_NOT_REGISTERED")
        if (suffix === "/register") return { plan: { id: body.id } }
        assert.equal(suffix, "/execute")
        const resource = body.adapter_id.replace(/-migration-inventory$/, "")
        assert.ok(resources[resource], "Only read-only migration inventory is allowed")
        const applied = [
          ...resources[resource].flatMap(files),
          ...(PRODUCTION_HISTORICAL_JOURNAL[resource] || []),
        ].filter((name) => !(pending106 && resource === "iconoplasm" && name === migrationName))
        return {
          result: [{ results: applied.map((name, id) => ({ id, name })) }],
          usage: { rows_read: applied.length, rows_written: 0, requests: 1 },
        }
      },
    },
  }
}

test("positive control: actual release runner accepts an entirely applied source inventory", async () => {
  const h = inventoryHarness(false)
  const result = await runAdmittedMigrations(h.options)
  assert.deepEqual(result.pending_migrations, [])
  receipt("all_applied_control", {
    accepted: true,
    inventory_calls: h.calls.filter((x) => x.suffix === "/execute").length,
    ddl_calls: 0,
  })
})

test("release can inventory the new 0106 migration against a realistic prior-version journal", async () => {
  const h = inventoryHarness(true)
  const result = await runAdmittedMigrations(h.options)
  assert.deepEqual(result.pending_migrations, [migrationKey])
  receipt("pending_0106", {
    accepted: true,
    pending: result.pending_migrations,
    manifest_entry_present: Boolean(manifest.migrations[migrationKey]),
    ddl_calls: 0,
  })
})

test("new discovery migration has a registered executable admission adapter", () => {
  const adapters = createMigrationOperationCostAdapters(
    { ICONOPLASM_SCHEMA_TRANSITION: "1" },
    OPERATION_COST_IDENTITIES,
  )
  const registered = [...adapters.keys()].filter((name) => name.includes("0106"))
  receipt("adapter_0106", { registered })
  assert.deepEqual(registered, ["iconoplasm-migration-0106"])
})

function statements(sql) {
  return String(sql || "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
}

async function withD1(run) {
  const req = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    req.resolve("wrangler/package.json"),
  )("miniflare")
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('isolated test')}}",
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

async function seedPriorSchema(db, { catalogRows }) {
  for (const path of [
    "0007_add_gene_catalog.sql",
    "0018_add_gene_catalog_aliases.sql",
    "0023_add_gene_discoveries.sql",
    "0041_shared_gene_discovery_rollup.sql",
  ]) {
    for (const sql of statements(read(`migrations-iconoplasm/${path}`))) await db.prepare(sql).run()
  }
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .run()
  if (catalogRows > 0)
    await db
      .prepare(
        `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${Number(catalogRows)}) INSERT INTO icono_gene_catalog(gene_symbol,full_name) SELECT printf('AUDIT%06d',n),printf('Audit gene %d',n) FROM seq`,
      )
      .run()
}

test(
  "the admitted replacement applies natively without a catalog-sized seed",
  { timeout: 120000 },
  async () => {
    await withD1(async (db) => {
      await seedPriorSchema(db, { catalogRows: 19023 })
      const adapter = createCompactDiscoveryMigrationCostAdapter({
        db,
        ...OPERATION_COST_IDENTITIES,
      })
      const prepared = await adapter.prepare({})
      const { actual, result } = await adapter.dispatch(prepared)
      const ordinalCount = await db
        .prepare("SELECT COUNT(*) AS total FROM icono_discovery_ordinals_v2")
        .first("total")
      const journal = await db
        .prepare("SELECT name FROM d1_migrations WHERE name = ?")
        .bind(migrationName)
        .first("name")
      receipt("native_admitted_replacement", {
        catalog_rows: 19023,
        ordinal_count: Number(ordinalCount),
        actual,
        application_write_allocation: 20000,
        statements: prepared.statements.length,
        excludes: "fixture setup, migration journal/admission overhead, other application traffic",
      })
      assert.equal(result.applied, true)
      assert.equal(Number(ordinalCount), 0)
      assert.equal(journal, migrationName)
      assert.ok(
        actual.rows_written <= 20000,
        `Admitted migration spends ${actual.rows_written} writes, exceeding the application allocation`,
      )
      assert.ok(actual.rows_read <= manifest.migrations[migrationKey].prediction.rows_read)
      assert.ok(actual.rows_written <= manifest.migrations[migrationKey].prediction.rows_written)
    })
  },
)

test(
  "ordinal transfer is bounded by touched names and independent of catalog size",
  { timeout: 120000 },
  async () => {
    await withD1(async (db) => {
      await seedPriorSchema(db, { catalogRows: 19023 })
      const adapter = createCompactDiscoveryMigrationCostAdapter({
        db,
        ...OPERATION_COST_IDENTITIES,
      })
      await adapter.dispatch(await adapter.prepare({}))
      const first = await ensureDiscoveryDictionaryForNames(db, ["TP53", "BRCA1", "RETIRED1"], {
        preserveHistorical: true,
      })
      const afterFirst = await db
        .prepare("SELECT COUNT(*) AS total FROM icono_discovery_ordinals_v2")
        .first("total")
      const history = await db
        .prepare(
          "SELECT name, ordinal, canonical, active FROM icono_discovery_ordinals_v2 WHERE name = 'RETIRED1'",
        )
        .first()
      assert.equal(Number(afterFirst), 3)
      assert.equal(Number(history.active), 0)
      assert.equal(history.canonical, "RETIRED1")
      assert.ok(first.byName.get("TP53") != null && first.byName.get("BRCA1") != null)

      // Re-resolution is a no-op and never renumbers an existing ordinal.
      const second = await ensureDiscoveryDictionaryForNames(db, ["TP53"], {})
      const afterSecond = await db
        .prepare("SELECT COUNT(*) AS total FROM icono_discovery_ordinals_v2")
        .first("total")
      assert.equal(Number(afterSecond), 3)
      assert.equal(second.byName.get("TP53"), first.byName.get("TP53"))

      // A rename keeps the prior ordinal and makes the old name an alias.
      await db
        .prepare("UPDATE icono_gene_catalog SET aliases_json = ? WHERE gene_symbol = ?")
        .bind(JSON.stringify(["TP53"]), "AUDIT000001")
        .run()
      const renamed = await ensureDiscoveryDictionaryForNames(db, ["AUDIT000001"], {})
      assert.equal(renamed.byName.get("AUDIT000001"), first.byName.get("TP53"))
      receipt("bounded_ordinal_transfer", {
        catalog_rows: 19023,
        first_resolution_ordinals: Number(afterFirst),
        second_resolution_ordinals: Number(afterSecond),
        rename_kept_ordinal: renamed.byName.get("AUDIT000001") === first.byName.get("TP53"),
        note: "writes grow with touched names, never with catalog size",
      })
    })
  },
)

test("record tracked production caller references and reset entrypoints for source review", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
  const production = tracked.filter(
    (p) =>
      /^(workers|scripts|shared|\.github\/workflows)\//.test(p) &&
      /\.(js|mjs|ts|yml|yaml|ps1)$/.test(p) &&
      !/test|audit|__fixtures__|generated\//i.test(p),
  )
  const patterns = [
    "/authority/activate",
    "/authority/candidates",
    "authority_epoch",
    "background_sync_finalization",
    "sync-finalization/budget-defer",
    "sync-finalization/budget-resume",
  ]
  const refs = []
  for (const path of production) {
    const lines = read(path).split("\n")
    lines.forEach((line, index) => {
      for (const pattern of patterns)
        if (line.includes(pattern))
          refs.push({
            path,
            line: index + 1,
            pattern,
            excerpt: lines
              .slice(Math.max(0, index - 3), Math.min(lines.length, index + 6))
              .join("\n"),
          })
    })
  }
  receipt("production_references", {
    scope:
      "Tracked production source only; literal-reference search does not exclude dynamic or unpushed local callers",
    refs,
  })
})
