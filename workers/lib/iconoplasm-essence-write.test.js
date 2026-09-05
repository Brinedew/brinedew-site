import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { prepareGeneEssenceUpsertStatement } from "./iconoplasm-essence-write.js"

test("metadata publication succeeds after source cutover without reopening the retired writer", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`CREATE TABLE icono_gene_essence (
      gene_symbol TEXT PRIMARY KEY, full_name TEXT, weight_kg REAL, molecular_weight_kda REAL,
      height_cm REAL, sex TEXT, age TEXT, age_years REAL, first_publication_year INTEGER,
      faction TEXT, skin_hex TEXT, skin_name TEXT, tissue_tau REAL, primary_tissue TEXT,
      loeuf REAL, constraint_percentile REAL, leakage_percent REAL, leakage_hits INTEGER,
      leakage_total INTEGER, aesthetics_json TEXT, aesthetics_origin_json TEXT,
      politics_origin_json TEXT, family_surname TEXT, family_members INTEGER, family_feature TEXT,
      manifestation TEXT, manifestation_tags TEXT, manifestation_fields_json TEXT,
      sample_label TEXT, sample_number INTEGER, sample_text_hash TEXT,
      source TEXT, updated_by TEXT, updated_at TEXT
    )`)
    db.exec(
      readFileSync(
        new URL(
          "../../migrations-iconoplasm/0084_manifestation_authority_cutover.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    db.exec(
      "INSERT INTO icono_gene_essence (gene_symbol, manifestation) VALUES ('INS', 'frozen source')",
    )
    db.exec(
      "UPDATE icono_manifestation_projection_authority SET mode='authoritative', authority_epoch=2 WHERE singleton=1",
    )
    const env = {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind(...values) {
              return { run: () => db.prepare(sql).run(...values) }
            },
          }
        },
      },
    }
    for (const symbol of ["INS", "TP53"]) {
      prepareGeneEssenceUpsertStatement(
        env,
        {
          gene_symbol: symbol,
          full_name: "Updated name",
          weight_kg: 3,
          manifestation: "stale workstation prose",
          manifestation_tags: "stale tags",
          manifestation_fields_json: "{}",
        },
        "operator",
      ).run()
    }
    const existing = db.prepare("SELECT * FROM icono_gene_essence WHERE gene_symbol='INS'").get()
    assert.equal(existing.full_name, "Updated name")
    assert.equal(existing.weight_kg, 3)
    assert.equal(existing.manifestation, "frozen source")
    assert.equal(existing.manifestation_tags, null)
    assert.equal(
      db.prepare("SELECT manifestation FROM icono_gene_essence WHERE gene_symbol='TP53'").get()
        .manifestation,
      null,
    )
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE icono_gene_essence SET manifestation='replacement' WHERE gene_symbol='INS'",
          )
          .run(),
      /legacy_manifestation_writer_is_retired/,
    )
  } finally {
    db.close()
  }
})
