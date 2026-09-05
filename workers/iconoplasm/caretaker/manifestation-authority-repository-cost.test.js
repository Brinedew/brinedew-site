import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readGeneAliases } from "./manifestation-authority-repository.js"
import { requireAdoptedManifestationUpload } from "./manifestation-upload-intents.js"

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

test("upload verification probes only the current object and rejects historical adoption", async () => {
  const raw = new DatabaseSync(":memory:")
  try {
    raw.exec(`CREATE TABLE icono_manifestation_revision_storage_secrets (
      manifestation_revision_id TEXT PRIMARY KEY, object_key TEXT);
      CREATE TABLE icono_manifestation_upload_intents (
      upload_intent_id TEXT PRIMARY KEY, object_key TEXT UNIQUE,
      entity_kind TEXT, entity_id TEXT, status TEXT, resolved_at TEXT);
      WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_manifestation_upload_intents
      SELECT 'intent_'||n, 'object_'||n, 'revision', 'revision_cost_test', 'adopted', '2026-09-05'
      FROM ids;
      INSERT INTO icono_manifestation_revision_storage_secrets
      VALUES ('revision_cost_test','object_1')`)
    let queryPlan
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            queryPlan = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)
            return { first: async () => raw.prepare(sql).get(...args) }
          },
        }
      },
    }
    assert.equal(
      (await requireAdoptedManifestationUpload(db, "revision", "revision_cost_test"))
        .upload_intent_id,
      "intent_1",
    )
    assert.equal(queryPlan.length, 2)
    assert.ok(queryPlan.every((step) => /SEARCH .* USING INDEX .*\(.*=\?\)/.test(step.detail)))
    raw.exec("UPDATE icono_manifestation_revision_storage_secrets SET object_key='missing_current'")
    await assert.rejects(requireAdoptedManifestationUpload(db, "revision", "revision_cost_test"), {
      code: "UPLOAD_NOT_ADOPTED",
    })
  } finally {
    raw.close()
  }
})
