import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import { withTestMutationAuthority } from "./test-only-mutation-authority.js"

// How the admin Styles scorecard read can fail, written before the fix (B-903):
//
// 1. The scorecard reads the whole rollup. Before this change `scope=all` cost
//    20,004 D1 rows at 20,001 visions (19,193 live on 2 Oct 2026), once per tab
//    open and once per gene action while the tab was loaded. A stale tab, an old
//    script or a forgotten parameter must get one bounded page, never the rollup.
// 2. A page costs more than its size. Every sort and direction the scorecard
//    offers, at every page size up to the maximum, must read page size plus a
//    small constant, and an oversized `limit` must be clamped, not obeyed.
// 3. Deep pages cost more than early ones (OFFSET, or a row-value comparison
//    that seeks only the first column: 14,992 rows for a 13-row page, measured).
//    Walking the whole rollup by cursor must stay flat at every step.
// 4. Ties. Thousands of visions share the same live count, score and image
//    count. A cursor inside or at the edge of a tie group must neither skip nor
//    repeat a row, at page sizes that cut across the groups.
// 5. Going back. `before` and `from=end` must return exactly the rows the
//    forward walk shows, in the same order, and the first and last page must
//    say there is nothing further.
// 6. Hostile or stale input. An unknown sort, direction or limit, a cursor of
//    the wrong shape, two cursors at once, or a cursor holding SQL text must
//    refuse or run as a bound value; none may reach the database as SQL or
//    cost more than a page.
// 7. The blocklist list rides along with every page flip and costs its full
//    table each time. It must be sent for a fresh view only, never per flip.
// 8. A rollup that is still being built answers with a scan over every portrait
//    asset (59,346 on 2 Oct 2026). It must refuse and read a bounded few rows.
// 9. Preview hydration for the visible page reads only those visions' assets,
//    and a preview call without ids answers empty instead of grouping every
//    portrait asset (the scorecard's old bootstrap fallback was the only
//    caller of that unfiltered read).
// 10. A caller without the admin token reads nothing.

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

const ROLLUP_POPULATION = 20000
const BLACKLIST_ROWS = 8
const STATS_PATH = "/api/iconoplasm/admin/votes/vision-stats"
const ORDER_SQL = {
  "live:desc": "live_count DESC, score DESC, image_count DESC, vision_id ASC",
  "live:asc": "live_count ASC, score ASC, image_count ASC, vision_id DESC",
  "vision:asc": "vision_id ASC",
  "vision:desc": "vision_id DESC",
}

function brief(payload) {
  return JSON.stringify(payload).slice(0, 400)
}

function memoryKv() {
  const values = new Map()
  return {
    async get(key) {
      return values.has(key) ? values.get(key) : null
    },
    async put(key, value) {
      values.set(key, String(value))
    },
    async delete(key) {
      values.delete(key)
    },
  }
}

async function migratedDatabase(runtime) {
  const schema = new DatabaseSync(":memory:")
  try {
    const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(file, directory), "utf8"))
    const db = await runtime.getD1Database("DB")
    const definitions = schema
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
      )
      .all()
    for (let offset = 0; offset < definitions.length; offset += 20)
      await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
    return db
  } finally {
    schema.close()
  }
}

async function adminRequest(db, kv, path, init = {}) {
  const meter = createOperationCostD1Meter(db)
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(`https://the-only-allowed-internal-stateful-worker-do-not-duplicate${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
          ...(init.headers || {}),
        },
      }),
      withTestMutationAuthority({
        ICONOPLASM_DB: meter.db,
        ICONOPLASM_ADMIN_TOKEN: "secret",
        KV: kv,
      }),
      { waitUntil() {} },
    )
  const payload = await response.json()
  return { status: response.status, payload, cost: meter.finish() }
}

function statsUrl(params) {
  const query = new URLSearchParams(params).toString()
  return query ? `${STATS_PATH}?${query}` : STATS_PATH
}

function cursorOf(values) {
  return Buffer.from(JSON.stringify(values)).toString("base64url")
}

async function startRuntime() {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('vision stats cost')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
}

// Rows tie heavily on purpose: most visions share (live 0, score 0, images 1).
function rollupSeed(db, population, offset = 0) {
  return db.prepare(
    `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${population})
     INSERT INTO icono_admin_vision_rollup(vision_id,image_count,upvotes,downvotes,score,live_count)
     SELECT 'anima-v1-'||(n+${offset}),
            CASE WHEN n%7=0 THEN 2 ELSE 1 END,
            0,
            0,
            CASE WHEN n%11=0 THEN n%5-2 ELSE 0 END,
            CASE WHEN n%13=0 THEN n%4 ELSE 0 END
     FROM ids`,
  )
}

async function oracle(db, sort, dir) {
  const result = await db
    .prepare(
      `SELECT vision_id FROM icono_admin_vision_rollup ORDER BY ${ORDER_SQL[`${sort}:${dir}`]}`,
    )
    .all()
  return result.results.map((row) => row.vision_id)
}

// Walk the whole rollup forward by next_cursor, or backward from the last page
// by prev_cursor. Backward pages are returned in display order, so a backward
// walk is reassembled by prepending each page.
async function walk(db, kv, { sort, dir, limit, backward = false, maxPages = 100000, onPage }) {
  const ids = []
  let params = { sort, dir, limit: String(limit), ...(backward ? { from: "end" } : {}) }
  for (let page = 0; page < maxPages; page++) {
    const response = await adminRequest(db, kv, statsUrl(params), { method: "GET" })
    assert.equal(response.status, 200, brief(response.payload))
    const rows = response.payload.rows.map((row) => row.vision_id)
    if (onPage) onPage(response, page)
    if (backward) ids.unshift(...rows)
    else ids.push(...rows)
    const next = backward ? response.payload.prev_cursor : response.payload.next_cursor
    if (!next) return { ids, pages: page + 1 }
    params = { sort, dir, limit: String(limit), [backward ? "before" : "after"]: next }
  }
  throw new Error(`walk did not end after ${maxPages} pages`)
}

test(
  "admin scorecard pages read page size plus a small constant at 20,000 visions, at every depth",
  { timeout: 300000 },
  async (t) => {
    const runtime = await startRuntime()
    try {
      const db = await migratedDatabase(runtime)
      const kv = memoryKv()
      const sha = (n) => n.toString(16).padStart(64, "0")
      await db.batch([
        db.prepare(
          "INSERT OR REPLACE INTO icono_admin_read_model_bootstrap(bootstrap_key,status) VALUES('default','complete')",
        ),
        rollupSeed(db, ROLLUP_POPULATION, 100),
        db.prepare(
          "INSERT INTO icono_admin_vision_rollup(vision_id,image_count,upvotes,downvotes,score,live_count) VALUES('anima-v1-1',3,5,1,4,2)",
        ),
        db.prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${BLACKLIST_ROWS})
           INSERT INTO icono_artist_style_blacklist(artist_tag,artist_name,reason)
           SELECT 'blocked_tag_'||n,'Blocked '||n,'test' FROM ids`,
        ),
        db.prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${ROLLUP_POPULATION})
           INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id)
           SELECT 'G'||n,printf('%064x',n+1000),'full','thumb','approved','anima-v1-'||(n+100),'A1-'||(n+100) FROM ids`,
        ),
        ...[1, 2, 3].map((n) =>
          db
            .prepare(
              "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id) VALUES(?,?,'full','thumb','approved','anima-v1-1','A1-1')",
            )
            .bind(`TP5${n}`, sha(n)),
        ),
      ])
      const total = ROLLUP_POPULATION + 1

      // A page is its rows, one look-ahead row, the bootstrap row, one boundary
      // row for each of the cursor's four range queries (D1 counts the first
      // entry past an empty range), and, for a fresh view only, the blocklist
      // (D1 counts its sorted rows twice). Two rows of slack.
      const flipBound = (limit) => limit + 1 + 1 + 4 + 2
      const freshBound = (limit) => flipBound(limit) + 2 * BLACKLIST_ROWS

      // Failure mode 1: callers that still send the old whole-rollup request,
      // or nothing at all, get one default page.
      for (const params of [{ scope: "all" }, {}, { vision_ids: "anima-v1-1,anima-v1-150" }]) {
        const stale = await adminRequest(db, kv, statsUrl(params), { method: "GET" })
        t.diagnostic(JSON.stringify({ case: "stale-request", params, ...stale.cost }))
        assert.equal(stale.status, 200, brief(stale.payload))
        assert.equal(stale.payload.rows.length, 50, brief(stale.payload))
        assert.ok(stale.cost.rows_read <= freshBound(50), JSON.stringify(stale.cost))
        assert.ok(
          stale.payload.next_cursor,
          "a default page of a 20,001-row rollup has a next page",
        )
        assert.equal(stale.payload.prev_cursor, null)
      }

      // The old filtered form was a POST; it is gone and refused before any read.
      const oldPost = await adminRequest(db, kv, STATS_PATH, {
        method: "POST",
        body: JSON.stringify({ vision_ids: ["anima-v1-1"] }),
      })
      assert.equal(oldPost.status, 405, brief(oldPost.payload))
      assert.equal(oldPost.cost.rows_read, 0)

      // Failure mode 2: every sort, direction and page size, from the front and
      // from the back, reads page size plus a constant. An oversized limit is clamped.
      for (const sort of ["live", "vision"]) {
        for (const dir of ["asc", "desc"]) {
          for (const limit of [1, 12, 50, 200]) {
            for (const from of [undefined, "end"]) {
              const page = await adminRequest(
                db,
                kv,
                statsUrl({ sort, dir, limit: String(limit), ...(from ? { from } : {}) }),
                { method: "GET" },
              )
              assert.equal(page.status, 200, brief(page.payload))
              assert.equal(page.payload.rows.length, limit, `${sort} ${dir} ${limit} ${from}`)
              assert.ok(
                page.cost.rows_read <= freshBound(limit),
                `${sort} ${dir} ${limit} ${from}: ${JSON.stringify(page.cost)}`,
              )
              assert.equal(page.cost.rows_written, 0)
            }
          }
          const maxPage = await adminRequest(db, kv, statsUrl({ sort, dir, limit: "1000000" }), {
            method: "GET",
          })
          t.diagnostic(JSON.stringify({ case: "limit-clamped", sort, dir, ...maxPage.cost }))
          assert.equal(maxPage.status, 200, brief(maxPage.payload))
          assert.equal(maxPage.payload.rows.length, 200)
          assert.ok(maxPage.cost.rows_read <= freshBound(200), JSON.stringify(maxPage.cost))
        }
      }

      // Failure modes 3, 4 and 5 over the whole rollup: a forward walk and a
      // backward walk return every row once, in the database's own order, at a
      // flat cost per page. The oracle is a single ORDER BY, independent of the
      // cursor logic. The live order is the one with ties and four columns.
      for (const walkCase of [
        { sort: "live", dir: "desc", backward: false },
        { sort: "live", dir: "asc", backward: true },
      ]) {
        const expected = await oracle(db, walkCase.sort, walkCase.dir)
        assert.equal(expected.length, total)
        let worst = 0
        const { ids, pages } = await walk(db, kv, {
          ...walkCase,
          limit: 200,
          onPage(response, page) {
            const bound = page === 0 ? freshBound(200) : flipBound(200)
            assert.ok(
              response.cost.rows_read <= bound,
              `${walkCase.sort} ${walkCase.dir} page ${page}: ${JSON.stringify(response.cost)}`,
            )
            worst = Math.max(worst, response.cost.rows_read)
          },
        })
        t.diagnostic(JSON.stringify({ case: "walk", ...walkCase, pages, worst_rows_read: worst }))
        assert.equal(pages, Math.ceil(total / 200))
        assert.deepEqual(ids, expected, `${walkCase.sort} ${walkCase.dir} walk`)
      }

      // Depth costs nothing: a page that starts 0, 1, 5,000, 10,000 and 19,999
      // rows in, in every order, reads the same as the first.
      for (const sort of ["live", "vision"]) {
        for (const dir of ["asc", "desc"]) {
          const expected = await oracle(db, sort, dir)
          for (const position of [0, 1, 5000, 10000, 19999]) {
            const anchor = await db
              .prepare(
                "SELECT live_count, score, image_count, vision_id FROM icono_admin_vision_rollup WHERE vision_id=?",
              )
              .bind(expected[position])
              .first()
            const key =
              sort === "live"
                ? [anchor.live_count, anchor.score, anchor.image_count, anchor.vision_id]
                : [anchor.vision_id]
            const deep = await adminRequest(
              db,
              kv,
              statsUrl({ sort, dir, limit: "12", after: cursorOf(key) }),
              { method: "GET" },
            )
            assert.equal(deep.status, 200, brief(deep.payload))
            assert.deepEqual(
              deep.payload.rows.map((row) => row.vision_id),
              expected.slice(position + 1, position + 13),
              `${sort} ${dir} after position ${position}`,
            )
            assert.ok(
              deep.cost.rows_read <= flipBound(12),
              `${sort} ${dir} ${position}: ${JSON.stringify(deep.cost)}`,
            )
            if (position === 10000)
              t.diagnostic(JSON.stringify({ case: "deep-page", sort, dir, position, ...deep.cost }))
          }
        }
      }

      // Failure mode 7: the blocklist is sent for a fresh view, not per flip.
      const fresh = await adminRequest(db, kv, statsUrl({ limit: "12" }), { method: "GET" })
      assert.equal(fresh.payload.blacklisted.length, BLACKLIST_ROWS, brief(fresh.payload))
      const flip = await adminRequest(
        db,
        kv,
        statsUrl({ limit: "12", after: fresh.payload.next_cursor }),
        { method: "GET" },
      )
      t.diagnostic(JSON.stringify({ case: "page-flip", ...flip.cost }))
      assert.equal(flip.status, 200, brief(flip.payload))
      assert.equal("blacklisted" in flip.payload, false, brief(flip.payload))
      assert.ok(flip.cost.rows_read <= flipBound(12), JSON.stringify(flip.cost))
      assert.ok(fresh.cost.rows_read - flip.cost.rows_read >= BLACKLIST_ROWS)

      // Failure mode 6: hostile and stale input refuses before touching the database.
      const goodCursor = fresh.payload.next_cursor
      for (const params of [
        { sort: "avg_vote" },
        { sort: "live; DROP TABLE icono_admin_vision_rollup" },
        { dir: "sideways" },
        { limit: "0" },
        { limit: "-5" },
        { limit: "twelve" },
        { limit: "12.5" },
        { after: "not a cursor" },
        { before: "e30" },
        { after: cursorOf([1, 2, 3]) },
        { after: cursorOf([1, 2, 3, "x", "extra"]) },
        { after: cursorOf(["a", 0, 1, "anima-v1-5"]) },
        { after: cursorOf([0, 0, 1.5, "anima-v1-5"]) },
        { after: cursorOf([0, 0, 1, ""]) },
        { after: cursorOf([0, 0, 1, 7]) },
        { sort: "vision", after: cursorOf([0, 0, 1, "anima-v1-5"]) },
        { after: goodCursor, before: goodCursor },
        { after: goodCursor, from: "end" },
        { from: "middle" },
      ]) {
        const refused = await adminRequest(db, kv, statsUrl(params), { method: "GET" })
        assert.equal(refused.status, 400, `${JSON.stringify(params)} ${brief(refused.payload)}`)
        assert.equal(refused.cost.rows_read, 0, JSON.stringify({ params, ...refused.cost }))
      }
      // A cursor whose text is SQL is a value: it runs bound, returns a page, costs a page.
      const hostile = await adminRequest(
        db,
        kv,
        statsUrl({
          after: cursorOf([0, 0, 1, "x' OR 1=1; DROP TABLE icono_admin_vision_rollup; --"]),
          limit: "12",
        }),
        { method: "GET" },
      )
      assert.equal(hostile.status, 200, brief(hostile.payload))
      assert.ok(hostile.cost.rows_read <= flipBound(12), JSON.stringify(hostile.cost))
      const stillThere = await db
        .prepare("SELECT COUNT(*) AS n FROM icono_admin_vision_rollup")
        .first()
      assert.equal(stillThere.n, total)

      // Failure mode 9: a page's previews read only those visions' assets.
      const previews = await adminRequest(db, kv, "/api/iconoplasm/admin/votes/vision-previews", {
        method: "POST",
        body: JSON.stringify({ vision_ids: ["anima-v1-1"], limit: 6 }),
      })
      t.diagnostic(JSON.stringify({ case: "previews", ...previews.cost }))
      assert.equal(previews.status, 200, brief(previews.payload))
      assert.equal(previews.payload.rows.length, 1)
      assert.equal(previews.payload.rows[0].image_count, 3)
      assert.equal(previews.payload.rows[0].assets.length, 3)
      assert.ok(previews.cost.rows_read < 100, JSON.stringify(previews.cost))

      const noIds = await adminRequest(db, kv, "/api/iconoplasm/admin/votes/vision-previews", {
        method: "POST",
        body: JSON.stringify({}),
      })
      t.diagnostic(JSON.stringify({ case: "previews-without-ids", ...noIds.cost }))
      assert.equal(noIds.status, 200, brief(noIds.payload))
      assert.deepEqual(noIds.payload.rows, [])
      assert.equal(noIds.cost.rows_read, 0, JSON.stringify(noIds.cost))

      // Failure mode 10: no admin token, no rows.
      const denied = await adminRequest(db, kv, statsUrl({ limit: "12" }), {
        method: "GET",
        headers: { Authorization: "Bearer wrong" },
      })
      assert.equal(denied.status, 403, brief(denied.payload))
      assert.equal(denied.cost.rows_read, 0)

      // B-1080: the admin token has one spelling. The retired header carrying the
      // right secret is refused, the way the factory's bearer routes refused it (B-1079).
      const oldHeader = await adminRequest(db, kv, statsUrl({ limit: "12" }), {
        method: "GET",
        headers: { Authorization: "", "X-Iconoplasm-Admin-Token": "secret" },
      })
      assert.equal(oldHeader.status, 403, brief(oldHeader.payload))
      assert.equal(oldHeader.cost.rows_read, 0)

      // Failure mode 8: a rollup that is still being built is refused, not scanned from assets.
      await db
        .prepare(
          "UPDATE icono_admin_read_model_bootstrap SET status='running' WHERE bootstrap_key='default'",
        )
        .run()
      for (const params of [{}, { from: "end" }, { after: goodCursor }]) {
        const rebuilding = await adminRequest(db, kv, statsUrl(params), { method: "GET" })
        t.diagnostic(JSON.stringify({ case: "bootstrap-running", params, ...rebuilding.cost }))
        assert.equal(rebuilding.status, 503, brief(rebuilding.payload))
        assert.match(String(rebuilding.payload.error || ""), /still being built/)
        assert.ok(rebuilding.cost.rows_read <= 2, JSON.stringify(rebuilding.cost))
      }
      await db
        .prepare(
          "UPDATE icono_admin_read_model_bootstrap SET status='complete' WHERE bootstrap_key='default'",
        )
        .run()

      // A built but empty rollup is an empty page, not a fallback scan.
      await db.prepare("DELETE FROM icono_admin_vision_rollup").run()
      const empty = await adminRequest(db, kv, statsUrl({ limit: "12" }), { method: "GET" })
      t.diagnostic(JSON.stringify({ case: "empty-rollup", ...empty.cost }))
      assert.equal(empty.status, 200, brief(empty.payload))
      assert.deepEqual(empty.payload.rows, [])
      assert.equal(empty.payload.next_cursor, null)
      assert.equal(empty.payload.prev_cursor, null)
      assert.ok(empty.cost.rows_read <= 1 + 2 * BLACKLIST_ROWS + 2, JSON.stringify(empty.cost))
    } finally {
      await runtime.dispose()
    }
  },
)

test(
  "admin scorecard cursors neither skip nor repeat a row at any page size, in either direction",
  { timeout: 300000 },
  async () => {
    const runtime = await startRuntime()
    try {
      const db = await migratedDatabase(runtime)
      const kv = memoryKv()
      // Six tie groups of seven visions each: page sizes 4 and 7 cut inside
      // groups and at their edges.
      const population = 42
      await db.batch([
        db.prepare(
          "INSERT OR REPLACE INTO icono_admin_read_model_bootstrap(bootstrap_key,status) VALUES('default','complete')",
        ),
        db.prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${population})
           INSERT INTO icono_admin_vision_rollup(vision_id,image_count,upvotes,downvotes,score,live_count)
           SELECT 'anima-v1-'||n, 1+(n%2), 0, 0, n%2, n%3 FROM ids`,
        ),
      ])
      for (const sort of ["live", "vision"]) {
        for (const dir of ["asc", "desc"]) {
          const expected = await oracle(db, sort, dir)
          assert.equal(expected.length, population)
          // Page size 1 is the cursor at every row (live only: it is the order
          // with ties); 4 and 7 cut inside tie groups and across their edges;
          // 42 and 43 are the whole list and one more.
          const cases = [
            ...(sort === "live" ? [{ limit: 1, backward: false }] : []),
            { limit: 4, backward: false },
            { limit: 4, backward: true },
            { limit: 7, backward: false },
            { limit: 7, backward: true },
            { limit: 42, backward: true },
            { limit: 43, backward: false },
          ]
          for (const { limit, backward } of cases) {
            const label = `${sort} ${dir} limit ${limit} ${backward ? "backward" : "forward"}`
            let sawFirst = false
            let sawLast = false
            const { ids, pages } = await walk(db, kv, {
              sort,
              dir,
              limit,
              backward,
              onPage(response, page) {
                assert.ok(response.payload.rows.length <= limit, label)
                if (response.payload.prev_cursor === null) sawFirst = true
                if (response.payload.next_cursor === null) sawLast = true
                // The page the walk starts on is an end of the list.
                if (page === 0) {
                  assert.equal(
                    backward ? response.payload.next_cursor : response.payload.prev_cursor,
                    null,
                    label,
                  )
                }
              },
            })
            assert.deepEqual(ids, expected, label)
            assert.equal(pages, Math.ceil(population / limit), label)
            assert.ok(sawFirst && sawLast, label)
          }
        }
      }

      // Next then Previous returns to the same page: stepping back is the inverse of stepping on.
      const front = await adminRequest(db, kv, statsUrl({ limit: "7" }), { method: "GET" })
      const second = await adminRequest(
        db,
        kv,
        statsUrl({ limit: "7", after: front.payload.next_cursor }),
        { method: "GET" },
      )
      const back = await adminRequest(
        db,
        kv,
        statsUrl({ limit: "7", before: second.payload.prev_cursor }),
        { method: "GET" },
      )
      assert.deepEqual(
        back.payload.rows.map((row) => row.vision_id),
        front.payload.rows.map((row) => row.vision_id),
      )
      assert.equal(back.payload.prev_cursor, null)
    } finally {
      await runtime.dispose()
    }
  },
)
