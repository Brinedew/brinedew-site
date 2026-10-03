// B-943: a guess's structure loads straight from its provider, so it costs no Worker
// request, and the daily target's structure still goes through the Worker. Real Chrome, the
// real page (quartz/static/geneguessr/app.js), the real Mol* 3.8.0 build, the real Worker on a
// real local D1 seeded with the production shape, and the real Content Security Policy of the
// game document.
//
// The scene: a visitor opens the game and makes three guesses, one whose structure comes from
// RCSB (BCIF), one from SWISS-MODEL (a PDB file with no HEADER record) and one from AlphaFold
// (mmCIF). The providers here are fixtures answering with the headers the real ones send
// (`Access-Control-Allow-Origin: *`; curl with `Origin: https://geneguessr.brinedew.bio`
// against one real file per provider and format on 2026-10-03: RCSB ModelServer BCIF,
// AlphaFold mmCIF, PDB and BCIF, SWISS-MODEL PDB and mmCIF all answered it, and the error
// answers of RCSB and SWISS-MODEL carry no CORS header). What this proves is the page's side:
// which requests it makes and what Mol* does with the bytes. The fixture bodies are the file
// formats each provider serves; 1CRN.bcif is the real RCSB ModelServer answer for PDB 1CRN.
//
// Ways this can fail, written before the code:
//  1. a guess viewer still asks `/api/structure-cached?key=` with every provider healthy;
//  2. the target leaves the Worker: a provider request, or any payload, names the target;
//  3. the CSP blocks the provider fetch and the silent fallback hides it: the page is served
//     with the real policy and the test counts proxy requests;
//  4. a SWISS-MODEL PDB reaches Mol* without its HEADER line (a negative control shows Mol*
//     rejects it);
//  5. an oversize body reaches Mol*, or its cut-off triggers a second download through the
//     Worker;
//  6. a failing provider or one that stalls leaves an empty viewer instead of the fallback;
//  7. a URL off the three provider hosts, or one with the wrong scheme, credentials or a port,
//     is requested;
//  8. a page that is not given a direct URL (an older Worker) breaks instead of loading
//     through the Worker as it always did.
//
// B-957 adds the request budget of a whole visit: a guess answers with its similarity score
// (no second request), the bootstrap carries the graphics settings (no request of their own)
// and the leaderboard is read when its sidebar section reaches the viewport. The visit is
// measured on a desktop viewport (the sidebar beside the game, on screen at load) and on a
// phone (the sidebar below the game), with 3 and 6 guesses; the counts land in
// geneguessr-request-budget.json. Failure modes, written before the code:
//  9. a guess is answered without its score and the page asks again (`guess-similarity`), or
//     shows a spinner, or shows a number other than the one the Worker computes;
// 10. the page asks `/api/graphics-settings` at load, or styles the first viewer with the
//     built-in default while the stored value is on its way;
// 11. the leaderboard is read while its section is off screen, never read when it is on
//     screen or in a browser without IntersectionObserver, read again on every scroll, or
//     painted differently than before (the first paint says "No public streaks yet." until the
//     fetch starts; it must say "Loading leaderboard..." until the rows arrive).
// The page here carries the grid and sidebar rules of quartz/styles (base.scss and
// variables.scss): three columns from 1200 px with a sticky 100vh right sidebar, the sidebar
// below the game under that.
//
// B-960 and B-959 add the D1 rows of a visit, from the statements' own receipts: a successful
// session write records nothing, so a visit writes only the per-guess aggregate (2 rows a guess
// once the protein has been guessed today), and the leaderboard read costs a handful of rows
// however many accounts exist (workers/leaderboard-streaks.test.js proves that at 1,000, 10,000
// and 100,000 accounts). Failure modes, written before the code:
// 12. a visit writes a row to the session-write evidence tables, or any D1 row other than the
//     aggregates;
// 13. the leaderboard read at the end of a desktop visit costs more than a few dozen rows.
// The rows land in geneguessr-request-budget.json with the counts.
//
// Playwright disables the HTTP cache while a route is installed, so a repeat view's cost is
// not measured here. Against the real providers (Chrome 154, 2026-10-03) a repeat view with
// `cache: "force-cache"` took 1 to 2 ms for all three, while a default repeat took 270 to 424 ms
// for RCSB and SWISS-MODEL, which send no Cache-Control. Mol* is served from public/static/vendor (the build puts it
// there, pinned by SHA-256). Needs an installed Chrome. The request counts land in
// artifacts/e2e/ (E2E_OUT).
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import test, { after, before, mock } from "node:test"

import worker from "../workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { publicContentSecurityPolicy } from "../workers/lib/the-only-public-document-policy-do-not-duplicate.js"
import { DEFAULT_GRAPHICS_SETTINGS } from "../workers/admin.js"
import { getBlendedSimilarity } from "../workers/lib/protein-store.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
  seedEmbeddings,
  seedLeaderboard,
} from "../workers/daily-selection-pool-test-d1.js"
import {
  ANONYMOUS_PDB_HEADER,
  MAX_STRUCTURE_FILE_BYTES,
} from "../quartz/static/geneguessr/structure-bytes.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const STATIC = path.join(ROOT, "quartz", "static")
const MOLSTAR_BUILD = path.join(ROOT, "public", "static", "vendor", "pdbe-molstar-3.8.0", "build")
const BCIF = readFileSync(path.join(ROOT, "e2e", "fixtures", "1CRN.bcif"))
// An older page, to measure what the same visit cost before direct loading.
const APP_JS = process.env.GG_APP_JS || path.join(STATIC, "geneguessr", "app.js")
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
}
// The game page in the shape Quartz gives it: the game in the centre column and the right sidebar
// (where the stats and the "Top Streaks" section are mounted) beside it from 1200 px, below it
// under that. The grid numbers are those of quartz/styles/variables.scss and base.scss.
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>GeneGuessr</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/static/geneguessr/styles.css">
<style>
  body { margin: 0; }
  .page { max-width: calc(1200px + 300px); margin: 0 auto; }
  #quartz-body { display: grid; column-gap: 5px; row-gap: 5px;
    grid-template-columns: 320px auto 320px; grid-template-rows: auto auto auto;
    grid-template-areas: "grid-sidebar-left grid-header grid-sidebar-right"
      "grid-sidebar-left grid-center grid-sidebar-right"
      "grid-sidebar-left grid-footer grid-sidebar-right"; }
  #quartz-body .sidebar { gap: 1.2rem; top: 0; box-sizing: border-box; padding: 6rem 2rem 2rem 2rem;
    display: flex; height: 100vh; position: sticky; }
  #quartz-body .sidebar.left { grid-area: grid-sidebar-left; flex-direction: column; }
  #quartz-body .sidebar.right { grid-area: grid-sidebar-right; flex-direction: column; }
  #quartz-body .center { grid-area: grid-center; min-width: 100%; }
  #quartz-body .page-header { grid-area: grid-header; }
  #quartz-body footer { grid-area: grid-footer; }
  @media not all and (min-width: 1200px) {
    #quartz-body { padding: 0 1rem; grid-template-columns: 320px auto; grid-template-rows: auto auto auto auto;
      grid-template-areas: "grid-sidebar-left grid-header" "grid-sidebar-left grid-center"
        "grid-sidebar-left grid-sidebar-right" "grid-sidebar-left grid-footer"; }
    #quartz-body .sidebar.right { position: initial; height: unset; width: 100%; flex-direction: row; padding: 0; }
    #quartz-body .sidebar.right > * { flex: 1; max-height: 24rem; }
  }
  @media (max-width: 800px) {
    #quartz-body { grid-template-columns: auto; grid-template-rows: auto auto auto auto auto;
      grid-template-areas: "grid-sidebar-left" "grid-header" "grid-center" "grid-sidebar-right" "grid-footer"; }
    #quartz-body .sidebar.left { position: initial; height: unset; padding: 0; padding-top: 2rem; }
  }
</style>
<script src="/static/geneguessr/molstar-shared.js"></script>
</head><body><div class="page"><div id="quartz-body">
<div class="sidebar left"></div><div class="page-header"></div>
<div class="center"><article><div id="geneguessr-root"></div></article></div>
<div class="sidebar right"></div><footer></footer>
</div></div>
<script type="module" src="/static/geneguessr/app.js"></script></body></html>`
// The game document's real policy. Only `upgrade-insecure-requests` is dropped, because the
// test origin is plain http on loopback.
const CSP = publicContentSecurityPolicy({ geneguessrGame: true }).replace(
  /;?\s*upgrade-insecure-requests/,
  "",
)
const PROVIDER_HOSTS = ["models.rcsb.org", "alphafold.ebi.ac.uk", "swissmodel.expasy.org"]
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }
// Public streaks the leaderboard shows, best first.
const LEADERBOARD = [
  { id: "d1", username: "Ada", streak: 12, wins: 40 },
  { id: "d2", username: "Barbara", streak: 7, wins: 31 },
  { id: "d3", username: "Chien-Shiung", streak: 3, wins: 9 },
]

let db
let metered
let dispose
let rows
let origin
let server
let harness
let cookie = "geneguessr_session=e2e-visitor"
let requests = []
// What a visit costs on the meters besides Workers requests: Durable Object calls (reads and
// writes of the session), KV reads and puts, and D1 rows.
const meters = { doReads: 0, doWrites: 0, kvGets: 0 }
let rewrite = { directUrls: true, tokenRoute: true }

// A short helix, 12 residues: enough for Mol* to draw a cartoon.
function helix() {
  const residues = [
    "GLY",
    "ALA",
    "SER",
    "VAL",
    "LEU",
    "LYS",
    "GLU",
    "ASP",
    "ILE",
    "THR",
    "PHE",
    "ARG",
  ]
  const atoms = []
  residues.forEach((name, index) => {
    const theta = (index * 100 * Math.PI) / 180
    const ca = [2.3 * Math.cos(theta), 2.3 * Math.sin(theta), 1.5 * index]
    const around = (radius, shift, rise) => [
      ca[0] + radius * Math.cos(theta + shift),
      ca[1] + radius * Math.sin(theta + shift),
      ca[2] + rise,
    ]
    const c = around(0.9, 0.9, 0.7)
    atoms.push(
      { name: "N", element: "N", residue: name, seq: index + 1, xyz: around(0.9, -0.9, -0.7) },
      { name: "CA", element: "C", residue: name, seq: index + 1, xyz: ca },
      { name: "C", element: "C", residue: name, seq: index + 1, xyz: c },
      {
        name: "O",
        element: "O",
        residue: name,
        seq: index + 1,
        xyz: [c[0] + 0.5 * Math.cos(theta), c[1] + 0.5 * Math.sin(theta), c[2] + 0.6],
      },
    )
  })
  return atoms
}

// SWISS-MODEL's PDB files open with TITLE, EXPDTA, AUTHOR, REVDAT, JRNL and REMARK records
// and have no HEADER record (the first lines of a real one, 2026-10-03, are the same).
function swissModelPdb() {
  const head = [
    "TITLE     SWISS-MODEL SERVER (https://swissmodel.expasy.org)",
    "TITLE    2 Untitled Project",
    "EXPDTA    THEORETICAL MODEL (SWISS-MODEL SERVER)",
    "AUTHOR    SWISS-MODEL SERVER (SEE REFERENCE IN JRNL Records)",
    "REVDAT   1   02-OCT-26 1MOD    1       20:22",
    "REMARK   3 MODEL INFORMATION",
  ]
  const atoms = helix().map((atom, index) => {
    const name = atom.name.length === 1 ? ` ${atom.name}  ` : ` ${atom.name} `
    const [x, y, z] = atom.xyz.map((value) => value.toFixed(3).padStart(8))
    return `ATOM  ${String(index + 1).padStart(5)} ${name} ${atom.residue} A${String(atom.seq).padStart(4)}    ${x}${y}${z}  1.00 20.00           ${atom.element}`
  })
  return `${[...head, ...atoms, "TER", "END"].join("\n")}\n`
}

function alphaFoldCif() {
  const header = [
    "data_AF-E2E-F1",
    "#",
    "loop_",
    "_atom_site.group_PDB",
    "_atom_site.id",
    "_atom_site.type_symbol",
    "_atom_site.label_atom_id",
    "_atom_site.label_alt_id",
    "_atom_site.label_comp_id",
    "_atom_site.label_asym_id",
    "_atom_site.label_entity_id",
    "_atom_site.label_seq_id",
    "_atom_site.pdbx_PDB_ins_code",
    "_atom_site.Cartn_x",
    "_atom_site.Cartn_y",
    "_atom_site.Cartn_z",
    "_atom_site.occupancy",
    "_atom_site.B_iso_or_equiv",
    "_atom_site.auth_seq_id",
    "_atom_site.auth_comp_id",
    "_atom_site.auth_asym_id",
    "_atom_site.auth_atom_id",
    "_atom_site.pdbx_PDB_model_num",
  ]
  const atoms = helix().map((atom, index) => {
    const [x, y, z] = atom.xyz.map((value) => value.toFixed(3))
    return `ATOM ${index + 1} ${atom.element} ${atom.name} . ${atom.residue} A 1 ${atom.seq} ? ${x} ${y} ${z} 1.00 90.00 ${atom.seq} ${atom.residue} A ${atom.name} 1`
  })
  return `${[...header, ...atoms, "#"].join("\n")}\n`
}

// What a provider answers for a file, by host: the format each one serves.
function providerFile(url) {
  const { hostname } = new URL(url)
  if (hostname === "models.rcsb.org") return { body: BCIF, type: "application/octet-stream" }
  if (hostname === "swissmodel.expasy.org") {
    return { body: Buffer.from(swissModelPdb()), type: "text/plain; charset=ASCII" }
  }
  if (hostname === "alphafold.ebi.ac.uk") {
    return { body: Buffer.from(alphaFoldCif()), type: "application/octet-stream" }
  }
  return null
}

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  // The stored AlphaFold file is mmCIF, as on production (the shared seed stores `.pdb`).
  rows = productionShapedCatalogRows().map((row) =>
    row.alphafold_url
      ? { ...row, alphafold_url: row.alphafold_url.replace(/\.pdb$/, ".cif") }
      : row,
  )
  await seedCatalog(db, rows)
  metered = meteredDb(db)
  harness = geneguessrWorkerEnv(metered)
  const sessionStub = harness.env.GAME_SESSIONS.get
  harness.env.GAME_SESSIONS.get = (id) => {
    const stub = sessionStub(id)
    return {
      fetch: (url, init = {}) => {
        meters[init.method === "POST" ? "doWrites" : "doReads"] += 1
        return stub.fetch(url, init)
      },
    }
  }
  const kvGet = harness.env.KV.get
  harness.env.KV.get = (...args) => {
    meters.kvGets += 1
    return kvGet(...args)
  }

  // The Worker's own provider fetches (the target, and any fallback) answer with the same
  // fixtures the browser gets.
  mock.method(globalThis, "fetch", async (input) => {
    const url = String(input?.url || input)
    const file = providerFile(url)
    if (!file) return new Response("not found", { status: 404 })
    return new Response(file.body, { status: 200, headers: { "Content-Type": file.type } })
  })
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})

  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://local")
      if (url.pathname.startsWith("/api/")) {
        requests.push(`${request.method} ${url.pathname}${url.search}`)
        const body = request.method === "GET" ? undefined : await readBody(request)
        const answer = await worker.fetch(
          new Request(`${origin}${url.pathname}${url.search}`, {
            method: request.method,
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body,
          }),
          harness.env,
          { waitUntil() {} },
        )
        const headers = {
          "content-type": answer.headers.get("content-type") || "application/json",
        }
        if (!(answer.headers.get("content-type") || "").includes("json")) {
          response.writeHead(answer.status, headers)
          return response.end(Buffer.from(await answer.arrayBuffer()))
        }
        let text = await answer.text()
        // What an older Worker sends: no direct provider URL anywhere.
        if (!rewrite.directUrls) text = stripDirectUrls(url.pathname, text)
        if (rewrite.offList) text = rewrite.offList(url.pathname, text)
        response.writeHead(answer.status, headers)
        return response.end(text)
      }
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": TYPES[".html"], "content-security-policy": CSP })
        return response.end(PAGE)
      }
      if (url.pathname === "/static/geneguessr/protein-index.json") {
        response.writeHead(200, { "content-type": TYPES[".json"] })
        return response.end(JSON.stringify(proteinIndex()))
      }
      const file =
        url.pathname === "/static/geneguessr/app.js"
          ? APP_JS
          : path.join(STATIC, decodeURIComponent(url.pathname).replace(/^\/static\//, ""))
      if (
        url.pathname.startsWith("/static/") &&
        (file === APP_JS || file.startsWith(STATIC)) &&
        statSync(file).isFile()
      ) {
        response.writeHead(200, {
          "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        })
        return response.end(readFileSync(file))
      }
      response.writeHead(404)
      response.end("not found")
    } catch (error) {
      response.writeHead(500)
      response.end(String(error?.stack || error))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  // The first visitor of the day pays for the daily pick; the measured visits are not that one.
  await worker.fetch(
    new Request(`${origin}/api/game/bootstrap`, {
      headers: { Cookie: "geneguessr_session=e2e-warmup" },
    }),
    harness.env,
    { waitUntil() {} },
  )
  // The embedding rows a guess's similarity is computed from (the target, and every protein a
  // visit can guess), and the accounts the leaderboard shows.
  const target = newestTarget()
  await seedEmbeddings(db, [
    rows.find((row) => row.uniprot === target).gene,
    ...guessRows(target, 6).map((row) => row.gene),
  ])
  await seedLeaderboard(db, LEADERBOARD)
  // The measured visits start from a day that is already under way: the board is built (the
  // first read builds it), and a visitor has guessed every protein a visit guesses, so each
  // guess's aggregate row exists and costs 2 rows to bump instead of 3 to create.
  const call = (path, init = {}) =>
    worker.fetch(
      new Request(`${origin}${path}`, {
        headers: {
          Cookie: "geneguessr_session=e2e-day-underway",
          "Content-Type": "application/json",
        },
        ...init,
      }),
      harness.env,
      { waitUntil() {} },
    )
  assert.equal((await call("/api/stats/leaderboard?limit=5")).status, 200)
  await call("/api/game/bootstrap")
  for (const row of guessRows(target, 6)) {
    const answer = await call("/api/game/guess", {
      method: "POST",
      body: JSON.stringify({ uniprot: row.uniprot }),
    })
    assert.equal(answer.status, 200)
  }
})

after(async () => {
  mock.restoreAll()
  await new Promise((resolve) => server?.close(resolve))
  await dispose?.()
})

function stripDirectUrls(pathname, text) {
  const strip = (token) => {
    if (token && typeof token === "object") delete token.directUrl
  }
  if (pathname === "/api/game/bootstrap") {
    const payload = JSON.parse(text)
    for (const guess of payload.guesses || []) strip(guess.structureToken)
    return JSON.stringify(payload)
  }
  if (pathname === "/api/game/guess") {
    const payload = JSON.parse(text)
    strip(payload.guessStructureToken)
    return JSON.stringify(payload)
  }
  if (pathname === "/api/structure-token") {
    const payload = JSON.parse(text)
    strip(payload)
    return JSON.stringify(payload)
  }
  return text
}

const readBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

// The page searches this static file for a guess; its rows are the seeded proteins.
function proteinIndex() {
  return {
    schema_version: 1,
    fields: ["uniprot", "hgnc", "gene_surname", "full_name", "length", "synonyms"],
    rows: rows.map((row) => [
      row.uniprot,
      row.gene,
      row.gene_surname,
      `Protein ${row.id}`,
      100,
      [],
    ]),
  }
}

// The target the daily pick gave the newest session (the visit's own), and three proteins to
// guess, one per source.
const newestTarget = () => [...harness.sessions.values()].at(-1).targetId
// `count` proteins to guess, cycling through the three sources: the first three are one of
// each, the next three the second of each.
const guessRows = (target, count = 3) => {
  const sources = ["pdb", "swissmodel", "alphafold"]
  const pools = sources.map((source) =>
    rows.filter(
      (row) => row.structure_source === source && row.gene_summary && row.uniprot !== target,
    ),
  )
  return Array.from({ length: count }, (_, index) => pools[index % 3][Math.floor(index / 3)])
}

function resetMeters() {
  metered.receipts.length = 0
  harness.kvPuts.length = 0
  Object.assign(meters, { doReads: 0, doWrites: 0, kvGets: 0 })
}
const readMeters = () => ({
  ...meters,
  kvPuts: harness.kvPuts.length,
  d1RowsRead: metered.totalRead(),
  d1RowsWritten: metered.totalWritten(),
  d1Receipts: metered.receipts.map((receipt) => ({
    sql: receipt.sql.slice(0, 400),
    rowsRead: receipt.rows_read,
    rowsWritten: receipt.rows_written,
  })),
  d1Statements: metered.receipts
    .filter((receipt) => receipt.rows_written || receipt.rows_read > 1)
    .map(
      (receipt) =>
        `${receipt.rows_read} read, ${receipt.rows_written} written: ${receipt.sql.slice(0, 90)}`,
    ),
})

function category(line) {
  if (line.startsWith("GET /api/game/bootstrap")) return "bootstrap"
  if (line.startsWith("GET /api/graphics-settings")) return "graphicsSettings"
  if (line.startsWith("GET /api/stats/leaderboard")) return "leaderboard"
  if (line.startsWith("POST /api/game/guess-similarity")) return "similarity"
  if (line.startsWith("POST /api/game/guess")) return "guess"
  if (line.includes("/api/structure-cached?type=target")) return "structureTarget"
  if (line.includes("/api/structure-cached?key=")) return "structureKey"
  if (line.includes("/api/structure-token")) return "structureToken"
  return "other"
}
function counts(lines) {
  const out = {
    bootstrap: 0,
    graphicsSettings: 0,
    leaderboard: 0,
    guess: 0,
    similarity: 0,
    structureTarget: 0,
    structureKey: 0,
    structureToken: 0,
    other: 0,
  }
  for (const line of lines) out[category(line)] += 1
  return { ...out, total: lines.length }
}

// A browser context for one visitor. Off-origin requests: Mol* comes from the vendored build, a
// provider answers from a fixture with the CORS header the real ones send (or as `provider`
// says), and everything else is refused. `tracker` records what the page did.
async function openVisitor(
  browser,
  { visitorCookie, provider = null, viewport = { width: 1200, height: 900 }, noObserver = false },
) {
  cookie = visitorCookie
  const tracker = {
    providerRequests: [],
    providerHeaders: [],
    offOrigin: [],
    complete: new Set(),
    cspViolations: [],
  }
  const context = await browser.newContext({ viewport })
  // A browser without IntersectionObserver (an old one, or one that blocks it).
  if (noObserver) await context.addInitScript(() => delete window.IntersectionObserver)
  await context.route(
    (url) => url.origin !== origin,
    async (route) => {
      const url = route.request().url()
      const { hostname } = new URL(url)
      if (hostname === "cdn.jsdelivr.net") {
        const match = url.match(/pdbe-molstar@3\.8\.0\/build\/([a-z.-]+)$/)
        const file = match && path.join(MOLSTAR_BUILD, match[1])
        if (file && existsSync(file)) {
          return route.fulfill({
            body: readFileSync(file),
            contentType: file.endsWith(".css") ? "text/css" : "text/javascript",
          })
        }
        return route.abort()
      }
      tracker.offOrigin.push(url)
      const fixture = providerFile(url)
      if (!fixture || !PROVIDER_HOSTS.includes(hostname)) return route.abort()
      tracker.providerRequests.push(url)
      const sent = route.request().headers()
      tracker.providerHeaders.push({ url, referer: sent.referer, cookie: sent.cookie })
      if (provider) {
        const handled = await provider(url, route, fixture)
        if (handled) return
      }
      return route.fulfill({
        status: 200,
        body: fixture.body,
        headers: { "content-type": fixture.type, "access-control-allow-origin": "*" },
      })
    },
  )
  // Every Blob a viewer is given: its size and first bytes, to see what Mol* receives.
  await context.addInitScript(() => {
    window.__blobs = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (object) => {
      if (object instanceof Blob) {
        object
          .slice(0, 24)
          .text()
          .then((head) => window.__blobs.push({ size: object.size, head }))
      }
      return create(object)
    }
  })
  // What the visitor sees change: every spinner or pending mark that is ever added to the page,
  // and every text the leaderboard section shows, in order.
  await context.addInitScript(() => {
    window.__pendingMarks = 0
    window.__leaderboardTexts = []
    const pending = ".pg-score-spinner, .pg-pending"
    const record = () => {
      const section = document.getElementById("pg-sidebar-leaderboard")
      if (!section) return
      const text = section.textContent.replace(/\s+/g, " ").trim()
      if (text !== window.__leaderboardTexts.at(-1)) window.__leaderboardTexts.push(text)
    }
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of change.addedNodes) {
          if (node.nodeType === 1 && (node.matches(pending) || node.querySelector(pending))) {
            window.__pendingMarks += 1
          }
        }
      }
      record()
    }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  const page = await context.newPage()
  page.on("console", (message) => {
    const text = message.text()
    const done = text.match(/\[TIMING\] (\S+) \| loadComplete fired - structure fully rendered/)
    if (done) tracker.complete.add(done[1])
    if (/Content Security Policy/i.test(text)) tracker.cspViolations.push(text)
  })
  return { page, context, tracker }
}

async function openGame(page) {
  await page.goto(`${origin}/?gg_api=${encodeURIComponent(origin)}`)
  await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
}

// Types a protein's gene symbol, picks the suggestion and waits for its card.
async function guess(page, row, cardsAfter) {
  await page.fill("#pg-input", row.gene)
  await page.waitForSelector(`.pg-suggestion[data-uniprot="${row.uniprot}"]`, { timeout: 10000 })
  await page.click(`.pg-suggestion[data-uniprot="${row.uniprot}"]`)
  await page.waitForFunction(
    (count) => document.querySelectorAll('.pg-feedback-card[id^="guess-card-"]').length >= count,
    cardsAfter,
    { timeout: 20000 },
  )
}

// Waits until `expected` viewers have rendered or shown an error, and returns which.
async function settle(page, tracker, expected, timeoutMs = 40000) {
  const failedViewers = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".pg-structure-error")]
        .filter((el) => !el.hidden && el.textContent.trim())
        .map((el) => el.textContent.trim()),
    )
  const deadline = Date.now() + timeoutMs
  let failed = await failedViewers()
  while (tracker.complete.size + failed.length < expected && Date.now() < deadline) {
    await page.waitForTimeout(500)
    failed = await failedViewers()
  }
  await page.waitForTimeout(1000)
  failed = await failedViewers()
  return { complete: [...tracker.complete], failed }
}

// A visit: open the game and make `guesses` guesses by typing and clicking.
async function visit(
  browser,
  { visitorCookie, guesses = 3, provider = null, viewport, noObserver = false },
) {
  const { page, context, tracker } = await openVisitor(browser, {
    visitorCookie,
    provider,
    viewport,
    noObserver,
  })
  requests = []
  resetMeters()
  await openGame(page)
  const target = newestTarget()
  const chosen = guessRows(target, guesses)
  for (const [index, row] of chosen.entries()) await guess(page, row, index + 1)
  const viewers = await settle(page, tracker, 1 + chosen.length)
  return {
    page,
    context,
    tracker,
    result: {
      target,
      guessed: chosen.map((row) => row.uniprot),
      requests: [...requests],
      counts: counts(requests),
      meters: readMeters(),
      providerRequests: [...tracker.providerRequests],
      ...viewers,
    },
  }
}

// A returning visitor: a session that already holds these guesses with no score (the bootstrap
// scores them). The page opens the newest guess's card, so a load shows two viewers (the target
// and that guess); the visitor then opens the other two cards, and reloads.
async function returningVisit(browser, { visitorCookie }) {
  const { page, context, tracker } = await openVisitor(browser, { visitorCookie })
  cookie = visitorCookie
  await worker.fetch(
    new Request(`${origin}/api/game/bootstrap`, { headers: { Cookie: visitorCookie } }),
    harness.env,
    { waitUntil() {} },
  )
  const [key, state] = [...harness.sessions.entries()].at(-1)
  const chosen = guessRows(state.targetId)
  harness.sessions.set(key, {
    ...state,
    guesses: chosen.map((row, index) => ({
      guessId: `g${index + 1}`,
      uniprot: row.uniprot,
      correct: false,
      createdAt: Date.now() + index,
    })),
  })
  const phases = []
  const phase = async (name, action, expected) => {
    requests = []
    tracker.complete.clear()
    tracker.providerRequests.length = 0
    await action()
    const viewers = await settle(page, tracker, expected)
    phases.push({
      name,
      counts: counts(requests),
      providerRequests: [...tracker.providerRequests],
      ...viewers,
    })
  }
  await phase("load", () => openGame(page), 2)
  await phase(
    "open the other two cards",
    async () => {
      // Each click turns one collapsed card open, so the first collapsed one is the next.
      for (let opened = 0; opened < chosen.length - 1; opened += 1) {
        await page.locator(".pg-feedback-card.collapsed button.pg-collapse-toggle").first().click()
      }
    },
    2,
  )
  await phase(
    "reload",
    async () => {
      await page.reload()
      await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
    },
    4, // the page remembers which cards are open: the target and all three guesses
  )
  return { page, context, tracker, phases, target: state.targetId, guessed: chosen }
}

const chromeAndMolstar = async (t) => {
  if (!existsSync(path.join(MOLSTAR_BUILD, "pdbe-molstar-plugin.js"))) {
    if (process.env.CI) throw new Error("public/static/vendor Mol* build is missing")
    t.skip("the Mol* build is not in public/static/vendor (run pnpm run build)")
    return null
  }
  return launchChrome(t)
}

const measured = {}
const save = () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    path.join(OUT, "geneguessr-direct-structures.json"),
    JSON.stringify(measured, null, 2),
  )
}
const hostsOf = (urls) => urls.map((url) => new URL(url).hostname).sort()
const rowWith = (source, result) =>
  rows.find((row) => row.structure_source === source && result.guessed.includes(row.uniprot))

test("page load plus three guesses: guess structures come from the providers, the target through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { result, page, context, tracker } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-direct",
    })
    mkdirSync(OUT, { recursive: true })
    await page.screenshot({
      path: path.join(OUT, "geneguessr-direct-structures.png"),
      fullPage: true,
    })
    const blobs = await page.evaluate(() => window.__blobs)
    await context.close()
    measured.direct = { ...result, blobs }

    assert.equal(
      result.counts.structureKey,
      0,
      `guess views through the Worker: ${result.requests}`,
    )
    assert.equal(result.counts.structureTarget, 1, "the target is one Worker view")
    assert.equal(result.counts.structureToken, 0, "no token request")
    assert.deepEqual(
      hostsOf(result.providerRequests),
      [...PROVIDER_HOSTS].sort(),
      "one request to each provider, for the three guesses",
    )
    assert.deepEqual(result.failed, [], "no viewer failed")
    assert.equal(result.complete.length, 4, `rendered viewers: ${result.complete}`)
    assert.deepEqual(tracker.cspViolations, [], "the policy lets every provider request through")
    // What Mol* is given: a SWISS-MODEL PDB always opens with the anonymous HEADER line, and
    // the file after it is the provider's, byte for byte.
    const header = new TextDecoder().decode(ANONYMOUS_PDB_HEADER)
    assert.equal(blobs.length, 4, "one blob per viewer")
    assert.ok(
      blobs.every((blob) => !blob.head.startsWith("TITLE     SWISS-MODEL")),
      "a SWISS-MODEL PDB reached Mol* without its HEADER line",
    )
    const swiss = blobs.filter((blob) => blob.head.startsWith("HEADER    MODEL"))
    assert.ok(swiss.length >= 1)
    for (const blob of swiss) assert.equal(blob.size, swissModelPdb().length + header.length)
    assert.ok(
      blobs.some((blob) => blob.size === BCIF.length),
      "the RCSB file is delivered whole",
    )
    assert.ok(
      blobs.some((blob) => blob.size === alphaFoldCif().length),
      "the AlphaFold file too",
    )
    for (const sent of tracker.providerHeaders) {
      assert.equal(sent.referer, undefined, `a provider got a referrer: ${sent.referer}`)
      assert.equal(sent.cookie, undefined, "a provider got a cookie")
    }
  } finally {
    save()
    await browser.close()
  }
})

test("the same visit with no direct URL in the payloads loads every guess through the Worker, as before", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: false }
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-proxy",
    })
    await context.close()
    measured.proxyOnly = result

    assert.equal(result.counts.structureKey, 3)
    assert.equal(result.counts.structureTarget, 1)
    assert.deepEqual(result.providerRequests, [], "the browser never talks to a provider")
    assert.deepEqual(result.failed, [])
    assert.equal(result.complete.length, 4)
  } finally {
    rewrite = { directUrls: true }
    save()
    await browser.close()
  }
})

test("a returning visitor's load, opened cards and reload take every guess from its provider with no structure request to the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const visitor = await returningVisit(browser, { visitorCookie: "geneguessr_session=e2e-back" })
    await visitor.context.close()
    measured.returning = visitor.phases
    const [load, opened, reload] = visitor.phases
    for (const phase of visitor.phases) {
      assert.equal(phase.counts.structureKey, 0, `${phase.name}: no guess through the Worker`)
      assert.equal(phase.counts.structureToken, 0, `${phase.name}: no token request`)
      assert.deepEqual(phase.failed, [], `${phase.name}: no viewer failed`)
    }
    for (const phase of [load, reload]) {
      assert.equal(phase.counts.bootstrap, 1, `${phase.name}: one bootstrap`)
      assert.equal(phase.counts.structureTarget, 1, `${phase.name}: the target is one Worker view`)
    }
    assert.deepEqual(hostsOf(load.providerRequests), ["alphafold.ebi.ac.uk"], "load: the open card")
    assert.equal(load.complete.length, 2, `load: ${load.complete}`)
    assert.deepEqual(
      hostsOf(opened.providerRequests),
      ["models.rcsb.org", "swissmodel.expasy.org"],
      "opening the other cards loads them from their providers",
    )
    assert.equal(opened.counts.total, 0, "opening a card makes no Worker request")
    assert.deepEqual(hostsOf(reload.providerRequests), [...PROVIDER_HOSTS].sort(), "reload")
    assert.equal(reload.complete.length, 4, `reload: ${reload.complete}`)
  } finally {
    save()
    await browser.close()
  }
})

test("no payload and no provider request names the target before the reveal", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { result, context, page } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-secret",
    })
    const target = rows.find((row) => row.uniprot === result.target)
    const seen = await page.evaluate(async (base) => {
      const response = await fetch(`${base}/api/game/bootstrap`, { credentials: "include" })
      return response.text()
    }, origin)
    await context.close()

    const nameable = [target.uniprot, target.pdb_id, target.swissmodel_url, target.alphafold_url]
      .filter(Boolean)
      .map(String)
    const everyRequest = [...result.requests, ...result.providerRequests].join("\n")
    for (const secret of nameable) {
      assert.ok(!seen.includes(secret), `the bootstrap names the target: ${secret}`)
      assert.ok(!everyRequest.includes(secret), `a request names the target: ${secret}`)
    }
    assert.match(seen, /\/api\/structure-cached\?type=target/)
  } finally {
    await browser.close()
  }
})

test("a provider that fails, answers an error or blocks the browser sends that one guess through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-failing",
      provider: async (url, route) => {
        const { hostname } = new URL(url)
        if (hostname === "models.rcsb.org") {
          await route.abort("connectionreset")
          return true
        }
        if (hostname === "alphafold.ebi.ac.uk") {
          await route.fulfill({
            status: 503,
            body: "busy",
            headers: { "access-control-allow-origin": "*" },
          })
          return true
        }
        // SWISS-MODEL answers a 404 with no CORS header, as the real one does.
        await route.fulfill({ status: 404, body: "no model" })
        return true
      },
    })
    await context.close()
    measured.providersFailing = result

    const key = (path) => `GET /api/structure-cached?key=${encodeURIComponent(path)}`
    assert.deepEqual(
      result.requests.filter((line) => line.includes("structure-cached?key=")).sort(),
      [
        key(`pdb/${rowWith("pdb", result).pdb_id}.bcif`),
        key(`swissmodel/${rowWith("swissmodel", result).uniprot}_tmpl.pdb`),
        key(`alphafold/${rowWith("alphafold", result).uniprot}.cif`),
      ].sort(),
    )
    assert.deepEqual(result.failed, [], "the Worker route shows every viewer")
    assert.equal(result.complete.length, 4)
  } finally {
    save()
    await browser.close()
  }
})

test("an empty answer from a provider counts as a failure, not as a structure", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-empty",
      provider: async (url, route) => {
        if (new URL(url).hostname !== "swissmodel.expasy.org") return false
        // The page puts a HEADER line in front of a SWISS-MODEL file; an empty file is still empty.
        await route.fulfill({
          status: 200,
          body: "",
          headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
        })
        return true
      },
    })
    await context.close()

    assert.equal(result.counts.structureKey, 1, `fallbacks: ${result.requests}`)
    assert.match(
      result.requests.find((line) => line.includes("structure-cached?key=")),
      /swissmodel/,
    )
    assert.deepEqual(result.failed, [])
    assert.equal(result.complete.length, 4)
  } finally {
    await browser.close()
  }
})

test("a provider that stalls sends that guess through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const started = Date.now()
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-stalled",
      provider: async (url) => {
        if (new URL(url).hostname !== "swissmodel.expasy.org") return false
        await new Promise(() => {}) // never answers; closing the context ends it
      },
    })
    await context.close()
    measured.providerStalled = { ...result, seconds: Math.round((Date.now() - started) / 1000) }

    assert.equal(result.counts.structureKey, 1, `fallbacks: ${result.requests}`)
    assert.match(
      result.requests.find((line) => line.includes("structure-cached?key=")),
      /swissmodel/,
    )
    assert.deepEqual(result.failed, [])
    assert.equal(result.complete.length, 4)
  } finally {
    save()
    await browser.close()
  }
})

test("an oversize body from a provider is cut off, never reaches Mol*, and is not downloaded a second time", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-oversize",
      provider: async (url, route) => {
        if (new URL(url).hostname !== "swissmodel.expasy.org") return false
        await route.fulfill({
          status: 200,
          body: Buffer.alloc(MAX_STRUCTURE_FILE_BYTES + 1024, 0x41),
          headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
        })
        return true
      },
    })
    await context.close()
    measured.oversize = result

    assert.equal(result.counts.structureKey, 0, "no second download through the Worker")
    assert.equal(result.failed.length, 1, `failed viewers: ${result.failed}`)
    assert.match(result.failed[0], /Could not load the 3D structure/)
    assert.equal(result.complete.length, 3, "the other three viewers render")
  } finally {
    save()
    await browser.close()
  }
})

test("a direct URL that is not a provider URL is never requested and the guess loads through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    const bad = [
      "https://evil.example/x.cif",
      "http://models.rcsb.org/v1/1CRN/full?encoding=bcif",
      "https://user:pw@alphafold.ebi.ac.uk/files/AF-X-F1-model_v6.cif",
    ]
    let next = 0
    // Every guess response names a different bad URL, in the order the guesses are made.
    rewrite = {
      directUrls: true,
      offList: (pathname, text) => {
        if (pathname !== "/api/game/guess") return text
        const payload = JSON.parse(text)
        if (payload.guessStructureToken) payload.guessStructureToken.directUrl = bad[next++]
        return JSON.stringify(payload)
      },
    }
    const { result, context, tracker } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-offlist",
    })
    await context.close()
    measured.offList = result

    assert.equal(next, 3)
    assert.deepEqual(result.providerRequests, [], "no request to a provider")
    assert.deepEqual(
      tracker.offOrigin.filter((url) => !/cdn\.jsdelivr\.net/.test(url)),
      [],
      "no request off the page's origin",
    )
    assert.deepEqual(tracker.cspViolations, [], "the page refused them before the policy had to")
    assert.equal(result.counts.structureKey, 3)
    assert.deepEqual(result.failed, [])
  } finally {
    rewrite = { directUrls: true }
    save()
    await browser.close()
  }
})

// ---------------------------------------------------------------------------------------------
// B-957: the request budget of a visit. What a visit costs on the free plan is its Worker
// requests (two meter units each), so these tests count them for page load plus 3 and 6
// guesses, on a desktop viewport and on a phone.

const budget = {}
const saveBudget = () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, "geneguessr-request-budget.json"), JSON.stringify(budget, null, 2))
}
const leaderboardShown = (page) =>
  page.evaluate(() => ({
    names: [...document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-name")].map(
      (el) => el.textContent,
    ),
    streaks: [...document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-streak")].map(
      (el) => Number(el.textContent),
    ),
    texts: window.__leaderboardTexts,
  }))
const RANKED = {
  names: LEADERBOARD.map((entry) => entry.username),
  streaks: LEADERBOARD.map((entry) => entry.streak),
}
const rowsShown = () =>
  document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-row").length > 0

for (const [layout, viewport] of [
  ["desktop", DESKTOP],
  ["phone", PHONE],
]) {
  for (const guesses of [3, 6]) {
    const expectedTotal = 2 + guesses + (layout === "desktop" ? 1 : 0)
    test(`a ${layout} visit, page load plus ${guesses} guesses, costs ${expectedTotal} Worker requests`, async (t) => {
      const browser = await chromeAndMolstar(t)
      if (!browser) return
      try {
        rewrite = { directUrls: true }
        const { result, page, context, tracker } = await visit(browser, {
          visitorCookie: `geneguessr_session=e2e-budget-${layout}-${guesses}`,
          guesses,
          viewport,
        })
        // The visit's own measurements first: a visitor on a phone has not scrolled to the
        // sidebar, a desktop visitor has it on screen.
        const marks = await page.evaluate(() => window.__pendingMarks)
        const entry = { ...result, pendingMarks: marks }
        budget[`${layout}${guesses}`] = entry
        if (layout === "phone") {
          // Then the visitor scrolls down to the sidebar: the section is read once.
          await page.locator("#pg-sidebar-leaderboard").scrollIntoViewIfNeeded()
          await page.waitForFunction(rowsShown, null, { timeout: 10000 })
          entry.afterScroll = counts(requests)
        }
        await context.close()

        const c = result.counts
        assert.equal(c.bootstrap, 1, `bootstrap: ${result.requests}`)
        assert.equal(c.structureTarget, 1, "the target is one Worker view")
        assert.equal(c.guess, guesses, "one request a guess")
        assert.equal(c.similarity, 0, "no request for a similarity score")
        assert.equal(c.graphicsSettings, 0, "no request for the graphics settings")
        assert.equal(c.structureKey, 0, "no guess view through the Worker")
        assert.equal(c.structureToken, 0, "no token request")
        assert.equal(c.other, 0, `nothing else: ${result.requests}`)
        assert.equal(c.leaderboard, layout === "desktop" ? 1 : 0, "the leaderboard")
        assert.equal(c.total, expectedTotal, `${result.requests}`)
        assert.equal(marks, 0, "a score never shows as pending")
        // D1 rows (B-960, B-959): the receipts of every statement the visit ran.
        const receipts = result.meters.d1Receipts
        assert.deepEqual(
          receipts.filter((receipt) => /game_session_write_/.test(receipt.sql)),
          [],
          "a successful session write records nothing",
        )
        assert.deepEqual(
          receipts
            .filter((receipt) => receipt.rowsWritten && !/daily_guess_aggregate/.test(receipt.sql))
            .map((receipt) => receipt.sql),
          [],
          "the only rows a visit writes are the aggregates",
        )
        assert.equal(result.meters.d1RowsWritten, 2 * guesses, "2 rows a guess")
        const board = receipts.filter((receipt) => /leaderboard_streaks/.test(receipt.sql))
        assert.equal(board.length, layout === "desktop" ? 1 : 0, "one board read on a desktop")
        for (const read of board) {
          assert.ok(read.rowsRead <= 28 && read.rowsWritten === 0, `${read.rowsRead} rows read`)
        }
        assert.deepEqual(result.failed, [], "no viewer failed")
        assert.equal(result.complete.length, 1 + guesses, `rendered viewers: ${result.complete}`)
        assert.deepEqual(tracker.cspViolations, [])
        if (layout === "phone") {
          assert.equal(entry.afterScroll.leaderboard, 1, "scrolling to the section reads it once")
          assert.equal(entry.afterScroll.total, 3 + guesses)
        }
      } finally {
        saveBudget()
        await browser.close()
      }
    })
  }
}

test("each card shows the similarity score the Worker computes, at once and never as a spinner", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { result, page, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-scores",
      viewport: DESKTOP,
    })
    const shown = await page.evaluate(() => ({
      pending: window.__pendingMarks,
      cards: [...document.querySelectorAll('.pg-feedback-card[id^="guess-card-"]')].map((card) => ({
        gene: card.querySelector(".pg-feedback-gene")?.textContent,
        score: card.querySelector(".pg-feedback-score")?.textContent,
        bar: card.querySelector(".pg-bar-fill")?.style.width,
      })),
    }))
    await context.close()
    const target = rows.find((row) => row.uniprot === result.target)
    assert.equal(shown.cards.length, 3)
    for (const card of shown.cards) {
      const guessed = rows.find((row) => row.gene === card.gene)
      const expected = (await getBlendedSimilarity(db, guessed.gene, target.gene)).blended
      assert.equal(typeof expected, "number", `${card.gene}: the seeded embeddings score`)
      assert.equal(card.score, `${expected}%`, `${card.gene}: the number on the card`)
      assert.equal(card.bar, `${expected}%`, `${card.gene}: the bar`)
    }
    assert.equal(shown.pending, 0, "no spinner or pending mark was ever added to the page")
  } finally {
    await browser.close()
  }
})

test("the page is styled with the settings the bootstrap carries, with no request of their own", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  const tuned = {
    ...DEFAULT_GRAPHICS_SETTINGS,
    camera: { ...DEFAULT_GRAPHICS_SETTINGS.camera, mode: "orthographic" },
  }
  const cameraMode = async (stored) => {
    if (stored) harness.kv.set("graphics_settings", JSON.stringify(stored))
    else harness.kv.delete("graphics_settings")
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: `geneguessr_session=e2e-graphics-${stored ? "tuned" : "default"}`,
      viewport: DESKTOP,
    })
    requests = []
    // `molstar_debug` hands the page's last viewer to the test.
    await page.goto(`${origin}/?molstar_debug&gg_api=${encodeURIComponent(origin)}`)
    await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
    await settle(page, tracker, 1)
    await page.waitForTimeout(1500) // the stylization steps wait 100 to 300 ms each
    const mode = await page.evaluate(
      () => globalThis.__GeneguessrMolstarDebug?.viewer?.plugin?.canvas3d?.props?.camera?.mode,
    )
    const seen = counts(requests)
    await context.close()
    return { mode, seen }
  }
  try {
    rewrite = { directUrls: true }
    const withStored = await cameraMode(tuned)
    const withDefault = await cameraMode(null)
    budget.graphicsSettings = { withStored, withDefault }
    assert.equal(withStored.mode, "orthographic", "the stored value styled the first viewer")
    assert.equal(withDefault.mode, "perspective", "the control: with no stored value, the default")
    assert.equal(withStored.seen.graphicsSettings, 0, "no settings request with a stored value")
    assert.equal(withDefault.seen.graphicsSettings, 0, "none without one")
  } finally {
    harness.kv.delete("graphics_settings")
    saveBudget()
    await browser.close()
  }
})

test("a phone reads the leaderboard when its section nears the screen, and it looks as it always did", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { page, context } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-phone",
      viewport: PHONE,
    })
    requests = []
    await openGame(page)
    await page.waitForTimeout(2000)
    const before = { counts: counts(requests), shown: await leaderboardShown(page) }
    const offScreen = await page.evaluate(() => {
      const top = document.getElementById("pg-sidebar-leaderboard").getBoundingClientRect().top
      return top - window.innerHeight
    })
    await page.locator("#pg-sidebar-leaderboard").scrollIntoViewIfNeeded()
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    // Away and back: the rows are already there, so no second read.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.locator("#pg-sidebar-leaderboard").scrollIntoViewIfNeeded()
    await page.waitForTimeout(1000)
    const after = { counts: counts(requests), shown: await leaderboardShown(page) }
    await context.close()
    budget.leaderboardPhone = { before, after, pixelsBelowTheScreenAtLoad: Math.round(offScreen) }

    assert.ok(offScreen > 400, `the section starts ${offScreen} px below the screen at load`)
    assert.equal(before.counts.leaderboard, 0, "not read while off screen")
    assert.deepEqual(before.shown.texts, ["Loading leaderboard..."], "the first paint")
    assert.equal(after.counts.leaderboard, 1, "read once, however often it is scrolled to")
    assert.deepEqual({ names: after.shown.names, streaks: after.shown.streaks }, RANKED)
    assert.ok(
      !after.shown.texts.includes("No public streaks yet."),
      `the empty text never flashed: ${JSON.stringify(after.shown.texts)}`,
    )
    assert.equal(after.shown.texts.length, 2, "loading, then the rows")
  } finally {
    saveBudget()
    await browser.close()
  }
})

test("a desktop reads the leaderboard at load, because its section is on screen, and it looks as it always did", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { page, context } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-desktop",
      viewport: DESKTOP,
    })
    requests = []
    await openGame(page)
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    const shown = await leaderboardShown(page)
    const onScreen = await page.evaluate(() => {
      const box = document.getElementById("pg-sidebar-leaderboard").getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight
    })
    await context.close()
    budget.leaderboardDesktop = { counts: counts(requests), shown, onScreen }

    assert.equal(onScreen === true, true, "the section is on the first screen")
    assert.equal(counts(requests).leaderboard, 1)
    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
    assert.equal(shown.texts.length, 2, `loading, then the rows: ${JSON.stringify(shown.texts)}`)
    assert.ok(!shown.texts.includes("No public streaks yet."), "the empty text never flashed")
  } finally {
    saveBudget()
    await browser.close()
  }
})

test("a browser without IntersectionObserver still reads the leaderboard, at load", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    rewrite = { directUrls: true }
    const { page, context } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-old",
      viewport: PHONE,
      noObserver: true,
    })
    requests = []
    await openGame(page)
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    const shown = await leaderboardShown(page)
    await context.close()

    assert.equal(counts(requests).leaderboard, 1)
    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
  } finally {
    await browser.close()
  }
})
