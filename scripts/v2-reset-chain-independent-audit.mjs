import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { runAdmittedMigrations } from "./run-admitted-d1-migrations.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { createMigrationOperationCostAdapters } from "../workers/iconoplasm/operation-cost-migration-adapters.js"

// Diagnostic only. No application changes, production credentials or remote calls.
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
const files = (directory) => readdirSync(new URL(`${directory}/`, root)).filter((name) => name.endsWith(".sql")).sort()
const evidence = { reviewed_source: "25625563e479d0ad2354953b1d3c9e909b35bb89", checks: {} }
function receipt(name, value) {
  evidence.checks[name] = value
  writeFileSync(new URL("v2-reset-chain-evidence.json", root), JSON.stringify(evidence, null, 2))
  console.log("V2_RESET_AUDIT", name, JSON.stringify(value))
}
function inventoryHarness(pending106) {
  const calls = []
  const adapters = Object.keys(resources).map((resource) => ({
    id: `${resource}-migration-inventory`, resource, ...OPERATION_COST_IDENTITIES,
  }))
  return {
    calls,
    options: {
      manifest, releaseId: "isolated-cutover-audit", inventoryOnly: true, files,
      send: async (suffix, method, body) => {
        calls.push({ suffix, method, adapter: body?.adapter_id })
        if (!suffix) return { adapters }
        if (suffix === "/receipt") throw new Error("COST_PREDICTION_NOT_REGISTERED")
        if (suffix === "/register") return { plan: { id: body.id } }
        assert.equal(suffix, "/execute")
        const resource = body.adapter_id.replace(/-migration-inventory$/, "")
        assert.ok(resources[resource], "Only read-only migration inventory is allowed")
        const applied = resources[resource].flatMap(files).filter((name) => !(pending106 && resource === "iconoplasm" && name === migrationName))
        return { result: [{ results: applied.map((name, id) => ({ id, name })) }], usage: { rows_read: applied.length, rows_written: 0, requests: 1 } }
      },
    },
  }
}

test("positive control: actual release runner accepts an entirely applied source inventory", async () => {
  const h = inventoryHarness(false)
  const result = await runAdmittedMigrations(h.options)
  assert.deepEqual(result.pending_migrations, [])
  receipt("all_applied_control", { accepted: true, inventory_calls: h.calls.filter((x) => x.suffix === "/execute").length, ddl_calls: 0 })
})

test("release can inventory the actual new 0106 migration before its first production application", async () => {
  const h = inventoryHarness(true)
  let result
  try {
    result = await runAdmittedMigrations(h.options)
  } catch (error) {
    receipt("pending_0106", { accepted: false, error: error.message, manifest_entry_present: Boolean(manifest.migrations[migrationKey]), ddl_calls: 0 })
    throw error
  }
  assert.deepEqual(result.pending_migrations, [migrationKey])
  receipt("pending_0106", { accepted: true, pending: result.pending_migrations })
})

test("new discovery migration has a registered executable admission adapter", () => {
  const adapters = createMigrationOperationCostAdapters({ ICONOPLASM_SCHEMA_TRANSITION: "1" }, OPERATION_COST_IDENTITIES)
  const registered = [...adapters.keys()].filter((name) => name.includes("0106"))
  receipt("adapter_0106", { registered })
  assert.ok(registered.length > 0, "No migration-0106 adapter is registered")
})

function statements(sql) {
  return sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n").split(";").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean)
}

test("committed 0106 migration fits the entire 20000-write application allocation at 19023 catalog rows", { timeout: 120000 }, async () => {
  const req = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(req.resolve("wrangler/package.json"))("miniflare")
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default {fetch(){return new Response('isolated test')}}",
    compatibilityDate: "2026-08-01", d1Databases: ["DB"],
  }))
  try {
    const db = await runtime.getD1Database("DB")
    for (const path of ["0007_add_gene_catalog.sql", "0023_add_gene_discoveries.sql", "0041_shared_gene_discovery_rollup.sql"]) {
      for (const sql of statements(read(`migrations-iconoplasm/${path}`))) await db.prepare(sql).run()
    }
    await db.prepare("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<19023) INSERT INTO icono_gene_catalog(gene_symbol,full_name) SELECT printf('AUDIT%06d',n),printf('Audit gene %d',n) FROM seq").run()
    const phaseCosts = []
    for (const sql of statements(read(`migrations-iconoplasm/${migrationName}`))) {
      const result = await db.prepare(sql).run()
      assert.ok(Number.isSafeInteger(result.meta?.rows_read), "Native D1 read receipt required")
      assert.ok(Number.isSafeInteger(result.meta?.rows_written), "Native D1 write receipt required")
      phaseCosts.push({ sql, rows_read: result.meta.rows_read, rows_written: result.meta.rows_written })
    }
    const rows_read = phaseCosts.reduce((sum, x) => sum + x.rows_read, 0)
    const rows_written = phaseCosts.reduce((sum, x) => sum + x.rows_written, 0)
    const ordinal_count = await db.prepare("SELECT COUNT(*) AS total FROM icono_discovery_ordinals_v2").first("total")
    receipt("native_0106_migration", { catalog_rows: 19023, legacy_discovery_rows: 0, ordinal_count, rows_read, rows_written, application_write_allocation: 20000, excludes: "fixture setup, migration journal/admission overhead, other application traffic", phaseCosts })
    assert.equal(ordinal_count, 19023)
    assert.ok(rows_written <= 20000, `Migration alone spends ${rows_written} writes, exceeding the entire 20000-write application allocation`)
  } finally {
    await runtime.dispose()
  }
})

test("record tracked production caller references and reset entrypoints for source review", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n")
  const production = tracked.filter((p) => /^(workers|scripts|shared|\.github\/workflows)\//.test(p) && /\.(js|mjs|ts|yml|yaml|ps1)$/.test(p) && !/test|audit|__fixtures__|generated\//i.test(p))
  const patterns = ["/authority/activate", "/authority/candidates", "authority_epoch", "background_sync_finalization", "sync-finalization/budget-defer", "sync-finalization/budget-resume"]
  const refs = []
  for (const path of production) {
    const lines = read(path).split("\n")
    lines.forEach((line, index) => {
      for (const pattern of patterns) if (line.includes(pattern)) refs.push({ path, line: index + 1, pattern, excerpt: lines.slice(Math.max(0,index-3),Math.min(lines.length,index+6)).join("\n") })
    })
  }
  receipt("production_references", { scope: "Tracked production source only; literal-reference search does not exclude dynamic or unpushed local callers", refs })
})
