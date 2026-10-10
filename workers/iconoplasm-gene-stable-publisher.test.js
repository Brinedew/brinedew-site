import assert from "node:assert/strict"
import test from "node:test"

import { publishIconoplasmGeneStableObject } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

// ARCHITECTURE FENCE [IPD-010]: routine publication is per gene and bounded.
// B-898, B-1063: the per-gene publisher, on the real D1 schema (every
// production migration). Failure modes written before the builder replaced the
// D1 card assembly:
// 1. a gene's first portrait doesn't show until a vote or the nightly repair
//    elects it (ERVK11-1 on 2026-10-09: "no portrait" next to its candidate),
//    or the elected winner isn't projected into icono_publish_state, which the
//    gallery feeds and the catalogue builder still read;
// 2. an administrator's pin loses to the election, or the election overwrites
//    the pinned state;
// 3. a gene with no canonical text gets no card (599 genes on 2026-10-09);
// 4. (B-1055) a gene the catalogue no longer carries keeps its page, or a
//    listed gene loses it;
// 5. reading a gene's inputs costs more than one D1 call;
// 6. an election changes the winner, but the clans page and the admin pages,
//    which read it from the gene rollup, keep the old one (or none).
// The vote-version recheck after the write is proven in iconoplasm.d1-votes.test.js
// (failure mode 11).
const A = "a".repeat(64)
const B = "b".repeat(64)
const noText = async () => null

function geneDatabase() {
  const db = iconoplasmDatabase()
  db.database
    .prepare(
      `INSERT INTO icono_gene_catalog (gene_symbol, full_name, color_hex, tmh)
       VALUES ('TP53', 'tumor protein p53', '#aa3322', 0)`,
    )
    .run()
  return db
}

function addPortrait(db, symbol, asset, createdAt) {
  db.database
    .prepare(
      `INSERT INTO icono_portrait_assets
         (gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, width, height,
          status, created_at, is_stale, autopick_eligible, vision_id)
       VALUES (?, ?, 'f', 'm', 't', 768, 1024, 'draft', ?, 0, 1, 'anima-v1-23013')`,
    )
    .run(symbol, asset, createdAt)
}

function recordingStore() {
  const written = []
  return {
    written,
    async writeStable(key, value) {
      written.push({ key, value })
      return { key, hash: "e".repeat(64), size: 1 }
    },
    async deleteStable(key) {
      written.push({ key, deleted: true })
      return { key, deleted: true }
    },
  }
}

const winnerOf = (db) =>
  db.database
    .prepare(
      "SELECT current_asset_sha256 AS asset, admin_override AS pinned FROM icono_publish_state WHERE gene_symbol = 'TP53'",
    )
    .get() ?? null

test("a gene's first portrait is its winner at once, and the election reaches D1", async () => {
  const db = geneDatabase()
  addPortrait(db, "TP53", A, "2026-10-09 15:09:40")
  db.database
    .prepare(
      "INSERT INTO icono_gene_essence (gene_symbol, full_name, weight_kg, leakage_percent) VALUES ('TP53', 'Cellular tumor antigen p53', 43.7, 12.5)",
    )
    .run()
  const objects = recordingStore()
  const result = await publishIconoplasmGeneStableObject({ ICONOPLASM_DB: db }, "tp53", {
    objects,
    readManifestation: noText,
  })
  const card = objects.written.at(-1).value
  assert.equal(objects.written.at(-1).key, "genes/v3/TP53.json")
  assert.equal(card.portrait.status, "published")
  assert.equal(card.portrait.asset_sha256, A)
  // 2026-10-09: marking the winner "approved" cost 17 D1 rows written per
  // election (34,068 rows of that day's write wall) for a label nothing reads.
  assert.equal(card.portrait_candidates[0].status, "draft", "winning changes no status")
  assert.equal(
    db.database.prepare("SELECT status FROM icono_portrait_assets WHERE asset_sha256 = ?").get(A)
      .status,
    "draft",
  )
  assert.equal(card.full_name, "tumor protein p53")
  assert.equal(card.essence.sex, "Female", "tmh 0 reads as soluble")
  // Production Essence rows still hold March 2026 leakage values. The rank is a
  // whole-catalogue number from the workstation's uniqueness file (B-1064), so a
  // card never carries one.
  assert.equal(card.uniqueness_rank, undefined, "a card carries no uniqueness rank")
  assert.equal(card.weight_kg, 43.7)
  assert.equal(result.winner_asset_sha256, A)
  assert.deepEqual({ ...winnerOf(db) }, { asset: A, pinned: 0 })
  const rollup = db.database
    .prepare(
      "SELECT current_asset_sha256 AS asset FROM icono_admin_gene_rollup WHERE gene_symbol = 'TP53'",
    )
    .get()
  assert.equal(rollup?.asset, A, "clans and admin read the winner from the gene rollup")
})

test("a pin beats the election and the election leaves the pinned state alone", async () => {
  const db = geneDatabase()
  addPortrait(db, "TP53", A, "2026-01-01 00:00:00")
  addPortrait(db, "TP53", B, "2026-02-01 00:00:00")
  db.database
    .prepare(
      `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, admin_override)
       VALUES ('TP53', ?, 'brinedew', 1)`,
    )
    .run(A)
  const objects = recordingStore()
  await publishIconoplasmGeneStableObject({ ICONOPLASM_DB: db }, "TP53", {
    objects,
    readManifestation: noText,
  })
  const card = objects.written.at(-1).value
  assert.equal(card.portrait.asset_sha256, A, "the older, pinned portrait shows")
  assert.deepEqual(
    card.portrait_candidates.map((candidate) => [candidate.asset_sha256, candidate.is_current]),
    [
      [A, true],
      [B, false],
    ],
  )
  assert.deepEqual({ ...winnerOf(db) }, { asset: A, pinned: 1 })
})

test("a gene with no canonical text and no portrait still gets its card", async () => {
  const db = geneDatabase()
  const objects = recordingStore()
  const result = await publishIconoplasmGeneStableObject({ ICONOPLASM_DB: db }, "TP53", {
    objects,
    readManifestation: noText,
  })
  const card = objects.written.at(-1).value
  assert.equal(result.withdrawn, false)
  assert.equal(card.portrait.status, "missing")
  assert.equal(card.canonical_manifestation, null)
  assert.equal(winnerOf(db), null, "no winner, nothing projected")
})

test("a gene the catalogue no longer carries loses its page; a listed gene keeps it", async () => {
  // 2026-10-08: 618 genes left the catalogue and every one kept its page,
  // "New candidate" button included (ADGRE4P, a pseudogene, among them).
  const db = geneDatabase()
  for (const symbol of ["TP53", "ADGRE4P"])
    db.database
      .prepare("INSERT OR IGNORE INTO icono_published_gene_routes (gene_symbol) VALUES (?)")
      .run(symbol)
  const objects = recordingStore()
  const env = { ICONOPLASM_DB: db }
  const routes = () =>
    db.database
      .prepare("SELECT gene_symbol FROM icono_published_gene_routes ORDER BY gene_symbol")
      .all()
      .map((row) => row.gene_symbol)

  const removed = await publishIconoplasmGeneStableObject(env, "adgre4p", {
    objects,
    readManifestation: noText,
  })
  assert.deepEqual(removed, {
    symbol: "ADGRE4P",
    withdrawn: true,
    stable: null,
    page_deleted: true,
  })
  assert.deepEqual(objects.written, [{ key: "genes/v3/ADGRE4P.json", deleted: true }])
  assert.deepEqual(routes(), ["TP53"])

  const listed = await publishIconoplasmGeneStableObject(env, "TP53", {
    objects,
    readManifestation: noText,
  })
  assert.equal(listed.withdrawn, false)
  assert.equal(objects.written.at(-1).key, "genes/v3/TP53.json")
  assert.deepEqual(routes(), ["TP53"])
})

test("a gene's inputs are one D1 call", async () => {
  const db = geneDatabase()
  addPortrait(db, "TP53", A, "2026-01-01 00:00:00")
  db.database
    .prepare(
      `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, admin_override)
       VALUES ('TP53', ?, 'seed', 0)`,
    )
    .run(A)
  const before = db.calls
  await publishIconoplasmGeneStableObject({ ICONOPLASM_DB: db }, "TP53", {
    objects: recordingStore(),
    readManifestation: noText,
  })
  // The inputs batch, the vote-version recheck, the route membership.
  assert.equal(db.calls - before, 3)
})
