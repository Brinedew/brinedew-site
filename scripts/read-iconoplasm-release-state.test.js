import assert from "node:assert/strict"
import test from "node:test"
import {
  readIconoplasmReleaseState,
  requireReaderRecoveryHeadroom,
  selectReleaseOriginRunId,
} from "./read-iconoplasm-release-state.mjs"

const credentials = { accountId: "a".repeat(32), token: "test-private-token" }
const binding = (name, text) => ({ name, type: "plain_text", text })

test("release state comes from the installed setting, independent of reader availability", async () => {
  for (const transition of ["0", "1"]) {
    let calls = 0
    const state = await readIconoplasmReleaseState({
      ...credentials,
      fetcher: async (url, options) => {
        calls++
        assert.equal(
          url,
          `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/workers/scripts/geneguessr-api/settings`,
        )
        assert.equal(options.redirect, "error")
        assert.ok(options.signal)
        return Response.json({
          success: true,
          result: {
            bindings: [
              binding("ICONOPLASM_SCHEMA_TRANSITION", transition),
              binding("ICONOPLASM_SCHEMA_TRANSITION_MODE", "reader-recovery"),
              binding("UNRELATED_SECRET", "must-not-be-returned"),
            ],
          },
        })
      },
    })
    assert.deepEqual(state, {
      schema_transition: transition === "1",
      reader_recovery: true,
      origin_run_id: "",
    })
    assert.equal(calls, 1)
    assert.doesNotMatch(JSON.stringify(state), /private|must-not/)
  }
})

test("an active transition retains its original run across pushes and cannot silently renew a migration", () => {
  const active = { schema_transition: true, origin_run_id: "123" }
  assert.equal(selectReleaseOriginRunId(active, "456"), "123")
  assert.equal(selectReleaseOriginRunId(active, "456", "123"), "123")
  assert.throws(() => selectReleaseOriginRunId(active, "456", "999"), /MUST_PRESERVE_ORIGIN/)
  assert.throws(
    () => selectReleaseOriginRunId({ ...active, origin_run_id: "" }, "456"),
    /RESUME_RUN_REQUIRED/,
  )
  assert.equal(selectReleaseOriginRunId({ ...active, origin_run_id: "" }, "456", "123"), "123")
  assert.equal(selectReleaseOriginRunId({ schema_transition: false }, "456"), "456")
  assert.throws(
    () => selectReleaseOriginRunId({ schema_transition: false }, "456", "123"),
    /REQUIRES_MAINTENANCE/,
  )
})

test("ambiguous or unavailable installed state never authorizes a maintenance refresh", async () => {
  for (const result of [
    {},
    { bindings: [binding("ICONOPLASM_SCHEMA_TRANSITION", "unknown")] },
    {
      bindings: [
        binding("ICONOPLASM_SCHEMA_TRANSITION", "1"),
        binding("ICONOPLASM_SCHEMA_TRANSITION", "0"),
      ],
    },
    { bindings: [{ name: "ICONOPLASM_SCHEMA_TRANSITION", type: "secret_text" }] },
  ]) {
    await assert.rejects(
      readIconoplasmReleaseState({
        ...credentials,
        fetcher: async () => Response.json({ success: true, result }),
      }),
      /COST_RELEASE_STATE_(INVALID|UNAVAILABLE)/,
    )
  }
  await assert.rejects(
    readIconoplasmReleaseState({
      ...credentials,
      fetcher: async () => new Response("private-provider-prose", { status: 403 }),
    }),
    /^Error: COST_RELEASE_STATE_UNAVAILABLE$/,
  )
})

test("zero-D1 reader recovery preserves Worker and KV headroom even when D1 is exhausted", () => {
  const now = Date.parse("2026-09-08T12:00:00Z")
  const sample = {
    day: "2026-09-08",
    measured_at: now,
    kv_measured_at: now,
    requests: 5000,
    kv_reads: 1000,
    rows_read: 5000000,
    rows_written: 100000,
  }
  assert.deepEqual(requireReaderRecoveryHeadroom(sample, now), {
    rows_read: 0,
    rows_written: 0,
    kv_writes: 0,
    requests: 20,
    kv_reads: 100,
  })
  for (const bad of [
    { ...sample, measured_at: now - 60001 },
    { ...sample, kv_measured_at: now + 1 },
    { ...sample, kv_reads: undefined },
    { ...sample, day: "2026-09-07" },
  ])
    assert.throws(() => requireReaderRecoveryHeadroom(bad, now), /USAGE_UNAVAILABLE/)
  assert.throws(
    () => requireReaderRecoveryHeadroom({ ...sample, requests: 74981 }, now),
    /HEADROOM: requests/,
  )
  assert.throws(
    () => requireReaderRecoveryHeadroom({ ...sample, kv_reads: 69901 }, now),
    /HEADROOM: kv_reads/,
  )
})
