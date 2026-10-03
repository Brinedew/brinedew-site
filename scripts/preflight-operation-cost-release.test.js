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
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { createMigrationOperationCostAdapters } from "../workers/iconoplasm/operation-cost-migration-adapters.js"
import { createSchemaDropMigrationCostAdapter } from "../workers/iconoplasm/operation-cost-schema-drop-migration-adapter.js"

// The release preflight decides, before any application traffic pauses,
// whether a release fits. Its job does not depend on which migration is
// pending, so these tests drive it with synthetic pending migrations built
// from the generic schema-drop adapter. Failure modes, written first:
// 1. A pending migration's prediction or bound is missing from the headroom
//    the release reserves, so a release that cannot finish is admitted.
// 2. A pending migration with an unreviewed adapter, a retired protocol,
//    invalid arguments, a bound over twice its prediction or a bound over the
//    daily allocation is admitted.
// 3. A working site enters maintenance without full headroom.
// 4. A paused site cannot resume its first staged migration when that one
//    fits (the repair path), or resumes one that does not fit, or resumes a
//    migration that is not staged.
// 5. Missing, stale, future, wrong-day or malformed telemetry reads as headroom.
// 6. An unknown or duplicated pending name is admitted.
// 7. The catalog initialization's key-value reads and writes leave the sum.
const releaseManifest = JSON.parse(
  readFileSync(new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url)),
)
const staged = (index) => ({
  key: `iconoplasm/900${index}_synthetic_drop.sql`,
  adapterId: `iconoplasm-migration-900${index}`,
  entry: {
    adapter_id: `iconoplasm-migration-900${index}`,
    arguments: { max_schema_rows: 512 },
    migration_protocol: "one-migration-per-release-v1",
    prediction: { rows_read: 3000, rows_written: 16, requests: 1 },
  },
})
const [first, second] = [staged(1), staged(2)]
// The schema-drop bound is eight passes over the admitted 512-row schema plus
// 256 rows, and 32 rows written.
const DROP_BOUND = { rows_read: 8 * 512 + 256, rows_written: 32 }
// Three inventories each read the schema objects and the applied journal.
const INVENTORY_READS = 3 * (2050 + 1026)
const syntheticAdapters = () => {
  const adapters = createMigrationOperationCostAdapters({}, OPERATION_COST_IDENTITIES)
  for (const { key, adapterId } of [first, second])
    adapters.set(
      adapterId,
      createSchemaDropMigrationCostAdapter({
        db: null,
        name: key.slice(key.indexOf("/") + 1),
        statements: ["DROP TABLE IF EXISTS icono_synthetic_probe;"],
        ...OPERATION_COST_IDENTITIES,
      }),
    )
  return adapters
}
const manifest = {
  ...releaseManifest,
  catalog_initialization_prediction: undefined,
  migrations: { [first.key]: first.entry, [second.key]: second.entry },
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
const check = (observed, plan = manifest, extra = {}) =>
  preflightOperationCostRelease({
    manifest: plan,
    reader: { refresh: async () => observed },
    now: () => time,
    adapters: syntheticAdapters(),
    ...extra,
  })

test("low provider usage cannot admit a release over retained shared reservations", () => {
  const capacity = {
    day: sample.day,
    measured_at: time,
    remaining: { rows_read: 1000000 - 753048, rows_written: 20000 - 256, requests: 2300 },
  }
  const maximum = { rows_read: capacity.remaining.rows_read, rows_written: 0, requests: 40 }
  requireReleaseSharedCapacity(maximum, capacity, time)
  assert.throws(
    () =>
      requireReleaseSharedCapacity(
        { ...maximum, rows_read: maximum.rows_read + 1 },
        capacity,
        time,
      ),
    /COST_RELEASE_SHARED_HEADROOM: rows_read/,
  )
  for (const invalid of [
    null,
    { ...capacity, measured_at: time - 60001 },
    { ...capacity, measured_at: time + 1 },
    { ...capacity, day: "2026-09-04" },
    { ...capacity, remaining: { ...capacity.remaining, rows_read: NaN } },
  ])
    assert.throws(
      () => requireReleaseSharedCapacity(maximum, invalid, time),
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

test("a working site cannot enter maintenance without full headroom; a paused site can resume its first staged migration", async () => {
  const options = {
    manifest,
    pendingMigrations: [first.key, second.key],
    adapters: syntheticAdapters(),
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
  // Only the first staged migration and the inventories are reserved.
  assert.equal(admitted.maximum.rows_read, DROP_BOUND.rows_read + INVENTORY_READS)
  assert.equal(admitted.maximum.rows_written, DROP_BOUND.rows_written)
  await assert.rejects(
    chooseReleaseAdmission({
      ...options,
      capacity: {
        ...options.capacity,
        remaining: { ...options.capacity.remaining, rows_read: DROP_BOUND.rows_read },
      },
      readMaintenance: async () => true,
    }),
    /SHARED_HEADROOM/,
  )
  const { migration_protocol: _protocol, ...unstaged } = first.entry
  await assert.rejects(
    chooseReleaseAdmission({
      ...options,
      manifest: { ...manifest, migrations: { ...manifest.migrations, [first.key]: unstaged } },
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

test("release reserves headroom for every pending migration and three inventories", async () => {
  const result = await check(sample)
  assert.deepEqual(result.required, {
    rows_read: 15900 + 2 * 2 * first.entry.prediction.rows_read,
    rows_written: 2 * 2 * first.entry.prediction.rows_written,
    requests: 416,
  })
  for (const meter of Object.keys(ACCOUNT_CEILINGS)) {
    const boundary = { ...sample, [meter]: ACCOUNT_CEILINGS[meter] - result.required[meter] }
    await check(boundary)
    await assert.rejects(
      check({ ...boundary, [meter]: boundary[meter] + 1 }),
      /COST_RELEASE_ACCOUNT_HEADROOM/,
    )
  }
})

test("catalog initialization keeps its key-value reads and writes in the release sum", async () => {
  const options = {
    manifest: releaseManifest,
    pendingMigrations: [],
    reader: { refresh: async () => sample },
    now: () => time,
  }
  const result = await preflightOperationCostRelease(options)
  assert.equal(result.maximum.kv_reads, 10)
  assert.equal(result.maximum.kv_writes, 1)
  await preflightOperationCostRelease({
    ...options,
    reader: { refresh: async () => ({ ...sample, kv_deletes: 1000, kv_lists: 1000 }) },
  })
  await assert.rejects(
    preflightOperationCostRelease({
      ...options,
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
      adapters: syntheticAdapters(),
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
  const verify = (pendingMigrations) => check(sample, manifest, { pendingMigrations })
  const none = await verify([])
  assert.deepEqual(none.required, { rows_read: 15900, rows_written: 0, requests: 160 })
  assert.equal(none.maximum.rows_written, 0)
  const one = await verify([first.key])
  assert.equal(one.required.rows_written, 2 * first.entry.prediction.rows_written)
  assert.equal(one.required.rows_read, 15900 + 2 * first.entry.prediction.rows_read)
  assert.equal(one.maximum.rows_written, DROP_BOUND.rows_written)
  assert.equal(one.maximum.rows_read - none.maximum.rows_read, DROP_BOUND.rows_read)
  await assert.rejects(verify([first.key, first.key]), /MIGRATION_NOT_REVIEWED/)
  await assert.rejects(verify(["iconoplasm/unknown.sql"]), /MIGRATION_NOT_REVIEWED/)
})

test("an empty plan reserves the three inventories and nothing else", async () => {
  const result = await preflightOperationCostRelease({
    manifest: { ...releaseManifest, catalog_initialization_prediction: undefined, migrations: {} },
    reader: { refresh: async () => sample },
    now: () => time,
  })
  assert.deepEqual(result.required, { rows_read: 15900, rows_written: 0, requests: 160 })
  assert.equal(result.maximum.rows_read, INVENTORY_READS)
  assert.equal(result.maximum.rows_written, 0)
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

test("explicit maintenance checks capacity before mutations and refreshes before staging", () => {
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
    /if: inputs\.data_maintenance == true && steps\.release-state\.outputs\.schema_transition != 'true'/,
  )
})

test("underfunded, invalid and oversized migration work is refused before telemetry or deployment", async () => {
  let calls = 0
  const oversized = {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    prepare: async () => ({
      bound: { rows_read: ACCOUNT_CEILINGS.rows_read, rows_written: 0, requests: 1 },
    }),
  }
  const verify = (item, extra = {}) =>
    preflightOperationCostRelease({
      manifest: { ...manifest, migrations: { [first.key]: item } },
      adapters: syntheticAdapters(),
      reader: {
        refresh: async () => {
          calls++
          return sample
        },
      },
      now: () => time,
      ...extra,
    })
  const original = first.entry
  await assert.rejects(
    verify({ ...original, prediction: { ...original.prediction, rows_read: 1 } }),
    /TWICE_PREDICTION_LIMIT/,
  )
  await assert.rejects(verify({ ...original, adapter_id: "unreviewed" }), /MIGRATION_NOT_REVIEWED/)
  await assert.rejects(
    verify({ ...original, arguments: { max_schema_rows: -1 } }),
    /MIGRATION_ARGUMENTS_INVALID/,
  )
  for (const protocol of ["admin-count-seed-v1", "unreviewed-protocol"])
    await assert.rejects(
      verify({ ...original, migration_protocol: protocol }),
      /COST_MIGRATION_PROTOCOL_INVALID/,
    )
  const adapters = syntheticAdapters()
  adapters.set(first.adapterId, oversized)
  await assert.rejects(
    verify(
      {
        ...original,
        prediction: { rows_read: ACCOUNT_CEILINGS.rows_read, rows_written: 0, requests: 1 },
      },
      { adapters },
    ),
    /EXCEEDS_DAILY_ALLOCATION/,
  )
  assert.equal(calls, 0)
})
