import assert from "node:assert/strict"
import test from "node:test"

import {
  handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi,
  repairCanonInvariants,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"

// B-1188: the workstation's canon audit and the nightly canon repair read the
// card, the pin and the vote winner from the tables readers' pages read, not
// from icono_admin_gene_rollup. Failure modes, written first:
// 1. the audit answers for genes nobody asked about, or misses a broken card
//    (the rollup's audit could not see one: it compared the card with itself);
// 2. the repair leaves a reader looking at a broken card, or at no card while a
//    candidate could be one;
// 3. the repair overrides the owner's pin;
// 4. the repair scans the catalogue when the counts say nothing is wrong.

const TOKEN = "admin-token-0000000000000000000000000003"
const sha = (letter) => letter.repeat(64)
const gene = (symbol) =>
  `INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('${symbol}', '${symbol}')`
const portrait = (symbol, asset) =>
  `INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb)
   VALUES ('${symbol}', '${asset}', '', '')`
const card = (symbol, asset, pinned = 0) =>
  `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, admin_override)
   VALUES ('${symbol}', '${asset}', ${pinned})`

async function site() {
  const db = iconoplasmDatabase()
  for (const sql of [
    gene("BROKEN"),
    gene("BARE"),
    gene("PINNED"),
    gene("FINE"),
    gene("EMPTY"),
    portrait("BROKEN", sha("b")),
    portrait("BARE", sha("c")),
    portrait("PINNED", sha("d")),
    portrait("FINE", sha("f")),
    card("BROKEN", sha("0")),
    card("PINNED", sha("1"), 1),
    card("FINE", sha("f")),
  ])
    await db.prepare(sql).run()
  const cards = async () =>
    Object.fromEntries(
      (
        await db.prepare("SELECT gene_symbol, current_asset_sha256 FROM icono_publish_state").all()
      ).results.map((row) => [row.gene_symbol, row.current_asset_sha256]),
    )
  return { db, cards }
}

async function audit(db, symbols) {
  const query = symbols === undefined ? "" : `&symbols=${symbols.join(",")}`
  const response = await handleApi(
    new Request(`https://iconoplasm.brinedew.bio/api/iconoplasm/admin/canon-audit?x=1${query}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }),
    { ICONOPLASM_DB: db, ICONOPLASM_ADMIN_TOKEN: TOKEN },
    {},
  )
  return { status: response.status, body: await response.json() }
}

test("the canon audit answers for the genes it is asked about, from the true tables", async () => {
  const { db } = await site()
  const { status, body } = await audit(db, ["BROKEN", "FINE", "NOSUCH"])
  assert.equal(status, 200)
  const bySymbol = Object.fromEntries(body.rows.map((row) => [row.symbol, row]))
  assert.deepEqual(Object.keys(bySymbol).sort(), ["BROKEN", "FINE", "NOSUCH"])
  assert.equal(bySymbol.BROKEN.current_asset_sha256, sha("0"))
  assert.equal(bySymbol.BROKEN.current_asset_missing, true, "a card that names no stored portrait")
  assert.equal(bySymbol.BROKEN.leader.asset_sha256, sha("b"))
  assert.equal(bySymbol.FINE.current.asset_sha256, sha("f"))
  assert.equal(bySymbol.FINE.leader.asset_sha256, sha("f"))
  assert.equal(bySymbol.FINE.drift, false)
  assert.equal(
    bySymbol.FINE.current.medium_url,
    `https://iconoplasm.brinedew.bio/portraits/v1/ff/${sha("f")}/medium.webp`,
  )
  assert.equal(bySymbol.NOSUCH.current_asset_sha256, null)

  assert.deepEqual((await audit(db)).body.rows, [], "nobody asked about any gene")
  const many = Array.from({ length: 201 }, (_, i) => `G${i}`)
  assert.equal((await audit(db, many)).status, 400)
})

test("the nightly repair re-elects broken and missing cards, and leaves a pin alone", async () => {
  const { db, cards } = await site()
  const first = await repairCanonInvariants({ ICONOPLASM_DB: db }, { actorId: "cron" })
  assert.deepEqual(first.symbols, ["BROKEN", "BARE"])
  assert.deepEqual(first.changed_symbols, ["BROKEN", "BARE"])
  assert.deepEqual(await cards(), {
    BROKEN: sha("b"),
    BARE: sha("c"),
    PINNED: sha("1"),
    FINE: sha("f"),
  })

  // Only the pinned card is still broken, and EMPTY has nothing to show.
  const second = await repairCanonInvariants({ ICONOPLASM_DB: db }, { actorId: "cron" })
  assert.deepEqual(second.symbols, [])

  // 4. Every gene has a card and none is broken: two count rows, no scan.
  await db.prepare("DELETE FROM icono_publish_state WHERE gene_symbol = 'PINNED'").run()
  await db.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol IN ('PINNED', 'EMPTY')").run()
  const statements = []
  const watched = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql) => {
          statements.push(sql)
          return target.prepare(sql)
        }
      const value = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const quiet = await repairCanonInvariants({ ICONOPLASM_DB: watched }, { actorId: "cron" })
  assert.deepEqual(quiet.symbols, [])
  assert.equal(statements.length, 2, statements.join("\n---\n"))
})
