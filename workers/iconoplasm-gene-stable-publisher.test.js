import assert from "node:assert/strict"
import test from "node:test"

import { publishIconoplasmGeneStableObject } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

// ARCHITECTURE FENCE [IPD-010]: routine publication is per gene and bounded.
// B-898: the per-gene publisher. Failure modes written after a live republish
// of ADO on 2026-10-01 17:37Z published a portrait-less object and nulled its
// D1 winner, because "no selection given" was treated as "withdraw":
// 1. no selection (votes, uploads, the republish route) -> materialize from D1
//    as it stands, with no portrait override;
// 2. an explicit winner (the administrator's /admin/publish pin, already in
//    D1) -> that override and the pool's current mark;
// 3. a gene with no card -> reported withdrawn, nothing written;
// 4. (B-1055) a gene the catalogue no longer carries -> its page is deleted,
//    proven by a D1 read; a listed gene with no card keeps its page.
// The vote-version recheck after the write is proven against a real D1 schema
// in iconoplasm.d1-votes.test.js (failure mode 11).
function harness({ cards = null } = {}) {
  const calls = { materialize: [], written: [] }
  const source = {
    async materialize(symbols, { portraitOverrides } = {}) {
      calls.materialize.push(portraitOverrides)
      return cards === null
        ? symbols.map((symbol) => ({
            symbol,
            payload: {
              symbol,
              portrait_candidates: [
                { asset_sha256: "a".repeat(64) },
                { asset_sha256: "b".repeat(64) },
              ],
            },
          }))
        : cards
    },
    complete: () => true,
    stable: (card) => card,
    project: (payload) => payload,
  }
  const objects = {
    async writeStable(key, value) {
      calls.written.push({ key, value })
      return { key, hash: "e".repeat(64), size: 1 }
    },
  }
  return {
    calls,
    run: (opts) => publishIconoplasmGeneStableObject({}, "tp53", { ...opts, source, objects }),
  }
}

test("no selection: publish from D1 as it stands, with no override", async () => {
  const h = harness()
  const result = await h.run({})
  assert.deepEqual(h.calls.materialize, [null])
  assert.equal(h.calls.written[0].key, "genes/v3/TP53.json")
  assert.equal(result.selected_asset_sha256, null)
  assert.equal(result.vote_version, null, "a publisher without D1 stamps no vote version")
})

test("an explicit winner is the override and the pool's only current candidate", async () => {
  const h = harness()
  const result = await h.run({ portraitAssetSha256: "A".repeat(64) })
  assert.deepEqual(h.calls.materialize, [{ TP53: "a".repeat(64) }])
  assert.equal(result.selected_asset_sha256, "a".repeat(64))
  assert.deepEqual(
    h.calls.written[0].value.portrait_candidates.map((candidate) => candidate.is_current),
    [true, false],
  )
})

test("a gene with no card is reported withdrawn and nothing is written", async () => {
  const h = harness({ cards: [] })
  const result = await h.run({})
  assert.equal(result.withdrawn, true)
  assert.deepEqual(h.calls.written, [])
})

test("a gene the catalogue no longer carries loses its page; a listed gene with no card keeps it", async () => {
  // 2026-10-08: 618 genes left the catalogue and every one kept its page,
  // "New candidate" button included (ADGRE4P, a pseudogene, among them).
  const db = iconoplasmDatabase()
  db.database
    .prepare(
      "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53', 'tumor protein p53')",
    )
    .run()
  for (const symbol of ["TP53", "ADGRE4P"])
    db.database
      .prepare("INSERT OR IGNORE INTO icono_published_gene_routes (gene_symbol) VALUES (?)")
      .run(symbol)
  const deleted = []
  const objects = {
    async writeStable() {
      assert.fail("a withdrawn gene writes no object")
    },
    async deleteStable(key) {
      deleted.push(key)
      return { key, deleted: true }
    },
  }
  const source = {
    async materialize() {
      return []
    },
    complete: () => true,
  }
  const env = { ICONOPLASM_DB: db }
  const routes = () =>
    db.database
      .prepare("SELECT gene_symbol FROM icono_published_gene_routes ORDER BY gene_symbol")
      .all()
      .map((row) => row.gene_symbol)

  const removed = await publishIconoplasmGeneStableObject(env, "adgre4p", { source, objects })
  assert.deepEqual(removed, {
    symbol: "ADGRE4P",
    withdrawn: true,
    stable: null,
    page_deleted: true,
  })
  assert.deepEqual(deleted, ["genes/v3/ADGRE4P.json"])
  assert.deepEqual(routes(), ["TP53"])

  const listed = await publishIconoplasmGeneStableObject(env, "TP53", { source, objects })
  assert.equal(listed.page_deleted, false)
  assert.deepEqual(deleted, ["genes/v3/ADGRE4P.json"])
  assert.deepEqual(routes(), ["TP53"])
})
