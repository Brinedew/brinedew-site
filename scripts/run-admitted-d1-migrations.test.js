import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, existsSync } from "node:fs"
import { runAdmittedMigrations } from "./run-admitted-d1-migrations.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"

const manifest = JSON.parse(
  readFileSync(new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url)),
)
const resources = ["geneguessr", "iconoplasm", "iconoplasm-authoring"]
const directories = {
  geneguessr: "migrations",
  iconoplasm: "migrations-iconoplasm",
  "iconoplasm-authoring": "migrations-iconoplasm-authoring",
}

function harness(extra = false) {
  const calls = []
  const adapters = resources.map((resource) => ({
    id: resource + "-migration-inventory",
    resource,
    query_ids: [
      "applied-migrations",
      "notifications-migration-size",
      "assignments-migration-size",
      "finalization-migration-size",
      "finalization-unfinished-migration-size",
      "finalization-terminal-migration-size",
      "finalization-status-migration-size",
      "finalization-status-unfinished-migration-size",
    ],
    ...OPERATION_COST_IDENTITIES,
  }))
  for (const [key, item] of Object.entries(manifest.migrations))
    adapters.push({
      id: item.adapter_id,
      resource: key.split("/")[0],
      migration_protocol: item.migration_protocol,
      ...OPERATION_COST_IDENTITIES,
    })
  return {
    calls,
    options: {
      manifest,
      releaseId: "test-release",
      files: (directory) => {
        if (directory === "workers/benchmark/migrations") return []
        const resource = resources.find((resource) => directories[resource] === directory)
        return [
          "0001.sql",
          ...Object.keys(manifest.migrations)
            .filter((key) => key.startsWith(resource + "/"))
            .map((key) => key.split("/")[1]),
          ...(extra && resource === "iconoplasm-authoring" ? ["9999-unreviewed.sql"] : []),
        ]
      },
      send: async (suffix, method, body) => {
        calls.push({ suffix, method, body })
        if (!suffix) return { adapters }
        if (suffix === "/capacity")
          return {
            day: new Date().toISOString().slice(0, 10),
            measured_at: Date.now(),
            remaining: { rows_read: 1000000, rows_written: 20000, requests: 2400 },
          }
        if (suffix === "/receipt") throw new Error("COST_PREDICTION_NOT_REGISTERED")
        if (suffix === "/register") return { plan: { id: body.id } }
        return {
          result: body.adapter_id.endsWith("-migration-inventory")
            ? [
                {
                  results:
                    body.arguments.statements[0].query_id === "applied-migrations"
                      ? [{ id: 1, name: "0001.sql" }]
                      : [{ capped_count: 0 }],
                },
              ]
            : { applied: true },
          usage: { rows_read: 1, rows_written: 0, requests: 1 },
        }
      },
    },
  }
}

test("release manifest points only at real reviewed migration files", () => {
  for (const key of Object.keys(manifest.migrations)) {
    const [resource, name] = key.split("/")
    assert.ok(existsSync(new URL(`../${directories[resource]}/${name}`, import.meta.url)), key)
  }
})

test("fresh inventory observations cannot change the retained migration operation identity", async () => {
  const h = harness()
  await runAdmittedMigrations({
    ...h.options,
    releaseId: "deploy-original",
    inventoryReleaseId: "inspect-current-3",
  })
  const registrations = h.calls
    .filter((call) => call.suffix === "/register")
    .map((call) => call.body)
  assert.equal(
    registrations.filter((plan) => plan.adapter_id.endsWith("-migration-inventory")).length,
    10,
  )
  for (const plan of registrations) {
    assert.ok(
      plan.id.startsWith(
        plan.adapter_id.endsWith("-migration-inventory")
          ? "inspect-current-3-"
          : "deploy-original-",
      ),
    )
  }
})

test("resumable seed keeps one immutable plan and stops before a page without shared headroom", async () => {
  const h = harness(),
    original = h.options.send
  let pages = 0
  h.options.send = async (suffix, method, body) => {
    if (suffix === "/capacity" && pages === 2)
      return {
        day: new Date().toISOString().slice(0, 10),
        measured_at: Date.now(),
        remaining: { rows_read: 0, rows_written: 20000, requests: 2400 },
      }
    const response = await original(suffix, method, body)
    if (suffix === "/execute" && body.adapter_id === "iconoplasm-migration-0095") {
      pages++
      return { ...response, result: { applied: false, next_phase: "catalog" } }
    }
    return response
  }
  await assert.rejects(runAdmittedMigrations(h.options), /COST_MIGRATION_RESUME_AFTER_HEADROOM/)
  const executed = h.calls.filter(
    (call) => call.suffix === "/execute" && call.body.adapter_id === "iconoplasm-migration-0095",
  )
  assert.deepEqual(
    executed.map((call) => call.body.step_id),
    ["execute-0", "execute-1"],
  )
  assert.equal(new Set(executed.map((call) => call.body.operation_id)).size, 1)
  assert.equal(
    h.calls.filter(
      (call) => call.suffix === "/register" && call.body.adapter_id === "iconoplasm-migration-0095",
    ).length,
    1,
  )
})
test("no forecast fails before discovery; unknown migration fails before any DDL", async () => {
  const missing = harness()
  await assert.rejects(runAdmittedMigrations({ ...missing.options, manifest: {} }), /PLAN_REQUIRED/)
  assert.equal(missing.calls.length, 0)
  const unknown = harness(true)
  await assert.rejects(runAdmittedMigrations(unknown.options), /NOT_REVIEWED/)
  assert.equal(
    unknown.calls.filter(
      (call) =>
        call.suffix === "/execute" && !call.body.adapter_id.endsWith("-migration-inventory"),
    ).length,
    0,
  )
})
test("every inventory and migration registers before execution and records its receipt", async () => {
  const { options, calls } = harness()
  const result = await runAdmittedMigrations(options)
  assert.equal(result.migrations_applied, Object.keys(manifest.migrations).length)
  assert.equal(result.evidence.length, Object.keys(manifest.migrations).length + 3)
  for (let index = 0; index < calls.length; index++) {
    if (calls[index].suffix !== "/register") continue
    assert.equal(calls[index + 1].suffix, "/execute")
    assert.equal(calls[index].body.id, calls[index + 1].body.operation_id)
  }
})

test("oversized notification source refuses before registering any DDL, including earlier migrations", async () => {
  const { options, calls } = harness()
  const original = options.send
  options.send = async (suffix, method, body) => {
    const result = await original(suffix, method, body)
    if (
      suffix === "/execute" &&
      body.arguments?.statements?.[0]?.query_id === "notifications-migration-size"
    )
      result.result = [{ results: [{ capped_count: 3001 }] }]
    return result
  }
  await assert.rejects(runAdmittedMigrations(options), /COST_MIGRATION_SOURCE_TOO_LARGE/)
  assert.ok(
    calls
      .filter((call) => call.suffix === "/register")
      .every((call) => call.body.adapter_id.endsWith("-migration-inventory")),
  )
})

test("pre-deploy inventory pins the installed implementation and never executes DDL", async () => {
  const { options, calls } = harness()
  const send = options.send
  options.send = async (...args) => {
    const result = await send(...args)
    if (!args[0])
      result.adapters = result.adapters
        .filter((adapter) => adapter.id.endsWith("-migration-inventory"))
        .map((adapter) => ({
          ...adapter,
          executable_sha256: "e".repeat(64),
          schema_sha256: "f".repeat(64),
        }))
    return result
  }
  const result = await runAdmittedMigrations({ ...options, inventoryOnly: true })
  assert.deepEqual(result.pending_migrations.sort(), Object.keys(manifest.migrations).sort())
  assert.equal(calls.filter((call) => call.suffix === "/execute").length, 3)
  for (const call of calls.filter((call) => call.suffix === "/register")) {
    assert.ok(call.body.adapter_id.endsWith("-migration-inventory"))
    assert.equal(call.body.executable_sha256, "e".repeat(64))
    assert.equal(call.body.schema_sha256, "f".repeat(64))
  }
  await assert.rejects(runAdmittedMigrations(options), /DEPLOYED_IMPLEMENTATION_MISMATCH/)
})

test("shared benchmark history and the repaired legacy comments journal remain recognized", async () => {
  const benchmark = ["0001_benchmark_init.sql", "0002_add_session_state.sql"]
  const repairs = ["0045_gene_comments_and_clans_backend.sql", "0046_gene_comment_columns.sql"]
  for (const defect of [null, "unknown", "duplicate", "missing-repair"]) {
    const { options, calls } = harness()
    const originalFiles = options.files
    options.files = (directory) =>
      directory === "workers/benchmark/migrations"
        ? benchmark
        : [...originalFiles(directory), ...(directory === "migrations-iconoplasm" ? repairs : [])]
    const originalSend = options.send
    options.send = async (suffix, method, body) => {
      const result = await originalSend(suffix, method, body)
      if (
        suffix === "/execute" &&
        body.adapter_id.endsWith("-migration-inventory") &&
        body.arguments.statements[0].query_id === "applied-migrations"
      ) {
        const resource = body.adapter_id.replace(/-migration-inventory$/, "")
        const names = [
          "0001.sql",
          ...(resource === "geneguessr" ? benchmark : []),
          ...(resource === "iconoplasm" ? [...repairs, "0045_add_gene_comments.sql"] : []),
        ]
        if (resource === "iconoplasm") {
          if (defect === "unknown") names.push("0045_unknown_variant.sql")
          if (defect === "duplicate") names.push("0045_add_gene_comments.sql")
          if (defect === "missing-repair") names.splice(names.indexOf(repairs[1]), 1)
        }
        result.result = [{ results: names.map((name, id) => ({ id: id + 1, name })) }]
      }
      return result
    }
    if (defect) {
      await assert.rejects(runAdmittedMigrations(options), /HISTORY_DIVERGED: iconoplasm/)
      assert.equal(
        calls.filter(
          (call) =>
            call.suffix === "/execute" && !call.body.adapter_id.endsWith("-migration-inventory"),
        ).length,
        0,
      )
    } else {
      assert.equal(
        (await runAdmittedMigrations(options)).migrations_applied,
        Object.keys(manifest.migrations).length,
      )
    }
  }
})
