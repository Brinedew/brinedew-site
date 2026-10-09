import assert from "node:assert/strict"
import test, { after, before } from "node:test"

import {
  fulfillGenerationRequests,
  generationRequestLeaseClaim,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway,
  iconoplasmBudgetClassFromRouteFamily,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createIconoplasmGenerationExecutorHandler } from "../iconoplasm-generation-executor-routes.js"
import {
  claimExactGenerationLeases,
  failExactGenerationLease,
  readExactGenerationLeaseMaterial,
  renewExactGenerationLease,
} from "../iconoplasm-generation-lease.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  reconcileDeliveredRequestFulfillments,
} from "../iconoplasm-request-notifications.js"
import { requireExactGenerationProvenance } from "../lib/iconoplasm-generation-provenance.js"
import { ICONOPLASM_ROUTE_CONTRACTS } from "../iconoplasm-route-contract.js"
import { isReplicaCostRoute } from "./operation-cost-replica-adapter.js"
import {
  GENERATION_COMPLETION_MAX_REQUESTS,
  GENERATION_COMPLETION_FIXED_ROWS,
  GENERATION_COMPLETION_GROUP_ROWS,
  GENERATION_COMPLETION_REQUEST_ROWS,
  GENERATION_LEASE_FAIL_ROWS,
  GENERATION_LEASE_NEW_ROWS,
  GENERATION_LEASE_RENEW_ROWS,
  GENERATION_QUARANTINE_ROWS,
  LAPTOP_RESERVATION_ROUTE_IDS,
  MUTATION_WRITE_FLOOR_UNITS,
  generationClaimBounds,
  generationClaimWriteUnits,
  generationCompletionWriteUnits,
  laptopReservation,
} from "../lib/iconoplasm-mutation-write-bounds.js"
import { MUTATION_BACKGROUND_CEILING } from "../lib/iconoplasm-mutation-lane-reservations.js"
import {
  liveD1Meter,
  openMigratedD1,
  realBudgetLedger,
  spyOnLedger,
} from "../test-helpers/reservation-receipts-harness.js"

// B-944. The five generation executor routes (claim, material, renew, fail,
// complete) are classed workstation_sync_write, but the wrapper's budgeted-route
// gate did not list their family, so none of them reserved and none was metered
// into the daily ledger. A claim alone can write about 1,800 rows.
//
// How this could go wrong (written before the code, B-944):
// 1. An anonymous request reserves capacity: the reservation was taken before
//    the bearer was checked, and the hostname is public.
// 2. A claim replays an earlier body and is never counted: the identity was the
//    body hash and every claim by one process has the same body.
// 3. A claim reserves from its limit but scans four times as many rows, and each
//    quarantined row writes nine.
// 4. A completion loops over an unbounded body.
// 5. A refused renew lets a lease lapse so another claim takes the work.
// 6. A refusal consumes its reservation and the identical retry is refused forever.
// 7. A later migration adds an index or trigger and the measured worst case drifts.
// 8. Metering wraps the D1 binding; a route that used a method the wrapper does
//    not carry would fail only on this route family.
// Each test below drives the real functions against real D1 receipts.

let database
// An authoring database with the complete schema and no rows: every exact
// source a request names is then permanently gone, which is what a claim
// quarantines.
let authoring
before(async () => {
  database = await openMigratedD1()
  authoring = await openMigratedD1("../../migrations-iconoplasm-authoring/")
})
after(async () => {
  await database?.dispose()
  await authoring?.dispose()
})

const quiet = (t) => {
  const original = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  t.after(() => {
    ;[console.log, console.warn, console.error] = original
  })
}

const OWNER = "workstation_receipts_0001"
const GENERATION_TOKEN = "generation-secret"
const REPLICA_TOKEN = "replica-secret"
const sha = (character) => String(character).repeat(64)
const hexSha = (number) => number.toString(16).padStart(64, "0")
let counter = 0

// Open bound requests, one SQL statement, every provenance column a real bound
// request carries so the indexes and triggers bill what production bills.
// `groups` spreads the requests over that many requesters, so a completion of
// them is that many Discord groups (one requester and one gene is one group).
async function seedOpenRequests(count, { requester = "user_receipts", groups = 1 } = {}) {
  const firstId =
    Number(
      await database.db
        .prepare("SELECT COALESCE(MAX(id), 0) AS m FROM icono_generation_requests")
        .first("m"),
    ) + 1
  const gene = `G${++counter}`
  await database.db
    .prepare(
      `WITH RECURSIVE n(i) AS (VALUES(?) UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO icono_generation_requests (
         id, gene_symbol, requester_user_id, status, created_at, generation_provenance_status,
         generation_request_id, source_gene_id, source_manifestation_id,
         source_manifestation_revision_id, source_manifestation_body_sha256,
         source_manifestation_derivative_id, source_manifestation_derivative_sha256,
         source_manifestation_derivative_tags_sha256, source_manifestation_derivative_tags_bytes,
         source_manifestation_derivative_fields_sha256, source_manifestation_derivative_fields_bytes,
         source_manifestation_derivative_recipe_id, source_manifestation_derivative_recipe_version,
         source_manifestation_derivative_provider_id, source_manifestation_derivative_model_id,
         source_manifestation_derivative_tagger_config_sha256, source_canonical_selection_id,
         source_canonical_head_version, source_gene_revision, source_sample_label,
         source_sample_number, source_sample_text_sha256, source_snapshot_sha256,
         generation_request_contract_sha256, generation_config_sha256, prompt_body_mode
       )
       SELECT i, ?, CASE WHEN ? > 1 THEN 'user_' || ((i - ?) % ?) ELSE ? END, 'open',
         strftime('%Y-%m-%d %H:%M:%S', '2026-01-01', '+' || i || ' seconds'), 'bound',
         printf('generation_request_%08d', i), 'gene_stable_receipts', 'manifestation_receipts_0001',
         'revision_receipts_00000001', ?, 'derivative_receipts_00000001', ?, ?, 80, ?, 107,
         'taggerizer', '2', 'opencode', 'deepseek-v4-flash-free', ?, 'selection_receipts_00000001',
         7, 11, 'sample zero', 0, ?, printf('%064x', i), ?, ?, 'taggerizer_prompt'
       FROM n`,
    )
    .bind(
      firstId,
      firstId + count - 1,
      gene,
      groups,
      firstId,
      groups,
      requester,
      sha("a"),
      sha("b"),
      sha("1"),
      sha("2"),
      sha("c"),
      sha("d"),
      sha("f"),
      sha("e"),
    )
    .run()
  return { gene, ids: Array.from({ length: count }, (_, index) => firstId + index) }
}

async function requestRow(id) {
  return database.db
    .prepare("SELECT gr.*, '' AS full_name FROM icono_generation_requests gr WHERE gr.id = ?")
    .bind(id)
    .first()
}

const permanentFailure = (row) => ({
  id: Number(row.id),
  generation_request_id: row.generation_request_id,
  gene_symbol: row.gene_symbol,
  source_manifestation_revision_id: row.source_manifestation_revision_id,
  source_snapshot_sha256: row.source_snapshot_sha256,
  code: "GENERATION_SOURCE_REVISION_INACTIVE",
  error: "The exact revision was withdrawn.",
})

// A claim validator that blocks the first `blocked` rows of the scan.
const blockingValidator =
  (blocked) =>
  async ({ rows }) => ({
    validRows: Object.freeze(rows.slice(blocked)),
    blockedRows: Object.freeze(rows.slice(0, blocked).map(permanentFailure)),
  })

const claimEnv = (meter) => ({
  ICONOPLASM_DB: meter.db,
  ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters",
})

async function measuredClaim({ limit, blocked, meter = liveD1Meter(database.db) }) {
  const before = { ...meter.totals }
  const result = await generationRequestLeaseClaim(
    claimEnv(meter),
    { limit, leaseOwnerId: OWNER, leaseSeconds: 900 },
    { validateRows: blockingValidator(blocked) },
  )
  return {
    result,
    wrote: meter.totals.rows_written - before.rows_written,
    meter,
  }
}

async function cancelOpenReceiptRequests() {
  await database.db
    .prepare("UPDATE icono_generation_requests SET status = 'cancelled' WHERE status = 'open'")
    .run()
}

// Failure modes 1, 3 and 7: the claim is sized from its limit but scans four
// times as many rows, and a quarantined row is the most expensive thing it writes.
test("a claim reserves for a scan in which every row is quarantined, whatever its limit", async (t) => {
  quiet(t)
  let worstPerQuarantine = 0
  for (const limit of [undefined, 1, 12, 25, 50, 10_000]) {
    await cancelOpenReceiptRequests()
    const { claimLimit, scanLimit } = generationClaimBounds(limit)
    await seedOpenRequests(scanLimit + 5)
    const run = await measuredClaim({ limit, blocked: scanLimit })
    assert.equal(run.result.quarantined_count, scanLimit, `limit ${limit}`)
    assert.equal(run.result.runnable_count, 0)
    const units = generationClaimWriteUnits(limit)
    assert.ok(units >= run.wrote, `limit ${limit} under-reserved: ${units} < ${run.wrote}`)
    if (scanLimit >= 40) worstPerQuarantine = Math.max(worstPerQuarantine, run.wrote / scanLimit)
    t.diagnostic(
      JSON.stringify({
        site: "claim-all-quarantined",
        limit,
        claimLimit,
        scanLimit,
        wrote: run.wrote,
        units,
      }),
    )
  }
  // The per-row constant is the measured worst case: nine rows, no estimate.
  assert.ok(
    GENERATION_QUARANTINE_ROWS >= worstPerQuarantine,
    `a quarantined request writes ${worstPerQuarantine}, the constant says ${GENERATION_QUARANTINE_ROWS}`,
  )
  assert.ok(GENERATION_QUARANTINE_ROWS <= Math.ceil(worstPerQuarantine) + 1)
})

test("a claim that leases what it scans writes six rows per new lease, and five for a re-claim", async (t) => {
  quiet(t)
  for (const limit of [1, 5, 12, 50]) {
    await cancelOpenReceiptRequests()
    await seedOpenRequests(generationClaimBounds(limit).scanLimit)
    const run = await measuredClaim({ limit, blocked: 0 })
    assert.equal(run.result.runnable_count, limit)
    assert.ok(
      run.wrote >= limit * GENERATION_LEASE_NEW_ROWS - limit,
      JSON.stringify({ limit, wrote: run.wrote }),
    )
    assert.ok(generationClaimWriteUnits(limit) >= run.wrote, `limit ${limit}: ${run.wrote}`)
    t.diagnostic(
      JSON.stringify({
        site: "claim-leases",
        limit,
        wrote: run.wrote,
        perLease: run.wrote / limit,
      }),
    )
  }
  // The pin: the largest per-lease cost measured over those runs.
  await cancelOpenReceiptRequests()
  await seedOpenRequests(20)
  const one = await measuredClaim({ limit: 1, blocked: 0 })
  assert.equal(one.wrote, GENERATION_LEASE_NEW_ROWS)
  // Failing the lease and claiming it again rewrites the same lease row.
  const leaseToken = one.result.leases[0].generation_lease_token
  await failExactGenerationLease({
    db: database.db,
    leaseToken,
    leaseOwnerId: OWNER,
    expectedLeaseVersion: one.result.leases[0].generation_lease_version,
    failureCode: "executor_failed",
  })
  const again = await measuredClaim({ limit: 1, blocked: 0 })
  assert.equal(again.result.runnable_count, 1)
  assert.ok(again.wrote <= GENERATION_LEASE_NEW_ROWS, `a re-claim writes ${again.wrote}`)
})

test("a claim that quarantines part of its scan and leases the rest stays inside the reservation", async (t) => {
  quiet(t)
  for (const [limit, blocked] of [
    [5, 10],
    [12, 30],
    [50, 100],
    [50, 199],
  ]) {
    await cancelOpenReceiptRequests()
    await seedOpenRequests(generationClaimBounds(limit).scanLimit + 5)
    const run = await measuredClaim({ limit, blocked })
    assert.ok(run.result.runnable_count >= 1)
    assert.ok(
      generationClaimWriteUnits(limit) >= run.wrote,
      `limit ${limit} blocked ${blocked}: ${run.wrote} > ${generationClaimWriteUnits(limit)}`,
    )
    t.diagnostic(
      JSON.stringify({
        site: "claim-mixed",
        limit,
        blocked,
        wrote: run.wrote,
        units: generationClaimWriteUnits(limit),
      }),
    )
  }
})

test("the claim's limit and scan are the numbers the reservation is sized from", async () => {
  for (const limit of [undefined, null, "", 0, -4, 1.9, "7", "abc", 50, 51, 1e9]) {
    const { claimLimit, scanLimit } = generationClaimBounds(limit)
    assert.ok(claimLimit >= 1 && claimLimit <= 50, `limit ${limit} gave ${claimLimit}`)
    assert.ok(scanLimit >= 20 && scanLimit <= 200 && scanLimit >= claimLimit)
    assert.ok(generationClaimWriteUnits(limit) >= MUTATION_WRITE_FLOOR_UNITS)
  }
  assert.deepEqual(generationClaimBounds(undefined), { claimLimit: 10, scanLimit: 40 })
  assert.deepEqual(generationClaimBounds(50), { claimLimit: 50, scanLimit: 200 })
  // A bigger claim never reserves less than a smaller one.
  let previous = 0
  for (let limit = 1; limit <= 50; limit += 1) {
    const units = generationClaimWriteUnits(limit)
    assert.ok(units >= previous, `limit ${limit}`)
    previous = units
  }
})

// Failure mode 5 and the cost of the small routes.
async function leaseFor(requestId) {
  const row = await requestRow(requestId)
  const claimed = await claimExactGenerationLeases({
    db: database.db,
    rows: [row],
    leaseOwnerId: OWNER,
    limit: 1,
    leaseSeconds: 900,
  })
  return { row, lease: claimed.leases[0] }
}

test("a renew and a fail write two rows each, and a refused attempt writes none", async (t) => {
  const { ids } = await seedOpenRequests(3)
  const renewTarget = await leaseFor(ids[0])
  const meter = liveD1Meter(database.db)
  const renewed = await renewExactGenerationLease({
    db: meter.db,
    leaseToken: renewTarget.lease.generation_lease_token,
    leaseOwnerId: OWNER,
    expectedLeaseVersion: renewTarget.lease.generation_lease_version,
    leaseSeconds: 900,
  })
  assert.equal(renewed.generation_lease_version, renewTarget.lease.generation_lease_version + 1)
  assert.equal(meter.totals.rows_written, GENERATION_LEASE_RENEW_ROWS)
  // The identical retry is fenced by the version it carries: it writes nothing.
  const before = meter.totals.rows_written
  await assert.rejects(
    renewExactGenerationLease({
      db: meter.db,
      leaseToken: renewTarget.lease.generation_lease_token,
      leaseOwnerId: OWNER,
      expectedLeaseVersion: renewTarget.lease.generation_lease_version,
      leaseSeconds: 900,
    }),
    { code: "GENERATION_LEASE_CAS_MISMATCH" },
  )
  assert.equal(meter.totals.rows_written, before)

  const failTarget = await leaseFor(ids[1])
  const failMeter = liveD1Meter(database.db)
  await failExactGenerationLease({
    db: failMeter.db,
    leaseToken: failTarget.lease.generation_lease_token,
    leaseOwnerId: OWNER,
    expectedLeaseVersion: failTarget.lease.generation_lease_version,
    failureCode: "executor_failed",
  })
  assert.equal(failMeter.totals.rows_written, GENERATION_LEASE_FAIL_ROWS)
  t.diagnostic(
    JSON.stringify({
      site: "lease-small",
      renew: GENERATION_LEASE_RENEW_ROWS,
      fail: GENERATION_LEASE_FAIL_ROWS,
    }),
  )
})

test("reading a lease's material writes no row, so it reserves no write capacity", async () => {
  const { ids } = await seedOpenRequests(1)
  const { lease } = await leaseFor(ids[0])
  const meter = liveD1Meter(database.db)
  let sourceReads = 0
  const material = await readExactGenerationLeaseMaterial({
    env: { ICONOPLASM_DB: meter.db },
    leaseToken: lease.generation_lease_token,
    leaseOwnerId: OWNER,
    expectedLeaseVersion: lease.generation_lease_version,
    readSource: async (_env, row) => {
      sourceReads += 1
      return { request_id: row.id }
    },
  })
  assert.equal(sourceReads, 1)
  assert.equal(material.request_id, ids[0])
  assert.ok(meter.totals.rows_read > 0)
  assert.equal(meter.totals.rows_written, 0)
  assert.equal(
    laptopReservation("authority_generation_lease_material", { lease_owner_id: OWNER }).units,
    0,
  )
})

// Failure mode 4: a completion loops over every request id in its body. The
// whole path runs here: lease completion, generation receipt, request UPDATE
// (its trigger creates the notification), notification bind, the Discord
// delivery of one group, and the settlement UPDATE.
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4,
])

// `discord.failing = true` makes Discord refuse to open the DM channel (a 500, which
// the delivery treats as retryable), so a completion starts its requests and
// delivers nothing.
function installDiscordAndPortraits(t) {
  const original = globalThis.fetch
  const discord = { failing: false }
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.endsWith("/users/@me/channels")) {
      if (discord.failing) return Response.json({ message: "refused" }, { status: 500 })
      return Response.json({ id: "dm_channel_receipts" })
    }
    if (target.includes("/channels/") && target.endsWith("/messages")) {
      return Response.json({ id: `message_${++counter}` })
    }
    throw new Error(`unexpected fetch ${target}`)
  }
  return discord
}

async function seedCompletion(count, { groups = 1 } = {}) {
  const { gene, ids } = await seedOpenRequests(count, { groups })
  const items = []
  for (const id of ids) {
    const { row, lease } = await leaseFor(id)
    const assetSha = hexSha(900_000 + id)
    await database.db
      .prepare(
        "INSERT OR IGNORE INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id,created_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
      )
      .bind(gene, assetSha, "full", "thumb", "approved", "anima-v1-1", "A1-1")
      .run()
    const provenance = requireExactGenerationProvenance(row)
    items.push({
      ...provenance,
      request_ids: [id],
      generation_request_id: row.generation_request_id,
      generation_attempt_id: lease.generation_attempt_id,
      generation_lease_token: lease.generation_lease_token,
      generation_lease_owner_id: OWNER,
      generation_lease_version: lease.generation_lease_version,
      generation_request_contract_sha256: row.generation_request_contract_sha256,
      generation_config_sha256: row.generation_config_sha256,
      prompt_body_mode: row.prompt_body_mode,
      fulfilled_asset_sha256: assetSha,
      fulfilled_vision_id: "anima-v1-1",
      provider_id: "opencode",
      model_id: "receipts-model",
      prompt_sha256: sha("9"),
    })
  }
  return { gene, ids, items }
}

function completionHandler() {
  return createIconoplasmGenerationExecutorHandler({
    authorizeGenerationBearer: async () => ({ authorized: true }),
    claimGenerationLeases: async () => {
      throw new Error("a completion never claims")
    },
    fulfillGenerationRequests: (env, args) =>
      fulfillGenerationRequests(env, args, {
        validateSource: async (_env, row) => requireExactGenerationProvenance(row),
      }),
    deliverPendingNotifications: deliverPendingRequestFulfillmentNotifications,
    reconcileDeliveredFulfillments: reconcileDeliveredRequestFulfillments,
    inlineDeliveryLimit: 10,
    logger: { error() {} },
  })
}

async function complete({ items, publicationId, meter }) {
  const env = {
    ICONOPLASM_DB: meter.db,
    ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters",
    DISCORD_BOT_TOKEN: "discord-receipts-token",
    ICONOPLASM_PORTRAITS: {
      async get() {
        return {
          body: new Blob([WEBP]).stream(),
          httpMetadata: { contentType: "image/webp" },
          size: WEBP.byteLength,
          httpEtag: "etag",
        }
      },
    },
  }
  const before = meter.totals.rows_written
  const response = await completionHandler()({
    match: { route: { id: "authority_generation_lease_complete" }, params: {} },
    request: new Request("https://x.test/api/iconoplasm/authority/generation-leases/complete", {
      method: "POST",
      body: JSON.stringify({ publication_id: publicationId, items }),
    }),
    env,
  })
  return {
    status: response.status,
    body: await response.json(),
    wrote: meter.totals.rows_written - before,
  }
}

test("a completion of n requests, delivered to one requester, writes what the reservation counts", async (t) => {
  quiet(t)
  installDiscordAndPortraits(t)
  const points = []
  for (const count of [1, 2, 10, GENERATION_COMPLETION_MAX_REQUESTS]) {
    const { items } = await seedCompletion(count)
    const meter = liveD1Meter(database.db)
    const publicationId = `publication-receipts-${++counter}`
    const first = await complete({ items, publicationId, meter })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    const units = generationCompletionWriteUnits(count)
    points.push({ count, wrote: first.wrote, units, ok: first.body.ok })
  }
  t.diagnostic(JSON.stringify({ site: "complete-one-group", points }))
  for (const point of points)
    assert.ok(
      point.units >= point.wrote,
      `${point.count} requests under-reserved: ${JSON.stringify(points)}`,
    )
  // Three rows once and 41 for each request (a group of one saves four). The
  // constants are what was measured, not an estimate: at the largest completion,
  // one group, they are exact. The reservation is larger by the groups it allows
  // for, which the settle-series test below measures.
  const largest = points.at(-1)
  assert.equal(
    GENERATION_COMPLETION_FIXED_ROWS + GENERATION_COMPLETION_REQUEST_ROWS * largest.count,
    largest.wrote,
    JSON.stringify(points),
  )
})

// B-962. One call delivers one Discord group, so the workstation sends the
// identical body again until every group is delivered: a body of n requests to n
// requesters is n calls. The reservation is taken once, by the first call (a
// replay of the same body is admitted without a new one), so it has to cover the
// rows of the whole series, not of one call.
//
// How the settle loop could go wrong (written before the fix, B-962):
// 1. A pass rewrites every request still pending (its resume UPDATE and its
//    notification bind), so pass k writes about 19 + 3 x pending rows. For 50
//    requests to 50 requesters that is about 6,000 rows over 51 calls against the
//    2,103 reserved.
// 2. The fix leaves a request unrepaired: a notification a crashed pass left on an
//    older publication, a failed notification that is not requeued, a request row
//    that still carries an older group size.
// 3. The fix skips a rewrite the delivery depends on, so a replay delivers nothing
//    and the loop makes no progress.
// 4. The series total, not the first pass, exceeds the reservation.
// 5. A grouping the test did not try is the worst case (one group of n, n groups
//    of one, something between).
// 6. The "write only what moves" condition widens the old guard and silently
//    rebinds a request that belongs to another publication.
const sqlKind = (sql) => sql.replace(/\s+/g, " ").trim().slice(0, 60)

function writersOf(statements) {
  const byKind = {}
  for (const { sql, rows_written } of statements) {
    if (!rows_written) continue
    byKind[sqlKind(sql)] = (byKind[sqlKind(sql)] || 0) + rows_written
  }
  return byKind
}

// Sends the identical body until delivery settles, like the workstation does, and
// records what each call wrote and which statements wrote it.
async function settleSeries({ count, groups }) {
  const { items } = await seedCompletion(count, { groups })
  const meter = liveD1Meter(database.db, { trace: true })
  const publicationId = `publication-receipts-${++counter}`
  const passes = []
  for (let pass = 1; pass <= count + 1; pass += 1) {
    const from = meter.statements.length
    const result = await complete({ items, publicationId, meter })
    passes.push({
      pass,
      wrote: result.wrote,
      ok: result.body.ok === true,
      status: result.status,
      writers: writersOf(meter.statements.slice(from)),
    })
    if (result.body.ok === true) break
  }
  return {
    passes,
    total: passes.reduce((sum, pass) => sum + pass.wrote, 0),
    settled: passes.at(-1).ok,
  }
}

// n groups of one is the most calls, groups of two is the most rows (a group of
// one saves four rows and adds three), one group is the call that writes it all.
const SETTLE_SERIES = [
  { count: 5, groups: 5 },
  { count: 10, groups: 5 },
  { count: 10, groups: 2 },
  { count: 10, groups: 1 },
]

test("a settle pass after the first writes only the group it delivers, and the reservation covers the whole series, whatever the grouping", async (t) => {
  quiet(t)
  installDiscordAndPortraits(t)
  for (const { count, groups } of SETTLE_SERIES) {
    const series = await settleSeries({ count, groups })
    const units = generationCompletionWriteUnits(count)
    const label = `${count} requests in ${groups} groups`
    t.diagnostic(
      JSON.stringify({
        site: "settle-series",
        count,
        groups,
        units,
        total: series.total,
        passes: series.passes.map((pass) => pass.wrote),
      }),
    )
    assert.ok(series.settled, `${label} did not settle`)
    assert.equal(series.passes.length, groups, "one group is delivered per call")
    // Failure mode 1: a pass costs the group it delivers, not the requests still
    // pending, so every pass after the first writes the same as the last, which
    // has nothing else pending.
    const later = series.passes.slice(1)
    const last = series.passes.at(-1).wrote
    for (const pass of later) {
      assert.equal(
        pass.wrote,
        last,
        `${label}, pass ${pass.pass}: wrote ${pass.wrote}, the last pass ${last}; passes ${JSON.stringify(series.passes.map((p) => p.wrote))} ${JSON.stringify(pass.writers)}`,
      )
    }
    if (later.length) {
      assert.ok(last <= GENERATION_COMPLETION_REQUEST_ROWS * (count / groups), `last pass ${last}`)
    }
    // Failures 4 and 5: the reservation is taken once and covers every pass.
    assert.ok(
      series.total <= units,
      `${label} wrote ${series.total} over ${series.passes.length} passes, the reservation is ${units}: ${JSON.stringify(series.passes.map((pass) => pass.wrote))}`,
    )
    // The reservation is the worst grouping's measured series, not a margin on it.
    if (groups === Math.floor(count / 2)) {
      assert.equal(series.total, units, `${label} is the worst grouping and pins the reservation`)
      assert.equal(
        series.total,
        GENERATION_COMPLETION_FIXED_ROWS +
          GENERATION_COMPLETION_REQUEST_ROWS * count +
          GENERATION_COMPLETION_GROUP_ROWS * (groups - 1),
      )
    }
  }
})

// Failure modes 2, 3 and 6, on the real schema: what the "only what moves"
// conditions must still do.
const RESUME_SQL = /SET updated_at = CURRENT_TIMESTAMP/
const BIND_SQL = /^\s*UPDATE icono_request_notifications\s+SET fulfillment_publication_id/

test("a replay repairs what a crashed pass left unbound or failed, and writes nothing for a request already bound", async (t) => {
  quiet(t)
  const discord = installDiscordAndPortraits(t)
  const { items, ids } = await seedCompletion(3)
  const [first, second, third] = ids
  const publicationId = `publication-receipts-${++counter}`

  // Pass 1 starts all three requests (the trigger creates their notifications on
  // the new publication, group size 3) but Discord refuses the channel.
  discord.failing = true
  const started = await complete({
    items,
    publicationId,
    meter: liveD1Meter(database.db),
  })
  assert.equal(started.body.ok, false)
  const startedStatuses = await database.db
    .prepare(
      "SELECT status FROM icono_generation_requests WHERE id IN (SELECT value FROM json_each(?))",
    )
    .bind(JSON.stringify(ids))
    .all()
  assert.deepEqual(
    startedStatuses.results.map((row) => row.status),
    ["delivery_pending", "delivery_pending", "delivery_pending"],
  )

  // The states an older or interrupted pass leaves behind: the first request on
  // its pre-publication binding (request row and notification), the second
  // notification failed before Discord, the third untouched.
  await database.db.batch([
    database.db
      .prepare(
        "UPDATE icono_generation_requests SET fulfillment_publication_id = ?, fulfillment_group_size = 1 WHERE id = ?",
      )
      .bind(`legacy-request:${first}`, first),
    database.db
      .prepare(
        "UPDATE icono_request_notifications SET fulfillment_publication_id = ?, fulfillment_group_size = 1, discord_status = 'pending', discord_next_attempt_at = NULL WHERE request_id = ?",
      )
      .bind(`legacy-request:${first}`, first),
    database.db
      .prepare(
        "UPDATE icono_request_notifications SET discord_status = 'failed', discord_error = 'Fulfilled portrait download failed (404).', discord_next_attempt_at = NULL WHERE request_id = ?",
      )
      .bind(second),
    database.db
      .prepare(
        "UPDATE icono_request_notifications SET discord_status = 'pending', discord_next_attempt_at = NULL WHERE request_id = ?",
      )
      .bind(third),
  ])

  discord.failing = false
  const meter = liveD1Meter(database.db, { trace: true })
  const replay = await complete({ items, publicationId, meter })
  assert.equal(replay.status, 200, JSON.stringify(replay.body))
  assert.equal(replay.body.ok, true, JSON.stringify(replay.body))
  const rowsWritten = (pattern) =>
    meter.statements.filter(({ sql, rows_written }) => pattern.test(sql) && rows_written > 0).length
  assert.equal(rowsWritten(RESUME_SQL), 1, "only the request on the old binding is rewritten")
  assert.equal(
    rowsWritten(BIND_SQL),
    2,
    "only the notification on the old binding and the failed one are rebound",
  )
  const after = await database.db
    .prepare(
      `SELECT r.id, r.status, r.fulfillment_publication_id AS request_publication,
              r.fulfillment_group_size AS request_size,
              n.fulfillment_publication_id AS notification_publication,
              n.fulfillment_group_size AS notification_size, n.discord_status
         FROM icono_generation_requests r
         JOIN icono_request_notifications n ON n.request_id = r.id
        WHERE r.id IN (SELECT value FROM json_each(?)) ORDER BY r.id`,
    )
    .bind(JSON.stringify(ids))
    .all()
  assert.deepEqual(
    after.results.map((row) => ({ ...row })),
    ids.map((id) => ({
      id,
      status: "fulfilled",
      request_publication: publicationId,
      request_size: 3,
      notification_publication: publicationId,
      notification_size: 3,
      discord_status: "sent",
    })),
  )

  // Every request is settled now: another replay of the same body writes nothing.
  const settledMeter = liveD1Meter(database.db)
  const settled = await complete({ items, publicationId, meter: settledMeter })
  assert.equal(settled.status, 200)
  assert.equal(settled.wrote, 0, "a replay after settlement writes no row")
})

test("a replay never moves a request that belongs to another publication", async (t) => {
  quiet(t)
  const discord = installDiscordAndPortraits(t)
  const { items, ids } = await seedCompletion(1)
  const firstPublication = `publication-receipts-${++counter}`
  discord.failing = true
  await complete({ items, publicationId: firstPublication, meter: liveD1Meter(database.db) })

  const meter = liveD1Meter(database.db, { trace: true })
  const other = await complete({
    items,
    publicationId: `publication-receipts-${++counter}`,
    meter,
  })
  assert.equal(other.status, 409)
  assert.equal(other.body.conflicts[0].reason, "request_already_bound_to_different_publication")
  assert.equal(
    meter.statements.filter(
      ({ sql, rows_written }) => (RESUME_SQL.test(sql) || BIND_SQL.test(sql)) && rows_written > 0,
    ).length,
    0,
  )
  const row = await database.db
    .prepare("SELECT fulfillment_publication_id AS p FROM icono_generation_requests WHERE id = ?")
    .bind(ids[0])
    .first()
  assert.equal(row.p, firstPublication)
})

test("a completion that carries more requests than one claim can lease is refused before any write", async () => {
  const body = {
    publication_id: "publication-too-large-1",
    items: Array.from({ length: GENERATION_COMPLETION_MAX_REQUESTS + 1 }, (_, index) => ({
      request_ids: [index + 1],
    })),
  }
  const meter = liveD1Meter(database.db)
  const response = await completionHandler()({
    match: { route: { id: "authority_generation_lease_complete" }, params: {} },
    request: new Request("https://x.test/api/iconoplasm/authority/generation-leases/complete", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    env: { ICONOPLASM_DB: meter.db },
  })
  const payload = await response.json()
  assert.equal(response.status, 400)
  assert.equal(payload.error.code, "GENERATION_COMPLETION_TOO_LARGE")
  assert.match(payload.error.message, new RegExp(String(GENERATION_COMPLETION_MAX_REQUESTS)))
  assert.equal(meter.totals.calls, 0, "a refused completion never reaches D1")
  // One request, many ids in one item, is the same size.
  const wide = await completionHandler()({
    match: { route: { id: "authority_generation_lease_complete" }, params: {} },
    request: new Request("https://x.test/api/iconoplasm/authority/generation-leases/complete", {
      method: "POST",
      body: JSON.stringify({
        publication_id: "publication-too-large-2",
        items: [
          {
            request_ids: Array.from(
              { length: GENERATION_COMPLETION_MAX_REQUESTS + 1 },
              (_, i) => i + 1,
            ),
          },
        ],
      }),
    }),
    env: { ICONOPLASM_DB: meter.db },
  })
  assert.equal(wide.status, 400)
  assert.equal(meter.totals.calls, 0)
  assert.equal(laptopReservation("authority_generation_lease_complete", body).units, 0)
})

test("the bound a completion is refused at is the largest real publication", () => {
  // Production, read-only, 2026-10-03: 6 publications of exactly 50 requests, the
  // next largest 44. A claim leases at most 50.
  assert.equal(GENERATION_COMPLETION_MAX_REQUESTS, 50)
  assert.equal(generationClaimBounds(1e9).claimLimit, GENERATION_COMPLETION_MAX_REQUESTS)
})

// ---- The gateway: what a request really reserves, in what order ----------

function gatewayFixture(t, providerRowsWritten = 0) {
  const meter = liveD1Meter(database.db)
  const ledger = realBudgetLedger(providerRowsWritten)
  t.after(() => ledger.close())
  const spy = spyOnLedger(ledger)
  const env = {
    ICONOPLASM_DB: meter.db,
    ICONOPLASM_AUTHORING_DB: authoring.db,
    ICONOPLASM_AUTHORITY_GENERATION_TOKEN: GENERATION_TOKEN,
    ICONOPLASM_AUTHORITY_REPLICA_TOKEN: REPLICA_TOKEN,
    ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: spy.namespace,
  }
  async function call(path, body, token = GENERATION_TOKEN) {
    const response = await gateway(
      new Request(`https://the-only-allowed-internal-stateful-worker-do-not-duplicate${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
      { waitUntil() {} },
    )
    return { status: response.status, payload: await response.json().catch(() => null) }
  }
  return { meter, ledger, spy, env, call }
}

const CLAIM = "/api/iconoplasm/authority/generation-leases/claim"
const claimBody = (limit = 50) => ({ lease_owner_id: OWNER, limit, lease_seconds: 900 })

test("an anonymous request touches neither the laptop lane nor the ledger", async (t) => {
  quiet(t)
  for (const token of [null, "wrong-token", REPLICA_TOKEN]) {
    const fixture = gatewayFixture(t)
    const response = await fixture.call(CLAIM, claimBody(50), token)
    assert.equal(response.status, 401, `token ${token}`)
    assert.equal(fixture.spy.calls.length, 0, `token ${token}: a Durable Object request was spent`)
    assert.equal(fixture.meter.totals.calls, 0)
  }
  // The tags submission had the same flaw: a reservation before the bearer check.
  const submit = "/api/iconoplasm/authority/revisions/revision_0001/tags-derivatives"
  const fixture = gatewayFixture(t)
  await fixture.call(submit, { command_id: `anonymous-${Math.random()}` }, null)
  assert.equal(fixture.spy.calls.length, 0, submit)
  await fixture.call(submit, { command_id: `anonymous-${Math.random()}` }, GENERATION_TOKEN)
  assert.equal(fixture.spy.calls.length, 0, `${submit} with the wrong audience`)
})

test("a claim reserves its measured worst case, every time it is sent", async (t) => {
  quiet(t)
  await cancelOpenReceiptRequests()
  const fixture = gatewayFixture(t)
  const first = await fixture.call(CLAIM, claimBody(50))
  const second = await fixture.call(CLAIM, claimBody(50))
  assert.equal(first.status, 200, JSON.stringify(first.payload))
  assert.equal(second.status, 200)
  const reservations = fixture.spy.reservations()
  assert.equal(reservations.length, 2, "an identical claim body is a new claim, not a replay")
  assert.notEqual(reservations[0].operation_id, reservations[1].operation_id)
  for (const reservation of reservations) {
    assert.equal(reservation.lane, "laptop_delivery")
    assert.equal(reservation.units, generationClaimWriteUnits(50))
    assert.match(reservation.operation_id, /^[a-zA-Z0-9_.:@-]{1,255}$/)
  }
  // Metered like the other authority routes: the shared ledger saw the request.
  assert.ok(fixture.spy.calls.some((call) => call.path === "/snapshot"))
  assert.ok(fixture.spy.calls.some((call) => call.path === "/record"))
  assert.ok(fixture.spy.calls.some((call) => call.path === "/complete-mutation-write-reservation"))
})

test("a claim through the gateway quarantines what is permanently gone, and the ledger sees every row it wrote", async (t) => {
  quiet(t)
  await cancelOpenReceiptRequests()
  const { ids } = await seedOpenRequests(30)
  const fixture = gatewayFixture(t)
  const response = await fixture.call(CLAIM, claimBody(5))
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  const { scanLimit } = generationClaimBounds(5)
  assert.equal(response.payload.quarantined_count, scanLimit)
  assert.equal(response.payload.runnable_count, 0)
  const wrote = fixture.meter.totals.rows_written
  assert.equal(wrote, GENERATION_QUARANTINE_ROWS * scanLimit)
  assert.ok(generationClaimWriteUnits(5) >= wrote)
  const recorded = fixture.spy.calls
    .filter((call) => call.path === "/record")
    .reduce((sum, call) => sum + Number(call.rows_written || 0), 0)
  assert.equal(recorded, wrote, "the shared daily ledger counted exactly the rows the claim wrote")
  const cancelled = await database.db
    .prepare(
      "SELECT COUNT(*) AS n FROM icono_generation_requests WHERE id IN (SELECT value FROM json_each(?)) AND status = 'cancelled'",
    )
    .bind(JSON.stringify(ids))
    .first("n")
  assert.equal(cancelled, scanLimit)
})

test("an unreadable claim body reserves nothing and writes nothing", async (t) => {
  quiet(t)
  const fixture = gatewayFixture(t)
  const response = await fixture.call(CLAIM, "{not json")
  assert.equal(response.status, 400)
  assert.equal(response.payload.error.code, "INVALID_JSON")
  assert.equal(fixture.spy.reservations().length, 0)
  assert.equal(fixture.meter.totals.rows_written, 0)
})

// Failure modes 5 and 6, on the real ledger.
test("at the ceiling a claim refuses before any D1 call, and is admitted again when pressure falls", async (t) => {
  quiet(t)
  await cancelOpenReceiptRequests()
  const { ids } = await seedOpenRequests(25)
  const units = generationClaimWriteUnits(50)
  // Room for the old 50 but not for what this claim can write.
  const fixture = gatewayFixture(t, MUTATION_BACKGROUND_CEILING - units + 1)
  const refused = await fixture.call(CLAIM, claimBody(50))
  assert.equal(refused.status, 503)
  assert.equal(refused.payload.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(fixture.meter.totals.calls, 0, "nothing is read or written while the ledger refuses")
  const stillOpen = await database.db
    .prepare(
      "SELECT COUNT(*) AS n FROM icono_generation_requests WHERE id IN (SELECT value FROM json_each(?)) AND status = 'open'",
    )
    .bind(JSON.stringify(ids))
    .first("n")
  assert.equal(stillOpen, ids.length, "a refused claim leaves every request open")

  fixture.ledger.observe(0)
  const admitted = await fixture.call(CLAIM, claimBody(50))
  assert.equal(admitted.status, 200, JSON.stringify(admitted.payload))
  assert.equal(admitted.payload.runnable_count > 0 || admitted.payload.blocked_count >= 0, true)
  assert.ok(fixture.meter.totals.rows_written <= units, JSON.stringify(fixture.meter.totals))
})

test("as pressure rises a claim is refused first, while a renew, a fail and a small completion keep being admitted", async (t) => {
  quiet(t)
  await cancelOpenReceiptRequests()
  const { ids } = await seedOpenRequests(3)
  const renewTarget = await leaseFor(ids[0])
  const failTarget = await leaseFor(ids[1])
  const claimUnits = generationClaimWriteUnits(50)
  // Pressure at which a 50-lease claim no longer fits but a 50-unit operation does.
  const fixture = gatewayFixture(t, MUTATION_BACKGROUND_CEILING - claimUnits + 50)
  const claim = await fixture.call(CLAIM, claimBody(50))
  assert.equal(claim.status, 503)

  const renew = await fixture.call(
    `/api/iconoplasm/authority/generation-leases/${renewTarget.lease.generation_lease_token}/renew`,
    {
      lease_owner_id: OWNER,
      expected_lease_version: renewTarget.lease.generation_lease_version,
      lease_seconds: 900,
    },
  )
  assert.equal(renew.status, 200, JSON.stringify(renew.payload))
  assert.equal(
    renew.payload.generation_lease_version,
    renewTarget.lease.generation_lease_version + 1,
  )
  const fail = await fixture.call(
    `/api/iconoplasm/authority/generation-leases/${failTarget.lease.generation_lease_token}/fail`,
    {
      lease_owner_id: OWNER,
      expected_lease_version: failTarget.lease.generation_lease_version,
      failure_code: "executor_failed",
    },
  )
  assert.equal(fail.status, 200, JSON.stringify(fail.payload))
  const sizes = fixture.spy.reservations().map((reservation) => reservation.units)
  assert.deepEqual(sizes.slice(-2), [MUTATION_WRITE_FLOOR_UNITS, MUTATION_WRITE_FLOOR_UNITS])
  for (const reservation of fixture.spy.reservations().slice(-2)) {
    assert.equal(reservation.lane, "laptop_delivery")
  }
})

test("a refused renew leaves the lease as it was, and the identical renew is admitted when pressure falls", async (t) => {
  quiet(t)
  await cancelOpenReceiptRequests()
  const { ids } = await seedOpenRequests(1)
  const target = await leaseFor(ids[0])
  const fixture = gatewayFixture(t, MUTATION_BACKGROUND_CEILING - MUTATION_WRITE_FLOOR_UNITS + 1)
  const path = `/api/iconoplasm/authority/generation-leases/${target.lease.generation_lease_token}/renew`
  const body = {
    lease_owner_id: OWNER,
    expected_lease_version: target.lease.generation_lease_version,
    lease_seconds: 900,
  }
  const refused = await fixture.call(path, body)
  assert.equal(refused.status, 503)
  assert.equal(fixture.meter.totals.rows_written, 0)
  const unchanged = await database.db
    .prepare(
      "SELECT lease_version, expires_at FROM icono_generation_execution_leases WHERE lease_token = ?",
    )
    .bind(target.lease.generation_lease_token)
    .first()
  assert.equal(unchanged.lease_version, target.lease.generation_lease_version)
  assert.equal(unchanged.expires_at, target.lease.generation_lease_expires_at)

  fixture.ledger.observe(0)
  const admitted = await fixture.call(path, body)
  assert.equal(admitted.status, 200, JSON.stringify(admitted.payload))
  // The same body again is the same operation: it replays, and the version fence
  // answers it, so a retry after a lost response costs no second reservation.
  const reservationsAfterAdmit = fixture.spy.reservations().length
  const replay = await fixture.call(path, body)
  assert.equal(replay.status, 409)
  assert.equal(fixture.spy.reservations().length, reservationsAfterAdmit + 1)
  assert.equal(
    fixture.spy.reservations().at(-1).operation_id,
    fixture.spy.reservations().at(-2).operation_id,
    "an identical renew is one operation",
  )
})

test("reading a lease's material is metered but reserves no write capacity, even at the ceiling", async (t) => {
  quiet(t)
  await cancelOpenReceiptRequests()
  const { ids } = await seedOpenRequests(1)
  const target = await leaseFor(ids[0])
  const fixture = gatewayFixture(t, MUTATION_BACKGROUND_CEILING - MUTATION_WRITE_FLOOR_UNITS + 1)
  const response = await fixture.call(
    `/api/iconoplasm/authority/generation-leases/${target.lease.generation_lease_token}/material`,
    { lease_owner_id: OWNER, expected_lease_version: target.lease.generation_lease_version },
  )
  // The exact source is not seeded, so the handler answers with its own error;
  // what matters is that admission did not refuse a read and did not reserve.
  assert.equal(
    response.payload?.error?.code,
    "CANONICAL_GENERATION_SOURCE_NOT_FOUND",
    `the request reached its handler, not an admission refusal: ${JSON.stringify(response.payload)}`,
  )
  assert.equal(fixture.spy.reservations().length, 0)
  assert.ok(fixture.spy.calls.some((call) => call.path === "/snapshot"))
})

test("an oversized completion reserves nothing, and a refused small one is untouched and retryable", async (t) => {
  quiet(t)
  const fixture = gatewayFixture(t)
  const oversized = await fixture.call("/api/iconoplasm/authority/generation-leases/complete", {
    publication_id: "publication-gateway-oversize",
    items: Array.from({ length: GENERATION_COMPLETION_MAX_REQUESTS + 1 }, (_, i) => ({
      request_ids: [i + 1],
    })),
  })
  assert.equal(oversized.status, 400)
  assert.equal(oversized.payload.error.code, "GENERATION_COMPLETION_TOO_LARGE")
  assert.equal(fixture.spy.reservations().length, 0)
  assert.equal(fixture.meter.totals.rows_written, 0)

  const small = {
    publication_id: "publication-gateway-small",
    items: [{ request_ids: [1] }],
  }
  const ceiling = gatewayFixture(t, MUTATION_BACKGROUND_CEILING - MUTATION_WRITE_FLOOR_UNITS + 1)
  const refused = await ceiling.call("/api/iconoplasm/authority/generation-leases/complete", small)
  assert.equal(refused.status, 503)
  assert.equal(ceiling.meter.totals.calls, 0)
  ceiling.ledger.observe(0)
  const admitted = await ceiling.call("/api/iconoplasm/authority/generation-leases/complete", small)
  assert.notEqual(admitted.status, 503, JSON.stringify(admitted.payload))
  assert.equal(ceiling.spy.reservations().at(-1).units, generationCompletionWriteUnits(1))
})

// The guard: a sixth laptop route cannot repeat B-944.
const SAMPLE_PATHS = {
  authority_generation_lease_claim: [
    "/api/iconoplasm/authority/generation-leases/claim",
    GENERATION_TOKEN,
    claimBody(3),
  ],
  authority_generation_lease_material: [
    "/api/iconoplasm/authority/generation-leases/lease_token_0001/material",
    GENERATION_TOKEN,
    { lease_owner_id: OWNER, expected_lease_version: 1 },
  ],
  authority_generation_lease_renew: [
    "/api/iconoplasm/authority/generation-leases/lease_token_0001/renew",
    GENERATION_TOKEN,
    { lease_owner_id: OWNER, expected_lease_version: 1, lease_seconds: 900 },
  ],
  authority_generation_lease_fail: [
    "/api/iconoplasm/authority/generation-leases/lease_token_0001/fail",
    GENERATION_TOKEN,
    { lease_owner_id: OWNER, expected_lease_version: 1, failure_code: "executor_failed" },
  ],
  authority_generation_lease_complete: [
    "/api/iconoplasm/authority/generation-leases/complete",
    GENERATION_TOKEN,
    { publication_id: "publication-guard-0001", items: [{ request_ids: [1] }] },
  ],
  authority_system_revision_append: [
    "/api/iconoplasm/authority/genes/gene_0001/system-revisions",
    REPLICA_TOKEN,
    { command_id: "command_guard_0003", prose: "A regenerated text." },
  ],
  authority_tags_derivative_submit: [
    "/api/iconoplasm/authority/revisions/revision_0001/tags-derivatives",
    REPLICA_TOKEN,
    { command_id: "command_guard_0001", status: "failed" },
  ],
  authority_tags_derivative_select: [
    "/api/iconoplasm/authority/revisions/revision_0001/tags-derivative-head",
    REPLICA_TOKEN,
    { command_id: "command_guard_0002", manifestation_derivative_id: "derivative_guard_0001" },
  ],
}

test("every route classed workstation_sync_write is metered and sized, or admitted by the operation-cost authority", async (t) => {
  quiet(t)
  const classed = ICONOPLASM_ROUTE_CONTRACTS.filter(
    (route) =>
      iconoplasmBudgetClassFromRouteFamily(route.budgetFamily) === "workstation_sync_write",
  ).map((route) => route.id)
  assert.deepEqual(
    [...classed].sort(),
    Object.keys(SAMPLE_PATHS).sort(),
    "a route was added or removed: give it a sample here and a sizing in the write-bounds module",
  )
  // The head selection is answered by the operation-cost authority before the
  // budget wrapper (its own declared bound), so the laptop lane never sees it.
  const operationCost = classed.filter((routeId) =>
    isReplicaCostRoute("POST", SAMPLE_PATHS[routeId][0]),
  )
  assert.deepEqual(operationCost, ["authority_tags_derivative_select"])
  const sized = classed.filter((routeId) => !operationCost.includes(routeId))
  assert.deepEqual([...LAPTOP_RESERVATION_ROUTE_IDS].sort(), [...sized].sort())
  for (const routeId of sized) {
    const [path, token, body] = SAMPLE_PATHS[routeId]
    const route = ICONOPLASM_ROUTE_CONTRACTS.find((entry) => entry.id === routeId)
    assert.equal(
      route.auth.endsWith("-bearer"),
      true,
      `${routeId} must name the bearer that guards it`,
    )
    const fixture = gatewayFixture(t)
    await fixture.call(path, body, token)
    assert.ok(
      fixture.spy.calls.some((call) => call.path === "/snapshot"),
      `${routeId} is not metered into the daily ledger`,
    )
    const reserved = laptopReservation(routeId, body)
    assert.equal(
      fixture.spy.reservations().length,
      reserved.units > 0 ? 1 : 0,
      `${routeId} reserved ${fixture.spy.reservations().length}, sizing says ${reserved.units}`,
    )
    if (reserved.units > 0) {
      assert.equal(fixture.spy.reservations()[0].units, reserved.units)
      assert.equal(fixture.spy.reservations()[0].lane, "laptop_delivery")
    }
  }
  // The one route that writes nothing says so, and the test above measured it.
  const readsOnly = sized.filter(
    (routeId) => laptopReservation(routeId, SAMPLE_PATHS[routeId][2]).units === 0,
  )
  assert.deepEqual(readsOnly, ["authority_generation_lease_material"])
})
