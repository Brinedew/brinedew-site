import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import {
  preflightOperationCostRelease,
  verifyReleaseAuthentication,
  requireReleaseSharedCapacity,
  chooseReleaseAdmission,
} from "./preflight-operation-cost-release.mjs"
import { ACCOUNT_CEILINGS } from "../workers/lib/operation-cost-ledger.js"

const releaseManifest = JSON.parse(
  readFileSync(new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url)),
)
// Historical four-migration fixture retains its original boundary regressions.
const manifest = {
  ...releaseManifest,
  catalog_initialization_prediction: undefined,
  migrations: Object.fromEntries(
    Object.entries(releaseManifest.migrations).filter(([key]) => /\/(0094|001[234])_/.test(key)),
  ),
}
const time = Date.parse("2026-09-05T12:00:00Z")
const sample = {
  day: "2026-09-05",
  measured_at: time,
  rows_read: 0,
  rows_written: 0,
  requests: 0,
  kv_measured_at: time,
  kv_reads: 0,
  kv_writes: 0,
  kv_deletes: 0,
  kv_lists: 0,
}
const check = (observed, plan = manifest) =>
  preflightOperationCostRelease({
    manifest: plan,
    reader: { refresh: async () => observed },
    now: () => time,
  })

test("low provider usage cannot admit a release over retained shared reservations", async () => {
  const release = await check(sample)
  const capacity = {
    day: sample.day,
    measured_at: time,
    remaining: { rows_read: 1000000 - 753048, rows_written: 20000 - 256, requests: 2300 },
  }
  assert.throws(
    () => requireReleaseSharedCapacity(release.maximum, capacity, time),
    /COST_RELEASE_SHARED_HEADROOM: rows_read/,
  )
  requireReleaseSharedCapacity({ rows_read: 1000, rows_written: 0, requests: 40 }, capacity, time)
  for (const invalid of [
    null,
    { ...capacity, measured_at: time - 60001 },
    { ...capacity, measured_at: time + 1 },
    { ...capacity, day: "2026-09-04" },
    { ...capacity, remaining: { ...capacity.remaining, rows_read: NaN } },
  ])
    assert.throws(
      () => requireReleaseSharedCapacity(release.maximum, invalid, time),
      /COST_SHARED_USAGE_UNAVAILABLE/,
    )
})

test("shared reservations also count against account headroom before pausing application traffic", () => {
  const maximum = { rows_read: 1000, rows_written: 0, requests: 40 }
  const capacity = {
    day: sample.day,
    measured_at: time,
    used: { rows_read: 753048, rows_written: 256, requests: 100 },
    remaining: { rows_read: 246952, rows_written: 19744, requests: 2300 },
  }
  assert.throws(
    () =>
      requireReleaseSharedCapacity(maximum, capacity, time, {
        ...sample,
        rows_read: ACCOUNT_CEILINGS.rows_read - 753048,
      }),
    /COST_RELEASE_ACCOUNT_HEADROOM: rows_read/,
  )
  requireReleaseSharedCapacity(maximum, capacity, time, sample)
})

test("a working site cannot enter maintenance without full headroom; a paused site can resume bounded pages", async () => {
  const options = {
    manifest: releaseManifest,
    pendingMigrations: ["iconoplasm/0095_transactional_admin_counts.sql"],
    now: time,
    result: {
      maximum: { rows_read: 718916, rows_written: 19980, requests: 416 },
      observed: sample,
    },
    capacity: {
      day: sample.day,
      measured_at: time,
      used: { rows_read: 840000, rows_written: 256, requests: 500 },
      remaining: { rows_read: 160000, rows_written: 19744, requests: 1900 },
    },
  }
  await assert.rejects(
    chooseReleaseAdmission({ ...options, readMaintenance: async () => false }),
    /SHARED_HEADROOM/,
  )
  const admitted = await chooseReleaseAdmission({ ...options, readMaintenance: async () => true })
  assert.equal(admitted.mode, "resume-existing-maintenance")
  assert.equal(admitted.maximum.rows_read, 42252)
  await assert.rejects(
    chooseReleaseAdmission({
      ...options,
      capacity: {
        ...options.capacity,
        remaining: { ...options.capacity.remaining, rows_read: 100 },
      },
      readMaintenance: async () => true,
    }),
    /SHARED_HEADROOM/,
  )
  await assert.rejects(
    chooseReleaseAdmission({
      ...options,
      pendingMigrations: ["iconoplasm/0096_request_inbox_counters.sql"],
      readMaintenance: async () => true,
    }),
    /SHARED_HEADROOM/,
  )
})

test("release authentication is checked without D1 work, redirects or credential output", async () => {
  let calls = 0
  const fetcher = async (url, options) => {
    calls++
    assert.equal(url, "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations")
    assert.equal(options.method, "HEAD")
    assert.equal(options.redirect, "error")
    assert.equal(options.headers["x-iconoplasm-admin-token"], "test-secret")
    return new Response(null)
  }
  await assert.rejects(verifyReleaseAuthentication({ fetcher }), /TOKEN_REQUIRED/)
  assert.equal(calls, 0)
  await verifyReleaseAuthentication({ token: "test-secret", fetcher })
  assert.equal(calls, 1)
  for (const status of [401, 403, 429, 503])
    await assert.rejects(
      verifyReleaseAuthentication({
        token: "test-secret",
        fetcher: async () => new Response(null, { status }),
      }),
      status === 401 || status === 403 ? /AUTHENTICATION_FAILED/ : /ADMISSION_UNAVAILABLE_HTTP_/,
    )
})

test("release reserves headroom for all reviewed migrations and three inventories", async () => {
  const result = await check(sample)
  // Includes the reviewed 0014 lineage migration as well as the prior three.
  assert.deepEqual(result.required, { rows_read: 825156, rows_written: 20880, requests: 416 })
  for (const meter of Object.keys(ACCOUNT_CEILINGS)) {
    const boundary = { ...sample, [meter]: ACCOUNT_CEILINGS[meter] - result.required[meter] }
    await check(boundary)
    await assert.rejects(
      check({ ...boundary, [meter]: boundary[meter] + 1 }),
      /COST_RELEASE_ACCOUNT_HEADROOM/,
    )
  }
})

test("the counter release fits protected capacity only after historical migrations are verified applied", async () => {
  const options = {
    manifest: releaseManifest,
    reader: { refresh: async () => sample },
    now: () => time,
  }
  await assert.rejects(preflightOperationCostRelease(options), /EXCEEDS_DAILY_ALLOCATION/)
  const pendingMigrations = [
    "iconoplasm-authoring/0017_canonical_lifecycle_keyed_guards.sql",
    "iconoplasm/0095_transactional_admin_counts.sql",
    "iconoplasm/0096_request_inbox_counters.sql",
    "iconoplasm/0097_delivery_reconciliation_cursor.sql",
    "iconoplasm-authoring/0015_retire_materialized_snapshot_parts.sql",
    "iconoplasm-authoring/0016_account_assignment_lookup.sql",
    "iconoplasm/0098_vote_projection_job_version.sql",
  ]
  const result = await preflightOperationCostRelease({ ...options, pendingMigrations })
  assert.equal(result.maximum.rows_read, 718916)
  assert.equal(result.maximum.rows_written, 19980)
  assert.equal(result.maximum.kv_reads, 5)
  assert.equal(result.maximum.kv_writes, 1)
  await preflightOperationCostRelease({
    ...options,
    pendingMigrations,
    reader: { refresh: async () => ({ ...sample, kv_deletes: 1000, kv_lists: 1000 }) },
  })
  await assert.rejects(
    preflightOperationCostRelease({
      ...options,
      pendingMigrations,
      reader: { refresh: async () => ({ ...sample, kv_writes: 700 }) },
    }),
    /ACCOUNT_HEADROOM/,
  )
})

test("missing, stale, future, wrong-day and malformed telemetry fail closed", async () => {
  for (const observed of [
    null,
    { ...sample, measured_at: time - 60001 },
    { ...sample, measured_at: time + 1 },
    { ...sample, day: "2026-09-04" },
    { ...sample, rows_read: NaN },
    { ...sample, requests: -1 },
  ])
    await assert.rejects(check(observed), /COST_ACCOUNT_USAGE_UNAVAILABLE/)
  await assert.rejects(
    preflightOperationCostRelease({
      manifest,
      reader: {
        refresh: async () => {
          throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
        },
      },
    }),
    /COST_ACCOUNT_USAGE_UNAVAILABLE/,
  )
})

test("applied migrations do not consume new-release headroom; unknown or duplicate pending names fail closed", async () => {
  const verify = (pendingMigrations) =>
    preflightOperationCostRelease({
      manifest,
      pendingMigrations,
      reader: { refresh: async () => sample },
      now: () => time,
    })
  const none = await verify([])
  assert.deepEqual(none.required, { rows_read: 15900, rows_written: 0, requests: 416 })
  assert.equal(none.maximum.rows_written, 0)
  const key = "iconoplasm-authoring/0013_strict_upload_reservations.sql"
  const one = await verify([key])
  assert.equal(one.required.rows_written, 32)
  assert.equal(one.required.rows_read, 20252)
  assert.ok(one.maximum.rows_written > 0)
  await assert.rejects(verify([key, key]), /MIGRATION_NOT_REVIEWED/)
  await assert.rejects(verify(["iconoplasm/unknown.sql"]), /MIGRATION_NOT_REVIEWED/)
})

test("invalid forecast fails before contacting Cloudflare", async () => {
  let calls = 0
  for (const plan of [
    {},
    { ...manifest, inventory_prediction: { rows_read: 1, rows_written: 0, requests: 0 } },
    {
      ...manifest,
      migrations: {
        invalid: {
          prediction: { rows_read: Number.MAX_SAFE_INTEGER, rows_written: 0, requests: 1 },
        },
      },
    },
  ])
    await assert.rejects(
      preflightOperationCostRelease({
        manifest: plan,
        reader: {
          refresh: async () => {
            calls++
            return sample
          },
        },
      }),
      /COST_(MIGRATION_PLAN|PREDICTION)_REQUIRED/,
    )
  assert.equal(calls, 0)
})

test("normal release checks capacity before mutations and refreshes before staging", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const initial = workflow.indexOf("run: node scripts/preflight-operation-cost-release.mjs")
  const refresh = workflow.lastIndexOf("run: node scripts/preflight-operation-cost-release.mjs")
  assert.ok(
    initial > 0 &&
      initial < workflow.indexOf("run: node scripts/reconcile-iconoplasm-crawler-policy.mjs"),
  )
  const staging = workflow.indexOf("- name: Stage migration admission in the existing state owner")
  assert.ok(refresh > initial && refresh < staging)
  assert.match(
    workflow.slice(staging, workflow.indexOf("ICONOPLASM_SCHEMA_TRANSITION:1", staging)),
    /if: steps\.release-state\.outputs\.schema_transition != 'true'/,
  )
})

test("underfunded, invalid and oversized migration work is refused before telemetry or deployment", async () => {
  let calls = 0
  const verify = (plan) =>
    preflightOperationCostRelease({
      manifest: plan,
      reader: {
        refresh: async () => {
          calls++
          return sample
        },
      },
      now: () => time,
    })
  const original = manifest.migrations["iconoplasm/0094_finalization_summary.sql"]
  const replace = (item) => ({
    ...manifest,
    migrations: { ...manifest.migrations, "iconoplasm/0094_finalization_summary.sql": item },
  })
  await assert.rejects(
    verify(replace({ ...original, prediction: { ...original.prediction, rows_read: 1 } })),
    /TWICE_PREDICTION_LIMIT/,
  )
  await assert.rejects(
    verify(replace({ ...original, adapter_id: "unreviewed" })),
    /MIGRATION_NOT_REVIEWED/,
  )
  await assert.rejects(
    verify(replace({ ...original, arguments: { max_rows: -1, max_unfinished: 0 } })),
    /MIGRATION_ARGUMENTS_INVALID/,
  )
  await assert.rejects(
    verify(
      replace({
        ...original,
        arguments: { max_rows: 21000, max_unfinished: 0 },
        prediction: { rows_read: 200000, rows_written: 15000, requests: 1 },
      }),
    ),
    /EXCEEDS_DAILY_ALLOCATION/,
  )
  assert.equal(calls, 0)
})
