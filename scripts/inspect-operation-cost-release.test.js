import assert from "node:assert/strict"
import test from "node:test"
import { inspectReleaseSchema, waitForReleaseAdapters } from "./inspect-operation-cost-release.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"

function capabilities(identities = OPERATION_COST_IDENTITIES) {
  return {
    features: ["preserved-budget-continuation"],
    adapters: ["geneguessr", "iconoplasm", "iconoplasm-authoring"].map((resource) => ({
      id: `${resource}-migration-inventory`,
      resource,
      query_ids: ["schema-objects"],
      ...identities,
    })),
  }
}

test("schema inspection waits through old/new/old rollout before registering exact plans", async () => {
  const stale = capabilities({ executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) })
  const samples = [stale, capabilities(), stale, capabilities(), capabilities()]
  let probes = 0
  const plans = new Map()
  const executed = []
  const result = await inspectReleaseSchema({
    releaseId: "inspect-original-run-2",
    sleep: async () => {},
    send: async (path, method, body) => {
      if (path === "") {
        assert.equal(method, "GET")
        return samples[probes++]
      }
      assert.equal(probes, 5, "no schema or plan work before the release is stable")
      if (path === "/capacity") return { remaining: { rows_read: 1_000_000 } }
      if (path === "/receipt") throw new Error("COST_PREDICTION_NOT_REGISTERED")
      if (path === "/register") {
        for (const [key, value] of Object.entries(OPERATION_COST_IDENTITIES))
          assert.equal(body[key], value)
        assert.ok(body.id.startsWith("inspect-original-run-2-schema-"))
        plans.set(body.id, body)
        return { plan: body }
      }
      assert.equal(path, "/execute")
      assert.ok(plans.has(body.operation_id))
      executed.push(body.adapter_id)
      return { result: [{ results: [{ name: "icono_gene_catalog" }] }], usage: { rows_read: 1 } }
    },
  })
  assert.equal(result.schemas.length, 3)
  assert.equal(executed.length, 3)
  assert.equal(plans.size, 3)
})

test("an unchanged or mixed deployed version exhausts bounded discovery without registering", async () => {
  for (const sample of [
    capabilities({ ...OPERATION_COST_IDENTITIES, executable_sha256: "a".repeat(64) }),
    { adapters: [...capabilities().adapters, capabilities().adapters[0]] },
    { adapters: capabilities().adapters.slice(1) },
  ]) {
    let calls = 0
    let elapsed = 0
    await assert.rejects(
      waitForReleaseAdapters({
        send: async (path, method) => {
          assert.equal(path, "")
          assert.equal(method, "GET")
          calls++
          return sample
        },
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms
        },
      }),
      /COST_DEPLOYED_IMPLEMENTATION_NOT_READY/,
    )
    assert.equal(calls, 16)
    assert.equal(elapsed, 30_000)
  }
})

test("readiness respects elapsed deadline and never retries a transport failure", async () => {
  let elapsed = 0
  let calls = 0
  await assert.rejects(
    waitForReleaseAdapters({
      send: async () => {
        calls++
        elapsed += 31_000
        return capabilities()
      },
      now: () => elapsed,
      sleep: async (ms) => {
        elapsed += ms
      },
    }),
    /COST_DEPLOYED_IMPLEMENTATION_NOT_READY/,
  )
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(
    waitForReleaseAdapters({
      send: async () => {
        calls++
        throw new Error("transport lost")
      },
    }),
    /transport lost/,
  )
  assert.equal(calls, 1)
})
