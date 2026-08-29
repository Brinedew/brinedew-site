import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

// B-716 design experiment, NOT a deployed private-data authority. Measure the
// complete provenance payload and row operations before selecting a migration.
test(
  "measure bounded per-person discovery documents in real SQLite DO storage",
  { timeout: 30000 },
  async (t) => {
    const require = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      require.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: "2026-08-01",
        durableObjects: { COLLECTION: { className: "CollectionExperiment", useSQLite: true } },
        script: `
      export class CollectionExperiment {
        constructor(state) {this.state=state;this.sql=state.storage.sql;this.sql.exec('CREATE TABLE documents(name TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID')}
        async fetch() {
          const chunks = Array.from({length:64},()=>[]);
          const record = (i) => ['GENE'+i,'2026-08-27 12:00:00','2026-08-27 12:00:00',1,'extension_hover','extension_hover','hover_dwell','hover_dwell',900,900];
          for(let i=0;i<19023;i++) chunks[i%64].push(record(i));
          const put=(name,value)=>this.sql.exec('INSERT INTO documents VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value',name,JSON.stringify(value)).rowsWritten;
          const emptySize=this.sql.databaseSize;
          for(let i=0;i<64;i++) put('chunk'+i,chunks[i]);
          put('meta',{sequence:0,total:19023,pending:[]});
          const fullSize=this.sql.databaseSize;
          const chunkRead=this.sql.exec('SELECT value FROM documents WHERE name=?','chunk0');
          const restored=JSON.parse(chunkRead.toArray()[0].value);
          restored.push(record(19023));
          let mutationWrites=0;
          this.state.storage.transactionSync(()=>{
            mutationWrites+=put('chunk0',restored);
            mutationWrites+=put('meta',{sequence:1,total:19024,pending:[{sequence:1,symbol:'GENE19023',created:true,encounters:1}]});
          });
          const acknowledgmentWrites=put('meta',{sequence:1,total:19024,pending:[]});
          await this.state.storage.setAlarm(Date.now()+86400000);
          return Response.json({emptySize,fullSize,bytesPerDiscovery:(fullSize-emptySize)/19023,maxChunkBytes:Math.max(...chunks.map(c=>new TextEncoder().encode(JSON.stringify(c)).length)),mutationWrites,acknowledgmentWrites,membershipChunkRowsRead:chunkRead.rowsRead,roundTripFirst:restored[0]});
        }
        async alarm() {}
      }
      export default {fetch(request,env){return env.COLLECTION.get(env.COLLECTION.idFromName('experiment')).fetch(request)}};
    `,
      }),
    )
    try {
      const result = await (await runtime.dispatchFetch("https://test/")).json()
      assert.equal(result.mutationWrites, 2)
      assert.equal(result.acknowledgmentWrites, 1)
      assert.equal(result.membershipChunkRowsRead, 1)
      assert.ok(result.maxChunkBytes < 65536)
      assert.deepEqual(result.roundTripFirst, [
        "GENE0",
        "2026-08-27 12:00:00",
        "2026-08-27 12:00:00",
        1,
        "extension_hover",
        "extension_hover",
        "hover_dwell",
        "hover_dwell",
        900,
        900,
      ])
      // Official pricing bills setAlarm as one additional row; cursor statistics
      // do not expose that internal table, so label this separately, not measured.
      t.diagnostic(
        JSON.stringify({
          ...result,
          documentedAlarmWrites: 1,
          modeledWritesPerUnbatchedDiscovery: 4,
          excludes:
            "shared D1 projection/receipt, auth, retries, migration, all API consumers, account-wide headroom",
        }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)
