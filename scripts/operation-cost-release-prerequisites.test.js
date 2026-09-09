import assert from "node:assert/strict"
import test from "node:test"
import {
  inspectMigrationSizes,
  migrationSizePrerequisites,
} from "./operation-cost-release-prerequisites.mjs"

const pending = [
  { adapter_id: "iconoplasm-migration-0096", arguments: { max_notifications: 3000 } },
  { adapter_id: "iconoplasm-authoring-migration-0016", arguments: { max_assignments: 1000 } },
]

async function inspect(counts) {
  const calls = []
  const probes = migrationSizePrerequisites(pending)
  const capabilities = {
    adapters: probes.map((probe) => ({
      id: probe.adapter_id,
      resource: probe.resource,
      query_ids: [probe.query],
      executable_sha256: "a".repeat(64),
      schema_sha256: "b".repeat(64),
    })),
  }
  const promise = inspectMigrationSizes({
    pending,
    capabilities,
    releaseId: "inspection",
    now: Date.now(),
    send: async (path, method, body) => {
      calls.push({ path, body })
      if (path === "/receipt") throw new Error("COST_PREDICTION_NOT_REGISTERED")
      if (path === "/register") return { plan: body }
      const probe = probes.find((item) => item.adapter_id === body.adapter_id)
      return {
        result: [{ results: [{ capped_count: counts[probe.resource] }] }],
        usage: { rows_read: 4, rows_written: 0 },
      }
    },
  })
  return { promise, calls }
}

test("pending source probes accept exact boundary and reserve only read-only inventory", async () => {
  const { promise, calls } = await inspect({ iconoplasm: 3000, "iconoplasm-authoring": 1000 })
  assert.equal((await promise).length, 2)
  assert.ok(
    calls
      .filter((item) => item.path === "/register")
      .every(
        (item) =>
          item.body.adapter_id.endsWith("-migration-inventory") &&
          item.body.prediction.rows_written === 0,
      ),
  )
})

test("oversized or malformed source refuses before reserving later migration work", async () => {
  for (const count of [3001, undefined, -1, 1.2]) {
    const { promise, calls } = await inspect({ iconoplasm: count, "iconoplasm-authoring": 0 })
    await assert.rejects(promise, /COST_MIGRATION_(SOURCE_TOO_LARGE|PREREQUISITE_INVALID)/)
    assert.equal(calls.filter((item) => item.path === "/execute").length, 1)
  }
})

test("already applied migrations do not probe obsolete sources and changed envelopes fail closed", () => {
  assert.deepEqual(migrationSizePrerequisites([]), [])
  assert.throws(
    () => migrationSizePrerequisites([{ ...pending[0], arguments: { max_notifications: 3001 } }]),
    /ENVELOPE_CHANGED/,
  )
})

test("multiple source probes on one database keep separate predictions and retry identities", async () => {
  const work = [
    {
      adapter_id: "iconoplasm-migration-0099",
      arguments: { max_rows: 25000, max_unfinished: 5000 },
    },
  ]
  const probes = migrationSizePrerequisites(work)
  const plans = new Map()
  const adapter = {
    id: "iconoplasm-migration-inventory",
    resource: "iconoplasm",
    query_ids: probes.map((p) => p.query),
    executable_sha256: "a".repeat(64),
    schema_sha256: "b".repeat(64),
  }
  let executes = 0
  const options = {
    pending: work,
    capabilities: { adapters: [adapter] },
    releaseId: "inspect-two-sources",
    now: Date.now(),
    send: async (path, method, body) => {
      if (path === "/receipt") {
        if (!plans.has(body.id)) throw new Error("COST_PREDICTION_NOT_REGISTERED")
        return { plan: { id: body.id, immutable: plans.get(body.id), steps: {}, status: "active" } }
      }
      if (path === "/register") {
        plans.set(body.id, body)
        return { plan: body }
      }
      executes++
      const probe = probes.find((p) => p.query === body.arguments.statements[0].query_id)
      return {
        result: [{ results: [{ capped_count: probe.maximum }] }],
        usage: { rows_read: probe.maximum, rows_written: 0 },
      }
    },
  }
  await inspectMigrationSizes(options)
  await inspectMigrationSizes(options)
  assert.equal(plans.size, 2)
  assert.equal(executes, 4)
  assert.deepEqual(
    [...plans.values()].map((p) => p.prediction.rows_read),
    [25001, 5001],
  )
})
