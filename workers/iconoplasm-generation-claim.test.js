import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  claimValidatedGenerationRequests,
  validateGenerationRequestRowsForClaim,
} from "./iconoplasm-generation-claim.js"
import { quarantinePermanentGenerationRequests } from "./iconoplasm-generation-request-quarantine.js"
import { IconoplasmGenerationSourceError } from "./lib/iconoplasm-generation-provenance.js"

class Statement {
  constructor(statement) {
    this.statement = statement
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async run() {
    const result = this.statement.run(...this.args)
    return { meta: { changes: Number(result.changes || 0) } }
  }
}

class D1 {
  constructor(raw) {
    this.raw = raw
  }

  prepare(sql) {
    return new Statement(this.raw.prepare(sql))
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }
}

const sha = (character) => String(character).repeat(64)

function sourceRow(id, overrides = {}) {
  return {
    id,
    generation_request_id: `generation_request_${String(id).padStart(8, "0")}`,
    gene_symbol: id === 1 ? "BAD" : "GOOD",
    source_manifestation_revision_id: `manifestation_revision_${String(id).padStart(8, "0")}`,
    source_snapshot_sha256: sha(id === 1 ? "a" : "b"),
    ...overrides,
  }
}

test("a permanently invalid queue head is quarantined without starving the next valid claim", async () => {
  const quarantined = []
  const claimedRows = []
  const rows = [sourceRow(1), sourceRow(2)]

  const result = await claimValidatedGenerationRequests(
    {
      env: {},
      db: {},
      rows,
      leaseOwnerId: "workstation_0001",
      limit: 1,
      leaseSeconds: 600,
    },
    {
      validateRows: (input) =>
        validateGenerationRequestRowsForClaim(input, {
          validateSource: async (_env, row) => {
            if (row.id === 1) {
              throw new IconoplasmGenerationSourceError(
                "GENERATION_SOURCE_REVISION_INACTIVE",
                "The exact revision was withdrawn.",
              )
            }
          },
        }),
      quarantineRequests: async ({ blockedRows }) => {
        quarantined.push(...blockedRows)
        return { quarantined_count: blockedRows.length, request_ids: [blockedRows[0].id] }
      },
      claimLeases: async ({ rows: runnableRows }) => {
        claimedRows.push(...runnableRows)
        return {
          lease_owner_id: "workstation_0001",
          lease_seconds: 600,
          leases: [{ generation_request_id: runnableRows[0].generation_request_id }],
        }
      },
    },
  )

  assert.deepEqual(
    quarantined.map((row) => row.id),
    [1],
  )
  assert.equal(quarantined[0].code, "GENERATION_SOURCE_REVISION_INACTIVE")
  assert.deepEqual(
    claimedRows.map((row) => row.id),
    [2],
  )
  assert.equal(result.claimed.leases[0].generation_request_id, rows[1].generation_request_id)
})

test("quarantine atomically cancels the request and preserves an immutable audit record", async () => {
  const raw = new DatabaseSync(":memory:")
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE icono_generation_requests (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('open', 'fulfilled', 'cancelled')),
      updated_at TEXT NOT NULL,
      fulfillment_note TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO icono_generation_requests (id, status, updated_at)
    VALUES (1, 'open', '2026-08-30T00:00:00.000Z');
  `)
  raw.exec(
    readFileSync(
      new URL("../migrations-iconoplasm/0087_generation_request_quarantine.sql", import.meta.url),
      "utf8",
    ),
  )
  const db = new D1(raw)
  const blocked = {
    ...sourceRow(1),
    code: "GENERATION_SOURCE_REVISION_INACTIVE",
    error: "The exact revision was withdrawn.",
  }

  const first = await quarantinePermanentGenerationRequests({
    db,
    blockedRows: [blocked],
    now: new Date("2026-08-30T01:00:00.000Z"),
  })
  const replay = await quarantinePermanentGenerationRequests({
    db,
    blockedRows: [blocked],
    now: new Date("2026-08-30T02:00:00.000Z"),
  })

  assert.equal(first.quarantined_count, 1)
  assert.equal(replay.quarantined_count, 1)
  assert.deepEqual(
    { ...raw.prepare("SELECT status, fulfillment_note FROM icono_generation_requests").get() },
    {
      status: "cancelled",
      fulfillment_note: "Exact source unavailable: GENERATION_SOURCE_REVISION_INACTIVE",
    },
  )
  assert.deepEqual(
    {
      ...raw
        .prepare(
          `SELECT generation_request_id, failure_code, quarantined_at
           FROM icono_generation_request_quarantine`,
        )
        .get(),
    },
    {
      generation_request_id: blocked.generation_request_id,
      failure_code: blocked.code,
      quarantined_at: "2026-08-30T01:00:00.000Z",
    },
  )
  assert.throws(
    () => raw.exec("DELETE FROM icono_generation_request_quarantine"),
    /generation_request_quarantine_is_immutable/,
  )
})
