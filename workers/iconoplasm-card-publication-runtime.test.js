import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import esbuild from "esbuild"
import {
  createCardPublicationCoordinatorClass,
  projectGeneDelta,
  projectPublicCardHead,
} from "./lib/iconoplasm-card-publication-coordinator.js"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")

test("card publication projects one committed public head without repeat writes", async () => {
  const values = new Map()
  let writes = 0
  const env = {
    KV: {
      async get(key) {
        return values.get(key) || null
      },
      async put(key, value) {
        writes += 1
        values.set(key, value)
      },
    },
  }
  const head = {
    current: {
      version: "ccv2-" + "a".repeat(64),
      key: "manifests/aa.json",
      published_at: "2026-09-01T00:00:00.000Z",
      manifest: { schema: "iconoplasm.cardCatalog.v2", storage: "bunny_card_catalog_v2" },
    },
    previous: { version: "ccv2-" + "b".repeat(64) },
  }

  await projectPublicCardHead(env, head)
  await projectPublicCardHead(env, head)

  assert.equal(writes, 1)
  assert.deepEqual(JSON.parse(values.get("iconoplasm:gallery-version")), {
    current: head.current.version,
    previous: head.previous.version,
    published_at: head.current.published_at,
    schema: head.current.manifest.schema,
    storage: head.current.manifest.storage,
    manifest_key: head.current.key,
    status: "active",
  })
})

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
            if(new URL(request.url).pathname === '/alarm-budget-test') {
              await this.state.storage.deleteAlarm();
              this.repo.remove('failure');
              const day = new Date().toISOString().slice(0,10);
              this.repo.put('write_allocation',{day,reserved:0,accounting_version:2});
              await this.arm(60000);
              const first=this.repo.get('write_allocation');
              await this.arm(120000);
              const unchanged=this.repo.get('write_allocation');
              await this.state.storage.setAlarm(Date.now()-1000);
              const beforePastDueRecovery=this.repo.get('write_allocation');
              await this.arm(1000);
              const recoveredPastDueAlarm=await this.state.storage.getAlarm();
              const afterPastDueRecovery=this.repo.get('write_allocation');
              await this.state.storage.deleteAlarm();
              this.repo.put('write_allocation',{day,reserved:54000,accounting_version:2});
              this.repo.put('requested',true);
              await this.alarm();
              const retryAlarm=await this.state.storage.getAlarm();
              await this.arm(1000);
              return Response.json({first,unchanged,beforePastDueRecovery,recoveredPastDueAlarm,afterPastDueRecovery,retryAlarm,retainedAlarm:await this.state.storage.getAlarm(),failure:this.repo.get('failure'),allocation:this.repo.get('write_allocation')});
            }
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
            if(new URL(request.url).pathname === '/progress-test') {
              this.repo.put('head',{current:{version:'ccv2-old',published_at:'2026-09-19T00:00:00.000Z',manifest:{build_revision:2,card_count:19023}},previous:null,watermark:{id:1}});
              this.repo.put('job',{migration:true,bootstrap:false,group:2,groups:[{},{},{}],offset:12,seal_offset:128,started_at:'2026-09-19T00:01:00.000Z'});
              return super.fetch(new Request('https://test/status'));
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
      const alarmBudgetResponse = await runtime.dispatchFetch("https://test/alarm-budget-test")
      const alarmBudgetText = await alarmBudgetResponse.text()
      assert.equal(alarmBudgetResponse.status, 200, alarmBudgetText)
      const alarmBudget = JSON.parse(alarmBudgetText)
      assert.equal(
        alarmBudget.first.reserved,
        2,
        "alarm and its reservation are both billed writes",
      )
      assert.deepEqual(alarmBudget.unchanged, alarmBudget.first, "an already earlier alarm is free")
      assert.ok(
        alarmBudget.recoveredPastDueAlarm > Date.now(),
        "a retained past-due platform alarm is replaced with executable future work",
      )
      assert.equal(
        alarmBudget.afterPastDueRecovery.reserved,
        alarmBudget.beforePastDueRecovery.reserved + 2,
        "past-due recovery reserves the alarm row and its accounting row",
      )
      assert.equal(
        alarmBudget.allocation.reserved,
        54004,
        "failure record and recovery alarm use protected control headroom",
      )
      const nextUtcDay = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z") + 86400000
      assert.equal(alarmBudget.failure.retry_at, nextUtcDay)
      assert.equal(alarmBudget.retryAlarm, nextUtcDay)
      assert.equal(
        alarmBudget.retainedAlarm,
        nextUtcDay,
        "a wake must not shorten quota-day backoff",
      )
      const retainedHead = await (await runtime.dispatchFetch("https://test/head")).json()
      assert.equal(retainedHead.current, head.current, "quota recovery must leave readers online")
      const quota = await (await runtime.dispatchFetch("https://test/quota-test")).json()
      assert.equal(quota.rejected, true)
      assert.equal(quota.retained.reserved, 55000)
      assert.equal(quota.reset.reserved, 2)
      const progress = await (await runtime.dispatchFetch("https://test/progress-test")).json()
      assert.equal(progress.build_revision, 2)
      assert.deepEqual(progress.job, {
        bootstrap: false,
        migration: true,
        group: 2,
        groups: 3,
        offset: 12,
        seal_offset: 128,
        started_at: "2026-09-19T00:01:00.000Z",
      })
      assert.equal(quota.reset.day, new Date().toISOString().slice(0, 10))
    } finally {
      await runtime.dispose()
    }
  },
)

class CoordinatorSqlForTest {
  constructor() {
    this.db = new DatabaseSync(":memory:")
  }

  exec(sql, ...bindings) {
    const source = String(sql || "")
    let rows = []
    if (bindings.length) {
      rows = this.db.prepare(source).all(...bindings)
    } else if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(source) && !source.trim().includes(";")) {
      rows = this.db.prepare(source).all()
    } else {
      this.db.exec(source)
    }
    return { toArray: () => rows }
  }
}

function fakeCoordinatorState() {
  const sql = new CoordinatorSqlForTest()
  let alarm = null
  const storage = {
    sql,
    transactionSync(callback) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        sql.db.exec("COMMIT")
        return result
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value) {
      alarm = value
    },
  }
  const state = {
    storage,
    blockConcurrencyWhile(callback) {
      this.ready = Promise.resolve().then(callback)
      return this.ready
    },
  }
  return { state, sql }
}

const sha = (char) => char.repeat(64)
const commitPayload = (overrides = {}) => ({
  symbol: "TP53",
  version: 1,
  selection_key: sha("a"),
  withdrawn: false,
  card: { key: `published-cards/v2/immutable/cards/${sha("b")}.json`, hash: sha("b") },
  gene: { key: `published-cards/v2/immutable/genes/${sha("c")}.json`, hash: sha("c") },
  portrait: {
    key: `published-cards/v2/immutable/portraits/${sha("d")}.json`,
    hash: sha("d"),
  },
  ...overrides,
})

test("coordinator accepts revision-checked gene commits once and replays repeats", async () => {
  const { state, sql } = fakeCoordinatorState()
  const Publisher = createCardPublicationCoordinatorClass(() => ({}))
  const owner = new Publisher(state, {})
  await state.ready
  const commit = (body) =>
    owner.fetch(
      new Request("https://internal/commit-gene-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
  const first = await commit(commitPayload())
  assert.equal(first.status, 200)
  assert.equal((await first.json()).accepted, true)
  const replay = await commit(commitPayload())
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).replayed, true)
  const conflict = await commit(commitPayload({ selection_key: sha("e") }))
  assert.equal(conflict.status, 409)
  assert.equal((await conflict.json()).code, "GENE_COMMIT_CONFLICT")
  const stale = await commit(commitPayload({ version: 0 }))
  assert.equal(stale.status, 400)
  const status = await (await owner.fetch(new Request("https://internal/gene-delta-status"))).json()
  assert.equal(status.ok, true)
  assert.equal(status.seq, 0)
  assert.equal(status.pending, 1)
  assert.equal(status.projection_pending, true)
  assert.equal(status.segments, 0)
  sql.db.close()
})

test("gene delta projection writes the KV document once and skips unchanged bytes", async () => {
  const values = new Map()
  let writes = 0
  const env = {
    KV: {
      async get(key) {
        return values.get(key) || null
      },
      async put(key, value) {
        writes += 1
        values.set(key, value)
      },
    },
  }
  const projection = {
    schema_version: 1,
    base: "ccv2-" + sha("a"),
    view: "ccv2-" + sha("a") + ".c" + sha("f"),
    chain_hash: sha("f"),
    segments: [
      { seq: 1, key: "published-cards/v2/immutable/indexes/x.json", hash: sha("b"), count: 2 },
    ],
    entry_count: 2,
    committed_at: null,
  }
  const first = await projectGeneDelta(env, projection, null)
  assert.equal(first.written, true)
  const repeat = await projectGeneDelta(env, projection, first.json)
  assert.equal(repeat.written, false)
  assert.equal(writes, 1)
  assert.deepEqual(
    JSON.parse(values.get("iconoplasm:gene-delta")).segments[0].key,
    projection.segments[0].key,
  )
})

test(
  "a changed delta view is not advertised until its chain and segments are reader-readable",
  { timeout: 60000 },
  async () => {
    const values = new Map()
    let writes = 0
    const env = {
      KV: {
        async get(key) {
          return values.get(key) || null
        },
        async put(key, value) {
          writes += 1
          values.set(key, value)
        },
      },
    }
    const { state, sql } = fakeCoordinatorState()
    const Publisher = createCardPublicationCoordinatorClass(() => ({}))
    const owner = new Publisher(state, env)
    await state.ready
    owner.repo.put("head", { current: { version: "ccv2-" + sha("a") }, previous: null })
    const commit = await owner.fetch(
      new Request("https://internal/commit-gene-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commitPayload()),
      }),
    )
    assert.equal(commit.status, 200)

    const wrote = []
    let reachable = false
    owner.objectStore = {
      async read() {
        return null
      },
      async write(kind, value) {
        const key = `published-cards/v2/immutable/${kind}/${sha("f")}.json`
        wrote.push(key)
        return { key, hash: sha("f"), size: JSON.stringify(value).length }
      },
      async verifyReaderResolvable(key) {
        return {
          ready: reachable,
          sources: { authenticated_storage: reachable, cdn: reachable },
        }
      },
    }

    // Immutable writes succeed, but the read plane is not yet stable: the
    // changed view must not be advertised, and the previous projection (none)
    // stays authoritative with durable projection work still pending.
    const blocked = await owner.projectGeneDeltaStep()
    assert.equal(blocked.ok, false)
    assert.equal(blocked.reason, "delta_objects_unreadable")
    assert.equal(blocked.more, true)
    assert.equal(writes, 0)
    assert.equal(values.has("iconoplasm:gene-delta"), false)
    assert.equal(owner.geneDelta.projection_pending, true)
    assert.ok(wrote.length >= 2, "the segment and chain writes happened")

    // A later wake sees the same immutable dependencies stably readable and
    // advertises the view exactly once.
    reachable = true
    const advanced = await owner.projectGeneDeltaStep()
    assert.equal(advanced.ok, true)
    assert.equal(advanced.advertised, true)
    assert.equal(writes, 1)
    const advertised = JSON.parse(values.get("iconoplasm:gene-delta"))
    assert.equal(advertised.chain_hash, sha("f"))

    // Idle repeat performs no KV writes and no new immutable writes.
    const idle = await owner.projectGeneDeltaStep()
    assert.equal(idle.skipped, true)
    assert.equal(writes, 1)
    assert.equal(wrote.length, 2)
    sql.db.close()
  },
)

test(
  "a card-catalog head advance re-advertises the durable delta view on the new base",
  { timeout: 60000 },
  async () => {
    const values = new Map()
    let writes = 0
    const env = {
      KV: {
        async get(key) {
          return values.get(key) || null
        },
        async put(key, value) {
          writes += 1
          values.set(key, value)
        },
      },
    }
    const { state, sql } = fakeCoordinatorState()
    const Publisher = createCardPublicationCoordinatorClass(() => ({}))
    const owner = new Publisher(state, env)
    await state.ready
    const baseA = "ccv2-" + sha("a")
    const baseB = "ccv2-" + sha("b")
    owner.repo.put("head", { current: { version: baseA }, previous: null })
    const commit = await owner.fetch(
      new Request("https://internal/commit-gene-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commitPayload()),
      }),
    )
    assert.equal(commit.status, 200)

    let immutableWrites = 0
    owner.objectStore = {
      async read() {
        return null
      },
      async write(kind, value) {
        immutableWrites += 1
        const hash = sha(String(immutableWrites % 10))
        return {
          key: `published-cards/v2/immutable/${kind}/${hash}.json`,
          hash,
          size: JSON.stringify(value).length,
        }
      },
      async verifyReaderResolvable() {
        return { ready: true, sources: { authenticated_storage: true, cdn: true } }
      },
    }

    const first = await owner.projectGeneDeltaStep()
    assert.equal(first.ok, true)
    assert.equal(first.advertised, true)
    const advertisedA = JSON.parse(values.get("iconoplasm:gene-delta"))
    assert.equal(advertisedA.base, baseA)
    assert.match(advertisedA.view, /\.c[a-f0-9]{64}$/)
    assert.equal(writes, 1)

    // Global base advance: no gene-delta change is pending, but the advertised
    // view now names a base readers refuse. The same wake must re-base it so
    // the committed selections stay visible.
    owner.repo.put("head", { current: { version: baseB }, previous: { version: baseA } })
    const rebased = await owner.projectGeneDeltaStep()
    assert.equal(rebased.ok, true)
    assert.equal(rebased.advertised, true)
    const advertisedB = JSON.parse(values.get("iconoplasm:gene-delta"))
    assert.equal(advertisedB.base, baseB)
    assert.match(advertisedB.view, new RegExp(`^${baseB}\\.c[a-f0-9]{64}$`))
    assert.notEqual(advertisedB.chain_hash, advertisedA.chain_hash)
    assert.deepEqual(advertisedB.segments, advertisedA.segments)
    assert.equal(writes, 2)

    // Idle repeat on the new base still writes nothing.
    const idle = await owner.projectGeneDeltaStep()
    assert.equal(idle.skipped, true)
    assert.equal(writes, 2)
    sql.db.close()
  },
)
