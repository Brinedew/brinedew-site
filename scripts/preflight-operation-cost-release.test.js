import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import {
  preflightOperationCostRelease,
  verifyReleaseAuthentication,
} from "./preflight-operation-cost-release.mjs"
import { ACCOUNT_CEILINGS } from "../workers/lib/operation-cost-ledger.js"

const manifest = JSON.parse(
  readFileSync(new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url)),
)
const time = Date.parse("2026-09-05T12:00:00Z")
const sample = { day: "2026-09-05", measured_at: time, rows_read: 0, rows_written: 0, requests: 0 }
const check = (observed, plan = manifest) =>
  preflightOperationCostRelease({
    manifest: plan,
    reader: { refresh: async () => observed },
    now: () => time,
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
  assert.deepEqual(result.required, { rows_read: 812856, rows_written: 20880, requests: 40 })
  for (const meter of Object.keys(ACCOUNT_CEILINGS)) {
    const boundary = { ...sample, [meter]: ACCOUNT_CEILINGS[meter] - result.required[meter] }
    await check(boundary)
    await assert.rejects(
      check({ ...boundary, [meter]: boundary[meter] + 1 }),
      /COST_RELEASE_ACCOUNT_HEADROOM/,
    )
  }
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
  assert.ok(refresh > initial && refresh < workflow.indexOf("ICONOPLASM_SCHEMA_TRANSITION:1"))
  assert.match(
    workflow.slice(refresh, workflow.indexOf("ICONOPLASM_SCHEMA_TRANSITION:1")),
    /Stage migration admission/,
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
