import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"

const MAX_BATCH_STATEMENTS = 32
const MAX_ARGUMENT_BYTES = 65_536

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function reject(code) {
  throw new OperationCostError(code)
}

// The registry is imported authority code with reviewed schema-specific bounds.
// Neither SQL, bounds, bindings nor receipts are accepted from the HTTP caller.
// All statements in a transaction are reserved together before D1 receives any.
export function createOperationCostD1Adapter({
  db,
  registry,
  executable_sha256,
  schema_sha256,
  resource,
}) {
  return {
    executable_sha256,
    schema_sha256,
    resource,
    query_ids: [...registry.keys()],
    async prepare(input) {
      if (
        !input ||
        !Array.isArray(input.statements) ||
        !input.statements.length ||
        input.statements.length > MAX_BATCH_STATEMENTS
      )
        reject("COST_D1_BATCH_INVALID")
      const encoded = JSON.stringify(input)
      if (new TextEncoder().encode(encoded).byteLength > MAX_ARGUMENT_BYTES)
        reject("COST_D1_ARGUMENT_LIMIT")
      const bound = { rows_read: 0, rows_written: 0, requests: 1 }
      const statements = input.statements.map((statement) => {
        if (
          !statement ||
          typeof statement.query_id !== "string" ||
          Object.keys(statement).some((key) => !["query_id", "arguments"].includes(key))
        )
          reject("COST_D1_STATEMENT_INVALID")
        const query = registry.get(statement.query_id)
        if (!query) reject("COST_D1_QUERY_NOT_VERIFIED")
        const prepared = query.prepare(statement.arguments)
        if (
          !prepared ||
          !Array.isArray(prepared.parameters) ||
          ![prepared.rows_read, prepared.rows_written].every(
            (cost) => Number.isSafeInteger(cost) && cost >= 0,
          )
        ) {
          reject("COST_D1_QUERY_BOUND_INVALID")
        }
        bound.rows_read += prepared.rows_read
        bound.rows_written += prepared.rows_written
        if (!Number.isSafeInteger(bound.rows_read) || !Number.isSafeInteger(bound.rows_written))
          reject("COST_D1_QUERY_BOUND_INVALID")
        return { sql: query.sql, parameters: prepared.parameters }
      })
      return {
        statements,
        bound,
        sha256: await sha256({ resource, schema_sha256, executable_sha256, statements }),
      }
    },
    dispatch: (prepared) => executeOperationCostD1Batch(db, prepared),
  }
}
