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
// <test file>-request-budget.json. Failure modes, written before the code:
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
// session write records nothing, so a visit writes only the per-guess aggregate (1 row a guess
// once the protein has been guessed today, B-964), and the leaderboard read costs a handful of rows
// however many accounts exist (workers/leaderboard-streaks.test.js proves that at 1,000, 10,000
// and 100,000 accounts). Failure modes, written before the code:
// 12. a visit writes a row to the session-write evidence tables, or any D1 row other than the
//     aggregates;
// 13. the leaderboard read at the end of a desktop visit costs more than a few dozen rows.
// The rows land in that file with the counts.
//
// B-965 takes the leaderboard off the Worker: the "Top Streaks" box is read from an object on the
// CDN that the Worker's own scheduled job publishes (workers/lib/leaderboard-publication.js; here
// the real job runs in `before`, Bunny Storage and Discord's CDN are fixtures, and the CDN host
// answers from what the job stored), with each avatar embedded in it. A box with five public
// streaks cost 1 request for the board and 5 for the pictures through `/api/avatar`, all metered
// and all paid on a first visit; now it costs none, and the Worker route is only the fallback.
// Failure modes, written before the code:
// 14. a visit still asks the Worker for the board or an avatar, or draws no picture, or the
//     document policy blocks the CDN read (the Worker route would answer and hide it);
// 15. with the CDN unreachable, or answering something that is not the board, the box stays empty
//     instead of falling back to the Worker route; the fallback measures what a full board used
//     to cost (the route and a request a picture);
// 16. an object that names a picture address other than a data: image makes the page request it.
// Playwright disables the HTTP cache while a route is installed, so a repeat view's cost is
// not measured here. Against the real providers (Chrome 154, 2026-10-03) a repeat view with
// `cache: "force-cache"` took 1 to 2 ms for all three, while a default repeat took 270 to 424 ms
// for RCSB and SWISS-MODEL, which send no Cache-Control. Mol* is served from public/static/vendor (the build puts it
// there, pinned by SHA-256). Needs an installed Chrome. The request counts land in
// artifacts/e2e/ (E2E_OUT).
//
// The tests live in geneguessr-direct-loads, geneguessr-direct-failures, geneguessr-visit-budget
// and geneguessr-score-and-leaderboard (.e2e.mjs), so Node runs them side by side; as one file
// they took about 490 s. Importing this module registers the hooks that seed D1, run the
// leaderboard job and start the server, once in each file's process.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { after, before, mock } from "node:test"

import worker from "../workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { publicContentSecurityPolicy } from "../workers/lib/the-only-public-document-policy-do-not-duplicate.js"
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
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_RECURRING_CRON,
} from "../workers/iconoplasm-background-schedule.js"
import { LEADERBOARD_OBJECT_KEY } from "../workers/lib/iconoplasm-published-objects.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

export const STATIC = path.join(ROOT, "quartz", "static")
export const MOLSTAR_BUILD = path.join(
  ROOT,
  "public",
  "static",
  "vendor",
  "pdbe-molstar-3.8.0",
  "build",
)
export const BCIF = readFileSync(path.join(ROOT, "e2e", "fixtures", "1CRN.bcif"))
// An older page, to measure what the same visit cost before direct loading.
export const APP_JS = process.env.GG_APP_JS || path.join(STATIC, "geneguessr", "app.js")
export const TYPES = {
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
export const PAGE = `<!doctype html>
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
export const CSP = publicContentSecurityPolicy({ geneguessrGame: true }).replace(
  /;?\s*upgrade-insecure-requests/,
  "",
)
export const PROVIDER_HOSTS = ["models.rcsb.org", "alphafold.ebi.ac.uk", "swissmodel.expasy.org"]
// The CDN the "Top Streaks" object is published to and read from, Bunny Storage behind the
// Worker's own writes, and Discord's CDN behind its avatar fetches: all fixtures here.
export const CDN_HOST = "img.brinedew.bio"
export const STORAGE_ZONE = "e2e-zone"
export const BUNNY_ENV = {
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: STORAGE_ZONE,
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "e2e-storage-password",
  ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: `https://${CDN_HOST}`,
  ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
}
// A real 1 x 1 PNG: what Discord's CDN answers for an avatar.
export const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)
export const DESKTOP = { width: 1280, height: 900 }
export const PHONE = { width: 390, height: 844 }
// Public streaks the leaderboard shows, best first: a full board of five, each with the avatar
// Discord stores for the account.
export const avatarOf = (id) => `https://cdn.discordapp.com/avatars/${id}/e2e.png`
export const LEADERBOARD = [
  { id: "d1", username: "Ada", streak: 12, wins: 40, avatar: avatarOf("d1") },
  { id: "d2", username: "Barbara", streak: 7, wins: 31, avatar: avatarOf("d2") },
  { id: "d3", username: "Chien-Shiung", streak: 3, wins: 9, avatar: avatarOf("d3") },
  { id: "d4", username: "Dorothy", streak: 2, wins: 15, avatar: avatarOf("d4") },
  { id: "d5", username: "Emmy", streak: 1, wins: 5, avatar: avatarOf("d5") },
]

export let db
export let metered
export let dispose
export let rows
export let origin
export let server
export let harness
export let cookie = "geneguessr_session=e2e-visitor"
export let requests = []
// What a visit costs on the meters besides Workers requests: Durable Object calls (reads and
// writes of the session), KV reads and puts, and D1 rows.
export const meters = { doReads: 0, doWrites: 0, kvGets: 0 }
export let rewrite = { directUrls: true, tokenRoute: true }
export const setRewrite = (value) => {
  rewrite = value
}
// Bunny Storage's objects (written by the Worker's scheduled job), and what the CDN host answers:
// `up` serves the stored object, `down` fails the connection, `garbage` answers 200 with a page
// that is not JSON, `tampered` serves the object with picture addresses the page must not request.
export const bunny = new Map()
export const board = { mode: "up" }

// A short helix, 12 residues: enough for Mol* to draw a cartoon.
export function helix() {
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
export function swissModelPdb() {
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

export function alphaFoldCif() {
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
export function providerFile(url) {
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
  mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = String(input?.url || input)
    const { host, pathname } = new URL(url)
    if (host === "storage.bunnycdn.com") {
      const key = pathname.slice(`/${STORAGE_ZONE}/`.length)
      if (String(init.method || "GET").toUpperCase() === "PUT") {
        bunny.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()))
        return new Response("{}", { status: 201 })
      }
      return bunny.has(key)
        ? new Response(bunny.get(key), { status: 200 })
        : new Response("not found", { status: 404 })
    }
    if (host === "cdn.discordapp.com") {
      return new Response(AVATAR_PNG, { status: 200, headers: { "Content-Type": "image/png" } })
    }
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
  // guess's aggregate row exists and costs 1 row to bump instead of 2 to create.
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
  // The "Top Streaks" object, written by the Worker's own scheduled job as the cron runs it.
  await worker.scheduled(
    {
      cron: ICONOPLASM_RECURRING_CRON,
      scheduledTime: Date.UTC(2026, 9, 3, 12, ICONOPLASM_BACKGROUND_MINUTES.geneguessrBoard[0]),
    },
    { ...harness.env, ...BUNNY_ENV },
    { waitUntil() {} },
  )
  assert.ok(bunny.has(LEADERBOARD_OBJECT_KEY), "the scheduled job published the board")
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

export function stripDirectUrls(pathname, text) {
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

export const readBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

// The page searches this static file for a guess; its rows are the seeded proteins.
export function proteinIndex() {
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
export const newestTarget = () => [...harness.sessions.values()].at(-1).targetId
// `count` proteins to guess, cycling through the three sources: the first three are one of
// each, the next three the second of each.
export const guessRows = (target, count = 3) => {
  const sources = ["pdb", "swissmodel", "alphafold"]
  const pools = sources.map((source) =>
    rows.filter(
      (row) => row.structure_source === source && row.gene_summary && row.uniprot !== target,
    ),
  )
  return Array.from({ length: count }, (_, index) => pools[index % 3][Math.floor(index / 3)])
}

export function resetMeters() {
  metered.receipts.length = 0
  harness.kvPuts.length = 0
  Object.assign(meters, { doReads: 0, doWrites: 0, kvGets: 0 })
}
export const readMeters = () => ({
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

export function category(line) {
  if (line.startsWith("GET /api/game/bootstrap")) return "bootstrap"
  if (line.startsWith("GET /api/graphics-settings")) return "graphicsSettings"
  if (line.startsWith("GET /api/stats/leaderboard")) return "leaderboard"
  if (line.startsWith("GET /api/avatar")) return "avatar"
  if (line.startsWith("POST /api/game/guess-similarity")) return "similarity"
  if (line.startsWith("POST /api/game/guess")) return "guess"
  if (line.includes("/api/structure-cached?type=target")) return "structureTarget"
  if (line.includes("/api/structure-cached?key=")) return "structureKey"
  if (line.includes("/api/structure-token")) return "structureToken"
  return "other"
}
export function counts(lines) {
  const out = {
    bootstrap: 0,
    graphicsSettings: 0,
    leaderboard: 0,
    avatar: 0,
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

// The CDN host, as `board.mode` says (see above). Every request to it is recorded on the tracker.
export async function answerCdn(route, tracker) {
  const request = route.request()
  const { pathname } = new URL(request.url())
  if (request.method() === "OPTIONS") {
    // A preflight is not a read of the object.
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET",
        "access-control-allow-headers": "*",
      },
    })
  }
  tracker.cdn.push(`${request.method()} ${pathname}`)
  const cors = { "access-control-allow-origin": "*" }
  if (board.mode === "down") return route.abort()
  if (pathname !== `/${LEADERBOARD_OBJECT_KEY}`) {
    return route.fulfill({ status: 404, headers: cors, body: "not found" })
  }
  if (board.mode === "garbage") {
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/html" },
      body: "<html>maintenance</html>",
    })
  }
  const object = JSON.parse(Buffer.from(bunny.get(LEADERBOARD_OBJECT_KEY)).toString("utf8"))
  if (board.mode === "tampered") {
    object.entries[0].avatarUrl = "https://tracker.example/pixel.png"
    object.entries[1].avatarUrl = "javascript:alert(1)"
  }
  return route.fulfill({
    status: 200,
    headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify(object),
  })
}

// A browser context for one visitor. Off-origin requests: Mol* comes from the vendored build, a
// provider answers from a fixture with the CORS header the real ones send (or as `provider`
// says), and everything else is refused. `tracker` records what the page did.
export async function openVisitor(
  browser,
  { visitorCookie, provider = null, viewport = { width: 1200, height: 900 }, noObserver = false },
) {
  cookie = visitorCookie
  const tracker = {
    providerRequests: [],
    providerHeaders: [],
    offOrigin: [],
    cdn: [],
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
      if (hostname === CDN_HOST) return answerCdn(route, tracker)
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
  // What the page passes to `fetch` for a provider's file: the options that decide whether a
  // provider gets credentials or a referrer, and whether a repeat view is the browser cache's
  // (Playwright turns the HTTP cache off while a route is installed, so the repeat view itself
  // cannot be measured here; the options are what the page asks for).
  await context.addInitScript(() => {
    window.__providerFetches = []
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      try {
        const url = new URL(typeof input === "string" ? input : input.url, location.href)
        if (/(^|\.)(rcsb\.org|ebi\.ac\.uk|expasy\.org)$/.test(url.hostname)) {
          window.__providerFetches.push({
            host: url.hostname,
            credentials: init?.credentials,
            referrerPolicy: init?.referrerPolicy,
            cache: init?.cache,
          })
        }
      } catch {}
      return realFetch(input, init)
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

export async function openGame(page) {
  await page.goto(`${origin}/?gg_api=${encodeURIComponent(origin)}`)
  await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
}

// Types a protein's gene symbol, picks the suggestion and waits for its card.
export async function guess(page, row, cardsAfter) {
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
export async function settle(page, tracker, expected, timeoutMs = 40000) {
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
export async function visit(
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
      cdnRequests: [...tracker.cdn],
      ...viewers,
    },
  }
}

// A returning visitor: a session that already holds these guesses with no score (the bootstrap
// scores them). The page opens the newest guess's card, so a load shows two viewers (the target
// and that guess); the visitor then opens the other two cards, and reloads.
export async function returningVisit(browser, { visitorCookie }) {
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

export const chromeAndMolstar = async (t) => {
  if (!existsSync(path.join(MOLSTAR_BUILD, "pdbe-molstar-plugin.js"))) {
    if (process.env.CI) throw new Error("public/static/vendor Mol* build is missing")
    t.skip("the Mol* build is not in public/static/vendor (run pnpm run build)")
    return null
  }
  return launchChrome(t)
}

// The test file Node is running: each of the four saves its measurements under its own name.
const testFile = path.basename(process.argv[1], ".e2e.mjs")
export const measured = {}
export const save = () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, `${testFile}.json`), JSON.stringify(measured, null, 2))
}
export const hostsOf = (urls) => urls.map((url) => new URL(url).hostname).sort()
export const rowWith = (source, result) =>
  rows.find((row) => row.structure_source === source && result.guessed.includes(row.uniprot))

// ---------------------------------------------------------------------------------------------
// B-957: the request budget of a visit. What a visit costs on the free plan is its Worker
// requests (two meter units each), so these tests count them for page load plus 3 and 6
// guesses, on a desktop viewport and on a phone.

export const budget = {}
export const saveBudget = () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, `${testFile}-request-budget.json`), JSON.stringify(budget, null, 2))
}
export const leaderboardShown = (page) =>
  page.evaluate(() => ({
    names: [...document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-name")].map(
      (el) => el.textContent,
    ),
    streaks: [...document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-streak")].map(
      (el) => Number(el.textContent),
    ),
    texts: window.__leaderboardTexts,
  }))
// The pictures in the box: where each comes from, and whether the browser decoded it.
export const picturesDecoded = (page, count) =>
  page.waitForFunction(
    (expected) => {
      const images = [
        ...document.querySelectorAll("#pg-sidebar-leaderboard img.pg-leaderboard-avatar"),
      ]
      return (
        images.length === expected && images.every((img) => img.complete && img.naturalWidth > 0)
      )
    },
    count,
    { timeout: 10000 },
  )
export const leaderboardPictures = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#pg-sidebar-leaderboard img.pg-leaderboard-avatar")].map(
      (img) => ({
        src: img.getAttribute("src").slice(0, 30),
        decoded: img.complete && img.naturalWidth > 0,
      }),
    ),
  )
export const BOARD_READ = `GET /${LEADERBOARD_OBJECT_KEY}`
export const RANKED = {
  names: LEADERBOARD.map((entry) => entry.username),
  streaks: LEADERBOARD.map((entry) => entry.streak),
}
export const rowsShown = () =>
  document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-row").length > 0
