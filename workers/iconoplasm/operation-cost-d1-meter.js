import { OperationCostError } from "../lib/operation-cost-ledger.js"

// Request-local wrapper for a reviewed domain operation. first() deliberately
// uses all() so its provider receipt is retained; application semantics stay
// unchanged. Only the executor can obtain this wrapper's underlying binding.
export function createOperationCostD1Meter(database) {
  const statements = new WeakMap()
  const actual = { rows_read: 0, rows_written: 0, requests: 1 }
  let pending = 0
  let uncertain = false
  let closed = false

  async function run(action) {
    if (closed || uncertain) throw new OperationCostError("COST_DATABASE_SCOPE_CLOSED")
    pending++
    try {
      const result = await action()
      for (const receipt of Array.isArray(result) ? result : [result]) {
        if (
          receipt?.success !== true ||
          ![receipt.meta?.rows_read, receipt.meta?.rows_written].every(
            (value) => Number.isSafeInteger(value) && value >= 0,
          )
        ) {
          throw new OperationCostError("COST_D1_RECEIPT_MISSING")
        }
        for (const meter of ["rows_read", "rows_written"]) {
          actual[meter] += receipt.meta[meter]
          if (!Number.isSafeInteger(actual[meter]))
            throw new OperationCostError("COST_D1_RECEIPT_INVALID")
        }
      }
      return result
    } catch (error) {
      uncertain = true
      throw error
    } finally {
      pending--
    }
  }

  function wrap(raw) {
    const statement = {
      bind: (...args) => wrap(raw.bind(...args)),
      all: () => run(() => raw.all()),
      run: () => run(() => raw.run()),
      async first(column) {
        const result = await run(() => raw.all())
        const row = result.results[0] || null
        if (column === undefined || row === null) return row
        if (!Object.hasOwn(row, column)) throw new Error("D1_COLUMN_NOTFOUND")
        return row[column]
      },
    }
    statements.set(statement, raw)
    return Object.freeze(statement)
  }

  return {
    db: Object.freeze({
      prepare(sql) {
        if (closed || uncertain) throw new OperationCostError("COST_DATABASE_SCOPE_CLOSED")
        return wrap(database.prepare(sql))
      },
      batch(batch) {
        if (
          !Array.isArray(batch) ||
          !batch.length ||
          batch.length > 128 ||
          batch.some((statement) => !statements.has(statement))
        ) {
          throw new OperationCostError("COST_DATABASE_BATCH_INVALID")
        }
        return run(async () => {
          const results = await database.batch(batch.map((statement) => statements.get(statement)))
          if (!Array.isArray(results) || results.length !== batch.length)
            throw new OperationCostError("COST_D1_RECEIPT_MISSING")
          return results
        })
      },
    }),
    finish() {
      closed = true
      if (uncertain || pending) throw new OperationCostError("COST_D1_RECEIPT_MISSING")
      return { ...actual }
    },
  }
}

export async function executeOperationCostD1Batch(database, prepared) {
  const meter = createOperationCostD1Meter(database)
  const result = await meter.db.batch(
    prepared.statements.map(({ sql, parameters }) => meter.db.prepare(sql).bind(...parameters)),
  )
  return { result, actual: meter.finish() }
}
