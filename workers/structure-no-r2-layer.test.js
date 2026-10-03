// GeneGuessr has no R2 structure cache.
//
// `STRUCTURES_BUCKET` is commented out in the Wrangler configs because R2 is not
// enabled on the account. Every structure path therefore ran its R2 branch against
// `undefined`: `env.STRUCTURES_BUCKET.head(...)` threw a TypeError that was caught and
// ignored on every target and guess token, so a token's `cached` and `sizeBytes` were
// always `false` and `0`; the bucket's get/put, eviction, multipart upload and daily
// pin never ran; three admin purge routes, a cache-stats route and an admin "pin
// structure" step managed a bucket that does not exist. Repeat views are served by
// the browser HTTP cache.
//
// Everything runs through the real Worker against a real local D1 built from the real
// GeneGuessr migrations and seeded with the production shape (19,110 proteins).
//
// Failure modes this file proves, each written before the code that fixes it:
//   T1  a bucket that is bound anyway (someone un-comments the binding) is read,
//       written or listed by a structure path
//   T2  a structure token carries `cached` or `sizeBytes`, fields only the bucket fed
//   T3  a deleted admin or debug route still answers (403 or 200) instead of 404
//   T4  a `STRUCTURES_BUCKET` reference returns to `workers/` outside the Discord recap
//       image fallback, which has its own storage choice (R2 if bound, else Bunny)
//   T5  the admin yearly fill still calls the deleted "pin structure" step
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { ADMIN_HTML } from "./admin-html.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

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

const withSource = (source) => rows.find((row) => row.structure_source === source)

// A bucket that records any use at all: every property read on it, every call.
function spyBucket() {
  const touched = []
  const bucket = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === "then") return undefined
        touched.push(String(name))
        return async () => null
      },
    },
  )
  return { bucket, touched }
}

const PROBE_BODY = "data_structure\nHEADER    MODEL\nATOM  1\n"

async function call(
  path,
  { method = "GET", cookie = null, body = null, sessions = new Map(), bucket = null } = {},
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(PROBE_BODY, { status: 200, headers: { "Content-Type": "chemical/x-cif" } })
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
  try {
    const harness = geneguessrWorkerEnv(meteredDb(db), { sessions })
    if (bucket) harness.env.STRUCTURES_BUCKET = bucket
    const headers = { ...(cookie ? { Cookie: `geneguessr_session=${cookie}` } : {}) }
    if (body) headers["Content-Type"] = "application/json"
    const waits = []
    const response = await worker.fetch(
      new Request(`https://geneguessr.brinedew.bio${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
      harness.env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    await Promise.allSettled(waits)
    const payload = response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : await response.text()
    return { response, payload, ...harness }
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
}

test("T1: a bound R2 bucket is never touched by a structure token, a structure fetch, a bootstrap or a guess", async () => {
  const { bucket, touched } = spyBucket()
  const sessions = new Map()
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const row = withSource(source)
    const token = await call(`/api/structure-token?uniprot=${row.uniprot}`, { bucket })
    assert.equal(token.response.status, 200, source)
    const bytes = await call(
      `/api/structure-cached?key=${encodeURIComponent(token.payload.cacheKey)}`,
      {
        bucket,
      },
    )
    assert.equal(bytes.response.status, 200, `${source}: bytes`)
  }
  const cookie = "no-r2-player"
  const boot = await call("/api/game/bootstrap?practice=1", { cookie, sessions, bucket })
  assert.equal(boot.response.status, 200)
  const target = [...sessions.values()][0].targetId
  const guess = rows.find((row) => row.structure_source === "swissmodel" && row.uniprot !== target)
  const guessed = await call("/api/game/guess?practice=1", {
    method: "POST",
    cookie,
    sessions,
    bucket,
    body: { uniprot: guess.uniprot },
  })
  assert.equal(guessed.response.status, 200)
  assert.deepEqual(touched, [], "the bucket was used")
})

test("T2: no structure token carries `cached` or `sizeBytes`", async () => {
  const sessions = new Map()
  const tokens = []
  for (const source of ["pdb", "swissmodel", "alphafold"]) {
    const { payload } = await call(`/api/structure-token?uniprot=${withSource(source).uniprot}`)
    tokens.push([`/api/structure-token ${source}`, payload])
  }
  const cookie = "no-r2-tokens"
  const boot = await call("/api/game/bootstrap?practice=1", { cookie, sessions })
  tokens.push(["bootstrap target token", boot.payload.targetStructureToken])
  const target = [...sessions.values()][0].targetId
  const guess = rows.find((row) => row.structure_source === "pdb" && row.uniprot !== target)
  const guessed = await call("/api/game/guess?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { uniprot: guess.uniprot },
  })
  tokens.push(["guess token", guessed.payload.guessStructureToken])
  for (const [label, token] of tokens) {
    assert.ok(token?.url, `${label} is a token`)
    assert.equal("cached" in token, false, `${label} carries cached`)
    assert.equal("sizeBytes" in token, false, `${label} carries sizeBytes`)
  }
})

test("T3: the R2 admin and debug routes are gone", async () => {
  const routes = [
    ["POST", "/api/admin/purge-orphan-structures"],
    ["POST", "/api/admin/delete-structure?key=pdb/1ABC.bcif"],
    ["POST", "/api/admin/purge-unreferenced-structures"],
    ["GET", "/api/debug/cache-stats"],
    ["POST", "/api/admin/schedule/availability-replacement/pin-structure"],
  ]
  for (const [method, path] of routes) {
    const { response } = await call(path, { method })
    assert.equal(response.status, 404, `${method} ${path}`)
  }
})

function sourceFiles(directory) {
  return readdirSync(new URL(directory, import.meta.url), { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((entry) => entry.endsWith(".js") && !entry.endsWith(".test.js"))
    .filter((entry) => !entry.startsWith("generated/") && !entry.includes("node_modules/"))
}

test("T4: `STRUCTURES_BUCKET` appears in workers/ only in the Discord recap image fallback", () => {
  const allowed = new Set(["discord.js", "lib/discord-recap-images.js"])
  const offenders = sourceFiles("./").filter(
    (entry) =>
      !allowed.has(entry) &&
      readFileSync(new URL(`./${entry}`, import.meta.url), "utf8").includes("STRUCTURES_BUCKET"),
  )
  assert.deepEqual(offenders, [])
})

test("T5: the admin yearly fill no longer pins a structure in R2", () => {
  assert.doesNotMatch(ADMIN_HTML, /pin-structure|pinAvailabilityReplacementStructure/)
  assert.match(ADMIN_HTML, /\/api\/admin\/schedule\/availability-replacement/)
})
