// B-1147: the per-request line on a real local D1. It must carry the rows each
// statement's receipt reports, keep first()'s answers exactly as D1 gives them,
// and count a person once per day without naming them.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

import { sealSession } from "./lib/sealed-session.js"
import { meteredEnv, noteRequestRoute, withRequestRecord } from "./lib/the-only-request-record.js"

const SESSION_SECRET = "a".repeat(64)

async function localD1() {
  const require = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare")
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('local')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["ICONOPLASM_DB"],
    }),
  )
  const db = await runtime.getD1Database("ICONOPLASM_DB")
  await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
  await db.exec("INSERT INTO t (id, name) VALUES (1, 'a'), (2, 'b'), (3, 'c')")
  return { runtime, db }
}

async function capture(run) {
  const lines = []
  const original = console.log
  const waits = []
  console.log = (value) => lines.push(JSON.parse(value))
  try {
    const response = await run({ waitUntil: (promise) => waits.push(promise) })
    await Promise.all(waits)
    return { response, lines }
  } finally {
    console.log = original
  }
}

test(
  "a request's line carries the D1 rows its statements read and wrote",
  { timeout: 60000 },
  async () => {
    const { runtime, db } = await localD1()
    const points = []
    const env = {
      ICONOPLASM_DB: db,
      SESSION_SECRET,
      ICONOPLASM_REQUESTS: { writeDataPoint: (point) => points.push(point) },
    }
    try {
      const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/votes", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.9",
          "User-Agent": "test",
          Referer: "https://iconoplasm.brinedew.bio/genes/SOX11?ref=reddit",
        },
      })
      const { response, lines } = await capture((ctx) =>
        withRequestRecord(request, env, ctx, async (env) => {
          const all = await env.ICONOPLASM_DB.prepare("SELECT id FROM t ORDER BY id").all()
          assert.deepEqual(
            all.results.map((r) => r.id),
            [1, 2, 3],
          )
          assert.deepEqual(
            await env.ICONOPLASM_DB.prepare("SELECT * FROM t WHERE id = ?").bind(2).first(),
            {
              id: 2,
              name: "b",
            },
          )
          assert.equal(
            await env.ICONOPLASM_DB.prepare("SELECT name FROM t WHERE id = 3").first("name"),
            "c",
          )
          assert.equal(
            await env.ICONOPLASM_DB.prepare("SELECT name FROM t WHERE id = 9").first(),
            null,
          )
          await assert.rejects(
            env.ICONOPLASM_DB.prepare("SELECT name FROM t WHERE id = 1").first("missing"),
            /D1_COLUMN_NOTFOUND/,
          )
          await env.ICONOPLASM_DB.batch([
            env.ICONOPLASM_DB.prepare("INSERT INTO t (id, name) VALUES (4, 'd')"),
            env.ICONOPLASM_DB.prepare("UPDATE t SET name = 'z' WHERE id = 1"),
          ])
          noteRequestRoute(request, "vote", { schema: 3 })
          return new Response("ok", { status: 201 })
        }),
      )
      assert.equal(response.status, 201)
      assert.equal(lines.length, 1, "one line per request")
      const [line] = lines
      assert.equal(line.route, "vote")
      assert.equal(line.status, 201)
      assert.equal(line.channel, "reddit")
      assert.equal(line.actor_kind, "guest")
      assert.match(line.actor, /^[0-9a-f]{16}$/)
      assert.equal(line.d1_calls, 7)
      assert.ok(line.rows_read >= 6, `rows_read ${line.rows_read}`)
      assert.ok(line.rows_written >= 2, `rows_written ${line.rows_written}`)
      assert.equal(points.length, 1)
      assert.deepEqual(points[0].doubles.slice(2), [line.rows_read, line.rows_written, 7])
      assert.equal(points[0].indexes[0], line.actor)

      // The metered binding is one object per binding, so caches keyed by it hold.
      assert.equal(meteredEnv(env).ICONOPLASM_DB, meteredEnv(env).ICONOPLASM_DB)
    } finally {
      await runtime.dispose()
    }
  },
)

test("a signed-in person is one actor across requests that day, and nobody in the clear", async () => {
  const env = { SESSION_SECRET }
  const cookie = await sealSession(env, {
    user_id: "user-123",
    sid: "s1",
    account_checked_at: Date.now(),
  })
  const actors = []
  for (const ip of ["198.51.100.1", "198.51.100.2"]) {
    const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/me", {
      headers: { Cookie: `session=${cookie}`, "CF-Connecting-IP": ip },
    })
    const { lines } = await capture((ctx) =>
      withRequestRecord(request, env, ctx, async () => new Response("ok")),
    )
    actors.push(lines[0])
  }
  assert.equal(actors[0].actor_kind, "account")
  assert.equal(actors[0].actor, actors[1].actor, "same person, two networks, one actor")
  assert.ok(!JSON.stringify(actors).includes("user-123"))
  assert.equal(actors[0].route, "api/iconoplasm/me")
})

test("a thrown handler still leaves its line, as a 500", async () => {
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/boom")
  const lines = []
  const original = console.log
  const waits = []
  console.log = (value) => lines.push(JSON.parse(value))
  try {
    await assert.rejects(
      withRequestRecord(
        request,
        { SESSION_SECRET },
        { waitUntil: (p) => waits.push(p) },
        async () => {
          throw new Error("boom")
        },
      ),
      /boom/,
    )
    await Promise.all(waits)
  } finally {
    console.log = original
  }
  assert.equal(lines.length, 1)
  assert.equal(lines[0].status, 500)
})
