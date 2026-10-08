import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import {
  readAssignmentManifestation,
  readGeneAliases,
} from "./manifestation-authority-repository.js"
import { createManifestationBodyObjectKey } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { discardUnreferencedBodies } from "./manifestation-uploaded-bodies.js"
import { TestD1 } from "./manifestation-authority-test-support.js"

test("alias envelopes preserve full ordered history and stop after 257 indexed rows on overflow", async () => {
  const raw = new DatabaseSync(":memory:")
  try {
    raw.exec(`CREATE TABLE icono_gene_aliases (
      alias_symbol TEXT PRIMARY KEY COLLATE NOCASE, gene_id TEXT,
      alias_kind TEXT, valid_from TEXT, retired_at TEXT);
      CREATE INDEX idx_icono_gene_aliases_gene
        ON icono_gene_aliases(gene_id, retired_at, alias_kind)`)
    const insert = raw.prepare("INSERT INTO icono_gene_aliases VALUES (?, ?, ?, ?, ?)")
    for (let index = 0; index < 4000; index++) {
      insert.run(`alias_${index}`, "large", "previous", "2026-01-01", null)
      insert.run(`other_${index}`, "unrelated", "synonym", "2026-01-01", null)
    }
    for (let index = 0; index < 256; index++)
      insert.run(`bounded_${index}`, "bounded", "previous", "2026-01-01", null)
    let visited = 0
    raw.function("count_visit", (value) => {
      visited++
      return value
    })
    const db = {
      prepare(sql) {
        // Count evaluation inside the indexed subquery, before its LIMIT and
        // the outer sort. This catches moving LIMIT back after the full sort.
        const measured = sql.replace(
          /SELECT alias_symbol/g,
          "SELECT count_visit(alias_symbol) AS alias_symbol",
        )
        return {
          bind(geneId) {
            return { all: async () => ({ results: raw.prepare(measured).all(geneId) }) }
          },
        }
      },
    }
    const result = await readGeneAliases(db, "bounded")
    assert.equal(result.length, 256)
    assert.deepEqual(
      result.map((item) => item.alias_symbol),
      Array.from({ length: 256 }, (_, index) => `bounded_${index}`).sort(),
    )
    assert.equal(visited, 512)
    visited = 0
    await assert.rejects(readGeneAliases(db, "large"), {
      code: "COST_GENE_ALIAS_ENVELOPE_EXCEEDED",
    })
    assert.equal(visited, 514)
    assert.equal(raw.prepare("SELECT count(*) AS n FROM icono_gene_aliases").get().n, 8256)
  } finally {
    raw.close()
  }
})

test("the cleanup after a failed save looks each body up by its unique key", async (t) => {
  // B-859: one indexed probe per uploaded body, never a scan of the ~19,000
  // stored bodies, on the real schema.
  const db = new TestD1()
  t.after(() => db.close())
  const plans = []
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    plans.push(
      ...db.raw
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all("key")
        .map(({ detail }) => detail),
    )
    return prepare(sql)
  }
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async (_url, init = {}) =>
    new Response(null, { status: String(init.method).toUpperCase() === "DELETE" ? 200 : 404 })
  const outcomes = await discardUnreferencedBodies(
    db,
    { ICONOPLASM_AUTHORING_STORAGE_ZONE: "zone", ICONOPLASM_AUTHORING_STORAGE_PASSWORD: "pw" },
    [
      { kind: "revision", objectKey: await createManifestationBodyObjectKey() },
      { kind: "derivative", objectKey: await createManifestationBodyObjectKey() },
    ],
  )
  assert.deepEqual(outcomes, ["deleted", "deleted"])
  assert.equal(plans.length, 2)
  assert.ok(
    plans.every((detail) =>
      /^SEARCH \w+ USING COVERING INDEX sqlite_autoindex_\w+ \(object_key=\?\)$/.test(detail),
    ),
    plans.join("; "),
  )
})

test("assignment manifestation lookup keeps latest history while avoiding the system-wide scan", async () => {
  const raw = new DatabaseSync(":memory:")
  try {
    raw.exec(`CREATE TABLE icono_manifestations (
      manifestation_id TEXT PRIMARY KEY, gene_id TEXT, author_account_id TEXT,
      caretaker_assignment_id TEXT, origin TEXT, status TEXT,
      manifestation_head_revision_id TEXT, source_manifestation_id TEXT,
      row_version INTEGER, non_withdrawable INTEGER, public_page_visible INTEGER,
      withdrawn_at TEXT, purge_eligible_at TEXT, created_at TEXT);
      WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10000)
      INSERT INTO icono_manifestations (manifestation_id, origin, created_at)
      SELECT 'system_'||n, 'system', '2026-09-01' FROM ids;
      INSERT INTO icono_manifestations
        (manifestation_id, caretaker_assignment_id, origin, status, created_at)
      VALUES
        ('old', 'assignment', 'caretaker', 'active', '2026-09-10'),
        ('new', 'assignment', 'fork', 'withdrawn', '2026-09-11'),
        ('other_origin', 'assignment', 'system', 'active', '2026-09-12')`)
    raw.exec(
      readFileSync(
        new URL(
          "../../../migrations-iconoplasm-authoring/0018_assignment_manifestation_lookup.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    let queryPlan
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            queryPlan = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)
            return { first: async () => raw.prepare(sql).get(...args) || null }
          },
        }
      },
    }
    assert.equal((await readAssignmentManifestation(db, "assignment")).manifestation_id, "new")
    assert.ok(
      queryPlan.some((step) =>
        /SEARCH icono_manifestations USING INDEX idx_icono_manifestations_assignment_latest/.test(
          step.detail,
        ),
      ),
    )
    assert.ok(
      queryPlan.every((step) => !/SCAN icono_manifestations|USE TEMP B-TREE/.test(step.detail)),
    )
    assert.equal(await readAssignmentManifestation(db, "missing"), null)
    assert.ok(
      queryPlan.every((step) => !/SCAN icono_manifestations|USE TEMP B-TREE/.test(step.detail)),
    )
  } finally {
    raw.close()
  }
})
