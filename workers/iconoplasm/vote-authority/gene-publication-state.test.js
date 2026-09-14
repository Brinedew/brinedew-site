import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { IconoplasmGenePublicationState } from "./gene-publication-state.js"

// Real SQLite for SQL/rollback assertions; alarm scheduling is simulated here.
// This suite does not claim Cloudflare billing or real alarm delivery evidence.
function fixture(t) {
  const db = new DatabaseSync(":memory:")
  t.after(() => db.close())
  let alarm = null
  let failAlarm = false
  let writes = 0
  let alarmWrites = 0
  let now = 100000
  let transactionTail = Promise.resolve()
  const storage = {
    sql: {
      exec(query, ...args) {
        const rows = db.prepare(query).all(...args)
        if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(query))
          writes += db.prepare("SELECT changes() AS n").get().n
        return { toArray: () => rows }
      },
    },
    transaction(fn) {
      const run = transactionTail.then(async () => {
        const before = alarm
        db.exec("BEGIN IMMEDIATE")
        try {
          const result = await fn(storage)
          db.exec("COMMIT")
          return result
        } catch (error) {
          db.exec("ROLLBACK")
          alarm = before
          throw error
        }
      })
      transactionTail = run.catch(() => {})
      return run
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value) {
      if (failAlarm) throw new Error("alarm storage unavailable")
      alarm = value
      alarmWrites++
    },
  }
  const make = () => new IconoplasmGenePublicationState(storage, { clock: () => now })
  const store = make()
  store.install()
  return {
    db,
    storage,
    store,
    make,
    cost: () => ({ writes, alarmWrites }),
    resetCost: () => {
      writes = 0
      alarmWrites = 0
    },
    failAlarm: (value) => {
      failAlarm = value
    },
    alarm: () => alarm,
    setAlarm: (value) => {
      alarm = value
    },
    advance: (amount) => {
      now += amount
    },
    now: () => now,
  }
}
const desired = (n) => ({
  selectionKey: n.toString(16).padStart(64, "0"),
  selectionRef: `revision:${n}`,
})
const uploaded = (n) => ({
  selectionKey: desired(n).selectionKey,
  contentSha256: (n + 1000).toString(16).padStart(64, "0"),
  objectKey: `published-cards/v2/immutable/${n}/card.json`,
})
const commit = (store, n) => store.commitSelection(() => desired(n))

// Every listed invariant is checked against executed code, not source regexes.
test("empty reads and repeated idle calls neither write nor arm alarms", async (t) => {
  const f = fixture(t)
  for (let i = 0; i < 100; i++) {
    assert.equal(f.store.read(), null)
    assert.equal(await f.store.beginAttempt(), null)
    assert.equal(await f.store.recoverWakeup(), false)
  }
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 0 })
})

test("vote row, selection intent and alarm roll back together on alarm failure", async (t) => {
  const f = fixture(t)
  f.db.exec("CREATE TABLE test_votes (user_id TEXT PRIMARY KEY, value INTEGER)")
  f.failAlarm(true)
  await assert.rejects(
    f.store.commitSelection(() => {
      f.storage.sql.exec("INSERT INTO test_votes VALUES ('reader', 1)")
      return desired(1)
    }),
    /alarm storage unavailable/,
  )
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM test_votes").get().n, 0)
  assert.equal(f.store.read(), null)
  assert.equal(f.alarm(), null)
})

test("throwing winner reducer preserves accepted prior state", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  const before = f.store.read()
  await assert.rejects(
    f.store.commitSelection(() => {
      throw new Error("invalid entitlement")
    }),
    /invalid entitlement/,
  )
  assert.deepEqual(f.store.read(), before)
})

test("a thousand content-neutral or duplicate votes cost zero publication writes", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  f.resetCost()
  for (let i = 0; i < 1000; i++) assert.equal((await commit(f.store, 1)).changed, false)
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 0 })
})

test("reference-only selection key is the SHA-256 of the canonical reference", async (t) => {
  const f = fixture(t)
  const reference = "gene-authority-selection-v1|symbol=TP53|winner=none"
  const result = await f.store.commitSelection(() => ({ selectionRef: reference }))
  assert.equal(result.changed, true)
  assert.equal(result.state.selectionKey, createHash("sha256").update(reference).digest("hex"))
  assert.equal(result.state.selectionRef, reference)
})

test("repeated reference-only selections stay write-free and reject rebinding", async (t) => {
  const f = fixture(t)
  const reference = "gene-authority-selection-v1|symbol=TP53|winner=" + "a".repeat(64)
  const composed = await f.store.commitSelection(() => ({ selectionRef: reference }))
  f.resetCost()
  const repeat = await f.store.commitSelection(() => ({ selectionRef: reference }))
  assert.equal(repeat.changed, false)
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 0 })
  await assert.rejects(
    f.store.commitSelection(() => ({
      selectionKey: composed.state.selectionKey,
      selectionRef: "other",
    })),
    /rebound/,
  )
})

test("changed winners coalesce into one row with the newest immutable selection", async (t) => {
  const f = fixture(t)
  for (let i = 1; i <= 250; i++) await commit(f.store, i)
  assert.equal(f.store.read().desiredVersion, 250)
  assert.equal(f.store.read().selectionKey, desired(250).selectionKey)
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM iconoplasm_gene_publication_state_v2").get().n,
    1,
  )
  assert.equal(f.cost().writes, 250)
  assert.equal(f.cost().alarmWrites, 1)
})

test("old completion cannot publish or clear a newer selection, including A-B-A", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  const old = await f.store.beginAttempt()
  await commit(f.store, 2)
  await commit(f.store, 1)
  assert.deepEqual(await f.store.completeAttempt(old, uploaded(1)), { applied: false })
  assert.equal(f.store.read().pending, true)
  assert.equal(f.store.read().publishedArtifact, null)
  const current = await f.store.beginAttempt()
  assert.equal(current.desiredVersion, 3)
  assert.deepEqual(await f.store.completeAttempt(current, uploaded(1)), { applied: true })
})

test("timeout and reconstruction retain pending work and fence the old attempt", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  f.setAlarm(null) // The host alarm starts now.
  const first = await f.store.beginAttempt()
  assert.equal(f.alarm(), f.now() + 60000)
  const reconstructed = f.make()
  assert.equal(await reconstructed.beginAttempt(), null)
  f.advance(60000)
  f.setAlarm(null)
  const second = await reconstructed.beginAttempt()
  assert.equal(second.attemptId, first.attemptId + 1)
  assert.deepEqual(await reconstructed.completeAttempt(first, uploaded(1)), { applied: false })
  assert.deepEqual(await reconstructed.completeAttempt(second, uploaded(1)), { applied: true })
})

test("duplicate success and failure receipts are write-free", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  const ticket = await f.store.beginAttempt()
  await f.store.failAttempt(ticket)
  f.resetCost()
  assert.deepEqual(await f.store.failAttempt(ticket), { applied: false })
  assert.deepEqual(await f.store.completeAttempt(ticket, uploaded(1)), { applied: false })
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 0 })
  f.advance(1000)
  const retry = await f.store.beginAttempt()
  await f.store.completeAttempt(retry, uploaded(1))
  f.resetCost()
  assert.deepEqual(await f.store.completeAttempt(retry, uploaded(1)), { applied: false })
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 0 })
})

test("future retry never performs an attempt or shortens an explicit provider deferral", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  const ticket = await f.store.beginAttempt()
  const due = f.now() + 86400000
  assert.equal((await f.store.failAttempt(ticket, { retryAt: due })).retryAt, due)
  f.setAlarm(null)
  f.resetCost()
  for (let i = 0; i < 100; i++) assert.equal(await f.store.beginAttempt(), null)
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 1 })
  assert.equal(f.alarm(), due)
})

test("one gene's failed publication cannot block another gene", async (t) => {
  const sick = fixture(t)
  const healthy = fixture(t)
  await commit(sick.store, 1)
  await sick.store.failAttempt(await sick.store.beginAttempt(), { retryAt: sick.now() + 86400000 })
  await commit(healthy.store, 2)
  assert.deepEqual(
    await healthy.store.completeAttempt(await healthy.store.beginAttempt(), uploaded(2)),
    { applied: true },
  )
  assert.equal(sick.store.read().pending, true)
  assert.equal(healthy.store.read().pending, false)
})

test("failed replacement retains the previous complete public artifact", async (t) => {
  const f = fixture(t)
  await f.store.seedPublished(desired(1), uploaded(1))
  await commit(f.store, 2)
  await f.store.failAttempt(await f.store.beginAttempt())
  assert.deepEqual(f.store.read().publishedArtifact, uploaded(1))
  assert.equal(f.store.read().publishedVersion, 1)
  assert.equal(f.store.read().desiredVersion, 2)
})

test("migration repeats are no-ops and cannot overwrite dirty/newer authority", async (t) => {
  const f = fixture(t)
  await f.store.seedPublished(desired(1), uploaded(1))
  f.resetCost()
  assert.deepEqual(await f.store.seedPublished(desired(1), uploaded(1)), { changed: false })
  assert.deepEqual(f.cost(), { writes: 0, alarmWrites: 0 })
  await commit(f.store, 2)
  await assert.rejects(f.store.seedPublished(desired(1), uploaded(1)), /cannot overwrite/)
  assert.equal(f.store.read().selectionKey, desired(2).selectionKey)
})

test("recoverWakeup repairs only pending local work and preserves an earlier shared alarm", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  f.setAlarm(null)
  assert.equal(await f.make().recoverWakeup(), true)
  assert.equal(f.alarm(), f.now())
  const ticket = await f.store.beginAttempt()
  f.setAlarm(f.now() - 1)
  await f.store.failAttempt(ticket, { retryAt: f.now() + 86400000 })
  assert.equal(f.alarm(), f.now() - 1)
})

test("concurrent begin calls produce a single live attempt", async (t) => {
  const f = fixture(t)
  await commit(f.store, 1)
  const tickets = await Promise.all(Array.from({ length: 12 }, () => f.store.beginAttempt()))
  assert.equal(tickets.filter(Boolean).length, 1)
})

test("invalid selection, source rebinding, async mutations and corrupt receipts are rejected", async (t) => {
  const f = fixture(t)
  await assert.rejects(
    f.store.commitSelection(async () => desired(1)),
    /synchronous/,
  )
  await assert.rejects(
    f.store.commitSelection(() => ({ ...desired(1), selectionKey: "bad" })),
    /selectionKey/,
  )
  await commit(f.store, 1)
  await assert.rejects(
    f.store.commitSelection(() => ({ ...desired(1), selectionRef: "other" })),
    /rebound/,
  )
  const ticket = await f.store.beginAttempt()
  for (const bad of [
    { ...uploaded(1), selectionKey: desired(2).selectionKey },
    { ...uploaded(1), contentSha256: "corrupt" },
    { ...uploaded(1), objectKey: "https://unexpected.example/card" },
    { ...uploaded(1), objectKey: "../card" },
  ])
    await assert.rejects(f.store.completeAttempt(ticket, bad), /artifact|objectKey/)
  assert.equal(f.store.read().pending, true)
})
