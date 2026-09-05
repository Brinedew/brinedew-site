import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  IconoplasmGenerationLeaseError,
  assertExactGenerationLeaseExecution,
  buildExactGenerationLeasePlan,
  claimExactGenerationLeases,
  completeExactGenerationLease,
  exactGenerationLeaseFromRow,
  failExactGenerationLease,
  renewExactGenerationLease,
  readExactGenerationLeaseMaterial,
} from "./iconoplasm-generation-lease.js"

const sha = (character) => String(character).repeat(64)

class D1Statement {
  constructor(statement) {
    this.statement = statement
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    return this.statement.get(...this.args) || null
  }

  async run() {
    const result = this.statement.run(...this.args)
    return { meta: { changes: Number(result.changes || 0) } }
  }
}

class D1Database {
  constructor(database) {
    this.database = database
  }

  prepare(sql) {
    return new D1Statement(this.database.prepare(sql))
  }
}

function leaseDatabase() {
  const database = new DatabaseSync(":memory:")
  database.exec(`
    CREATE TABLE icono_generation_execution_leases (
      generation_request_id TEXT PRIMARY KEY,
      request_row_id INTEGER NOT NULL,
      generation_attempt_id TEXT NOT NULL UNIQUE,
      lease_token TEXT NOT NULL UNIQUE,
      lease_owner_id TEXT NOT NULL,
      lease_version INTEGER NOT NULL CHECK (lease_version >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      failed_at TEXT,
      failure_code TEXT,
      updated_at TEXT NOT NULL
    );
  `)
  return { database, db: new D1Database(database) }
}

function deterministicIds() {
  let counter = 0
  return async (kind) => `${kind}_${String(++counter).padStart(8, "0")}`
}

function boundRow(overrides = {}) {
  return {
    id: 41,
    status: "open",
    gene_symbol: "TP53",
    full_name: "tumor protein p53",
    request_kind: "new_candidate",
    request_prompt: "",
    request_mode: "random",
    requested_vision_id: "",
    requested_emulsion_id: "",
    requested_emulsion_slot: 0,
    requested_workflow_id: "",
    requested_prompt_version: "",
    requested_variant_slot: "",
    factory_pipeline_code: "anima-v1",
    factory_vision_revision: 1,
    seed_mode: "random",
    generation_provenance_status: "bound",
    generation_request_id: "generation_request_00000001",
    generation_attempt_id: "generation_attempt_00000001",
    source_gene_id: "gene_tp53_stable",
    source_manifestation_id: "manifestation_tp53_0001",
    source_manifestation_revision_id: "revision_tp53_00000001",
    source_manifestation_body_sha256: sha("a"),
    source_manifestation_derivative_id: "derivative_tp53_00000001",
    source_manifestation_derivative_sha256: sha("b"),
    source_manifestation_derivative_tags_sha256: sha("1"),
    source_manifestation_derivative_tags_bytes: 80,
    source_manifestation_derivative_fields_sha256: sha("2"),
    source_manifestation_derivative_fields_bytes: 107,
    source_manifestation_derivative_recipe_id: "taggerizer",
    source_manifestation_derivative_recipe_version: "2",
    source_manifestation_derivative_provider_id: "opencode",
    source_manifestation_derivative_model_id: "deepseek-v4-flash-free",
    source_manifestation_derivative_tagger_config_sha256: sha("c"),
    source_canonical_selection_id: "selection_tp53_00000001",
    source_canonical_head_version: 7,
    source_gene_revision: 11,
    source_sample_label: "sample zero",
    source_sample_number: 0,
    source_sample_text_sha256: sha("d"),
    source_snapshot_sha256: sha("e"),
    generation_request_contract_sha256: sha("f"),
    generation_config_sha256: sha("0"),
    prompt_body_mode: "taggerizer_prompt",
    ...overrides,
  }
}

test("exact generation lease exposes one stable request/attempt and immutable material paths", () => {
  const lease = exactGenerationLeaseFromRow(boundRow())
  assert.equal(lease.generation_request_id, "generation_request_00000001")
  assert.equal(lease.generation_attempt_id, "generation_attempt_00000001")
  assert.deepEqual(lease.request_ids, [41])
  assert.equal(lease.source_sample_number, 0)
  assert.equal(
    lease.source_material.manifestation_revision_body_path,
    "/api/iconoplasm/authority/revisions/revision_tp53_00000001/body",
  )
  assert.equal(
    lease.source_material.manifestation_derivative_body_path,
    "/api/iconoplasm/authority/derivatives/derivative_tp53_00000001/body",
  )
  assert.equal(lease.source_manifestation_derivative_recipe_id, "taggerizer")
  assert.equal(lease.source_snapshot_sha256, sha("e"))
})

test("lease planning fails closed on source drift and never substitutes current canon", async () => {
  const row = boundRow()
  const plan = await buildExactGenerationLeasePlan({
    rows: [row],
    validateSource: async () => ({ source_snapshot_sha256: sha("9") }),
  })
  assert.equal(plan.leases.length, 0)
  assert.equal(plan.blocked_rows.length, 1)
  assert.equal(plan.blocked_rows[0].code, "GENERATION_SOURCE_SNAPSHOT_MISMATCH")
  assert.equal(
    plan.blocked_rows[0].source_manifestation_revision_id,
    row.source_manifestation_revision_id,
  )
})

test("legacy, missing-attempt, and deleted-source rows cannot become leases", async () => {
  const rows = [
    boundRow({ id: 1, generation_provenance_status: "legacy_unbound" }),
    boundRow({ id: 2, generation_attempt_id: "" }),
    boundRow({ id: 3 }),
  ]
  const plan = await buildExactGenerationLeasePlan({
    rows,
    validateSource: async (row) => {
      if (row.id === 3) {
        const error = new Error("The exact encrypted source object was deleted")
        error.code = "GENERATION_SOURCE_BODY_MISSING"
        throw error
      }
      return { source_snapshot_sha256: row.source_snapshot_sha256 }
    },
  })
  assert.equal(plan.leases.length, 0)
  assert.deepEqual(
    plan.blocked_rows.map((row) => row.code),
    ["LEGACY_GENERATION_SOURCE_UNBOUND", "GENERATION_LEASE_INVALID", "GENERATION_LEASE_FAILED"],
  )
})

test("repeated lease reads retain the same stable request and attempt identities", () => {
  const row = boundRow({ source_sample_number: null })
  const first = exactGenerationLeaseFromRow(row)
  const replay = exactGenerationLeaseFromRow({ ...row })
  assert.equal(replay.generation_request_id, first.generation_request_id)
  assert.equal(replay.generation_attempt_id, first.generation_attempt_id)
  assert.equal(replay.source_sample_number, null)
  assert.deepEqual(replay, first)
})

test("one owner atomically claims a request and competing polls cannot spend the same attempt", async () => {
  const fixture = leaseDatabase()
  try {
    const ids = deterministicIds()
    const now = new Date("2026-08-30T00:00:00.000Z")
    const row = boundRow({ generation_attempt_id: "" })
    const first = await claimExactGenerationLeases({
      db: fixture.db,
      rows: [row],
      leaseOwnerId: "workstation_owner_0001",
      now,
      idFactory: ids,
    })
    const competing = await claimExactGenerationLeases({
      db: fixture.db,
      rows: [row],
      leaseOwnerId: "workstation_owner_0002",
      now,
      idFactory: ids,
    })
    const replay = await claimExactGenerationLeases({
      db: fixture.db,
      rows: [row],
      leaseOwnerId: "workstation_owner_0001",
      now,
      idFactory: ids,
    })

    assert.equal(first.leases.length, 1)
    assert.equal(competing.leases.length, 0)
    assert.equal(replay.leases.length, 1)
    assert.equal(replay.leases[0].generation_attempt_id, first.leases[0].generation_attempt_id)
    assert.equal(replay.leases[0].generation_lease_token, first.leases[0].generation_lease_token)
    assert.equal(replay.leases[0].generation_lease_version, 1)
  } finally {
    fixture.database.close()
  }
})

test("renewal, exact execution, failure, and redelivery are fenced by lease CAS", async () => {
  const fixture = leaseDatabase()
  try {
    const ids = deterministicIds()
    const row = boundRow({ generation_attempt_id: "" })
    const initial = (
      await claimExactGenerationLeases({
        db: fixture.db,
        rows: [row],
        leaseOwnerId: "workstation_owner_0001",
        now: new Date("2026-08-30T00:00:00.000Z"),
        idFactory: ids,
      })
    ).leases[0]
    const renewed = await renewExactGenerationLease({
      db: fixture.db,
      leaseToken: initial.generation_lease_token,
      leaseOwnerId: initial.generation_lease_owner_id,
      expectedLeaseVersion: 1,
      now: new Date("2026-08-30T00:01:00.000Z"),
    })
    assert.equal(renewed.generation_lease_version, 2)

    await assert.rejects(
      assertExactGenerationLeaseExecution({
        db: fixture.db,
        generationRequestId: initial.generation_request_id,
        generationAttemptId: initial.generation_attempt_id,
        leaseToken: initial.generation_lease_token,
        leaseOwnerId: initial.generation_lease_owner_id,
        expectedLeaseVersion: 1,
        now: new Date("2026-08-30T00:01:01.000Z"),
      }),
      (error) =>
        error instanceof IconoplasmGenerationLeaseError &&
        error.code === "GENERATION_LEASE_CAS_MISMATCH",
    )
    for (const mismatch of [
      { generationAttemptId: "generation_attempt_wrong_0001" },
      { leaseToken: "generation_lease_wrong_0001" },
      { leaseOwnerId: "workstation_owner_wrong_0001" },
    ]) {
      await assert.rejects(
        assertExactGenerationLeaseExecution({
          db: fixture.db,
          generationRequestId: initial.generation_request_id,
          generationAttemptId: initial.generation_attempt_id,
          leaseToken: initial.generation_lease_token,
          leaseOwnerId: initial.generation_lease_owner_id,
          expectedLeaseVersion: 2,
          now: new Date("2026-08-30T00:01:01.000Z"),
          ...mismatch,
        }),
        (error) =>
          error instanceof IconoplasmGenerationLeaseError &&
          error.code === "GENERATION_LEASE_CAS_MISMATCH",
      )
    }

    await failExactGenerationLease({
      db: fixture.db,
      leaseToken: initial.generation_lease_token,
      leaseOwnerId: initial.generation_lease_owner_id,
      expectedLeaseVersion: 2,
      failureCode: "gpu_reset",
      now: new Date("2026-08-30T00:02:00.000Z"),
    })
    const redelivery = (
      await claimExactGenerationLeases({
        db: fixture.db,
        rows: [row],
        leaseOwnerId: "workstation_owner_0002",
        now: new Date("2026-08-30T00:02:01.000Z"),
        idFactory: ids,
      })
    ).leases[0]
    assert.notEqual(redelivery.generation_attempt_id, initial.generation_attempt_id)
    assert.notEqual(redelivery.generation_lease_token, initial.generation_lease_token)
    assert.equal(redelivery.generation_lease_version, 3)
  } finally {
    fixture.database.close()
  }
})

test("completion is exact and idempotent while completed work is never reclaimed", async () => {
  const fixture = leaseDatabase()
  try {
    const ids = deterministicIds()
    const row = boundRow({ generation_attempt_id: "" })
    const lease = (
      await claimExactGenerationLeases({
        db: fixture.db,
        rows: [row],
        leaseOwnerId: "workstation_owner_0001",
        now: new Date("2026-08-30T00:00:00.000Z"),
        idFactory: ids,
      })
    ).leases[0]
    const input = {
      db: fixture.db,
      generationRequestId: lease.generation_request_id,
      generationAttemptId: lease.generation_attempt_id,
      leaseToken: lease.generation_lease_token,
      leaseOwnerId: lease.generation_lease_owner_id,
      expectedLeaseVersion: lease.generation_lease_version,
      now: new Date("2026-08-30T00:01:00.000Z"),
    }
    assert.equal((await completeExactGenerationLease(input)).replayed, false)
    assert.equal((await completeExactGenerationLease(input)).replayed, true)
    assert.equal(
      (
        await assertExactGenerationLeaseExecution({
          ...input,
          now: new Date("2026-08-31T00:00:00.000Z"),
        })
      ).generation_lease_status,
      "completed",
    )
    const competing = await claimExactGenerationLeases({
      db: fixture.db,
      rows: [row],
      leaseOwnerId: "workstation_owner_0002",
      now: new Date("2026-08-31T00:00:01.000Z"),
      idFactory: ids,
    })
    assert.equal(competing.leases.length, 0)
  } finally {
    fixture.database.close()
  }
})

test("an expired lease is redelivered with a new attempt and token", async () => {
  const fixture = leaseDatabase()
  try {
    const ids = deterministicIds()
    const row = boundRow({ generation_attempt_id: "" })
    const first = (
      await claimExactGenerationLeases({
        db: fixture.db,
        rows: [row],
        leaseOwnerId: "workstation_owner_0001",
        leaseSeconds: 60,
        now: new Date("2026-08-30T00:00:00.000Z"),
        idFactory: ids,
      })
    ).leases[0]
    const second = (
      await claimExactGenerationLeases({
        db: fixture.db,
        rows: [row],
        leaseOwnerId: "workstation_owner_0002",
        leaseSeconds: 60,
        now: new Date("2026-08-30T00:01:01.000Z"),
        idFactory: ids,
      })
    ).leases[0]
    assert.notEqual(second.generation_attempt_id, first.generation_attempt_id)
    assert.notEqual(second.generation_lease_token, first.generation_lease_token)
    assert.equal(second.generation_lease_version, 2)
  } finally {
    fixture.database.close()
  }
})

test("material access is fenced to the active owner and persisted request source", async () => {
  const { database, db } = leaseDatabase()
  try {
    const row = boundRow()
    database.exec(
      `CREATE TABLE icono_generation_requests (id INTEGER PRIMARY KEY, generation_request_id TEXT, status TEXT, source_snapshot_sha256 TEXT)`,
    )
    database
      .prepare("INSERT INTO icono_generation_requests VALUES (?, ?, 'open', ?)")
      .run(row.id, row.generation_request_id, row.source_snapshot_sha256)
    const now = new Date("2026-09-05T00:00:00Z")
    const claimed = await claimExactGenerationLeases({
      db,
      rows: [row],
      leaseOwnerId: "workstation_0001",
      leaseSeconds: 600,
      now,
      idFactory: deterministicIds(),
    })
    const lease = claimed.leases[0]
    let reads = 0
    const input = {
      env: { ICONOPLASM_DB: db },
      leaseToken: lease.generation_lease_token,
      leaseOwnerId: lease.generation_lease_owner_id,
      expectedLeaseVersion: lease.generation_lease_version,
      now,
      readSource: async (_env, stored) => {
        reads++
        assert.equal(stored.source_snapshot_sha256, row.source_snapshot_sha256)
        return { prose: "verified private material" }
      },
    }
    for (const patch of [
      { leaseOwnerId: "wrong_owner_0001" },
      { expectedLeaseVersion: 99 },
      { leaseToken: "wrong_token_0001" },
      { now: new Date("2026-09-05T01:00:00Z") },
    ]) {
      await assert.rejects(
        readExactGenerationLeaseMaterial({ ...input, ...patch }),
        /lease expired or changed/,
      )
    }
    assert.equal(reads, 0)
    assert.deepEqual(await readExactGenerationLeaseMaterial(input), {
      prose: "verified private material",
    })
    database.exec("UPDATE icono_generation_requests SET status = 'cancelled'")
    await assert.rejects(readExactGenerationLeaseMaterial(input), /lease expired or changed/)
    assert.equal(reads, 1)
  } finally {
    database.close()
  }
})
