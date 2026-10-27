// B-1157: the daily request rollup, golden-tested on a real day.
//
// Ways it could go wrong, written before the script:
// 1. the per-alias lists from the calculations view are joined to the wrong
//    route, so one route's rows read land on another;
// 2. the totals miss the server errors, or count them from the wrong query;
// 3. a channel that a visitor typed into ?ref= is published as written;
// 4. a missing value (a route with no rows written) becomes NaN or undefined.
// The query side (only 10 groups unless parameters.limit is set) can't be
// tested offline; it was checked against the live API on 2026-10-27, where
// 2026-10-26 came back as 66 routes summing to 3,779 requests.
import assert from "node:assert/strict"
import test from "node:test"

import { dayRollup } from "./roll-up-iconoplasm-request-record.mjs"

// Seven of the 66 routes that Workers Observability answered for 2026-10-26,
// in its own shape: one list of aggregates per alias, groups as key/value.
const ROUTES_2026_10_26 = [
  ["discoveries_membership", 307, 6, 185, 0],
  ["api/.env", 4, 3, 0, 0],
  ["api/game/bootstrap", 302, 17, 0, 0],
  ["admin_requests_open", 1374, 4, 6718, 2470],
  ["api/structure-cached", 20, 13, 14, 0],
  ["discoveries_me_guest", 708, 3, 0, 0],
  ["api/iconoplasm/admin/texts", 281, 2, 19490, 281],
]
const ALIASES = ["requests", "people", "rows_read", "rows_written"]

function calculations(rows, key) {
  return {
    calculations: ALIASES.map((alias, i) => ({
      alias,
      aggregates: rows.map(([value, ...counts]) => ({
        value: counts[i],
        groups: key ? [{ key, value }] : [],
      })),
    })),
  }
}

const day = (channels = [["", 3779, 123, 44240, 4575]]) =>
  dayRollup({
    date: "2026-10-26",
    generatedAt: "2026-10-27T14:00:00.000Z",
    complete: true,
    totals: calculations([[null, 3779, 123, 44240, 4575]]),
    routes: calculations(ROUTES_2026_10_26, "route"),
    channels: calculations(channels, "channel"),
    errors: {
      calculations: [
        {
          alias: "requests",
          aggregates: [{ value: 1, groups: [{ key: "route", value: "api/structure-cached" }] }],
        },
      ],
    },
  })

test("a real day rolls up into totals and routes, largest first", () => {
  const rollup = day()
  assert.deepEqual(rollup.totals, {
    requests: 3779,
    people: 123,
    rows_read: 44240,
    rows_written: 4575,
    server_errors: 1,
  })
  assert.deepEqual(
    rollup.routes.map((route) => route.name),
    [
      "admin_requests_open",
      "discoveries_me_guest",
      "discoveries_membership",
      "api/game/bootstrap",
      "api/iconoplasm/admin/texts",
      "api/structure-cached",
      "api/.env",
    ],
  )
  assert.deepEqual(
    rollup.routes.find((route) => route.name === "api/iconoplasm/admin/texts"),
    {
      name: "api/iconoplasm/admin/texts",
      requests: 281,
      people: 2,
      rows_read: 19490,
      rows_written: 281,
      server_errors: 0,
    },
  )
  assert.equal(
    rollup.routes.find((route) => route.name === "api/structure-cached").server_errors,
    1,
  )
  assert.deepEqual(rollup.channels, [
    { name: "(none)", requests: 3779, people: 123, rows_read: 44240, rows_written: 4575 },
  ])
})

test("a channel that isn't a plain slug is counted, not published", () => {
  const rollup = day([
    ["", 3700, 120, 44000, 4500],
    ["reddit", 60, 9, 200, 70],
    ["<script>alert(1)</script>", 12, 2, 30, 4],
    ["call me at 555 0100", 7, 1, 10, 1],
  ])
  assert.deepEqual(
    rollup.channels.map((channel) => channel.name),
    ["(none)", "reddit", "(other)"],
  )
  assert.deepEqual(rollup.channels[2], {
    name: "(other)",
    requests: 19,
    people: 2,
    rows_read: 40,
    rows_written: 5,
  })
  assert.doesNotMatch(JSON.stringify(rollup), /script|555/)
})
