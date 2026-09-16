import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"

// Uses the repository's locked Wrangler/workerd, the deployed compatibility
// date, real DO SQL row receipts, and real transactional alarm storage.
// Alarm TIMES are placed one day ahead; automatic alarm delivery is not tested.
test("B-762 publication state in real SQLite Durable Objects", { timeout: 120000 }, async (t) => {
  const require = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare")
  const source = readFileSync(new URL("./gene-publication-state.js", import.meta.url), "utf8")
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2025-11-12",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
      script: `${source}
      export class Probe {
        constructor(state) {
          this.state = state;
          this.now = Date.now() + 86400000;
          this.cost = { rowsRead: 0, rowsWritten: 0, alarmReads: 0, alarmWrites: 0 };
          this.failAfterAlarm = false;
          const storage = {
            sql: { exec: (query, ...args) => {
              const cursor = state.storage.sql.exec(query, ...args);
              const rows = cursor.toArray();
              this.cost.rowsRead += cursor.rowsRead;
              this.cost.rowsWritten += cursor.rowsWritten;
              return { toArray: () => rows };
            }},
            transaction: callback => state.storage.transaction(callback),
            getAlarm: async () => { this.cost.alarmReads++; return state.storage.getAlarm(); },
            setAlarm: async time => {
              this.cost.alarmWrites++;
              await state.storage.setAlarm(time);
              if (this.failAfterAlarm) throw Error('injected failure AFTER native setAlarm');
            },
          };
          this.storage = storage;
          this.publication = new IconoplasmGenePublicationState(storage, { clock: () => this.now });
          this.publication.install();
          state.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_votes (id INTEGER PRIMARY KEY, value INTEGER)');
        }
        async alarm() { throw Error('unexpected automatic alarm: fixture must stay in future'); }
        async fetch(request) {
          const input = await request.json();
          if (input.advance) this.now += input.advance;
          if (input.consumeAlarm) await this.state.storage.deleteAlarm();
          this.cost = { rowsRead: 0, rowsWritten: 0, alarmReads: 0, alarmWrites: 0 };
          let result, error;
          this.failAfterAlarm = input.failAfterAlarm === true;
          try {
            if (input.op === 'commit') result = await this.publication.commitSelection(() => {
              if (input.mutateVote) this.storage.sql.exec('INSERT INTO test_votes VALUES (1, 1)');
              return input.selection;
            });
            else if (input.op === 'begin') result = await this.publication.beginAttempt();
            else if (input.op === 'complete') result = await this.publication.completeAttempt(input.ticket, input.artifact);
            else if (input.op === 'fail') result = await this.publication.failAttempt(input.ticket, input.options);
            else if (input.op === 'reconstruct') {
              this.publication = new IconoplasmGenePublicationState(this.storage, { clock: () => this.now });
              result = await this.publication.recoverWakeup();
            }
            else if (input.op !== 'inspect') throw Error('unknown test operation');
          } catch (caught) { error = String(caught.message); }
          const cost = { ...this.cost };
          return Response.json({ result, error, cost, state: this.publication.read(),
            votes: this.state.storage.sql.exec('SELECT COUNT(*) AS n FROM test_votes').toArray()[0].n,
            alarm: await this.state.storage.getAlarm() });
        }
      }
      export default { fetch(request, env) {
        return env.PROBE.get(env.PROBE.idFromName(new URL(request.url).pathname)).fetch(request);
      }}
    `,
    }),
  )
  t.after(() => runtime.dispose())
  const call = async (gene, body) =>
    (
      await runtime.dispatchFetch(`https://test/${gene}`, {
        method: "POST",
        body: JSON.stringify(body),
      })
    ).json()
  const selected = (n) => ({
    selectionKey: String(n).padStart(64, "0"),
    selectionRef: `revision:${n}`,
  })
  const object = (n) => ({
    selectionKey: selected(n).selectionKey,
    contentSha256: "a".repeat(64),
    objectKey: `cards/${n}.json`,
  })

  const rolledBack = await call("ROLLBACK", {
    op: "commit",
    selection: selected(1),
    mutateVote: true,
    failAfterAlarm: true,
  })
  assert.match(rolledBack.error, /AFTER native setAlarm/)
  assert.equal(rolledBack.state, null)
  assert.equal(rolledBack.votes, 0)
  assert.equal(rolledBack.alarm, null)

  const first = await call("TP53", { op: "commit", selection: selected(1) })
  assert.equal(first.error, undefined)
  assert.equal(first.cost.rowsWritten, 1)
  assert.equal(first.cost.alarmWrites, 1)
  const noop = await call("TP53", { op: "commit", selection: selected(1) })
  assert.equal(noop.cost.rowsWritten, 0)
  assert.equal(noop.cost.alarmWrites, 0)
  const old = await call("TP53", { op: "begin", consumeAlarm: true })
  assert.equal(old.error, undefined)
  assert.ok(old.alarm > first.alarm)
  await call("TP53", { op: "commit", selection: selected(2) })
  const stale = await call("TP53", { op: "complete", ticket: old.result, artifact: object(1) })
  assert.equal(stale.result.applied, false)
  assert.equal(stale.cost.rowsWritten, 0)
  assert.equal(stale.state.pending, true)
  const current = await call("TP53", { op: "begin", consumeAlarm: true })
  const published = await call("TP53", {
    op: "complete",
    ticket: current.result,
    artifact: object(2),
  })
  assert.equal(published.result.applied, true)
  assert.equal(published.cost.rowsWritten, 1)

  await call("FAILED", { op: "commit", selection: selected(1) })
  const failureTicket = await call("FAILED", { op: "begin", consumeAlarm: true })
  await call("FAILED", { op: "fail", ticket: failureTicket.result })
  const restored = await call("FAILED", { op: "reconstruct", consumeAlarm: true })
  assert.equal(restored.result, true)
  assert.ok(restored.alarm)
  assert.equal(restored.state.pending, true)
  const idle = await call("TP53", { op: "begin", consumeAlarm: true })
  assert.equal(idle.result, null)
  assert.equal(idle.alarm, null)
  assert.equal(idle.cost.rowsWritten, 0)
  assert.equal(idle.cost.alarmWrites, 0)
  t.diagnostic(
    JSON.stringify({
      first: first.cost,
      noop: noop.cost,
      begin: old.cost,
      stale: stale.cost,
      published: published.cost,
      idle: idle.cost,
      rollback: rolledBack.cost,
    }),
  )
})
