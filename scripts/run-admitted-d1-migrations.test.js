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
    ...OPERATION_COST_IDENTITIES,
  }))
  for (const [key, item] of Object.entries(manifest.migrations))
    adapters.push({
      id: item.adapter_id,
      resource: key.split("/")[0],
      ...OPERATION_COST_IDENTITIES,
    })
  return {
    calls,
    options: {
      manifest,
      releaseId: "test-release",
      files: (directory) => {
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
        if (suffix === "/receipt") throw new Error("COST_PREDICTION_NOT_REGISTERED")
        if (suffix === "/register") return { plan: { id: body.id } }
        return {
          result: body.adapter_id.endsWith("-migration-inventory")
            ? [{ results: [{ id: 1, name: "0001.sql" }] }]
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
  assert.equal(result.migrations_applied, 4)
  assert.equal(result.evidence.length, 7)
  for (let index = 2; index < calls.length; index += 3) {
    assert.equal(calls[index].suffix, "/register")
    assert.equal(calls[index + 1].suffix, "/execute")
    assert.equal(calls[index].body.id, calls[index + 1].body.operation_id)
  }
})
