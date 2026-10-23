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
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  ICONOPLASM_GENERATION_REQUEST_BATCH_LIMIT,
  generationRequestLeaseClaim,
  handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { writeFactoryGeneText } from "./iconoplasm/gene-text-write.js"
import { fakeBunnyStorage } from "./test-helpers/fake-bunny-storage.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID,
} from "./iconoplasm-request-notifications.js"
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

async function order(db, body, userId = "reader-1") {
  const response = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieFor({ user_id: userId, username: "reader" }),
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
    { ICONOPLASM_DB: db, ...fakeBunnyStorage(t).env },
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
    { ICONOPLASM_DB: db, ...fakeBunnyStorage(t).env },
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

// B-1143: an order at the limit must be placed in one Worker run (1,000 D1
// calls on the free plan), including the worst case where a refused style makes
// the order prepare twice.
test("an order at the batch limit fits in one Worker run", async (t) => {
  const { db, raw, seen } = watchedDatabase()
  t.after(() => raw.close())
  await writeFactoryGeneText(
    { ICONOPLASM_DB: db, ...fakeBunnyStorage(t).env },
    { symbol: "CA3", text: "A carbonic anhydrase.", tags: "zinc" },
  )
  const styles = Array.from(
    { length: ICONOPLASM_GENERATION_REQUEST_BATCH_LIMIT },
    (_, index) => `anima-v1-${index + 1}`,
  )
  // Slot 999999 is refused, which forces the second preparation.
  styles[styles.length - 1] = "anima-v1-999999"
  seen.length = 0
  const placed = await order(db, {
    symbol: "CA3",
    requested_vision_ids: styles,
    client_batch_id: "order-at-limit",
  })
  assert.equal(placed.status, 200, JSON.stringify(placed.payload))
  assert.equal(placed.payload.queued_count, ICONOPLASM_GENERATION_REQUEST_BATCH_LIMIT - 1)
  assert.ok(seen.length < 1000, `the order made ${seen.length} D1 calls`)

  const over = await order(db, {
    symbol: "CA3",
    requested_vision_ids: [...styles.slice(0, -1), "anima-v1-200", "anima-v1-201"],
    client_batch_id: "order-over-limit",
  })
  assert.equal(over.status, 400)

  // The picker holds the same number.
  const picker = readFileSync(
    new URL("../quartz/static/iconoplasm/app.js", import.meta.url),
    "utf8",
  )
  assert.match(
    picker,
    new RegExp(`var requestSelectionLimit = ${ICONOPLASM_GENERATION_REQUEST_BATCH_LIMIT}(?!\\d)`),
  )
})

// B-1145: one order is one receipt, whichever Drain sessions finish it.
//
// Ways it could go wrong, written before the fix:
// 1. the Drain draws an order in two sessions and each publication sends its own
//    Discord message (54 orders in the 2026-10-20 nightly copy);
// 2. a request in the order is cancelled (its exact source is gone) and the
//    receipt waits forever for it;
// 3. the cancellation lands before any request finishes, and the order's size
//    still counts it.
test("an order drawn in two Drain sessions is one receipt, and a cancelled style leaves it", async (t) => {
  const { db, raw } = watchedDatabase()
  t.after(() => raw.close())
  await writeFactoryGeneText(
    { ICONOPLASM_DB: db, ...fakeBunnyStorage(t).env },
    { symbol: "CA3", text: "A carbonic anhydrase.", tags: "zinc" },
  )
  const placed = await order(
    db,
    { symbol: "CA3", requested_vision_ids: SIX_STYLES, client_batch_id: "order-split" },
    ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID,
  )
  assert.equal(placed.status, 200, JSON.stringify(placed.payload))
  const ids = raw
    .prepare("SELECT id FROM icono_generation_requests ORDER BY id")
    .all()
    .map((row) => row.id)

  // What the fulfillment route and the quarantine do to a request row; the D1
  // triggers under test fire on exactly these transitions.
  const finish = (requestIds, publicationId) => {
    for (const id of requestIds)
      raw
        .prepare(
          `UPDATE icono_generation_requests
           SET status = 'delivery_pending', fulfillment_publication_id = ?,
               fulfilled_asset_sha256 = ?, fulfilled_vision_id = requested_vision_id
           WHERE id = ?`,
        )
        .run(publicationId, String(id).padStart(64, "a"), id)
  }
  const cancel = (id) =>
    raw.prepare("UPDATE icono_generation_requests SET status = 'cancelled' WHERE id = ?").run(id)

  const sent = []
  const originalFetch = globalThis.fetch
  t.after(() => (globalThis.fetch = originalFetch))
  globalThis.fetch = async (url, init) => {
    const value = String(url)
    if (value.startsWith("https://storage.bunnycdn.com/"))
      return new Response(
        new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]),
        { headers: { "Content-Type": "image/webp" } },
      )
    if (value === "https://discord.com/api/v10/users/@me/channels")
      return Response.json({ id: "dm-channel" })
    assert.equal(value, "https://discord.com/api/v10/channels/dm-channel/messages")
    sent.push(JSON.parse(init.body.get("payload_json")))
    return Response.json({ id: `message-${sent.length}` })
  }
  const deliver = () =>
    deliverPendingRequestFulfillmentNotifications({
      ICONOPLASM_DB: db,
      DISCORD_BOT_TOKEN: "test-only",
      ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
      ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
      ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
    })

  // The Drain's first session finishes half the order: nothing is sent yet.
  finish(ids.slice(0, 3), "pub-a")
  assert.equal((await deliver()).delivered, 0)
  assert.equal(sent.length, 0)

  // One style's source disappears; the second session finishes the rest.
  cancel(ids[3])
  finish(ids.slice(4), "pub-b")
  const delivered = await deliver()
  assert.equal(delivered.delivered, 1)
  assert.equal(delivered.delivered_requests, 5)
  assert.equal(sent.length, 1)
  assert.match(sent[0].content, /Your 5 free queue candidate portraits for \*\*CA3\*\*/)
  assert.deepEqual(
    raw
      .prepare(
        "SELECT DISTINCT fulfillment_publication_id AS receipt FROM icono_request_notifications",
      )
      .all()
      .map((row) => row.receipt),
    ["order-split"],
  )
  // The request rows keep the publication that finished them.
  assert.deepEqual(
    raw
      .prepare(
        "SELECT DISTINCT fulfillment_publication_id AS p FROM icono_generation_requests WHERE status <> 'cancelled' ORDER BY p",
      )
      .all()
      .map((row) => row.p),
    ["pub-a", "pub-b"],
  )

  // 3. A cancellation before anything finishes: the order of three is a
  // receipt of two.
  const second = await order(
    db,
    {
      symbol: "CA3",
      requested_vision_ids: ["anima-v1-7", "anima-v1-8", "anima-v1-9"],
      client_batch_id: "order-early-cancel",
    },
    ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID,
  )
  assert.equal(second.status, 200, JSON.stringify(second.payload))
  const later = raw
    .prepare(
      "SELECT id FROM icono_generation_requests WHERE request_batch_id = 'order-early-cancel' ORDER BY id",
    )
    .all()
    .map((row) => row.id)
  cancel(later[0])
  finish(later.slice(1), "pub-c")
  const again = await deliver()
  assert.equal(again.delivered_requests, 2)
  assert.equal(sent.length, 2)
})

// B-1146: fair turns. A reader who orders one style is drawn in the next Drain
// session, not after someone else's 100.
//
// Ways it could go wrong, written before the fix:
// 1. first come first served: B's one style waits behind all of A's order;
// 2. the order's rows all take the same turn, so A's whole order still goes
//    before anyone who came later;
// 3. a reader who already waits jumps back to the head with a second order;
// 4. diagnostics lose their place at the front.
test("a one-style order is drawn before the rest of a big order queued ahead of it", async (t) => {
  const { db, raw } = watchedDatabase()
  t.after(() => raw.close())
  await writeFactoryGeneText(
    { ICONOPLASM_DB: db, ...fakeBunnyStorage(t).env },
    { symbol: "CA3", text: "A carbonic anhydrase.", tags: "zinc" },
  )
  const styles = (from, count) =>
    Array.from({ length: count }, (_, index) => `anima-v1-${from + index}`)
  const place = async (userId, ids, batch) => {
    const placed = await order(
      db,
      { symbol: "CA3", requested_vision_ids: ids, client_batch_id: batch },
      userId,
    )
    assert.equal(placed.status, 200, JSON.stringify(placed.payload))
  }
  await place("reader-a", styles(1, 30), "a-big")
  await place("reader-b", styles(31, 1), "b-one")
  await place("reader-c", styles(32, 5), "c-five")
  // 3. A orders again while 30 still wait: it goes after A's own turns.
  await place("reader-a", styles(37, 2), "a-again")

  // The Drain: claim a batch of 10, draw it, finish it, claim the next.
  const env = { ICONOPLASM_DB: db, ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters" }
  const session = async () => {
    const claim = await generationRequestLeaseClaim(env, {
      limit: 10,
      leaseOwnerId: "drain-test",
    })
    assert.equal(claim.blocked_count, 0, JSON.stringify(claim.blocked_rows))
    const drawn = claim.leases.map((lease) =>
      raw
        .prepare(
          "SELECT id, requester_user_id, request_batch_id FROM icono_generation_requests WHERE generation_request_id = ?",
        )
        .get(lease.generation_request_id),
    )
    for (const row of drawn)
      raw
        .prepare("UPDATE icono_generation_requests SET status = 'delivery_pending' WHERE id = ?")
        .run(row.id)
    return drawn
  }
  const first = await session()
  const second = await session()
  assert.equal(first.length, 10)
  assert.deepEqual(
    first.map((row) => row.requester_user_id),
    [
      "reader-a",
      "reader-a",
      "reader-b",
      "reader-c",
      "reader-a",
      "reader-c",
      "reader-a",
      "reader-c",
      "reader-a",
      "reader-c",
    ],
  )
  assert.equal(second[0].requester_user_id, "reader-a")
  assert.equal(second[1].requester_user_id, "reader-c")
  assert.ok(second.slice(2).every((row) => row.requester_user_id === "reader-a"))

  // A's second order is drawn only after A's first.
  const rest = []
  for (let drawn = await session(); drawn.length; drawn = await session()) rest.push(...drawn)
  const aOrder = [...first, ...second, ...rest]
    .filter((row) => row.requester_user_id === "reader-a")
    .map((row) => row.request_batch_id)
  assert.equal(aOrder.length, 32)
  assert.deepEqual(aOrder.slice(-2), ["a-again", "a-again"])
  assert.ok(aOrder.slice(0, 30).every((batch) => batch === "a-big"))

  // 4. A diagnostic cell queued now holds turn 0 and goes first.
  await place("reader-b", styles(40, 1), "b-later")
  raw
    .prepare(
      `INSERT INTO icono_generation_requests (gene_symbol, requester_user_id, request_origin, status)
       VALUES ('CA3', 'owner', 'diagnostic_matrix', 'open')`,
    )
    .run()
  const turns = raw
    .prepare(
      "SELECT request_origin, queue_turn FROM icono_generation_requests WHERE status = 'open' ORDER BY queue_turn, id",
    )
    .all()
  assert.deepEqual(
    turns.map((row) => [row.request_origin, row.queue_turn > 0]),
    [
      ["diagnostic_matrix", false],
      ["user", true],
    ],
  )
})

// The Drain asks the site about the queue once a minute. Each question used to
// read every waiting request twice, so about 1,750 waiting requests spent
// Cloudflare's whole 5M daily reads on polling alone (B-1146).
test(
  "the Drain's queue poll and claim read the same few rows at 2,000 waiting as at 20",
  { timeout: 120000 },
  async () => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('local')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["SMALL", "LARGE"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    const directory = new URL("../migrations-iconoplasm/", import.meta.url)
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, directory), "utf8"))
    const definitions = schema
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
      )
      .all()
    schema.close()
    const reads = async (binding, waiting) => {
      const db = await runtime.getD1Database(binding)
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      // `waiting` requests from waiting/20 readers, behind 3,600 finished ones.
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?)
           INSERT INTO icono_generation_requests (gene_symbol, requester_user_id, status, queue_turn)
           SELECT 'G' || (i % 500), 'reader-' || (i % ?),
                  CASE WHEN i > 3600 THEN 'open' ELSE 'fulfilled' END, i
           FROM n`,
        )
        .bind(waiting + 3600, Math.max(1, Math.floor(waiting / 20)))
        .run()
      let rowsRead = 0
      const measured = {
        prepare(sql) {
          const wrap = (statement) => ({
            bind: (...args) => wrap(statement.bind(...args)),
            first: async () => {
              const result = await statement.all()
              rowsRead += result.meta.rows_read
              return result.results[0] ?? null
            },
            all: async () => {
              const result = await statement.all()
              rowsRead += result.meta.rows_read
              return result
            },
            run: async () => {
              const result = await statement.run()
              rowsRead += result.meta.rows_read
              return result
            },
          })
          return wrap(db.prepare(sql))
        },
      }
      const env = {
        ICONOPLASM_DB: measured,
        ICONOPLASM_ADMIN_TOKEN: "test-admin",
        ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE: "all_requesters",
      }
      const poll = await handleApi(
        new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/requests/open?limit=12", {
          headers: { Authorization: "Bearer test-admin" },
        }),
        env,
        { waitUntil() {} },
      )
      const polled = await poll.json()
      assert.equal(poll.status, 200, JSON.stringify(polled))
      assert.equal(polled.rows.length, 12)
      assert.equal(polled.eligible_count, Math.min(waiting, polled.count_cap))
      const claim = await generationRequestLeaseClaim(
        env,
        { limit: 10, leaseOwnerId: "drain-test" },
        {
          validateRows: async ({ rows }) => ({ validRows: rows, blockedRows: [] }),
          quarantineRequests: async () => ({ quarantined_count: 0 }),
          claimLeases: async ({ rows }) => ({ leases: rows.slice(0, 10) }),
        },
      )
      assert.equal(claim.leases.length, 10)
      // Turn order: the scan starts at the queue's head.
      assert.equal(claim.leases[0].id, 3601)
      return rowsRead
    }
    try {
      const small = await reads("SMALL", 20)
      const large = await reads("LARGE", 2000)
      // Before B-1146 the large queue read over 6,000 rows here.
      assert.ok(large < 1000, `2,000 waiting: ${large} rows read (20 waiting: ${small})`)
      assert.ok(large - small < 300, `2,000 waiting: ${large} rows read (20 waiting: ${small})`)
    } finally {
      await runtime.dispose()
    }
  },
)

// B-1163: clicking "Queue random" ten times is one order, one receipt.
//
// On 2026-10-22 the owner clicked it six times on ALMS1 in four seconds and got
// six orders and six Discord messages. Ways it could go wrong, written before
// the fix:
// 1. each click places its own order (the incident);
// 2. a click lands after part of the order was delivered, joins it, and the
//    receipt waits for a count it was born without, so it never goes out;
// 3. a click on another gene, or a style pick, joins the random order.
test("random clicks on one gene join one order until any of it is delivered", async (t) => {
  const { db, raw } = watchedDatabase()
  t.after(() => raw.close())
  const storage = fakeBunnyStorage(t).env
  for (const symbol of ["CA3", "SOX11"])
    await writeFactoryGeneText(
      { ICONOPLASM_DB: db, ...storage },
      { symbol, text: `${symbol} text.`, tags: "zinc" },
    )
  const reader = ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID
  const click = (symbol = "CA3") =>
    order(db, { symbol, request_kind: "new_candidate", request_mode: "random" }, reader)

  for (let i = 0; i < 10; i++) assert.equal((await click()).status, 200)
  const orders = () =>
    raw
      .prepare(
        `SELECT gene_symbol AS symbol, request_mode AS mode, request_batch_id AS id, COUNT(*) AS n
         FROM icono_generation_requests GROUP BY request_batch_id ORDER BY MIN(id)`,
      )
      .all()
      .map((row) => ({ ...row }))
  // 1. Ten clicks, one order.
  let placed = orders()
  assert.equal(placed.length, 1, JSON.stringify(placed))
  assert.match(placed[0].id, /^random-/)
  assert.equal(placed[0].n, 10)

  // 3. Another gene and a style pick each place their own order.
  assert.equal((await click("SOX11")).status, 200)
  assert.equal(
    (
      await order(
        db,
        { symbol: "CA3", requested_vision_ids: ["anima-v1-1"], client_batch_id: "pick" },
        reader,
      )
    ).status,
    200,
  )
  placed = orders()
  assert.deepEqual(
    placed.map((row) => [row.symbol, row.mode, row.n]),
    [
      ["CA3", "random", 10],
      ["SOX11", "random", 1],
      ["CA3", "specific", 1],
    ],
  )
  const randomOrder = placed[0].id

  const ids = raw
    .prepare("SELECT id FROM icono_generation_requests WHERE request_batch_id = ? ORDER BY id")
    .all(randomOrder)
    .map((row) => row.id)
  const finish = (requestIds) => {
    for (const id of requestIds)
      raw
        .prepare(
          `UPDATE icono_generation_requests
           SET status = 'delivery_pending', fulfillment_publication_id = 'pub',
               fulfilled_asset_sha256 = ?, fulfilled_vision_id = requested_vision_id
           WHERE id = ?`,
        )
        .run(String(id).padStart(64, "b"), id)
  }

  // 2. Once one request of the order is delivered, the next click starts a
  // new order: the open order is still found, and the insert's own check
  // turns the join away.
  finish(ids.slice(0, 1))
  assert.equal((await click()).status, 200)
  const after = orders().filter((row) => row.symbol === "CA3" && row.mode === "random")
  assert.equal(after.length, 2)
  assert.equal(after[0].n, 10)
  assert.equal(after[1].n, 1)

  const sent = []
  const originalFetch = globalThis.fetch
  t.after(() => (globalThis.fetch = originalFetch))
  globalThis.fetch = async (url, init) => {
    const value = String(url)
    if (value.startsWith("https://storage.bunnycdn.com/"))
      return new Response(
        new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]),
        { headers: { "Content-Type": "image/webp" } },
      )
    if (value === "https://discord.com/api/v10/users/@me/channels")
      return Response.json({ id: "dm-channel" })
    sent.push(JSON.parse(init.body.get("payload_json")))
    return Response.json({ id: `message-${sent.length}` })
  }
  finish(ids.slice(1))
  const delivered = await deliverPendingRequestFulfillmentNotifications({
    ICONOPLASM_DB: db,
    DISCORD_BOT_TOKEN: "test-only",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
  })
  assert.equal(delivered.delivered, 1)
  assert.equal(delivered.delivered_requests, 10)
  assert.equal(sent.length, 1)
  assert.match(sent[0].content, /Your 10 free queue candidate portraits for \*\*CA3\*\*/)
})
