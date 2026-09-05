import assert from "node:assert/strict"
import test from "node:test"
import { createOperationCostD1Adapter } from "./operation-cost-d1-adapter.js"

function fixture() {
  const batches = []
  const registry = new Map([
    [
      "lookup",
      {
        sql: "SELECT value FROM example WHERE id = ?",
        prepare(args) {
          if (!Number.isSafeInteger(args?.id) || args.id < 1) throw new Error("invalid identity")
          return { parameters: [args.id], rows_read: 2, rows_written: 0 }
        },
      },
    ],
  ])
  const db = {
    prepare(sql) {
      return {
        bind(...parameters) {
          return { sql, parameters }
        },
      }
    },
    async batch(statements) {
      batches.push(statements)
      return statements.map(() => ({
        success: true,
        results: [{ value: "found" }],
        meta: { rows_read: 1, rows_written: 0 },
      }))
    },
  }
  const adapter = createOperationCostD1Adapter({
    db,
    registry,
    resource: "example",
    executable_sha256: "a".repeat(64),
    schema_sha256: "b".repeat(64),
  })
  return { adapter, batches, db }
}

test("D1 adapter prepares a whole transaction without accessing D1 and hashes exact bound arguments", async () => {
  const { adapter, batches } = fixture()
  const input = {
    statements: [
      { query_id: "lookup", arguments: { id: 1 } },
      { query_id: "lookup", arguments: { id: 2 } },
    ],
  }
  const prepared = await adapter.prepare(input)
  assert.equal(batches.length, 0)
  assert.deepEqual(prepared.bound, { rows_read: 4, rows_written: 0, requests: 1 })
  assert.equal(prepared.sha256, (await adapter.prepare(input)).sha256)
  input.statements[1].arguments.id = 3
  assert.notEqual(prepared.sha256, (await adapter.prepare(input)).sha256)
  assert.deepEqual(prepared.statements[1].parameters, [2])
  const receipt = await adapter.dispatch(prepared)
  assert.equal(batches.length, 1)
  assert.deepEqual(receipt.actual, { rows_read: 2, rows_written: 0, requests: 1 })
})

test("D1 adapter rejects arbitrary SQL, unknown queries, oversized transactions and invalid arguments before dispatch", async () => {
  const { adapter, batches } = fixture()
  const valid = { query_id: "lookup", arguments: { id: 1 } }
  for (const input of [
    null,
    {},
    { statements: [] },
    { statements: Array(33).fill(valid) },
    { statements: [{ ...valid, sql: "DELETE FROM example" }] },
    { statements: [{ query_id: "arbitrary", arguments: {} }] },
    { statements: [{ query_id: "lookup", arguments: { id: "1 OR 1=1" } }] },
    { statements: [{ query_id: "lookup", arguments: { id: 1, padding: "x".repeat(65_536) } }] },
  ]) {
    await assert.rejects(adapter.prepare(input))
  }
  assert.equal(batches.length, 0)
})

test("D1 adapter requires complete provider receipts for every statement", async () => {
  const { adapter, db } = fixture()
  const prepared = await adapter.prepare({
    statements: [{ query_id: "lookup", arguments: { id: 1 } }],
  })
  for (const result of [
    null,
    [],
    [{ success: true }],
    [{ success: false, meta: { rows_read: 0, rows_written: 0 } }],
    [{ success: true, meta: { rows_read: 1, rows_written: NaN } }],
  ]) {
    db.batch = async () => result
    await assert.rejects(adapter.dispatch(prepared), /RECEIPT_MISSING/)
  }
})
