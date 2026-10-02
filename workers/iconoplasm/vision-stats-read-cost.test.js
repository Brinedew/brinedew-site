import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"
import { withTestMutationAuthority } from "./test-only-mutation-authority.js"

// How the admin vision-stats reads can fail, written before the fix (B-898):
//
// 1. A caller that forgets `vision_ids` silently reads every rollup row. The
//    workstation did this on every website sync and every Visions list refetch
//    (19,202 rows per call on the live database, 2 Oct 2026). An unfiltered
//    request without the explicit scorecard scope must refuse and read nothing.
// 2. A filtered lookup is planned as a scan because `? = 0 OR vision_id IN (...)`
//    hides the primary key (live: 19,194 rows for one id). A filtered lookup
//    must cost about one row per requested id, whatever the rollup's size.
// 3. A filtered lookup for visions absent from the rollup falls through to the
//    direct grouped read over every portrait asset. Once the rollup bootstrap
//    is complete, an empty filtered answer is the answer.
// 4. The direct grouped read behind vision previews and details has the same
//    index-defeating `OR`, so one preview page scans every asset's vision index
//    (live: 59,346 assets). It must read only the requested visions' assets.
// 5. The explicit scorecard request (`scope=all`) loses rows or its
//    live/score order while the default form is being narrowed.
// 6. While the rollup bootstrap is still running, a filtered request answers
//    from a half-built rollup instead of the direct read.
// 7. Duplicate ids double-count or double-read.

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

const ROLLUP_POPULATION = 20000

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
          "X-Iconoplasm-Admin-Token": "secret",
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

test(
  "admin vision stats read only the requested visions; the full scorecard is an explicit scope",
  { timeout: 180000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vision stats cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await migratedDatabase(runtime)
      const kv = memoryKv()
      const sha = (n) => n.toString(16).padStart(64, "0")
      await db.batch([
        db.prepare(
          "INSERT OR REPLACE INTO icono_admin_read_model_bootstrap(bootstrap_key,status) VALUES('default','complete')",
        ),
        db.prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${ROLLUP_POPULATION})
           INSERT INTO icono_admin_vision_rollup(vision_id,image_count,upvotes,downvotes,score,live_count)
           SELECT 'anima-v1-'||(n+100),1,0,0,0,0 FROM ids`,
        ),
        db.prepare(
          "INSERT INTO icono_admin_vision_rollup(vision_id,image_count,upvotes,downvotes,score,live_count) VALUES('anima-v1-1',3,5,1,4,2)",
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

      // Failure mode 1: the forgotten filter refuses, by POST and by GET.
      for (const init of [
        { method: "POST", body: JSON.stringify({}) },
        { method: "GET" },
        { method: "POST", body: JSON.stringify({ vision_ids: [] }) },
      ]) {
        const refused = await adminRequest(db, kv, "/api/iconoplasm/admin/votes/vision-stats", init)
        t.diagnostic(JSON.stringify({ case: "unfiltered", method: init.method, ...refused.cost }))
        assert.equal(refused.status, 400, brief(refused.payload))
        assert.match(String(refused.payload?.error || ""), /vision_ids/)
        assert.equal(refused.cost.rows_read, 0, JSON.stringify(refused.cost))
      }

      // Failure modes 2 and 7: one real id (sent twice) plus one absent id.
      const filtered = await adminRequest(db, kv, "/api/iconoplasm/admin/votes/vision-stats", {
        method: "POST",
        body: JSON.stringify({ vision_ids: ["anima-v1-1", "anima-v1-1", "anima-v1-150"] }),
      })
      t.diagnostic(JSON.stringify({ case: "filtered", ...filtered.cost }))
      assert.equal(filtered.status, 200, brief(filtered.payload))
      assert.deepEqual(
        filtered.payload.rows.map((row) => row.vision_id),
        ["anima-v1-1", "anima-v1-150"],
      )
      assert.equal(filtered.payload.rows[0].upvotes, 5)
      assert.equal(filtered.payload.rows[0].live_count, 2)
      assert.ok(filtered.cost.rows_read < 40, JSON.stringify(filtered.cost))

      // Failure mode 3: visions the rollup has never seen answer empty, cheaply.
      const absent = await adminRequest(
        db,
        kv,
        "/api/iconoplasm/admin/votes/vision-stats?vision_ids=turbo-corrected,rax2-era-anima",
        { method: "GET" },
      )
      t.diagnostic(JSON.stringify({ case: "absent", ...absent.cost }))
      assert.equal(absent.status, 200, brief(absent.payload))
      assert.deepEqual(absent.payload.rows, [])
      assert.ok(absent.cost.rows_read < 40, JSON.stringify(absent.cost))

      // Failure mode 4: preview hydration reads only the requested vision's assets.
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

      // Failure mode 5: the scorecard asks for every row on purpose and gets them in order.
      const scorecard = await adminRequest(
        db,
        kv,
        "/api/iconoplasm/admin/votes/vision-stats?scope=all",
        { method: "GET" },
      )
      t.diagnostic(JSON.stringify({ case: "scope=all", ...scorecard.cost }))
      assert.equal(scorecard.status, 200, brief(scorecard.payload))
      assert.equal(scorecard.payload.count, ROLLUP_POPULATION + 1)
      assert.equal(scorecard.payload.rows[0].vision_id, "anima-v1-1")

      // Failure mode 6: a running bootstrap answers filtered requests from the direct read.
      await db
        .prepare(
          "UPDATE icono_admin_read_model_bootstrap SET status='running' WHERE bootstrap_key='default'",
        )
        .run()
      await db.prepare("DELETE FROM icono_admin_vision_rollup WHERE vision_id='anima-v1-1'").run()
      const rebuilding = await adminRequest(db, kv, "/api/iconoplasm/admin/votes/vision-stats", {
        method: "POST",
        body: JSON.stringify({ vision_ids: ["anima-v1-1"] }),
      })
      t.diagnostic(JSON.stringify({ case: "bootstrap-running", ...rebuilding.cost }))
      assert.equal(rebuilding.status, 200, brief(rebuilding.payload))
      assert.equal(rebuilding.payload.rows.length, 1)
      assert.equal(rebuilding.payload.rows[0].image_count, 3)
      assert.ok(rebuilding.cost.rows_read < 100, JSON.stringify(rebuilding.cost))
    } finally {
      await runtime.dispose()
    }
  },
)
