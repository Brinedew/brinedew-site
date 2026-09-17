from pathlib import Path
import base64
import gzip
import hashlib
import subprocess


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one patch anchor: {old[:100]!r}; got {text.count(old)}")
    return text.replace(old, new, 1)


encoded = Path('.github/b749-patch-v3-1.b64').read_bytes() + Path('.github/b749-patch-v3-2.b64').read_bytes()
patch = gzip.decompress(base64.b64decode(encoded))
if hashlib.sha256(patch).hexdigest() != 'a4c54d242d21be11677123491d25706e7523931bb9a1e56b6703406b272b0142':
    raise SystemExit('Stored candidate patch identity changed')
patch_file = Path('/tmp/b749-runtime.patch')
patch_file.write_bytes(patch)
runtime_path = 'workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js'
queue_path = 'workers/iconoplasm.sync-finalization-queue.test.js'
args = ['git', 'apply', '--include=' + runtime_path, '--include=' + queue_path]
subprocess.run(args + ['--check', str(patch_file)], check=True)
subprocess.run(args + [str(patch_file)], check=True)
encoded = Path('.github/b749-test-v2-1.b64').read_bytes() + Path('.github/b749-test-v2-2.b64').read_bytes()
Path('workers/iconoplasm/sync-finalization-publication.test.js').write_bytes(gzip.decompress(base64.b64decode(encoded)))

p = Path(runtime_path)
s = p.read_text()
a = s.index('  async acceptSyncFinalizationHandoff(')
b = s.index('  pendingOutboxRows(', a)
s = s[:a] + Path('.github/b749-v4-owner.txt').read_text() + '\n' + s[b:]
s = replace_once(s, 'await this.acceptSyncFinalizationHandoff(requestedSymbol)', 'await this.acceptSyncFinalizationHandoff(requestedSymbol, payload?.job_version)')
s = replace_once(s, '''    notifyPublisher: async ({ symbols: readySymbols }) => {
      for (const symbol of readySymbols) {''', '''    notifyPublisher: async ({ jobs }) => {
      for (const job of jobs) {
        const symbol = job.gene_symbol''')
s = replace_once(s, '''          "/publication/finalization-handoff",
          { symbol },
        )
        if (response?.accepted !== true) {''', '''          "/publication/finalization-handoff",
          { symbol, job_version: job.job_version },
        )
        if (response?.accepted !== true || response?.authority_epoch !== "v2" ||
            response?.symbol !== symbol || response?.job_version !== job.job_version) {''')
s = replace_once(s, '''      for (let index = 0; index < messages.length; index += 1) {
        const sent = await sendSyncFinalizationDrainQueueMessage(this.env, messages[index])''', '''      const delivered = new Set()
      const messageIdentity = (message) => JSON.stringify([
        message?.run_id, message?.symbols, message?.drain_scoped_phases === true,
      ])
      for (let index = 0; index < messages.length; index += 1) {
        const sent = await sendSyncFinalizationDrainQueueMessage(this.env, messages[index])''')
s = replace_once(s, '''              ...wake,
              messages: messages.slice(index),
              due_at: Date.now() + delay,''', '''              ...current,
              messages: (Array.isArray(current.messages) ? current.messages : [])
                .filter((message) => !delivered.has(messageIdentity(message))),
              due_at: Date.now() + delay,''')
s = replace_once(s, '''          return { ok: false, deferred: true, reason: sent.code }
        }
      }
      await this.state.storage.transaction(async (txn) => {
        const current = await txn.get(key)
        if (current?.day === wake.day) await txn.delete(key)
        await this.schedulePendingResetAlarm(txn)
      })''', '''          return { ok: false, deferred: true, reason: sent.code }
        }
        delivered.add(messageIdentity(messages[index]))
      }
      await this.state.storage.transaction(async (txn) => {
        const current = await txn.get(key)
        if (current?.day === wake.day) {
          const remaining = (Array.isArray(current.messages) ? current.messages : [])
            .filter((message) => !delivered.has(messageIdentity(message)))
          if (remaining.length) {
            await txn.put(key, { ...current, messages: remaining, due_at: Date.now() + 1 })
          } else {
            await txn.delete(key)
          }
        }
        await this.schedulePendingResetAlarm(txn)
      })''')
p.write_text(s)

p = Path(queue_path)
s = replace_once(p.read_text(), '  FINALIZATION_COMPLETION_PAGE_SIZE,\n', '  FINALIZATION_COMPLETION_PAGE_SIZE,\n  SCOPED_FINALIZATION_REMAINDER_SQL,\n')
s = replace_once(s, '  async first() {\n', '''  async first() {
    if (this.sql === SCOPED_FINALIZATION_REMAINDER_SQL) {
      const scope = new Set(JSON.parse(this.args[0]))
      const rows = [...this.db.jobs.values()].filter(
        (row) => scope.has(row.gene_symbol) && row.status !== "completed",
      )
      return {
        remaining: rows.length,
        ready_remaining: rows.filter(
          (row) => ["completed_pending_finalize", "completed"].includes(row.phase),
        ).length,
      }
    }
''')
s = replace_once(s, 'return Response.json({ ok: true, accepted: true, symbol, authority_epoch: "v2" })', 'return Response.json({ ok: true, accepted: true, symbol, authority_epoch: "v2", job_version: payload.job_version })')
p.write_text(s)

for target, carrier in [
    ('workers/iconoplasm.vote-authority-demand-handover.test.js', '.github/b749-v4-owner-tests.txt'),
    ('workers/iconoplasm.b749-scoped-reset.test.js', '.github/b749-v4-reset-tests.txt'),
]:
    p = Path(target)
    p.write_text(p.read_text() + Path(carrier).read_text())

for name, old, new in [
    ('workers/iconoplasm.finalization-reset-alarm.test.js', 'else await this.governor.deferFinalizationToReset();', "else await this.governor.deferFinalizationToReset({runId:'retained-alarm-run',symbols:['TP53']});"),
    ('workers/iconoplasm.vote-reset-wake.test.js', 'await governor.deferFinalizationToReset()', 'await governor.deferFinalizationToReset({ runId: "shared-reset-run", symbols: ["TP53"] })'),
    ('workers/iconoplasm.daily-budget-kill-switch.test.js', 'body: { kind: "drain_finalization_ledger", run_id: "sync-budget-test", symbols: [] },', 'body: { kind: "drain_finalization_ledger", run_id: "sync-budget-test", symbols: ["TP53"] },'),
]:
    p = Path(name)
    p.write_text(replace_once(p.read_text(), old, new))
