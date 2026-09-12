import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

test(
  "warm vote and import do not export the gene's 10000 historical image summaries",
  { timeout: 60000 },
  async (t) => {
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
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        contents: `
      import {IconoplasmVoteCoordinator as Coordinator} from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
      export class TestCoordinator {
        constructor(state) {
          this.state=state; this.cost={rows_read:0,rows_written:0};
          const sql={exec:(query,...args)=>{
            const cursor=state.storage.sql.exec(query,...args);
            const rows=cursor.toArray();
            this.cost.rows_read+=cursor.rowsRead;this.cost.rows_written+=cursor.rowsWritten;
            return {toArray:()=>rows};
          }};
          const storage={sql,transactionSync:fn=>state.storage.transactionSync(fn),setAlarm:async()=>{}};
          this.coordinator=new Coordinator({storage,blockConcurrencyWhile:fn=>state.blockConcurrencyWhile(fn)},
            {ICONOPLASM_DB:{prepare(){throw Error('Warm vote unexpectedly queried D1')}}});
        }
        async fetch(request) {
          const path=new URL(request.url).pathname;
          if(path==='/seed') {
            this.state.storage.sql.exec("WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10000) INSERT INTO asset_summary(asset_sha256,vision_id,candidate_image_id) SELECT printf('%064x',n),'anima-v1-9',n FROM ids");
            this.coordinator.setMeta('symbol','TP53');this.coordinator.setMeta('bootstrapped','1');
            return Response.json({ok:true});
          }
          this.cost={rows_read:0,rows_written:0};
          const response=await this.coordinator.fetch(request);
          return Response.json({body:await response.json(),cost:this.cost,status:response.status});
        }
      }
      export default {fetch(request,env){return env.COORDINATOR.get(env.COORDINATOR.idFromName('TP53')).fetch(request)}}
    `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { COORDINATOR: { className: "TestCoordinator", useSQLite: true } },
      }),
    )
    try {
      await runtime.dispatchFetch("https://test/seed")
      const asset = "1".padStart(64, "0")
      const vote = await (
        await runtime.dispatchFetch("https://test/vote/set", {
          method: "POST",
          body: JSON.stringify({
            symbol: "TP53",
            asset_sha256: asset,
            user_id: "test-user",
            vote_value: 1,
          }),
        })
      ).json()
      assert.equal(vote.status, 200)
      assert.equal(vote.body.final_vote_value, 1)
      assert.equal(vote.body.snapshot.image_score, 1)
      assert.equal(Object.hasOwn(vote.body, "asset_summaries"), false)
      assert.ok(vote.cost.rows_read <= 200, JSON.stringify(vote.cost))
      assert.ok(vote.cost.rows_written <= 60, JSON.stringify(vote.cost))
      const imported = await (
        await runtime.dispatchFetch("https://test/vote/import", {
          method: "POST",
          body: JSON.stringify({
            symbol: "TP53",
            items: [{ asset_sha256: asset, user_id: "second-user", vote_value: -1 }],
          }),
        })
      ).json()
      assert.equal(imported.status, 200)
      assert.equal(imported.body.upserted, 1)
      assert.equal(Object.hasOwn(imported.body, "asset_summaries"), false)
      assert.ok(imported.cost.rows_read <= 200, JSON.stringify(imported.cost))
      assert.ok(imported.cost.rows_written <= 60, JSON.stringify(imported.cost))
      const repeated = await (
        await runtime.dispatchFetch("https://test/vote/set", {
          method: "POST",
          body: JSON.stringify({
            symbol: "TP53",
            asset_sha256: asset,
            user_id: "test-user",
            vote_value: 1,
          }),
        })
      ).json()
      assert.equal(repeated.status, 200)
      assert.equal(repeated.body.changed, false)
      assert.equal(repeated.body.snapshot.image_score, 0)
      assert.equal(repeated.body.snapshot.user_vote, 1)
      assert.equal(
        repeated.cost.rows_written,
        0,
        "unchanged metadata and a duplicate vote do not write SQL rows",
      )
      t.diagnostic(
        JSON.stringify({
          assets: 10000,
          vote: vote.cost,
          import: imported.cost,
          repeated: repeated.cost,
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
