// A guess's structure token names the provider the page loads it from (B-943), and the daily
// target's never does.
//
// A guess is not a secret: the player typed it. So its token carries `directUrl`, the stored
// upstream URL, and the page loads the file from the provider without a Worker request. The
// target's structure must still go through the Worker under an opaque URL, because a provider
// URL, a structure key or an accession would name the answer.
//
// Everything runs through the real Worker against a real local D1 built from the real
// GeneGuessr migrations and seeded with the production shape (19,110 proteins), with `fetch`
// as the providers.
//
// Failure modes this file proves, each written before the code that fixes it:
//   D1  a guess token carries no direct URL, so the page cannot leave the Worker
//   D2  the bootstrap, the guess response and `/api/structure-token?uniprot=` disagree on it
//   D3  it is not the URL the Worker route fetches for the same key, so the direct load and
//       the fallback would show different files
//   D4  a protein with no stored structure, or whose stored URL is off the provider hosts,
//       gets one
//   D5  the target's token carries a direct URL or a key, or any payload before the reveal
//       names the target's accession, structure id or stored URLs (all three sources)
//   D6  the game document's policy and the page do not agree with the Worker on the hosts
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { publicContentSecurityPolicy } from "./lib/the-only-public-document-policy-do-not-duplicate.js"
import { STRUCTURE_PROVIDER_HOSTS } from "../quartz/static/geneguessr/structure-bytes.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"
const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"

let db
let dispose
let rows

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
  await call("/api/game/bootstrap?practice=1", { cookie: "warm-up" })
})
after(async () => {
  await dispose()
})

const withSource = (source, skip = []) =>
  rows.find(
    (row) => row.structure_source === source && row.gene_summary && !skip.includes(row.uniprot),
  )

// One request through the real Worker. `fetch` is the provider network; `fetched` lists what
// the Worker asked it for.
async function call(
  path,
  { method = "GET", cookie = null, body = null, sessions = new Map() } = {},
) {
  const fetched = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    fetched.push(String(url))
    return new Response(PROBE_BODY, { status: 200, headers: { "Content-Type": "chemical/x-cif" } })
  }
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
  try {
    const harness = geneguessrWorkerEnv(meteredDb(db), { sessions })
    const headers = { ...(cookie ? { Cookie: `geneguessr_session=${cookie}` } : {}) }
    if (body) headers["Content-Type"] = "application/json"
    const waits = []
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      harness.env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    await Promise.allSettled(waits)
    const text = await response.clone().text()
    const payload = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text
    return { response, payload, text, fetched }
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
}

// A practice game with a chosen target, then these guesses, then a reload. Returns everything
// the Worker said to the browser on the way, as text.
async function playAgainst(target, guesses, cookie) {
  const sessions = new Map()
  const start = await call("/api/game/practice/start?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { uniprots: [target.uniprot] },
  })
  assert.equal(start.response.status, 200)
  const said = [start.text]
  const tokens = {}
  for (const guess of guesses) {
    const answer = await call("/api/game/guess?practice=1", {
      method: "POST",
      cookie,
      sessions,
      body: { uniprot: guess.uniprot },
    })
    assert.equal(answer.response.status, 200, `guess ${guess.uniprot}`)
    said.push(answer.text)
    tokens[guess.uniprot] = answer.payload.guessStructureToken
  }
  const reload = await call("/api/game/bootstrap?practice=1", { cookie, sessions })
  assert.equal(reload.response.status, 200)
  said.push(reload.text)
  return { start: start.payload, reload: reload.payload, tokens, said }
}

test("D1, D3: a guess token's direct URL is the URL the Worker route fetches for the same key", async () => {
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const row = withSource(source)
    const { response, payload } = await call(`/api/structure-token?uniprot=${row.uniprot}`)
    assert.equal(response.status, 200, source)
    assert.ok(payload.directUrl, `${source}: a direct URL`)
    assert.ok(
      payload.url.startsWith(`${ORIGIN}/api/structure-cached?key=`),
      "the fallback URL stays",
    )

    const viaRoute = await call(`/api/structure-cached?key=${encodeURIComponent(payload.cacheKey)}`)
    assert.equal(viaRoute.response.status, 200, `${source}: the route serves the key`)
    assert.deepEqual(viaRoute.fetched, [payload.directUrl], `${source}: one file, two ways`)
  }
  const pdb = withSource("pdb")
  assert.equal(
    (await call(`/api/structure-token?uniprot=${pdb.uniprot}`)).payload.directUrl,
    `https://models.rcsb.org/v1/${pdb.pdb_id}/full?encoding=bcif&copy_all_categories=false`,
  )
})

test("D2: the bootstrap, the guess response and the token route carry the same token", async () => {
  const target = withSource("pdb")
  const guesses = [
    withSource("pdb", [target.uniprot]),
    withSource("swissmodel"),
    withSource("alphafold"),
  ]
  const game = await playAgainst(target, guesses, "direct-urls-same")
  assert.equal(game.reload.guesses.length, 3)
  for (const entry of game.reload.guesses) {
    const route = await call(`/api/structure-token?uniprot=${entry.uniprot}`)
    assert.ok(entry.structureToken.directUrl, `${entry.uniprot}: the bootstrap's token`)
    assert.deepEqual(entry.structureToken, route.payload, `${entry.uniprot}: bootstrap = route`)
    assert.deepEqual(game.tokens[entry.uniprot], route.payload, `${entry.uniprot}: guess = route`)
  }
})

test("D4: no stored structure and an off-list stored URL give no direct URL", async () => {
  const bare = rows.find((row) => row.structure_source === null)
  assert.equal((await call(`/api/structure-token?uniprot=${bare.uniprot}`)).response.status, 404)

  // One protein per bad URL: the Worker keeps a row it has read in memory, so a row that was
  // read before its URL changed would still answer with the old one.
  const swissRows = rows.filter((row) => row.structure_source === "swissmodel").slice(300, 304)
  const bad = [
    "https://evil.example/model.pdb",
    "http://swissmodel.expasy.org/repository/uniprot/X.pdb",
    "https://user:pw@swissmodel.expasy.org/repository/uniprot/X.pdb",
    "https://swissmodel.expasy.org:8443/repository/uniprot/X.pdb",
  ]
  const update = (url, uniprot) =>
    db.prepare("UPDATE proteins SET swissmodel_url = ? WHERE uniprot = ?").bind(url, uniprot).run()
  try {
    for (const [index, row] of swissRows.entries()) {
      await update(bad[index], row.uniprot)
      const { response, payload } = await call(`/api/structure-token?uniprot=${row.uniprot}`)
      assert.equal(response.status, 200, bad[index])
      assert.equal("directUrl" in payload, false, `${bad[index]}: no direct URL`)
      assert.ok(payload.url.includes("/api/structure-cached?key="), "the Worker route is the way")
      // The route refuses it, as before.
      const viaRoute = await call(
        `/api/structure-cached?key=${encodeURIComponent(payload.cacheKey)}`,
      )
      assert.equal(viaRoute.response.status, 404, `${bad[index]}: the route refuses it too`)
      assert.deepEqual(viaRoute.fetched, [], `${bad[index]}: nothing is fetched`)
    }
  } finally {
    for (const row of swissRows) await update(row.swissmodel_url, row.uniprot)
  }
})

test("D5: before the reveal nothing the Worker sends names the target, whichever source it has", async () => {
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const target = withSource(source)
    const guesses = ["pdb", "swissmodel", "alphafold"].map((guessSource) =>
      withSource(guessSource, [target.uniprot]),
    )
    const game = await playAgainst(target, guesses, `direct-urls-secret-${source}`)

    // The target's own token: opaque, with no direct URL and no key.
    const targetToken = game.reload.targetStructureToken
    assert.ok(targetToken, `${source}: the target still has a token`)
    assert.equal(targetToken.url, `${ORIGIN}/api/structure-cached?type=target&practice=1`)
    for (const field of ["directUrl", "cacheKey", "linkUrl"]) {
      assert.equal(field in targetToken, false, `${source}: the target token has ${field}`)
    }
    assert.ok(!game.reload.targetId, "the target's id is not revealed")

    // Nothing says who the target is. The positive control: every guess's direct URL is there.
    const said = game.said.join("\n")
    for (const guess of guesses) {
      assert.ok(said.includes(game.tokens[guess.uniprot].directUrl), `${guess.uniprot} is named`)
    }
    const secrets = [
      target.uniprot,
      target.pdb_id && `pdb/${target.pdb_id}.`,
      target.pdb_id && `/v1/${target.pdb_id}/`,
      target.pdb_id && `(${target.pdb_id})`,
      target.swissmodel_url,
      target.alphafold_url,
    ].filter(Boolean)
    for (const secret of secrets) {
      assert.ok(!said.includes(secret), `${source} target: the Worker said "${secret}"`)
    }
  }
})

test("D6: the policy, the Worker and the page read one list of provider hosts", async () => {
  const connect = (policy) => policy.match(/connect-src ([^;]*)/)[1].split(" ")
  const game = connect(publicContentSecurityPolicy({ geneguessrGame: true }))
  const other = connect(publicContentSecurityPolicy())
  for (const host of STRUCTURE_PROVIDER_HOSTS) {
    assert.ok(game.includes(`https://${host}`), `the game document may connect to ${host}`)
    assert.ok(!other.includes(`https://${host}`), `no other document may connect to ${host}`)
  }
  assert.deepEqual(
    game.filter((source) => /rcsb|ebi\.ac\.uk|expasy/.test(source)).sort(),
    STRUCTURE_PROVIDER_HOSTS.map((host) => `https://${host}`).sort(),
  )

  const read = (file) => readFile(new URL(file, import.meta.url), "utf8")
  const [upstream, page, owner] = await Promise.all([
    read("./lib/structure-upstream.js"),
    read("../quartz/static/geneguessr/app.js"),
    read("../quartz/static/geneguessr/structure-bytes.js"),
  ])
  assert.match(upstream, /from "\.\.\/\.\.\/quartz\/static\/geneguessr\/structure-bytes\.js"/)
  assert.match(page, /from "\.\/structure-bytes\.js\?v=[0-9a-f]{16}"/)
  // Only the owner names a provider host to fetch from.
  const hostName =
    /models\.rcsb\.org|files\.rcsb\.org|alphafold\.ebi\.ac\.uk|swissmodel\.expasy\.org|pdbe\/model-server/
  assert.match(owner, hostName)
  assert.doesNotMatch(upstream.replace(/^\s*\/\/.*$/gm, ""), hostName, "the Worker door")
  assert.doesNotMatch(page, hostName, "the page")
})
