import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { TestD1 } from "./caretaker/manifestation-authority-test-support.js"
import { createIconoplasmApp } from "./app.js"
import { writeFactoryGeneText } from "./gene-text-write.js"

// B-1065 B2b: caretaking leaves the authoring database for the main one, through
// the real Hono route, the real authoring schema and every main migration.
// Failure modes written before the code:
// 1. a text, version or role arrives changed, or under another gene's symbol;
// 2. a rerun rewrites rows it already copied (the copy runs against the free
//    plan's 100,000-row daily write wall);
// 3. the second pass, after the switch, overwrites what the main database
//    changed since, or misses what the authoring side changed before the switch;
// 4. a gene whose role ended and was claimed again between the passes fails
//    on "one open role per gene";
// 5. a caretaker's unread comment count resets;
// 6. a page grows past what one D1 value holds, or the walk skips rows;
// 7. a caller without the factory's token runs it.
const TOKEN = "factory-token-0000000000000000000000001"
const MAIN_MIGRATIONS = new URL("../../migrations-iconoplasm/", import.meta.url)

class MainD1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:")
    for (const name of readdirSync(MAIN_MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .sort())
      this.raw.exec(readFileSync(new URL(name, MAIN_MIGRATIONS), "utf8"))
  }
  prepare(sql) {
    const raw = this.raw
    let args = []
    return {
      bind(...values) {
        args = values
        return this
      },
      async run() {
        const result = raw.prepare(sql).run(...args)
        return { meta: { changes: Number(result.changes) } }
      },
    }
  }
  close() {
    this.raw.close()
  }
}

function role(db, { id, geneId, accountId, status, updatedAt = "2026-10-10T10:00:00.000Z" }) {
  const ended = status === "ended"
  db.raw
    .prepare(
      `INSERT INTO icono_caretaker_assignments
         (caretaker_assignment_id, gene_id, account_id, status, terms_accepted_at,
          entitlement_policy_version, relinquish_policy, invited_by_account_id, started_at,
          ended_at, end_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', 'v1', 'retain', ?,
               '2026-10-01T00:00:00.000Z', ?, ?, '2026-10-01T00:00:00.000Z', ?)`,
    )
    .run(
      id,
      geneId,
      accountId,
      status,
      accountId,
      ended ? updatedAt : null,
      ended ? "caretaker_resigned" : null,
      updatedAt,
    )
}

function version(db, { id, geneId, lineId, number, tags = "t", withdrawnAt = null }) {
  db.raw
    .prepare(
      `INSERT INTO icono_caretaker_text_versions
         (version_id, gene_id, line_id, version, account_id, caretaker_assignment_id,
          text, text_sha256, tags, fields_json, readers_see, withdrawn_at, created_at)
       VALUES (?, ?, ?, ?, 'account_a', 'role_a', ?, ?, ?, NULL, 1, ?, '2026-10-02 00:00:00')`,
    )
    .run(id, geneId, lineId, number, `Text ${id}`, "e".repeat(64), tags, withdrawnAt)
}

async function harness(t) {
  const authoring = new TestD1()
  const main = new MainD1()
  t.after(() => {
    authoring.close()
    main.close()
  })
  const env = {
    ICONOPLASM_AUTHORING_DB: authoring,
    ICONOPLASM_DB: main,
    ICONOPLASM_ADMIN_TOKEN: TOKEN,
  }
  const app = createIconoplasmApp({
    legacy: async () => new Response("legacy", { status: 299 }),
    publishGene: async () => ({}),
    refreshSummaries: async () => {},
    accountUsage: async () => ({ rows_read: 0, rows_written: 0 }),
    windowUsage: async () => null,
  })
  const copy = async (table, after, { token = TOKEN } = {}) => {
    const response = await app.request(
      "/api/iconoplasm/admin/caretaking/copy",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ table, after }),
      },
      env,
    )
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  // The operator's loop: every page of every table.
  const copyAll = async () => {
    const totals = { pages: 0, written: 0 }
    for (const table of ["texts", "versions", "assignments"]) {
      let after = null
      do {
        const page = await copy(table, after)
        assert.equal(page.status, 200, JSON.stringify(page.body))
        totals.pages += 1
        totals.written += page.body.written
        after = page.body.next_after
      } while (after)
    }
    return totals
  }
  for (const account of ["account_a", "account_b"])
    authoring.raw
      .prepare(
        `INSERT INTO icono_authority_accounts (account_id, public_credit_label) VALUES (?, ?)`,
      )
      .run(account, `Caretaker ${account}`)
  const geneId = (symbol) =>
    authoring.raw
      .prepare(`SELECT gene_id FROM icono_gene_identities WHERE canonical_symbol = ?`)
      .get(symbol).gene_id
  return { authoring, main, env, copy, copyAll, geneId }
}

test("1, 2, 5, 6: every text, version and role arrives under its symbol, once", async (t) => {
  const h = await harness(t)
  // 120 genes, some with 40 KiB of Tags, so the walk needs several pages and
  // the byte limit, not the row limit, ends some of them.
  for (let index = 0; index < 120; index += 1) {
    await writeFactoryGeneText(h.env, {
      symbol: `GENE${String(index).padStart(3, "0")}`,
      text: `Text of gene ${index}.`,
      tags: index % 3 === 0 ? `tag ${index}, ${"x".repeat(30_000)}` : `tag ${index}`,
      fields: { index: [String(index)] },
    })
  }
  const mfng = h.geneId("GENE007")
  version(h.authoring, { id: "revision_v1", geneId: mfng, lineId: "line_a", number: 1 })
  version(h.authoring, {
    id: "revision_v2",
    geneId: mfng,
    lineId: "line_a",
    number: 2,
    withdrawnAt: "2026-10-03T00:00:00.000Z",
  })
  h.authoring.raw
    .prepare(
      `UPDATE icono_gene_texts SET chosen_caretaker_version_id = 'revision_v1' WHERE gene_id = ?`,
    )
    .run(mfng)
  role(h.authoring, { id: "role_old", geneId: mfng, accountId: "account_b", status: "ended" })
  role(h.authoring, { id: "role_now", geneId: mfng, accountId: "account_a", status: "active" })
  h.main.raw
    .prepare(
      `INSERT INTO icono_caretaker_assignment_notifications
         (caretaker_assignment_id, account_id, gene_id, canonical_symbol, assignment_status,
          assignment_version, notification_state, authority_event_id, authority_event_sequence,
          resolved_at, comments_read_through_id)
       VALUES ('role_now', 'account_a', ?, 'GENE007', 'active', 1, 'resolved', 'event_1', 1,
               '2026-10-01', 42)`,
    )
    .run(mfng)

  const first = await h.copyAll()
  assert.ok(first.pages > 4, `expected several text pages, got ${first.pages}`)

  const source = h.authoring.raw
    .prepare(
      `SELECT i.canonical_symbol AS gene_symbol, t.text_id, t.version, t.text, t.text_sha256,
              t.tags, t.fields_json, t.readers_see, t.chosen_caretaker_version_id, t.updated_at
         FROM icono_gene_texts t JOIN icono_gene_identities i USING (gene_id)
        ORDER BY gene_symbol`,
    )
    .all()
  const copied = h.main.raw.prepare(`SELECT * FROM icono_gene_texts ORDER BY gene_symbol`).all()
  assert.equal(copied.length, 120)
  assert.deepEqual(copied, source)

  const versions = h.main.raw
    .prepare(
      `SELECT version_id, gene_symbol, line_id, version, withdrawn_at, text
                FROM icono_caretaker_text_versions ORDER BY version_id`,
    )
    .all()
  assert.deepEqual(
    versions.map((row) => ({ ...row })),
    [
      {
        version_id: "revision_v1",
        gene_symbol: "GENE007",
        line_id: "line_a",
        version: 1,
        withdrawn_at: null,
        text: "Text revision_v1",
      },
      {
        version_id: "revision_v2",
        gene_symbol: "GENE007",
        line_id: "line_a",
        version: 2,
        withdrawn_at: "2026-10-03T00:00:00.000Z",
        text: "Text revision_v2",
      },
    ],
  )

  const roles = h.main.raw
    .prepare(
      `SELECT caretaker_assignment_id, gene_symbol, account_id, status,
                     comments_read_through_id
                FROM icono_caretaker_assignments ORDER BY caretaker_assignment_id`,
    )
    .all()
  assert.deepEqual(
    roles.map((row) => ({ ...row })),
    [
      {
        caretaker_assignment_id: "role_now",
        gene_symbol: "GENE007",
        account_id: "account_a",
        status: "active",
        comments_read_through_id: 42,
      },
      {
        caretaker_assignment_id: "role_old",
        gene_symbol: "GENE007",
        account_id: "account_b",
        status: "ended",
        comments_read_through_id: 0,
      },
    ],
  )

  const rerun = await h.copyAll()
  assert.equal(rerun.written, 0, "a rerun writes nothing")
})

test("3, 4: the second pass takes the side that changed last", async (t) => {
  const h = await harness(t)
  for (const symbol of ["ALPHA", "BETA"])
    await writeFactoryGeneText(h.env, { symbol, text: `${symbol} v1.`, tags: "t" })
  const alpha = h.geneId("ALPHA")
  version(h.authoring, { id: "revision_a1", geneId: alpha, lineId: "line_a", number: 1 })
  role(h.authoring, {
    id: "role_1",
    geneId: alpha,
    accountId: "account_a",
    status: "active",
    updatedAt: "2026-10-10T10:00:00.000Z",
  })
  // Stamps the pass can order: the first copy is older than every later write.
  h.authoring.raw.exec(`UPDATE icono_gene_texts SET updated_at = '2026-10-10 10:00:00'`)
  await h.copyAll()

  // Before the switch, on the authoring side: ALPHA's caretaker chose a
  // version, the version was withdrawn, the role ended and another person took
  // the gene.
  // The authoring triggers guard the old command path, which this test does not
  // drive; the rows it leaves are what matters to the copy.
  for (const { name } of h.authoring.raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'icono_caretaker_assignments'`,
    )
    .all())
    h.authoring.raw.exec(`DROP TRIGGER "${name}"`)
  h.authoring.raw
    .prepare(
      `UPDATE icono_gene_texts SET chosen_caretaker_version_id = 'revision_a1',
              updated_at = '2026-10-10 11:00:00' WHERE gene_id = ?`,
    )
    .run(alpha)
  h.authoring.raw.exec(
    `UPDATE icono_caretaker_text_versions SET withdrawn_at = '2026-10-10T11:00:00.000Z'`,
  )
  h.authoring.raw.exec(
    `UPDATE icono_caretaker_assignments SET status = 'ended', ended_at = '2026-10-10T11:00:00.000Z',
            end_reason = 'caretaker_resigned', updated_at = '2026-10-10T11:00:00.000Z'`,
  )
  role(h.authoring, {
    id: "role_0",
    geneId: alpha,
    accountId: "account_b",
    status: "active",
    updatedAt: "2026-10-10T11:00:00.000Z",
  })
  // After the switch, on the main side: the factory rewrote BETA.
  h.main.raw.exec(
    `UPDATE icono_gene_texts SET text = 'BETA v2 in main.', updated_at = '2026-10-10 12:00:00'
      WHERE gene_symbol = 'BETA'`,
  )
  // The authoring copy of BETA is older, so it must not come back.
  await h.copyAll()

  const texts = Object.fromEntries(
    h.main.raw
      .prepare(`SELECT gene_symbol, text, chosen_caretaker_version_id FROM icono_gene_texts`)
      .all()
      .map((row) => [row.gene_symbol, { ...row }]),
  )
  assert.equal(texts.ALPHA.chosen_caretaker_version_id, "revision_a1")
  assert.equal(texts.BETA.text, "BETA v2 in main.")
  assert.equal(
    h.main.raw.prepare(`SELECT withdrawn_at FROM icono_caretaker_text_versions`).get().withdrawn_at,
    "2026-10-10T11:00:00.000Z",
  )
  assert.deepEqual(
    h.main.raw
      .prepare(
        `SELECT caretaker_assignment_id, status FROM icono_caretaker_assignments
                 ORDER BY caretaker_assignment_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { caretaker_assignment_id: "role_0", status: "active" },
      { caretaker_assignment_id: "role_1", status: "ended" },
    ],
  )
})

test("7: only the factory's token runs the copy", async (t) => {
  const h = await harness(t)
  assert.equal((await h.copy("texts", null, { token: null })).status, 401)
  assert.equal((await h.copy("texts", null, { token: "wrong-token" })).status, 401)
  assert.equal((await h.copy("everything", null)).status, 400)
})
