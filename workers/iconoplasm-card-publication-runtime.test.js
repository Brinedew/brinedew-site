import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")

test(
  "real workerd SQLite coordinator preserves the head through a Bunny failure and commits verified bytes",
  { timeout: 30000 },
  async () => {
    const bundled = await esbuild.build({
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      stdin: {
        resolveDir: fileURLToPath(new URL("..", import.meta.url)),
        contents: `
        import { createCardPublicationCoordinatorClass } from './workers/lib/iconoplasm-card-publication-coordinator.js';
        const cards = [{symbol:'EZH2', payload:{symbol:'EZH2', portrait:'original'}}];
        const Base = createCardPublicationCoordinatorClass(() => ({
          legacyBaseline: async () => ({manifest:{schema:'test', build_revision:1, shards:[{key:'legacy', first_symbol:'EZH2',last_symbol:'EZH2',card_count:1}]},watermark:{id:1}}),
          legacyCards: async () => cards,
          highWater: async () => ({id:1}), changed: async () => ({symbols:[],truncated:false}),
          materialize: async () => cards, complete: c => !!c.symbol,
          stable: x => x, project: x => x, locator: c => ({symbol:c.symbol,portrait:c.payload.portrait})
        }));
        export class TestPublication extends Base {
          async fetch(request) {
            if(new URL(request.url).pathname === '/quota-test') {
              const day = new Date().toISOString().slice(0,10);
              this.repo.put('write_allocation',{day,reserved:55000,limit:55000});
              let rejected = false;
              try {this.repo.reserveWrites(2)} catch {rejected=true}
              const retained=this.repo.get('write_allocation');
              this.repo.put('write_allocation',{day:'2000-01-01',reserved:55000,limit:55000});
              this.repo.reserveWrites(2);
              return Response.json({rejected,retained,reset:this.repo.get('write_allocation')});
            }
            if(new URL(request.url).pathname === '/step') {
              await this.alarm(); return super.fetch(new Request('https://test/status'));
            }
            return super.fetch(request);
          }
        }
        export default {fetch(request,env) {return env.PUBLISHER.get(env.PUBLISHER.idFromName('test')).fetch(request)}};
      `,
      },
    })
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "publication-test",
            modules: true,
            script: bundled.outputFiles[0].text,
            compatibilityDate: "2026-08-01",
            durableObjects: { PUBLISHER: { className: "TestPublication", useSQLite: true } },
            bindings: {
              ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "test",
              ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
            },
            outboundService: "bunny-test-storage",
          },
          {
            name: "bunny-test-storage",
            modules: true,
            compatibilityDate: "2026-08-01",
            script: `
        const objects = new Map(); let fail = true;
        export default {async fetch(request) {
          const key = new URL(request.url).pathname;
          if(key === '/recover') {fail=false;return new Response('ok')}
          if(request.method === 'PUT') {
            if(fail) return new Response(null,{status:503});
            objects.set(key,await request.arrayBuffer()); return new Response(null,{status:201});
          }
          return objects.has(key) ? new Response(objects.get(key)) : new Response(null,{status:404});
        }};
      `,
          },
        ],
      }),
    )
    try {
      const response = await runtime.dispatchFetch("https://test/bootstrap", { method: "POST" })
      assert.equal(response.status, 202)
      const failed = await (await runtime.dispatchFetch("https://test/step")).json()
      assert.equal(failed.current, null)
      assert.equal(failed.job.offset, 0)
      assert.match(failed.failure.message, /PUT failed/)
      const storage = await runtime.getWorker("bunny-test-storage")
      await storage.fetch("https://storage.test/recover")
      let status
      for (let i = 0; i < 5; i++)
        status = await (await runtime.dispatchFetch("https://test/step")).json()
      assert.match(status.current, /^ccv2-[a-f0-9]{64}$/)
      assert.equal(status.watermark.id, 1)
      assert.equal(status.job, null)
      assert.equal(status.failure, null)
      assert.equal(status.requested, false)
      const head = await (await runtime.dispatchFetch("https://test/head")).json()
      assert.equal(head.current, status.current)
      assert.equal(head.storage, "bunny_card_catalog_v2")
      const quota = await (await runtime.dispatchFetch("https://test/quota-test")).json()
      assert.equal(quota.rejected, true)
      assert.equal(quota.retained.reserved, 55000)
      assert.equal(quota.reset.reserved, 2)
      assert.equal(quota.reset.day, new Date().toISOString().slice(0, 10))
    } finally {
      await runtime.dispose()
    }
  },
)
