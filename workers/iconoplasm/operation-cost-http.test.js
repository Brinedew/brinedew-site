import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  runAdmittedCatalogInitialization,
  runAdmittedCatalogPreparation,
} from "../../scripts/run-admitted-catalog-initialization.mjs"
import { createOperationCostAuthority, OPERATION_COST_ROUTE_PREFIX } from "./operation-cost-http.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function fixture({ migrated = true, kv, initializeCatalog, kvUsage = {} } = {}) {
  const clock = Date.parse("2026-09-06T12:00:00Z")
  const local = new DatabaseSync(":memory:")
  const provider = new DatabaseSync(":memory:")
  for (const name of ["0028_add_finalization_jobs.sql", "0094_finalization_summary.sql"]) {
    if (!migrated && name.startsWith("0094")) continue
    provider.exec(
      readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8"),
    )
  }
  provider.exec(
    "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
  )
  const storage = {
    sql: {
      exec(sql, ...args) {
        const statement = local.prepare(sql)
        if (statement.columns().length) return { toArray: () => statement.all(...args) }
        statement.run(...args)
        return { toArray: () => [] }
      },
    },
    transactionSync(fn) {
      local.exec("BEGIN IMMEDIATE")
      try {
        const result = fn()
        local.exec("COMMIT")
        return result
      } catch (error) {
        local.exec("ROLLBACK")
        throw error
      }
    },
  }
  const calls = []
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return { sql, args }
        },
      }
    },
    async batch(statements) {
      calls.push(statements)
      provider.exec("BEGIN IMMEDIATE")
      try {
        const results = statements.map(({ sql, args }) => {
          const statement = provider.prepare(sql)
          return {
            success: true,
            results: statement.columns().length ? statement.all(...args) : statement.run(...args),
            meta: { rows_read: 2, rows_written: 0 },
          }
        })
        provider.exec("COMMIT")
        return results
      } catch (error) {
        provider.exec("ROLLBACK")
        throw error
      }
    },
  }
  const usage = {
    current: () => ({
      day: "2026-09-06",
      measured_at: clock,
      rows_read: 0,
      rows_written: 0,
      requests: 0,
      kv_measured_at: clock,
      kv_reads: 0,
      kv_writes: 0,
      kv_deletes: 0,
      kv_lists: 0,
      ...kvUsage,
    }),
    refresh: async () => {},
  }
  const authority = createOperationCostAuthority(
    storage,
    { ICONOPLASM_DB: db, KV: kv },
    { usage, now: () => clock, initializeCatalog },
  )
  authority.initialize()
  const request = (suffix, input) =>
    new Request(`https://iconoplasm.brinedew.bio${OPERATION_COST_ROUTE_PREFIX}${suffix}`, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-iconoplasm-cost-principal": "admin" },
      body: input === undefined ? undefined : JSON.stringify(input),
    })
  return {
    authority,
    calls,
    db,
    local,
    provider,
    clock,
    request,
    close: () => {
      local.close()
      provider.close()
    },
  }
}

test("catalog preparation and later release retries do not replay an already verified publication", async () => {
  for (const initiallyReady of [true, false]) {
    let ready = initiallyReady,
      writes = 0
    const f = fixture({
      kv: {
        get: async () => "{}",
        put: async () => {
          writes++
        },
      },
      initializeCatalog: async (kv, { inspectOnly }) => {
        for (let i = 0; i < 5; i++) await kv.get(`key-${i}`)
        const changed = !ready
        if (changed && !inspectOnly) {
          await kv.put("iconoplasm:hydrated-catalog-artifact:test", "{}")
          ready = true
        }
        return { build_version: "test", gene_count: 1, changed }
      },
    })
    const registrations = []
    const send = async (suffix, method, body) => {
      if (suffix === "/register") registrations.push(body.id)
      const response = await f.authority.fetch(f.request(suffix, body))
      const result = await response.json()
      if (!response.ok) throw new Error(result.code)
      return result
    }
    try {
      const options = {
        prediction: {
          rows_read: 0,
          rows_written: 0,
          requests: 2,
          kv_reads: 5,
          kv_writes: 1,
          kv_deletes: 0,
          kv_lists: 0,
        },
        releaseId: "original",
        send,
        now: f.clock,
      }
      await runAdmittedCatalogPreparation({ ...options, inspectionId: "first" })
      await runAdmittedCatalogPreparation({ ...options, inspectionId: "later-release-retry" })
      assert.equal(writes, initiallyReady ? 0 : 1)
      assert.equal(
        registrations.filter((id) => id.startsWith("original-")).length,
        initiallyReady ? 0 : 1,
      )
      assert.equal(f.calls.length, 0)
    } finally {
      f.close()
    }
  }
})

test("capacity is admin-only, uncached and consumes no D1 queries", async () => {
  const f = fixture()
  try {
    const response = await f.authority.fetch(f.request("/capacity"))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    const value = await response.json()
    assert.equal(value.remaining.rows_read, 1_000_000)
    assert.equal(value.used.requests, 1)
    const replica = f.request("/capacity")
    replica.headers.set("x-iconoplasm-cost-principal", "replica")
    assert.equal((await f.authority.fetch(replica)).status, 403)
    assert.equal(f.calls.length, 0)
  } finally {
    f.close()
  }
})

test("authenticated catalog release shares retry ceilings and rejects unsafe initialization before KV", async () => {
  const prediction = {
    rows_read: 0,
    rows_written: 0,
    requests: 2,
    kv_reads: 5,
    kv_writes: 1,
    kv_deletes: 0,
    kv_lists: 0,
  }
  for (const scenario of [
    "success",
    "D1 exhausted",
    "KV deletes exhausted",
    "underestimate",
    "stale",
    "exhausted",
    "failure",
    "bad-receipt",
  ]) {
    let reads = 0,
      writes = 0,
      forwards = 0
    const f = fixture({
      kv: {
        get: async () => {
          reads++
          return "{}"
        },
        put: async () => {
          writes++
        },
      },
      kvUsage:
        scenario === "D1 exhausted"
          ? { rows_read: 8_000_000, rows_written: 100_000 }
          : scenario === "KV deletes exhausted"
            ? { kv_deletes: 1000 }
            : scenario === "stale"
              ? { kv_measured_at: 0 }
              : scenario === "exhausted"
                ? { kv_writes: 1000 }
                : {},
      initializeCatalog: async (kv) => {
        for (let i = 0; i < 5; i++) await kv.get(`key-${i}`)
        await kv.put("iconoplasm:hydrated-catalog-artifact:test", "{}")
        if (scenario === "failure") throw new Error("provider failure")
        return scenario === "bad-receipt"
          ? {}
          : { build_version: "test", gene_count: 1, changed: true }
      },
    })
    try {
      const env = {
        ICONOPLASM_ADMIN_TOKEN: "test-only",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
          idFromName: () => "global",
          get: () => ({
            fetch: (request) => {
              forwards++
              return f.authority.fetch(request)
            },
          }),
        },
      }
      const send = async (suffix, method, input) => {
        const request = f.request(suffix, input)
        request.headers.set("x-iconoplasm-admin-token", "test-only")
        const response = await gateway(request, env)
        const body = await response.json()
        if (!response.ok) throw new Error(body.code || body.error)
        return body
      }
      const run = () =>
        runAdmittedCatalogInitialization({
          prediction: scenario === "underestimate" ? { ...prediction, kv_reads: 1 } : prediction,
          releaseId: "catalog-release",
          send,
          now: f.clock,
        })
      assert.equal((await gateway(f.request("/execute", {}), env)).status, 403)
      assert.equal(forwards, 0)
      if (["success", "D1 exhausted", "KV deletes exhausted"].includes(scenario)) {
        assert.equal((await run()).result.changed, true)
        await run()
        await assert.rejects(run(), /COST_/)
        assert.equal(reads, 10)
        assert.equal(writes, 2)
      } else {
        await assert.rejects(run())
        if (["underestimate", "stale", "exhausted"].includes(scenario)) {
          assert.equal(reads, 0)
          assert.equal(writes, 0)
        } else {
          assert.equal(reads, 5)
          assert.equal(writes, 1)
        }
      }
      assert.equal(f.calls.length, 0)
    } finally {
      f.close()
    }
  }
})

test("HTTP authority denies unplanned/underestimated work, then executes a fitting registered operation without owner approval", async () => {
  const f = fixture()
  try {
    const capabilities = await (await f.authority.fetch(f.request(""))).json()
    const adapter = capabilities.adapters.find((adapter) => adapter.id === "iconoplasm-d1")
    const execution = {
      operation_id: "first",
      adapter_id: adapter.id,
      step_id: "read-status",
      arguments: { statements: [{ query_id: "finalization-summary", arguments: {} }] },
    }
    assert.equal((await f.authority.fetch(f.request("/execute", execution))).status, 428)
    const plan = {
      ...adapter,
      id: "first",
      adapter_id: adapter.id,
      prediction: { rows_read: 1, rows_written: 0, requests: 1 },
      expires_at: f.clock + 60_000,
    }
    assert.equal((await f.authority.fetch(f.request("/register", plan))).status, 201)
    assert.equal((await f.authority.fetch(f.request("/execute", execution))).status, 429)
    assert.equal(f.calls.length, 0)
    assert.equal(
      (
        await f.authority.fetch(
          f.request("/register", {
            ...plan,
            id: "corrected",
            prediction: { rows_read: 16, rows_written: 0, requests: 1 },
          }),
        )
      ).status,
      201,
    )
    const result = await f.authority.fetch(
      f.request("/execute", { ...execution, operation_id: "corrected" }),
    )
    assert.equal(result.status, 200)
    const body = await result.json()
    assert.equal(body.result[0].results[0].unfinished_count, 0)
    assert.equal(body.usage.rows_read, 2)
    assert.equal(f.calls.length, 1)
    assert.equal(
      (await f.authority.fetch(f.request("/execute", { ...execution, operation_id: "corrected" })))
        .status,
      400,
    )
    assert.equal(f.calls.length, 1)
    for (const path of ["/reserve", "/settle"])
      assert.equal((await f.authority.fetch(f.request(path, {}))).status, 404)
  } finally {
    f.close()
  }
})

test("real Worker gateway authenticates before authority/provider access and forwards a missing prediction to the mandatory refusal", async () => {
  const f = fixture()
  try {
    let forwards = 0
    const env = {
      ICONOPLASM_ADMIN_TOKEN: "test-only",
      ICONOPLASM_DB: f.db,
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
        idFromName: () => "global",
        get: () => ({
          fetch: (request) => {
            forwards++
            return f.authority.fetch(request)
          },
        }),
      },
    }
    const unauthed = await gateway(f.request("/execute", {}), env)
    assert.equal(unauthed.status, 403)
    assert.equal(forwards, 0)
    const request = f.request("/execute", { operation_id: "missing", adapter_id: "iconoplasm-d1" })
    request.headers.set("x-iconoplasm-admin-token", "test-only")
    const refused = await gateway(request, env)
    assert.equal(refused.status, 428)
    assert.equal(forwards, 1)
    const capacityRequest = f.request("/capacity")
    capacityRequest.headers.set("x-iconoplasm-admin-token", "test-only")
    const capacity = await gateway(capacityRequest, env)
    assert.equal(capacity.status, 200)
    assert.equal((await capacity.json()).remaining.rows_read, 1_000_000)
    assert.equal(forwards, 2)
    assert.equal(f.calls.length, 0)
  } finally {
    f.close()
  }
})

test("migration uses the same HTTP prediction gate and a query plan cannot be rebound to DDL", async () => {
  const f = fixture({ migrated: false })
  try {
    const capabilities = await (await f.authority.fetch(f.request(""))).json()
    const adapter = capabilities.adapters.find(
      (adapter) => adapter.id === "iconoplasm-migration-0094",
    )
    const plan = {
      ...adapter,
      id: "migration",
      adapter_id: adapter.id,
      prediction: { rows_read: 5000, rows_written: 300, requests: 1 },
      expires_at: f.clock + 60_000,
    }
    const execution = {
      operation_id: plan.id,
      adapter_id: adapter.id,
      step_id: "apply",
      arguments: { max_rows: 1, max_unfinished: 0 },
    }
    assert.equal((await f.authority.fetch(f.request("/execute", execution))).status, 428)
    assert.equal(f.calls.length, 0)
    assert.equal((await f.authority.fetch(f.request("/register", plan))).status, 201)
    assert.equal(
      (
        await f.authority.fetch(
          f.request("/execute", { ...execution, adapter_id: "iconoplasm-d1" }),
        )
      ).status,
      400,
    )
    assert.equal(f.calls.length, 0)
    const result = await f.authority.fetch(f.request("/execute", execution))
    assert.equal(result.status, 200)
    assert.equal((await result.json()).result.applied, true)
    assert.equal(f.calls.length, 1)
    assert.equal(f.provider.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n, 1)
  } finally {
    f.close()
  }
})

test("replica credentials cannot inherit admin plans or forge the internal principal header", async () => {
  const f = fixture()
  try {
    const capabilities = await (await f.authority.fetch(f.request(""))).json()
    const adapter = capabilities.adapters.find((item) => item.id === "iconoplasm-d1")
    const plan = {
      ...adapter,
      id: "admin-only",
      adapter_id: adapter.id,
      prediction: { rows_read: 16, rows_written: 0, requests: 1 },
      expires_at: f.clock + 60_000,
    }
    assert.equal((await f.authority.fetch(f.request("/register", plan))).status, 201)
    for (const [suffix, input] of [
      ["/register", { ...plan, id: "forged", principal: "admin" }],
      ["/receipt", { id: plan.id }],
    ]) {
      const request = f.request(suffix, input)
      request.headers.set("x-iconoplasm-cost-principal", "replica")
      assert.equal((await f.authority.fetch(request)).status, 403)
    }
    const env = {
      ICONOPLASM_AUTHORITY_REPLICA_TOKEN: "test-replica",
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
        idFromName: () => "global",
        get: () => ({ fetch: (request) => f.authority.fetch(request) }),
      },
    }
    const request = f.request("")
    request.headers.set("Authorization", "Bearer test-replica")
    // f.request carries the forged admin attribution; the external gateway
    // must replace it with the authenticated replica audience.
    const result = await gateway(request, env)
    assert.equal(result.status, 200)
    assert.deepEqual(
      (await result.json()).adapters.map((item) => item.id),
      ["authority-replica"],
    )
    assert.equal(f.calls.length, 0)
  } finally {
    f.close()
  }
})
