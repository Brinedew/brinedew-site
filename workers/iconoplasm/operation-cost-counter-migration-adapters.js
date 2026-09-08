import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  CANONICAL_LIFECYCLE_GUARDS_MIGRATION_NAME,
  CANONICAL_LIFECYCLE_GUARDS_MIGRATION_STATEMENTS,
  INBOX_COUNTERS_MIGRATION_NAME,
  INBOX_COUNTERS_MIGRATION_STATEMENTS,
  DELIVERY_CURSOR_MIGRATION_NAME,
  DELIVERY_CURSOR_MIGRATION_STATEMENTS,
  ASSIGNMENT_LOOKUP_MIGRATION_NAME,
  ASSIGNMENT_LOOKUP_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// Fixed server-owned SQL only. Each size guard stops at its envelope plus one;
// guards, DDL, seed and journal insertion execute in one atomic D1 batch.
const specifications = {
  canonicalLifecycleGuards: {
    resource: "iconoplasm-authoring",
    name: CANONICAL_LIFECYCLE_GUARDS_MIGRATION_NAME,
    sql: CANONICAL_LIFECYCLE_GUARDS_MIGRATION_STATEMENTS,
    tables: {},
    writes: () => 32,
    readPasses: 0,
  },
  assignmentLookup: {
    resource: "iconoplasm-authoring",
    name: ASSIGNMENT_LOOKUP_MIGRATION_NAME,
    sql: ASSIGNMENT_LOOKUP_MIGRATION_STATEMENTS,
    tables: { max_assignments: "icono_caretaker_assignments" },
    writes: (args) => args.max_assignments + 32,
    readPasses: 4,
  },
  deliveryCursor: {
    name: DELIVERY_CURSOR_MIGRATION_NAME,
    sql: DELIVERY_CURSOR_MIGRATION_STATEMENTS,
    tables: {},
    writes: () => 32,
    readPasses: 0,
  },
  inbox: {
    name: INBOX_COUNTERS_MIGRATION_NAME,
    sql: INBOX_COUNTERS_MIGRATION_STATEMENTS,
    tables: { max_notifications: "icono_request_notifications" },
    // Two notification indexes, at most four inbox writes per sent receipt.
    // Each two-write delivery group needs an eligible, non-sent member, so its
    // seed cannot overlap that member's inbox work. Include DDL/journal rows.
    writes: (args) => 6 * args.max_notifications + 512,
    readPasses: 16,
  },
}

function createCounterMigrationAdapter(kind, { db, executable_sha256, schema_sha256 }) {
  const specification = specifications[kind]
  return {
    resource: specification.resource || "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      const keys = [...Object.keys(specification.tables), "max_schema_rows"].sort()
      if (
        !args ||
        Object.keys(args).sort().join() !== keys.join() ||
        keys.some(
          (key) =>
            !Number.isSafeInteger(args[key]) ||
            args[key] < 0 ||
            args[key] > (key === "max_schema_rows" ? 1024 : 1000000),
        ) ||
        args.max_schema_rows < 1
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
      ]
      for (const [key, table] of Object.entries(specification.tables)) {
        statements.push(
          {
            sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE name=? AND type='table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%')
            THEN 1 ELSE json('COST_MIGRATION_SCHEMA_CHANGED') END AS admitted`,
            parameters: [table],
          },
          {
            sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM ${table} LIMIT ?)) <= ?
            THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted`,
            parameters: [args[key] + 1, args[key]],
          },
        )
      }
      statements.push(...specification.sql.map((sql) => ({ sql, parameters: [] })), {
        sql: "INSERT INTO d1_migrations(name) VALUES (?)",
        parameters: [specification.name],
      })
      // Capped guards + indexed seed joins + input/index cursor visits. The
      // inbox seed pins notifications as the outer cursor, so request/asset
      // history cannot multiply this envelope. Schema visits include every DDL.
      const bound = {
        rows_read:
          specification.readPasses *
            Object.keys(specification.tables).reduce((sum, key) => sum + args[key] + 1, 0) +
          64 * args.max_schema_rows +
          256,
        rows_written: specification.writes(args),
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      return { statements, bound, sha256 }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: specification.name, applied: true }, actual }
    },
  }
}

export const createInboxCountersMigrationCostAdapter = (options) =>
  createCounterMigrationAdapter("inbox", options)
export const createDeliveryCursorMigrationCostAdapter = (options) =>
  createCounterMigrationAdapter("deliveryCursor", options)

export const createAssignmentLookupMigrationCostAdapter = (options) =>
  createCounterMigrationAdapter("assignmentLookup", options)

export const createCanonicalLifecycleGuardsMigrationCostAdapter = (options) =>
  createCounterMigrationAdapter("canonicalLifecycleGuards", options)
