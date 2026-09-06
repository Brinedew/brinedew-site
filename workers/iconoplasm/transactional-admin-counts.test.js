import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { transactionalAdminCountMigration } from "../../scripts/generate-transactional-admin-counts.mjs"

const migration = readFileSync(
  new URL("../../migrations-iconoplasm/0095_transactional_admin_counts.sql", import.meta.url),
  "utf8",
)

function database() {
  const db = new DatabaseSync(":memory:")
  for (const name of [
    "0001_publish_tables.sql",
    "0004_portrait_asset_legacy_flags.sql",
    "0007_add_gene_catalog.sql",
    "0013_admin_read_models.sql",
    "0032_admin_gallery_budget_read_model.sql",
  ]) {
    db.exec(readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8"))
  }
  return db
}

function assertExact(db) {
  const catalogue = db.prepare("SELECT gene_symbol FROM icono_gene_catalog").all()
  const rollups = db.prepare("SELECT * FROM icono_admin_gene_rollup").all()
  const bySymbol = new Map(rollups.map((row) => [row.gene_symbol, row]))
  const assets = db
    .prepare("SELECT * FROM icono_portrait_assets")
    .all()
    .filter((row) => row.asset_sha256 !== "")
  const rows = catalogue.map((row) => bySymbol.get(row.gene_symbol) || {})
  const count = (predicate) => rows.filter(predicate).length
  const sum = (field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)
  const hasLive = (row) => Boolean(row.current_asset_sha256)
  const expected = {
    genes: rows.length,
    with_live: count(hasLive),
    overrides: count((row) => row.admin_override === 1 && hasLive(row)),
    drift: count((row) => row.current_asset_missing === 1),
    current_asset_missing: count((row) => row.current_asset_missing === 1),
    missing: count((row) => !row.candidate_count),
    no_live: count((row) => !hasLive(row)),
    stale_assets: sum("stale_count"),
    legacy_assets: sum("legacy_count"),
    zero_candidates: count((row) => !row.candidate_count),
    one_candidate: count((row) => row.candidate_count === 1),
    two_to_five_candidates: count((row) => row.candidate_count >= 2 && row.candidate_count <= 5),
    six_plus_candidates: count((row) => row.candidate_count >= 6),
  }
  const stored = db
    .prepare("SELECT * FROM icono_admin_dashboard_summary WHERE summary_key='default'")
    .get()
  for (const [key, value] of Object.entries(expected)) assert.equal(stored[key], value, key)
  const filters = {
    "live:all": rollups.length,
    "live:mismatch": rollups.filter((row) => row.current_asset_missing === 1).length,
    "live:pinned": rollups.filter((row) => row.admin_override === 1).length,
    "live:missing": rollups.filter((row) => !row.candidate_count).length,
    "live:stale": rollups.filter((row) => row.stale_count > 0).length,
    "all:all": assets.length,
    "all:mismatch": assets.filter(
      (row) => bySymbol.get(row.gene_symbol)?.current_asset_missing === 1,
    ).length,
    "all:pinned": assets.filter((row) => bySymbol.get(row.gene_symbol)?.admin_override === 1)
      .length,
    "all:missing": 0,
    "all:stale": assets.filter((row) => row.is_stale === 1).length,
  }
  assert.deepEqual(
    Object.fromEntries(
      db
        .prepare("SELECT count_key,total FROM icono_admin_gallery_count_cache")
        .all()
        .map((row) => [row.count_key, row.total]),
    ),
    filters,
  )
}

test("admin counters preserve every filter through catalogue, rollup and asset changes", () => {
  assert.equal(migration.replace(/\r\n/g, "\n"), transactionalAdminCountMigration())
  const db = database()
  try {
    db.exec(
      "INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES('ONE','One'),('TWO','Two'),('MISSING','Missing')",
    )
    db.exec(
      "INSERT INTO icono_admin_gene_rollup(gene_symbol,candidate_count,current_asset_sha256,stale_count) VALUES('ONE',2,'a',1),('ORPHAN',1,'b',0)",
    )
    db.exec(
      "INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_hero,r2_key_thumb,is_stale) VALUES('ONE','a','','',1),('ONE','b','','',0),('ORPHAN','c','','',0),('NO_ROLLUP','d','','',1),('ONE','','','',1)",
    )
    db.exec(migration)
    assertExact(db)
    for (const mutation of [
      "UPDATE icono_admin_gene_rollup SET admin_override=1,current_asset_missing=1,legacy_count=3 WHERE gene_symbol='ONE'",
      "INSERT INTO icono_admin_gene_rollup(gene_symbol,candidate_count) VALUES('TWO',7)",
      "UPDATE icono_portrait_assets SET gene_symbol='TWO',is_stale=0 WHERE asset_sha256='a'",
      "UPDATE icono_portrait_assets SET asset_sha256='now-valid' WHERE asset_sha256=''",
      "DELETE FROM icono_portrait_assets WHERE gene_symbol='NO_ROLLUP'",
      "INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES('ORPHAN','Orphan')",
      "UPDATE icono_admin_gene_rollup SET gene_symbol='RENAMED' WHERE gene_symbol='ONE'",
      "UPDATE icono_gene_catalog SET gene_symbol='RENAMED' WHERE gene_symbol='ONE'",
      "DELETE FROM icono_gene_catalog WHERE gene_symbol='MISSING'",
      "DELETE FROM icono_admin_gene_rollup WHERE gene_symbol='TWO'",
    ]) {
      db.exec(mutation)
      assertExact(db)
    }
    db.exec("BEGIN; DELETE FROM icono_portrait_assets; DELETE FROM icono_admin_gene_rollup;")
    assertExact(db)
    db.exec("ROLLBACK")
    assertExact(db)
    const before = db.prepare("SELECT total_changes() AS n").get().n
    db.exec("UPDATE icono_admin_gene_rollup SET candidate_count=candidate_count")
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n - before, 2)
  } finally {
    db.close()
  }
})

test("empty admin models retain exact zero totals", () => {
  const db = database()
  try {
    db.exec(migration)
    assertExact(db)
  } finally {
    db.close()
  }
})
