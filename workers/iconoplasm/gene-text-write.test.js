import assert from "node:assert/strict"
import test from "node:test"

import { TestD1 } from "./caretaker/manifestation-authority-test-support.js"
import { registerGeneIdentity } from "./caretaker/caretaker-assignment-commands.js"
import { createIconoplasmApp } from "./app.js"
import { catalogueGeneId } from "./gene-text-write.js"

// B-1065: the factory saves a gene's text through the real Hono route into the
// real authoring schema (every migration, 0024 included). Failure modes written
// before the code:
// 1. a known gene gets a second identity, or a new one an ID nobody can derive;
// 2. a retry of the same text writes again and bumps the version;
// 3. a new text loses the gene's readers-see flag or a caretaker's choice;
// 4. a text or Tags the old path refused (empty, control characters, over
//    16 KiB, numbers in the fields) lands in the table;
// 5. a caller without the factory's token writes;
// 6. the workstation's read-back skips a gene at a page edge, hands it a
//    withdrawn caretaker version, or scans every text to find the few chosen.
const TOKEN = "factory-token-0000000000000000000000002"

function harness(t) {
  const db = new TestD1()
  t.after(() => db.close())
  const env = { ICONOPLASM_AUTHORING_DB: db, ICONOPLASM_ADMIN_TOKEN: TOKEN }
  const app = createIconoplasmApp({
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async () => ({}),
    refreshSummaries: async () => {},
    accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
    windowUsage: async () => null,
  })
  const save = async (symbol, body, { token = TOKEN } = {}) => {
    const response = await app.request(
      `/api/iconoplasm/admin/genes/${symbol}/text`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    )
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const list = async (query, { token = TOKEN } = {}) => {
    const response = await app.request(
      `/api/iconoplasm/admin/texts?${new URLSearchParams(query)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      env,
    )
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const rows = (sql, ...args) => db.raw.prepare(sql).all(...args)
  return { db, save, list, rows }
}

const FIELDS = { protein_class: "kinase", locations: ["nucleus"], note: "café" }

test("a known gene keeps its identity, and the same text again writes nothing", async (t) => {
  const h = harness(t)
  await registerGeneIdentity(h.db, { geneId: "gene_imported_tp53", canonicalSymbol: "TP53" })

  const refused = await h.save("TP53", { text: "A guardian." }, { token: "wrong" })
  assert.equal(refused.status, 401)
  assert.equal(h.rows("SELECT * FROM icono_gene_texts").length, 0)

  const first = await h.save("tp53", {
    text: "A guardian of the genome.\r\nIt stands watch.",
    tags: "guardian, watchful",
    fields: FIELDS,
  })
  assert.equal(first.status, 200)
  assert.equal(first.body.gene_id, "gene_imported_tp53")
  assert.equal(first.body.symbol, "TP53")
  assert.equal(first.body.version, 1)
  assert.equal(first.body.changed, true)
  const [saved] = h.rows("SELECT * FROM icono_gene_texts")
  assert.equal(saved.text, "A guardian of the genome.\nIt stands watch.")
  assert.equal(saved.tags, "guardian, watchful")
  assert.deepEqual(JSON.parse(saved.fields_json), FIELDS)
  assert.equal(saved.text_id, first.body.text_id)
  assert.equal(h.rows("SELECT * FROM icono_gene_identities").length, 1)

  const retry = await h.save("TP53", {
    text: "A guardian of the genome.\nIt stands watch.",
    tags: "guardian, watchful",
    fields: FIELDS,
  })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.changed, false)
  assert.equal(retry.body.version, 1)
  assert.equal(retry.body.text_id, first.body.text_id)
  assert.equal(h.rows("SELECT updated_at FROM icono_gene_texts")[0].updated_at, saved.updated_at)
})

test("a new text keeps the readers-see flag and a caretaker's choice", async (t) => {
  const h = harness(t)
  const first = await h.save("WEE1", { text: "A gatekeeper at G2." })
  assert.equal(first.status, 200)
  assert.equal(first.body.registered, true)
  assert.equal(first.body.gene_id, await catalogueGeneId("WEE1"))
  assert.deepEqual(
    h.rows("SELECT gene_id, canonical_symbol FROM icono_gene_identities").map((r) => ({ ...r })),
    [{ gene_id: first.body.gene_id, canonical_symbol: "WEE1" }],
  )
  h.db.raw
    .prepare(
      "UPDATE icono_gene_texts SET readers_see = 1, chosen_caretaker_version_id = 'revision_ct' WHERE gene_id = ?",
    )
    .run(first.body.gene_id)

  const second = await h.save("WEE1", { text: "A stricter gatekeeper at G2." })
  assert.equal(second.body.version, 2)
  assert.equal(second.body.changed, true)
  assert.notEqual(second.body.text_id, first.body.text_id)
  assert.equal(second.body.registered, undefined)
  const [saved] = h.rows("SELECT * FROM icono_gene_texts")
  assert.equal(saved.text, "A stricter gatekeeper at G2.")
  assert.equal(saved.readers_see, 1)
  assert.equal(saved.chosen_caretaker_version_id, "revision_ct")
  assert.equal(saved.tags, null)
  assert.equal(saved.fields_json, null)
})

test("texts and Tags the old path refused are refused, and nothing is written", async (t) => {
  const h = harness(t)
  const cases = [
    [{ text: "   " }, "TEXT_INVALID"],
    [{ text: "bell\u0007" }, "TEXT_INVALID"],
    [{ text: "é".repeat(8193) }, "TEXT_INVALID"],
    [{ text: "fine", tags: "" }, "TAGS_INVALID"],
    [{ text: "fine", fields: { length: 3 } }, "FIELDS_INVALID"],
  ]
  for (const [body, code] of cases) {
    const answer = await h.save("MFNG", body)
    assert.equal(answer.status, 400, code)
    assert.equal(answer.body.code, code)
  }
  const shapeless = await h.save("MFNG", { tags: "no text" })
  assert.equal(shapeless.status, 400)
  const badSymbol = await h.save("bad_symbol", { text: "fine" })
  assert.equal(badSymbol.status, 400)
  assert.equal(h.rows("SELECT * FROM icono_gene_texts").length, 0)
  assert.equal(h.rows("SELECT * FROM icono_gene_identities").length, 0)
})

test("the workstation reads every text back in pages, and the caretaker choices alone", async (t) => {
  const h = harness(t)
  assert.equal((await h.list({}, { token: "wrong" })).status, 401)
  const wee1 = await h.save("WEE1", {
    text: "A gatekeeper at G2.",
    tags: "gatekeeper",
    fields: FIELDS,
  })
  const tp53 = await h.save("TP53", { text: "A guardian of the genome." })
  await h.save("MFNG", { text: "A sugar tailor." })
  const insert = h.db.raw.prepare(
    `INSERT INTO icono_caretaker_text_versions
       (version_id, gene_id, line_id, version, account_id, caretaker_assignment_id,
        text, text_sha256, tags, withdrawn_at)
     VALUES (?, ?, ?, 1, 'acct_1', 'assign_1', ?, ?, ?, ?)`,
  )
  insert.run(
    "ver_wee1",
    wee1.body.gene_id,
    "line_wee1",
    "A caretaker's gatekeeper.",
    "a".repeat(64),
    "kept",
    null,
  )
  insert.run(
    "ver_tp53",
    tp53.body.gene_id,
    "line_tp53",
    "Withdrawn.",
    "b".repeat(64),
    null,
    "2026-10-10",
  )
  h.db.raw
    .prepare("UPDATE icono_gene_texts SET chosen_caretaker_version_id = ? WHERE gene_id = ?")
    .run("ver_wee1", wee1.body.gene_id)
  h.db.raw
    .prepare("UPDATE icono_gene_texts SET chosen_caretaker_version_id = ? WHERE gene_id = ?")
    .run("ver_tp53", tp53.body.gene_id)

  const factory = await h.list({})
  assert.equal(factory.status, 200)
  assert.equal(factory.body.next_after, null)
  assert.deepEqual(factory.body.texts.map((r) => r.symbol).sort(), ["MFNG", "TP53", "WEE1"])
  const factoryWee1 = factory.body.texts.find((r) => r.symbol === "WEE1")
  assert.equal(factoryWee1.text, "A gatekeeper at G2.")
  assert.equal(factoryWee1.text_id, wee1.body.text_id)
  assert.deepEqual(factoryWee1.fields, FIELDS)

  const caretaker = await h.list({ chosen: "caretaker" })
  assert.equal(caretaker.status, 200)
  assert.deepEqual(
    caretaker.body.texts.map((r) => [r.symbol, r.version_id, r.text, r.tags]),
    [["WEE1", "ver_wee1", "A caretaker's gatekeeper.", "kept"]],
  )

  const plan = h
    .rows(
      `EXPLAIN QUERY PLAN SELECT gene_id FROM icono_gene_texts
        WHERE chosen_caretaker_version_id IS NOT NULL AND gene_id > ? ORDER BY gene_id LIMIT 201`,
      "",
    )
    .map((r) => r.detail)
    .join(" | ")
  assert.match(plan, /icono_gene_texts_caretaker_chosen/, plan)

  const identity = h.db.raw.prepare(
    "INSERT INTO icono_gene_identities (gene_id, canonical_symbol) VALUES (?, ?)",
  )
  const text = h.db.raw.prepare(
    `INSERT INTO icono_gene_texts (gene_id, text_id, version, text, text_sha256)
     VALUES (?, ?, 1, 'A filler gene.', ?)`,
  )
  for (let i = 0; i < 200; i++) {
    const geneId = `gene_filler_${String(i).padStart(3, "0")}`
    identity.run(geneId, `FILL${i}`)
    text.run(geneId, `text_filler_${i}`, "c".repeat(64))
  }
  const seen = []
  let after = null
  for (let pages = 0; pages < 5; pages++) {
    const page = await h.list(after ? { after } : {})
    assert.equal(page.status, 200)
    assert.ok(page.body.texts.length <= 200)
    seen.push(...page.body.texts.map((r) => r.gene_id))
    after = page.body.next_after
    if (!after) break
  }
  assert.equal(after, null)
  assert.equal(seen.length, 203)
  assert.equal(new Set(seen).size, 203)
})
