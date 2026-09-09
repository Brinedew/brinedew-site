import assert from "node:assert/strict"
import test from "node:test"
import {
  earlyReleaseCapacitySentinel,
  readEarlyReleaseCapacity,
} from "./early-release-capacity-sentinel.mjs"

const time = Date.parse("2026-09-09T06:00:00Z")
const ceilings = { rows_read: 3_500_000, rows_written: 70_000, requests: 75_000 }
function fixture() {
  const calls = []
  const usage = {
    day: "2026-09-09",
    measured_at: time,
    rows_read: 100,
    rows_written: 10,
    requests: 5,
  }
  const capacity = {
    day: "2026-09-09",
    measured_at: time,
    used: { rows_read: 100, rows_written: 10, requests: 5 },
    remaining: { rows_read: 999_900, rows_written: 19_990, requests: 2_495 },
  }
  const options = {
    readState: async () => {
      calls.push("state")
      return { schema_transition: false }
    },
    readUsage: async () => {
      calls.push("usage")
      return usage
    },
    readCapacity: async () => {
      calls.push("capacity")
      return capacity
    },
    ceilings,
    now: () => time,
  }
  return { calls, usage, capacity, options }
}

test("normal release performs only the ordered state, analytics and capacity reads", async () => {
  const { calls, options, capacity } = fixture()
  const result = await earlyReleaseCapacitySentinel(options)
  assert.equal(result.mode, "continue-to-authoritative-preflight")
  assert.deepEqual(result.remaining, capacity.remaining)
  assert.deepEqual(calls, ["state", "usage", "capacity"])
})

test("existing maintenance preserves zero-D1 reader recovery despite exhausted D1", async () => {
  const { calls, options } = fixture()
  options.readState = async () => ({ schema_transition: true })
  options.readUsage = options.readCapacity = async () => {
    throw new Error("must not inspect D1 capacity before recovering existing readers")
  }
  const result = await earlyReleaseCapacitySentinel(options)
  assert.equal(result.mode, "defer-to-existing-reader-recovery")
  assert.deepEqual(calls, [])
})

for (const state of [null, {}, { schema_transition: "false" }, { schema_transition: 1 }]) {
  test(`unknown installed state fails closed: ${JSON.stringify(state)}`, async () => {
    const { calls, options } = fixture()
    options.readState = async () => state
    await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_RELEASE_STATE_INVALID/)
    assert.deepEqual(calls, [])
  })
}

for (const meter of Object.keys(ceilings)) {
  test(`account exhaustion stops before the capacity request: ${meter}`, async () => {
    const { calls, options, usage } = fixture()
    usage[meter] = ceilings[meter]
    await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_RELEASE_ACCOUNT_HEADROOM/)
    assert.deepEqual(calls, ["state", "usage"])
  })
  test(`shared exhaustion stops before any inventory: ${meter}`, async () => {
    const { options, capacity } = fixture()
    capacity.remaining[meter] = 0
    await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_RELEASE_SHARED_HEADROOM/)
  })
  test(`uncertain reservations are retained: ${meter}`, async () => {
    const { options, capacity, usage } = fixture()
    capacity.used[meter] = ceilings[meter] - usage[meter]
    await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_RELEASE_ACCOUNT_HEADROOM/)
  })
}

test("one remaining Worker request cannot be spent solely on the capacity probe", async () => {
  const { calls, options, usage } = fixture()
  usage.requests = ceilings.requests - 1
  await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_RELEASE_ACCOUNT_HEADROOM/)
  assert.deepEqual(calls, ["state", "usage"])
})

for (const measuredAt of [time - 60_001, time + 1, "1788933600000", undefined]) {
  test(`stale or malformed shared timestamp refuses: ${measuredAt}`, async () => {
    const { options, capacity } = fixture()
    capacity.measured_at = measuredAt
    await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_SHARED_USAGE_UNAVAILABLE/)
  })
}

for (const value of [-1, NaN, Infinity, "1", undefined, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid shared remaining counter refuses: ${value}`, async () => {
    const { options, capacity } = fixture()
    capacity.remaining.rows_read = value
    await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_SHARED_USAGE_UNAVAILABLE/)
  })
}

test("an old UTC day cannot admit a new-day release", async () => {
  const { options, usage } = fixture()
  usage.day = "2026-09-08"
  await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_ACCOUNT_USAGE_UNAVAILABLE/)
})

test("UTC rollover during the capacity request invalidates the earlier sample", async () => {
  const { options } = fixture()
  let reads = 0
  options.now = () => (++reads === 1 ? time : Date.parse("2026-09-10T00:00:00Z"))
  await assert.rejects(earlyReleaseCapacitySentinel(options), /COST_ACCOUNT_USAGE_UNAVAILABLE/)
})

test("capacity transport makes exactly one fixed-origin GET with no redirect or body", async () => {
  const calls = []
  const { capacity } = fixture()
  const result = await readEarlyReleaseCapacity({
    token: "test-only",
    fetcher: async (url, options) => {
      calls.push(url)
      assert.equal(url, "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations/capacity")
      assert.equal(options.method, "GET")
      assert.equal(options.redirect, "error")
      assert.equal(options.body, undefined)
      assert.equal(options.headers["x-iconoplasm-admin-token"], "test-only")
      assert.ok(options.signal instanceof AbortSignal)
      return Response.json(capacity)
    },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(result, capacity)
})

for (const status of [401, 403, 429, 503]) {
  test(`capacity HTTP refusal has no retry or response-body leak: ${status}`, async () => {
    let calls = 0
    await assert.rejects(
      readEarlyReleaseCapacity({
        token: "test-only",
        fetcher: async () => {
          calls++
          return new Response("sensitive diagnostic", { status })
        },
      }),
      { message: "COST_SHARED_USAGE_UNAVAILABLE" },
    )
    assert.equal(calls, 1)
  })
}

test("missing credentials fail before network access", async () => {
  await assert.rejects(
    readEarlyReleaseCapacity({
      token: "",
      fetcher: async () => assert.fail("unexpected request"),
    }),
    /COST_OPERATOR_TOKEN_REQUIRED/,
  )
})

test("network failures are sanitized without retry", async () => {
  let calls = 0
  await assert.rejects(
    readEarlyReleaseCapacity({
      token: "test-only",
      fetcher: async () => {
        calls++
        throw new Error("private transport detail")
      },
    }),
    { message: "COST_SHARED_USAGE_UNAVAILABLE" },
  )
  assert.equal(calls, 1)
})

for (const body of ["not json", "x".repeat(65_537)]) {
  test(`invalid capacity body is rejected (length ${body.length})`, async () => {
    await assert.rejects(
      readEarlyReleaseCapacity({
        token: "test-only",
        fetcher: async () => new Response(body),
      }),
      /COST_SHARED_USAGE_UNAVAILABLE/,
    )
  })
}
