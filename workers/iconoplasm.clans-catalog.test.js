import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { ICONOPLASM_CLAN_CATALOG } from "./generated/iconoplasm-clan-catalog.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

// B-1070: the clan catalogue (113 KiB of the Worker bundle) loads on the first
// clans request instead of in every cold isolate's start-up. Failure mode: the
// lazy load breaks and the overview reports no clans, or a members page can no
// longer find its clan. The real route on the real D1 schema, as a guest.
test("the clans overview reads the catalogue it loads on first use", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/clans"),
      { ICONOPLASM_DB: iconoplasmDatabase() },
    )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.authenticated, false)
  assert.equal(body.total_clans, ICONOPLASM_CLAN_CATALOG.length)
  assert.ok(body.total_clans > 500, "the whole catalogue, not an empty table")
  assert.equal(body.sealed_count, body.total_clans)
})

// B-1188: a clan tile shows the card the gene's page shows. Failure modes:
// the tile shows an old card, or none, because it reads a copy that drifts
// (icono_admin_gene_rollup showed an old card for 160 genes and no portrait for
// 591 live ones on 2026-10-29); the tile names the gene by its UniProt protein
// name instead of its one public (catalogue) name (B-908); a gene the catalogue
// retired still counts in a clan the home shelf no longer shows it in.
test("a reader's clan tiles show each gene's published card and catalogue name", async () => {
  const db = iconoplasmDatabase()
  const clan = ICONOPLASM_CLAN_CATALOG[0].clan
  const card = "c".repeat(64)
  for (const [symbol, name] of [
    ["TP53", "tumor protein p53"],
    ["MDM2", "MDM2 proto-oncogene"],
    ["RETIRED1", "retired gene"],
  ])
    await db
      .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
      .bind(symbol, name)
      .run()
  for (const symbol of ["TP53", "MDM2", "RETIRED1"])
    await db
      .prepare(
        "INSERT INTO icono_gene_essence (gene_symbol, full_name, aesthetics_origin_json) VALUES (?, ?, ?)",
      )
      .bind(symbol, `UniProt ${symbol}`, JSON.stringify([clan]))
      .run()
  await db
    .prepare("INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256) VALUES (?, ?)")
    .bind("TP53", card)
    .run()
  const env = { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  const cookie = await sessionCookieFor({ user_id: "reader", username: "reader" })
  const call = (path, init = {}) =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        ...init,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      }),
      env,
      { waitUntil() {} },
    )
  const merged = await call("/api/iconoplasm/discoveries/merge", {
    method: "POST",
    body: JSON.stringify({ symbols: ["TP53", "MDM2", "RETIRED1"] }),
  })
  assert.equal(merged.status, 200)
  // The reader met RETIRED1 before the catalogue dropped it.
  await db.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol = ?").bind("RETIRED1").run()

  const overview = await (await call("/api/iconoplasm/clans")).json()
  assert.equal(overview.authenticated, true)
  const tile = overview.clans.find((entry) => entry.clan === clan)
  assert.ok(tile, "the reader's clan is revealed")
  assert.equal(tile.discovered_count, 2)
  const bySymbol = Object.fromEntries(tile.members.map((member) => [member.symbol, member]))
  assert.equal(bySymbol.TP53.full_name, "tumor protein p53")
  assert.equal(bySymbol.TP53.has_portrait, true)
  assert.match(bySymbol.TP53.medium_url, new RegExp(card))
  assert.equal(bySymbol.MDM2.has_portrait, false, "no published card, no portrait")
  assert.equal(bySymbol.MDM2.medium_url, null)

  const page = await (
    await call(`/api/iconoplasm/clans/${encodeURIComponent(clan)}/members`)
  ).json()
  assert.equal(page.total_members, 2)
  assert.deepEqual(
    page.members.map((member) => [
      member.symbol,
      member.medium_url && member.medium_url.includes(card),
    ]),
    tile.members.map((member) => [
      member.symbol,
      member.medium_url && member.medium_url.includes(card),
    ]),
  )
})

// The readers' clan strip is one drag through the whole clan, not a page of
// four; all=1 is what makes that possible. Failure modes: the response still
// stops at four, or the strip loses the order or the blot address.
test("all=1 returns every member of one clan, in the strip's order", async () => {
  const db = iconoplasmDatabase()
  const clan = ICONOPLASM_CLAN_CATALOG[0].clan
  const symbols = ["TP53", "MDM2", "CDKN1A", "BAX", "BBC3", "GADD45A"]
  for (const [index, symbol] of symbols.entries()) {
    await db
      .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
      .bind(symbol, `gene ${index}`)
      .run()
    await db
      .prepare(
        "INSERT INTO icono_gene_essence (gene_symbol, full_name, aesthetics_origin_json) VALUES (?, ?, ?)",
      )
      .bind(symbol, `UniProt ${symbol}`, JSON.stringify([clan]))
      .run()
  }
  const env = { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  const cookie = await sessionCookieFor({ user_id: "reader", username: "reader" })
  const call = (path, init = {}) =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        ...init,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      }),
      env,
      { waitUntil() {} },
    )
  const merged = await call("/api/iconoplasm/discoveries/merge", {
    method: "POST",
    body: JSON.stringify({ symbols }),
  })
  assert.equal(merged.status, 200)

  const all = await (
    await call(`/api/iconoplasm/clans/${encodeURIComponent(clan)}/members?all=1`)
  ).json()
  assert.equal(all.members.length, symbols.length)
  assert.equal(all.total_members, symbols.length)
  assert.equal(all.total_pages, 1)
  assert.equal(all.page, 0)
  assert.equal(all.page_size, symbols.length)
  assert.deepEqual(all.members.map((member) => member.symbol).sort(), symbols.slice().sort())
  for (const member of all.members) {
    assert.match(member.blot_url, new RegExp(`/blot/${member.symbol}\\.webp$`))
  }

  const first = await (
    await call(`/api/iconoplasm/clans/${encodeURIComponent(clan)}/members`)
  ).json()
  assert.equal(first.members.length, 4, "page mode still ships one page")
  assert.equal(first.total_pages, Math.ceil(symbols.length / 4))
})
