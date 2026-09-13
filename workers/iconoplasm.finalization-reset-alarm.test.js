import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

test(
  "both retained queue wakes commit with one alarm in real Durable Object SQLite",
  { timeout: 60000 },
  async () => {
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
      import {IconoplasmSyncGovernor as Governor} from './workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js';
      export class TestGovernor {
        constructor(state) {
          this.state=state;this.sends=0;this.voteSends=0;this.writes=0;this.alarms=0;
          const storage={get:key=>state.storage.get(key),transaction:fn=>state.storage.transaction(tx=>fn({
            get:key=>tx.get(key),delete:key=>tx.delete(key),
            put:(key,value)=>{this.writes++;return tx.put(key,value)},
            setAlarm:value=>{this.alarms++;return tx.setAlarm(value)}
          }))};
          this.make=()=>new Governor({storage},{ICONOPLASM_SYNC_FINALIZATION_QUEUE:{send:async()=>{this.sends++}},ICONOPLASM_VOTE_PROJECTION_QUEUE:{send:async()=>{this.voteSends++}}});
          this.governor=this.make();
        }
        alarm() { return this.governor.alarm() }
        async fetch(request) {
          const body=await request.json();
          if(body.restart)this.governor=this.make();
          if(body.fire) {
            for(const key of ['finalization_reset_wake','vote_projection_reset_wake']) {
              const wake=await this.state.storage.get(key);
              if(wake)await this.state.storage.put(key,{...wake,due_at:Date.now()-1});
            }
            await this.governor.alarm();
          } else if(body.vote) await this.governor.deferVoteProjectionToReset();
          else await this.governor.deferFinalizationToReset();
          return Response.json({wake:await this.state.storage.get('finalization_reset_wake')||null,voteWake:await this.state.storage.get('vote_projection_reset_wake')||null,alarm:await this.state.storage.getAlarm(),writes:this.writes,alarms:this.alarms,sends:this.sends,voteSends:this.voteSends});
        }
      }
      export default {fetch(request,env){return env.GOVERNOR.get(env.GOVERNOR.idFromName('existing-owner')).fetch(request)}}
    `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { GOVERNOR: { className: "TestGovernor", useSQLite: true } },
      }),
    )
    try {
      const send = async (body) => {
        const response = await runtime.dispatchFetch("https://test/", {
          method: "POST",
          body: JSON.stringify(body),
        })
        assert.equal(response.status, 200, await response.clone().text())
        return response.json()
      }
      const first = await send({})
      assert.ok(first.wake.due_at > Date.now())
      assert.equal(first.alarm, first.wake.due_at)
      assert.equal(first.writes, 1)
      assert.equal(first.alarms, 1)
      const again = await send({ restart: true })
      assert.equal(again.writes, 1)
      assert.equal(again.alarms, 1)
      const both = await send({ vote: true })
      assert.ok(both.voteWake.due_at > Date.now())
      assert.equal(both.alarm, Math.min(both.wake.due_at, both.voteWake.due_at))
      assert.equal(both.writes, 2)
      const repeatVote = await send({ vote: true, restart: true })
      assert.equal(repeatVote.writes, 2)
      assert.equal(repeatVote.alarms, both.alarms)
      const fired = await send({ fire: true, restart: true })
      assert.equal(fired.wake, null)
      assert.equal(fired.voteWake, null)
      assert.equal(fired.sends, 1)
      assert.equal(fired.voteSends, 1)
      const empty = await send({ fire: true })
      assert.equal(empty.sends, 1)
      assert.equal(empty.voteSends, 1)
    } finally {
      await runtime.dispose()
    }
  },
)
