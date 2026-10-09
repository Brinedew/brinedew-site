// Test harness for the mutation-reservation receipts tests. It runs the real
// operation against a real D1 (Miniflare) holding the complete migrated schema,
// so every index and trigger bills exactly the rows the provider would bill,
// and it records how many rows the database had written when each admitted
// operation reserved and when it completed.
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

// seedRows copies the rows the migrations themselves insert (an authority
// singleton, registered terms), which the schema definitions alone do not carry.
export async function openMigratedD1(
  migrationDirectory = "../../migrations-iconoplasm/",
  { seedRows = false } = {},
) {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('reservation receipts')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
  const schema = new DatabaseSync(":memory:")
  try {
    const directory = new URL(migrationDirectory, import.meta.url)
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, directory), "utf8"))
    const db = await runtime.getD1Database("DB")
    const definitions = schema
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
      )
      .all()
    for (let offset = 0; offset < definitions.length; offset += 20)
      await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
    if (seedRows) {
      for (const { name } of schema
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()) {
        for (const row of schema.prepare(`SELECT * FROM "${name}"`).all()) {
          const columns = Object.keys(row)
          await db
            .prepare(
              `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
            )
            .bind(...Object.values(row))
            .run()
        }
      }
    }
    return {
      db,
      dispose: async () => {
        schema.close()
        await runtime.dispose()
      },
    }
  } catch (error) {
    schema.close()
    await runtime.dispose()
    throw error
  }
}

// A D1 whose running totals can be read at any moment. Unlike the operation-cost
// meter it never closes, so a reservation can be compared with the rows written
// between its own reserve and complete calls. With `trace`, every statement that
// ran is also kept with the rows it wrote (`statements`), so a test can say which
// statement wrote, not only how many rows a pass wrote.
export function liveD1Meter(database, { trace = false } = {}) {
  const totals = { rows_read: 0, rows_written: 0, calls: 0 }
  const statements = []
  const raws = new WeakMap()
  const count = (receipt, sql = "") => {
    for (const item of Array.isArray(receipt) ? receipt : [receipt]) {
      totals.rows_read += item?.meta?.rows_read || 0
      totals.rows_written += item?.meta?.rows_written || 0
      if (trace) statements.push({ sql, rows_written: item?.meta?.rows_written || 0 })
    }
    return receipt
  }
  function wrap(raw, sql) {
    const statement = {
      bind: (...args) => wrap(raw.bind(...args), sql),
      async all() {
        totals.calls += 1
        return count(await raw.all(), sql)
      },
      async run() {
        totals.calls += 1
        return count(await raw.run(), sql)
      },
      async first(column) {
        totals.calls += 1
        const result = count(await raw.all(), sql)
        const row = result.results[0] ?? null
        if (column === undefined || row === null) return row
        return row[column]
      },
    }
    raws.set(statement, raw)
    return statement
  }
  return {
    totals,
    statements,
    db: {
      prepare: (sql) => wrap(database.prepare(sql), sql),
      async batch(batched) {
        totals.calls += 1
        return count(
          await database.batch(batched.map((statement) => raws.get(statement))),
          "<batch>",
        )
      },
    },
  }
}

// One entry per admitted operation: the units it reserved and the rows the
// database wrote from its reserve call to its complete call (or to the end of
// the run when it never completed, as a failed operation does not).
function settleReservations(events, endRowsWritten) {
  const open = new Map()
  const settled = []
  for (const event of events) {
    if (event.kind === "reserve") open.set(event.operation_id, event)
    else {
      const reserved = open.get(event.operation_id)
      if (!reserved) continue
      settled.push({
        operation_id: reserved.operation_id,
        lane: reserved.lane,
        units: reserved.units,
        wrote: event.at - reserved.at,
        completed: true,
      })
      open.delete(event.operation_id)
    }
  }
  for (const reserved of open.values())
    settled.push({
      operation_id: reserved.operation_id,
      lane: reserved.lane,
      units: reserved.units,
      wrote: endRowsWritten - reserved.at,
      completed: false,
    })
  return settled
}

// Stands in for the shared daily-budget Durable Object and admits everything.
// It records the rows the database had written at each reserve and complete call.
export function recordingMutationLedger(meter) {
  const events = []
  return {
    namespace: {
      idFromName: () => "global",
      get: () => ({
        async fetch(request) {
          const path = new URL(request.url).pathname
          const body = await request.json()
          if (path === "/reserve-mutation-writes")
            events.push({ kind: "reserve", at: meter.totals.rows_written, ...body })
          else if (path === "/complete-mutation-write-reservation")
            events.push({ kind: "complete", at: meter.totals.rows_written, ...body })
          else throw new Error(`Unexpected ledger path ${path}`)
          return Response.json({ ok: true })
        },
      }),
    },
    settle: (endRowsWritten) => settleReservations(events, endRowsWritten),
  }
}

function sqliteDoStorage(raw) {
  return {
    sql: {
      exec(sql, ...args) {
        const statement = raw.prepare(String(sql))
        if (statement.columns().length) return { toArray: () => statement.all(...args) }
        statement.run(...args)
        return { toArray: () => [] }
      },
    },
    transactionSync(callback) {
      raw.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        raw.exec("COMMIT")
        return result
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
    },
  }
}

// The real shared daily-budget Durable Object over in-memory SQLite, fed a
// provider observation of `providerRowsWritten`.
export function realBudgetLedger(providerRowsWritten = 0, { providerRowsRead } = {}) {
  const raw = new DatabaseSync(":memory:")
  const observation = { rowsWritten: providerRowsWritten, rowsRead: providerRowsRead }
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    { storage: sqliteDoStorage(raw), blockConcurrencyWhile: (callback) => callback() },
    {
      KV: {
        async get() {
          return {
            schemaVersion: 3,
            generatedAt: new Date().toISOString(),
            providerAdmission: {
              accountId: "reservation-receipts",
              dayKey: new Date().toISOString().slice(0, 10),
              rowsWritten: observation.rowsWritten,
              ...(observation.rowsRead === undefined ? {} : { rowsRead: observation.rowsRead }),
            },
          }
        },
      },
    },
  )
  return {
    owner,
    // A new provider reading, taking effect on the next admission.
    observe(rowsWritten) {
      observation.rowsWritten = rowsWritten
      owner.providerObservationCheckedAt = 0
      owner.providerObservationCache = null
    },
    namespace: {
      idFromName: () => "global",
      get: () => ({ fetch: (request) => owner.fetch(request) }),
    },
    close: () => raw.close(),
  }
}

// Wraps a ledger so every call it receives is recorded and then answered by the
// real ledger. A gateway test reads the reservations the request really made
// (path, lane, units, operation id) instead of trusting what the code says.
export function spyOnLedger(ledger) {
  const calls = []
  return {
    calls,
    reservations: () => calls.filter((call) => call.path === "/reserve-mutation-writes"),
    namespace: {
      idFromName: () => "global",
      get: () => ({
        async fetch(request) {
          const path = new URL(request.url).pathname
          const body = await request
            .clone()
            .json()
            .catch(() => null)
          const response = await ledger.namespace.get().fetch(request)
          calls.push({
            path,
            status: response.status,
            ...(body?.lane
              ? { lane: body.lane, units: body.units, operation_id: body.operation_id }
              : {}),
            ...(path === "/record"
              ? { rows_read: body?.rows_read, rows_written: body?.rows_written }
              : {}),
          })
          return response
        },
      }),
    },
  }
}
