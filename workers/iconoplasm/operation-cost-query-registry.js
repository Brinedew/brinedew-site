import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  GLOBAL_FINALIZATION_SUMMARY_SQL,
  SCOPED_FINALIZATION_SUMMARY_SQL,
} from "./sync-finalization-summary.js"

// Cost proofs belong beside their exact SQL and schema tests. A result LIMIT
// never establishes a read bound. New queries must enter this registry before
// an operator can execute them against production.
export function createOperationCostQueryRegistry() {
  return new Map([
    [
      "finalization-summary",
      {
        sql: GLOBAL_FINALIZATION_SUMMARY_SQL,
        prepare(args) {
          if (args && Object.keys(args).length)
            throw new OperationCostError("COST_QUERY_ARGUMENTS_INVALID")
          // Migration 0094: one singleton PK plus one terminal covering-index
          // entry. Allow 32 billed row visits; completed history is never scanned.
          return { parameters: [], rows_read: 32, rows_written: 0 }
        },
      },
    ],
    [
      "finalization-summary-for-symbols",
      {
        sql: SCOPED_FINALIZATION_SUMMARY_SQL,
        prepare(args) {
          const symbols = args?.symbols
          if (
            !Array.isArray(symbols) ||
            !symbols.length ||
            symbols.length > 5000 ||
            Object.keys(args).some((key) => key !== "symbols") ||
            !symbols.every(
              (symbol) => typeof symbol === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(symbol),
            )
          ) {
            throw new OperationCostError("COST_QUERY_ARGUMENTS_INVALID")
          }
          // Each JSON member makes one unique gene-symbol index lookup and at
          // most one table-row visit. Account for the JSON cursor and aggregate
          // overhead too; work scales with input, never completed-history size.
          return {
            parameters: [JSON.stringify(symbols)],
            rows_read: 32 + 16 * symbols.length,
            rows_written: 0,
          }
        },
      },
    ],
  ])
}
