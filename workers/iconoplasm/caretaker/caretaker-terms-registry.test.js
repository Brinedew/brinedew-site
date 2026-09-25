// B-864: a terms change ships as a normal push. The checked-in registry names
// the current version; the claim offer seeds it on first sight. Ways this can
// go wrong, each asserted below:
// 1. the claim offer keeps naming an older seeded version, so nobody can
//    accept the new text;
// 2. the offer names the new id but with a hash other than the served copy's;
// 3. every signed-in gene view writes to D1 (the offer is a hot GET);
// 4. a version whose effective date is still in the future is offered early;
// 5. the same id already in D1 with different text is silently accepted,
//    so a caretaker's recorded hash stops matching what they read.
import assert from "node:assert/strict"
import test from "node:test"

import { CURRENT_CARETAKER_TERMS, readActiveCaretakerTerms } from "./caretaker-terms-registry.js"
import { TestD1 } from "./manifestation-authority-test-support.js"

const AFTER = "2026-09-26T00:00:00.000Z"

function recordingWrites(db) {
  const writes = []
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    if (/^\s*INSERT/i.test(sql)) writes.push(sql)
    return prepare(sql)
  }
  return writes
}

test("the claim offer names the registry version and its exact hash", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  const terms = await readActiveCaretakerTerms(db, AFTER)
  assert.equal(terms.terms_version_id, CURRENT_CARETAKER_TERMS.terms_version_id)
  assert.equal(terms.terms_sha256, CURRENT_CARETAKER_TERMS.terms_sha256)
  assert.equal(terms.document_url, CURRENT_CARETAKER_TERMS.document_url)
})

test("once seeded, reading the offer writes nothing", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  await readActiveCaretakerTerms(db, AFTER)
  const writes = recordingWrites(db)
  for (let i = 0; i < 3; i += 1) await readActiveCaretakerTerms(db, AFTER)
  assert.deepEqual(writes, [])
})

test("a registry version is not offered before its effective date", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  const before = new Date(Date.parse(CURRENT_CARETAKER_TERMS.effective_at) - 1000).toISOString()
  const terms = await readActiveCaretakerTerms(db, before)
  assert.notEqual(terms?.terms_version_id, CURRENT_CARETAKER_TERMS.terms_version_id)
})

test("the same id with different text in D1 fails closed", async (t) => {
  const db = new TestD1()
  t.after(() => db.close())
  db.raw
    .prepare(
      `INSERT INTO icono_caretaker_terms_versions (
         terms_version_id, terms_sha256, document_url, display_label,
         effective_at, created_by_actor_kind, created_by_account_id
       ) VALUES (?, ?, ?, ?, ?, 'migration', NULL)`,
    )
    .run(
      CURRENT_CARETAKER_TERMS.terms_version_id,
      "f".repeat(64),
      CURRENT_CARETAKER_TERMS.document_url,
      CURRENT_CARETAKER_TERMS.display_label,
      CURRENT_CARETAKER_TERMS.effective_at,
    )
  await assert.rejects(
    readActiveCaretakerTerms(db, AFTER),
    /TERMS_VERSION_CONFLICT|already differs/,
  )
})
