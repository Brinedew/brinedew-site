import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, existsSync } from "node:fs"
import { runAdmittedMigrations } from "./run-admitted-d1-migrations.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"

// The admitted runner executes pending reviewed migrations through the cost
// authority during an explicit maintenance release. Its job does not depend on
// which migration is pending, so these tests drive it with synthetic plans and
// a fake authority. Failure modes, written first:
// 1. An unreviewed pending migration, or one whose adapter belongs to another
//    database, reaches DDL.
// 2. DDL is sent before every database's pending set has been checked.
// 3. A migration executes before its plan is registered, or under the wrong
//    release identity.
// 4. An active transition runs more than one staged migration in a release, or
//    does not say that more remain.
// 5. A protocol the runner does not implement is executed as an ordinary one.
// 6. A journaled name the source does not know (diverged or duplicated
//    history) is accepted.
// 7. An empty plan applies something or skips the inventories.
const manifest = JSON.parse(
  readFileSync(new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url)),
)
const synthetic = (adapterId, extra = {}) => ({
  adapter_id: adapterId,
  arguments: { max_schema_rows: 512 },
  prediction: { rows_read: 3000, rows_written: 16, requests: 1 },
  ...extra,
})
const STAGED = "one-migration-per-release-v1"
const plainPlan = {
  ...manifest,
  migrations: {
    "iconoplasm/9001_a.sql": synthetic("iconoplasm-migration-9001"),
    "iconoplasm/9002_b.sql": synthetic("iconoplasm-migration-9002"),
    "iconoplasm-authoring/9003_c.sql": synthetic("iconoplasm-authoring-migration-9003"),
  },
}
const stagedPlan = {
  ...manifest,
  migrations: Object.fromEntries(
    Object.entries(plainPlan.migrations).map(([key, value]) => [
      key,
      { ...value, migration_protocol: STAGED },
    ]),
  ),
}
const emptyPlan = { ...manifest, migrations: {} }
const resources = ["geneguessr", "iconoplasm", "iconoplasm-authoring"]
const directories = {
  geneguessr: "migrations",
  iconoplasm: "migrations-iconoplasm",
  "iconoplasm-authoring": "migrations-iconoplasm-authoring",
}

function harness(extra = false, plan = plainPlan) {
  const calls = []
  const adapters = resources.map((resource) => ({
    id: resource + "-migration-inventory",
    resource,
    query_ids: ["applied-migrations", "schema-objects"],
    ...OPERATION_COST_IDENTITIES,
  }))
  for (const [key, item] of Object.entries(plan.migrations))
    adapters.push({
      id: item.adapter_id,
      resource: key.split("/")[0],
      migration_protocol: item.migration_protocol,
      ...OPERATION_COST_IDENTITIES,
    })
  return {
    calls,
    options: {
      manifest: plan,
      releaseId: "test-release",
      files: (directory) => {
        if (directory === "workers/benchmark/migrations") return []
        const resource = resources.find((resource) => directories[resource] === directory)
        return [
          "0001.sql",
          ...Object.keys(plan.migrations)
            .filter((key) => key.startsWith(resource + "/"))
            .map((key) => key.split("/")[1]),
          ...(extra && resource === "iconoplasm-authoring" ? ["9999-unreviewed.sql"] : []),
        ].sort()
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

test("a standard D1 migration already in the journal needs no custom release adapter", async () => {
  const migration = "0018_assignment_manifestation_lookup.sql"
  assert.ok(existsSync(new URL(`../migrations-iconoplasm-authoring/${migration}`, import.meta.url)))
  assert.equal(manifest.migrations[`iconoplasm-authoring/${migration}`], undefined)
  const h = harness()
  const originalFiles = h.options.files
  const originalSend = h.options.send
  h.options.files = (directory) =>
    directory === "migrations-iconoplasm-authoring"
      ? [...originalFiles(directory), migration]
      : originalFiles(directory)
  h.options.send = async (...args) => {
    const result = await originalSend(...args)
    if (
      args[0] === "/execute" &&
      args[2]?.adapter_id === "iconoplasm-authoring-migration-inventory" &&
      args[2]?.arguments?.statements?.[0]?.query_id === "applied-migrations"
    )
      result.result[0].results.push({ id: 2, name: migration })
    return result
  }
  const result = await runAdmittedMigrations({ ...h.options, inventoryOnly: true })
  assert.ok(!result.pending_migrations.includes(`iconoplasm-authoring/${migration}`))
  assert.equal(
    h.calls.filter(
      (call) =>
        call.suffix === "/execute" && !call.body.adapter_id.endsWith("-migration-inventory"),
    ).length,
    0,
  )
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
  assert.ok(
    registrations.filter((plan) => plan.adapter_id.endsWith("-migration-inventory")).length >= 3,
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
  assert.equal(result.migrations_applied, Object.keys(options.manifest.migrations).length)
  assert.equal(result.evidence.length, Object.keys(options.manifest.migrations).length + 3)
  for (let index = 0; index < calls.length; index++) {
    if (calls[index].suffix !== "/register") continue
    assert.equal(calls[index + 1].suffix, "/execute")
    assert.equal(calls[index].body.id, calls[index + 1].body.operation_id)
  }
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
  assert.deepEqual(
    result.pending_migrations.sort(),
    Object.keys(options.manifest.migrations).sort(),
  )
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
        Object.keys(options.manifest.migrations).length,
      )
    }
  }
})

test("an active transition stages exactly one reviewed migration and reports that more remain", async () => {
  const { options, calls } = harness(false, stagedPlan)
  const result = await runAdmittedMigrations(options)
  assert.equal(result.migrations_applied, 1)
  assert.equal(result.continuation_required, true)
  assert.deepEqual(
    calls
      .filter(
        (call) =>
          call.suffix === "/execute" && !call.body.adapter_id.endsWith("-migration-inventory"),
      )
      .map((call) => call.body.adapter_id),
    ["iconoplasm-migration-9001"],
  )
})

test("a protocol the runner does not implement refuses before any DDL", async () => {
  for (const protocol of ["admin-count-seed-v1", "unreviewed-protocol"]) {
    const plan = {
      ...plainPlan,
      migrations: {
        ...plainPlan.migrations,
        "iconoplasm/9001_a.sql": {
          ...plainPlan.migrations["iconoplasm/9001_a.sql"],
          migration_protocol: protocol,
        },
      },
    }
    const { options, calls } = harness(false, plan)
    await assert.rejects(runAdmittedMigrations(options), /COST_MIGRATION_PROTOCOL_INVALID/)
    assert.equal(
      calls.filter(
        (call) =>
          call.suffix === "/execute" && !call.body.adapter_id.endsWith("-migration-inventory"),
      ).length,
      0,
    )
  }
})

test("an empty plan reads the three inventories and applies nothing", async () => {
  const { options, calls } = harness(false, emptyPlan)
  const result = await runAdmittedMigrations(options)
  assert.equal(result.migrations_applied, 0)
  assert.equal(result.continuation_required, false)
  assert.equal(result.evidence.length, 3)
  assert.deepEqual(
    calls.filter((call) => call.suffix === "/execute").map((call) => call.body.adapter_id),
    resources.map((resource) => `${resource}-migration-inventory`),
  )
})
