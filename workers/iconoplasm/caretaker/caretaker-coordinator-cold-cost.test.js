import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import esbuild from "esbuild"

test(
  "cold caretaker commands preserve authority without importing ordinary vote history",
  { timeout: 60000 },
  async (t) => {
    const root = new URL("../../../", import.meta.url)
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const bundle = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["cloudflare:*", "node:*"],
      stdin: {
        resolveDir: fileURLToPath(root),
        contents: `
      import {IconoplasmVoteCoordinator as Coordinator} from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
      import {createOperationCostD1Meter} from './workers/iconoplasm/operation-cost-d1-meter.js';
      export class Probe {
        constructor(state,env) {
          this.state=state;this.env=env;this.sqlCost={rows_read:0,rows_written:0};this.alarmWrites=0;
          const sql={exec:(query,...args)=>{const cursor=state.storage.sql.exec(query,...args);const rows=cursor.toArray();this.sqlCost.rows_read+=cursor.rowsRead;this.sqlCost.rows_written+=cursor.rowsWritten;return {toArray:()=>rows}}};
          const storage={sql,transactionSync:fn=>state.storage.transactionSync(fn),setAlarm:async time=>{this.alarmWrites++;await state.storage.setAlarm(Math.max(time,Date.now()+86400000))}};
          this.context={storage,blockConcurrencyWhile:fn=>state.blockConcurrencyWhile(fn)};
          this.coordinator=new Coordinator(this.context,env);
        }
        async alarm() {}
        async fetch(request) {
          const path=new URL(request.url).pathname;
          if(path==='/inspect') return Response.json({
            meta:this.state.storage.sql.exec('SELECT * FROM meta ORDER BY key').toArray(),
            assignment:this.coordinator.caretakerSupervotes.readAssignment(),
            head:this.coordinator.caretakerSupervotes.readHead(),
            eligibility:this.state.storage.sql.exec('SELECT * FROM caretaker_supervote_asset_eligibility ORDER BY asset_sha256').toArray(),
            outbox:this.state.storage.sql.exec('SELECT * FROM caretaker_supervote_outbox ORDER BY id').toArray(),
            counts:this.state.storage.sql.exec('SELECT (SELECT COUNT(*) FROM asset_summary) AS assets,(SELECT COUNT(*) FROM vote_by_user_asset) AS votes').toArray()[0]
          });
          if(path==='/restart') {this.coordinator=new Coordinator(this.context,this.env);return Response.json({ok:true})}
          if(path==='/retain-pause') {this.coordinator.setMeta('outbox_budget_retry_at','1789344000000');return Response.json({ok:true})}
          this.sqlCost={rows_read:0,rows_written:0};this.alarmWrites=0;
          const meter=createOperationCostD1Meter(this.env.ICONOPLASM_DB);
          this.coordinator.env={...this.env,ICONOPLASM_DB:meter.db};
          try {
            const response=await this.coordinator.fetch(request);
            return Response.json({status:response.status,body:await response.json(),d1:meter.finish(),sql:this.sqlCost,alarm_writes:this.alarmWrites});
          }catch(error){return Response.json({error:String(error.message),d1:meter.finish(),sql:this.sqlCost})}
        }
      }
      export default {fetch(request,env){const id=new URL(request.url).searchParams.get('id');return env.PROBE.get(env.PROBE.idFromName(id)).fetch(request)}}
    `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["ICONOPLASM_DB"],
        durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const migrations = new URL("migrations-iconoplasm/", root)
      for (const file of readdirSync(migrations)
        .filter((n) => n.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, migrations), "utf8"))
      const db = await runtime.getD1Database("ICONOPLASM_DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let i = 0; i < definitions.length; i += 20)
        await db.batch(definitions.slice(i, i + 20).map(({ sql }) => db.prepare(sql)))
      const seed = async (symbol, n) =>
        db.batch([
          db
            .prepare(
              "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<?) INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,vision_id) SELECT ?,printf('%064x',n),'full','thumb','anima-v1-1' FROM ids",
            )
            .bind(n, symbol),
          db
            .prepare(
              "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<?) INSERT INTO icono_image_votes(gene_symbol,asset_sha256,user_id,vote_value,vision_id,candidate_ref) SELECT ?,printf('%064x',n),'user',1,'anima-v1-1',?||':'||printf('%064x',n) FROM ids",
            )
            .bind(n, symbol, symbol),
        ])
      const call = async (id, path, payload) =>
        (
          await runtime.dispatchFetch(`https://test${path}?id=${id}`, {
            method: "POST",
            body: JSON.stringify(payload || {}),
          })
        ).json()
      const assignment = (symbol) => ({
        symbol,
        event: {
          event_id: "assignment-1",
          event_sequence: 100,
          gene: { gene_id: `gene-${symbol}`, canonical_symbol: symbol },
          assignment: {
            caretaker_assignment_id: "assignment",
            account_id: "account",
            status: "active",
            assignment_version: 1,
          },
        },
      })
      const receipts = []
      for (const n of [1000, 10000]) {
        const symbol = `G${n}`
        await seed(symbol, n)
        const result = await call(symbol, "/caretaker-assignment/project", assignment(symbol))
        t.diagnostic(JSON.stringify({ selected_assets_and_votes: n, assignment: result }))
        assert.equal(result.status, 200, JSON.stringify(result))
        assert.deepEqual(result.d1, { rows_read: 0, rows_written: 0, requests: 1 })
        assert.ok(
          result.sql.rows_read < 100 && result.sql.rows_written < 100,
          JSON.stringify(result),
        )
        const snapshot = await call(symbol, "/caretaker-supervote/snapshot", {
          symbol,
          account_id: "account",
        })
        assert.equal(snapshot.status, 200)
        assert.equal(snapshot.sql.rows_written, 0)
        assert.deepEqual(snapshot.d1, { rows_read: 0, rows_written: 0, requests: 1 })
        const state = await call(symbol, "/inspect")
        assert.deepEqual(state.counts, { assets: 0, votes: 0 })
        assert.equal(state.eligibility.length, 0)
        assert.equal(
          state.meta.find((row) => row.key === "bootstrapped"),
          undefined,
        )
        receipts.push(result)
      }
      assert.deepEqual(receipts[0].sql, receipts[1].sql)

      const symbol = "G10000",
        sha = "1".padStart(64, "0")
      const initialEligibility = await db
        .prepare(
          "SELECT * FROM icono_caretaker_candidate_eligibility_projection WHERE gene_symbol=? AND asset_sha256=?",
        )
        .bind(symbol, sha)
        .first()
      for (const batch of [false, true]) {
        const projection = {
          ...initialEligibility,
          event_id: `candidate-eligibility:${initialEligibility.source_event_sequence}`,
        }
        const id = `eligibility-first-${batch}`
        const projected = await call(
          id,
          batch
            ? "/caretaker-supervote/eligibility/project-batch"
            : "/caretaker-supervote/eligibility/project",
          { symbol, ...(batch ? { projections: [projection] } : { projection }) },
        )
        assert.equal(projected.status, 200)
        assert.equal(projected.d1.rows_read, 0)
        assert.equal(projected.d1.rows_written, 0)
        assert.ok(projected.sql.rows_written < 20)
        assert.deepEqual((await call(id, "/inspect")).counts, { assets: 0, votes: 0 })
      }
      const command = {
        symbol,
        account_id: "account",
        asset_sha256: sha,
        direction: 1,
        command_id: "command-1",
        request_sha256: "a".repeat(64),
        expected_assignment_version: 1,
        expected_supervote_version: 0,
      }
      const selected = await call(symbol, "/caretaker-supervote/set", command)
      t.diagnostic(JSON.stringify({ selected }))
      assert.equal(selected.status, 200, JSON.stringify(selected))
      assert.ok(selected.d1.rows_read <= 2)
      assert.equal(selected.d1.rows_written, 0)
      await call(symbol, "/retain-pause")
      const before = await call(symbol, "/inspect")
      assert.equal(before.head.asset_sha256, sha)
      assert.equal(before.eligibility.length, 1)
      assert.deepEqual(before.counts, { assets: 0, votes: 0 })

      await call(symbol, "/restart")
      const replay = await call(symbol, "/caretaker-supervote/set", command)
      assert.equal(replay.status, 200)
      assert.equal(replay.body.replayed, true)
      assert.equal(replay.sql.rows_written, 0)
      assert.deepEqual((await call(symbol, "/inspect")).outbox, before.outbox)

      // The ordinary seed may follow an already-live caretaker. It must keep that
      // authority, exact eligibility version and pending deliveries untouched.
      const ordinary = await call(symbol, "/state", { symbol })
      t.diagnostic(
        JSON.stringify({
          ordinary: { ...ordinary, body: { assets: ordinary.body?.asset_summaries?.length } },
        }),
      )
      assert.equal(ordinary.status, 200, JSON.stringify(ordinary.error))
      assert.equal(ordinary.body.asset_summaries.length, 10000)
      const after = await call(symbol, "/inspect")
      assert.deepEqual(after.assignment, before.assignment)
      assert.deepEqual(after.head, before.head)
      assert.deepEqual(after.outbox, before.outbox)
      assert.deepEqual(after.eligibility, before.eligibility)
      assert.deepEqual(
        after.meta.find((row) => row.key === "outbox_budget_retry_at"),
        before.meta.find((row) => row.key === "outbox_budget_retry_at"),
      )
      assert.deepEqual(after.counts, { assets: 10000, votes: 10000 })

      await db
        .prepare(
          "UPDATE icono_portrait_assets SET status='rejected' WHERE gene_symbol=? AND asset_sha256=?",
        )
        .bind(symbol, sha)
        .run()
      const rejected = await call(symbol, "/caretaker-supervote/set", {
        ...command,
        command_id: "command-2",
        request_sha256: "b".repeat(64),
        expected_supervote_version: 1,
      })
      assert.equal(rejected.status, 409)
      assert.equal(rejected.body.code, "SUPERVOTE_TARGET_INELIGIBLE")
      const row = await db
        .prepare(
          "SELECT * FROM icono_caretaker_candidate_eligibility_projection WHERE gene_symbol=? AND asset_sha256=?",
        )
        .bind(symbol, sha)
        .first()
      const projection = { ...row, event_id: `candidate-eligibility:${row.source_event_sequence}` }
      const invalidated = await call(symbol, "/caretaker-supervote/eligibility/project-batch", {
        symbol,
        projections: [projection],
      })
      assert.equal(invalidated.status, 200)
      assert.equal((await call(symbol, "/inspect")).head.asset_sha256, null)
      const stale = await call(symbol, "/caretaker-supervote/eligibility/project", {
        symbol,
        projection: {
          ...projection,
          source_event_sequence: row.source_event_sequence - 1,
          eligibility_version: row.eligibility_version - 1,
          eligible: 1,
        },
      })
      assert.equal(stale.status, 409)
      assert.equal(stale.body.code, "STALE_CANDIDATE_ELIGIBILITY")
      const wrongGene = await call(symbol, "/caretaker-supervote/snapshot", {
        symbol: "OTHER",
        account_id: "account",
      })
      assert.match(wrongGene.error, /gene|symbol/i)
      assert.deepEqual((await call(symbol, "/inspect")).assignment, before.assignment)
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
