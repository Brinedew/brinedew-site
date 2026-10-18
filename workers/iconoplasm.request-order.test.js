// A reader's multi-style order reaches the Drain whole.
//
// On 2026-10-18 the owner queued six CA3 styles. The site inserted the rows one
// by one over two seconds; the Drain's once-a-minute pass read the queue after
// the third, drew three, and the other three came back six minutes later as a
// second publication and a second Discord message.
//
// Ways it could go wrong, written before the fix:
// 1. a queue read during the order sees part of it (the incident);
// 2. a style the site refuses leaves the accepted rows claiming a larger order
//    than exists, so the delivery waits for rows that never come;
// 3. a retried submit of the same order adds rows instead of returning them.

import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { writeFactoryGeneText } from "./iconoplasm/gene-text-write.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

const OPEN_ROWS = "SELECT COUNT(*) AS n FROM icono_generation_requests WHERE status = 'open'"

// The Drain's view: after every D1 call the Worker makes, count the open rows a
// queue read at that moment would see.
function watchedDatabase() {
  const db = iconoplasmDatabase()
  const seen = []
  const look = () => seen.push(db.database.prepare(OPEN_ROWS).get().n)
  const watch = (statement) => ({
    inner: statement,
    bind: (...args) => watch(statement.bind(...args)),
    first: async (...args) => {
      const result = await statement.first(...args)
      look()
      return result
    },
    all: async () => {
      const result = await statement.all()
      look()
      return result
    },
    run: async () => {
      const result = await statement.run()
      look()
      return result
    },
  })
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql) => watch(target.prepare(sql))
      if (key === "batch")
        return async (statements) => {
          const result = await target.batch(statements.map((statement) => statement.inner))
          look()
          return result
        }
      const value = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { db: proxy, raw: db.database, seen }
}

async function order(db, body) {
  const response = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieFor({ user_id: "reader-1", username: "reader" }),
      },
      body: JSON.stringify(body),
    }),
    { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
    { waitUntil() {} },
  )
  return { status: response.status, payload: await response.json() }
}

const SIX_STYLES = Array.from({ length: 6 }, (_, index) => `anima-v1-${index + 1}`)

test("a queue read during a six-style order sees none of it or all of it", async (t) => {
  const { db, raw, seen } = watchedDatabase()
  t.after(() => raw.close())
  await writeFactoryGeneText(
    { ICONOPLASM_DB: db },
    { symbol: "CA3", text: "A carbonic anhydrase.", tags: "zinc" },
  )
  seen.length = 0

  const placed = await order(db, {
    symbol: "CA3",
    requested_vision_ids: SIX_STYLES,
    client_batch_id: "order-ca3",
  })
  assert.equal(placed.status, 200, JSON.stringify(placed.payload))
  assert.equal(placed.payload.queued_count, 6)
  assert.deepEqual([...new Set(seen)].sort(), [0, 6], `queue reads saw ${seen.join(",")}`)

  const rows = raw
    .prepare("SELECT request_batch_id, request_batch_size FROM icono_generation_requests")
    .all()
  assert.equal(rows.length, 6)
  assert.ok(
    rows.every((row) => row.request_batch_id === "order-ca3" && row.request_batch_size === 6),
  )

  // A retried submit returns the same six rows and adds none.
  const again = await order(db, {
    symbol: "CA3",
    requested_vision_ids: SIX_STYLES,
    client_batch_id: "order-ca3",
  })
  assert.equal(again.payload.queued_count, 6)
  assert.deepEqual(
    again.payload.requests.map((request) => request.id).sort(),
    placed.payload.requests.map((request) => request.id).sort(),
  )
  assert.equal(raw.prepare(OPEN_ROWS).get().n, 6)
})

test("a refused style leaves an order whose size is the rows that exist", async (t) => {
  const { db, raw } = watchedDatabase()
  t.after(() => raw.close())
  await writeFactoryGeneText(
    { ICONOPLASM_DB: db },
    { symbol: "CA3", text: "A carbonic anhydrase.", tags: "zinc" },
  )

  // Slot 999999 is outside every callable interval, so the site refuses it.
  const placed = await order(db, {
    symbol: "CA3",
    requested_vision_ids: ["anima-v1-1", "anima-v1-999999", "anima-v1-2"],
    client_batch_id: "order-partial",
  })
  assert.equal(placed.status, 200, JSON.stringify(placed.payload))
  assert.equal(placed.payload.queued_count, 2)
  assert.equal(placed.payload.failures.length, 1)
  assert.equal(placed.payload.failures[0].requested_vision_id, "anima-v1-999999")
  const sizes = raw
    .prepare("SELECT request_batch_size AS size FROM icono_generation_requests")
    .all()
    .map((row) => row.size)
  assert.deepEqual(sizes, [2, 2])
})
