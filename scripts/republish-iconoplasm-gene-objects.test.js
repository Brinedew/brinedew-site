// B-859: end-to-end test of the one-shot operator script that rewrites every
// gene's stable object (genes/v3/<SYMBOL>.json) so the published objects stop
// carrying the Tags the caretaker panel promises are private.
//
// The script drives the production Worker's admin republish route over about
// 19,023 genes, so a mistake spends meters and leaves the CDN half-rewritten.
// Every way it could go wrong, written down BEFORE the script existed:
//
//   F1  A "dry run" that writes. Dry run is the default and must send no
//       request to the Worker.
//   F2  A batch the real route refuses (more than 8 symbols, a malformed
//       symbol), so the sweep dies on its first call. The test drives the real
//       route handler, not a copy of its limits.
//   F3  A run that cannot be resumed or capped. `--limit` must stop on a gene
//       boundary and name the next symbol; a second run from that symbol must
//       finish the rest, with no gene rewritten twice across the two runs.
//   F4  A repair path that cannot target the genes that failed. `--only` must
//       rewrite exactly those symbols, and refuse a symbol the catalog does not
//       list (a typo would otherwise republish nothing and say "ok").
//   F5  A transient Worker failure (a CPU kill on a cold isolate, a 503) loses a
//       whole batch of 8. It is retried once, then split into single genes; a
//       gene the route reports as failed is listed, never silently skipped, and
//       the rest of the sweep continues.
//   F6  A real outage hammered forever. After too many failed genes the run
//       stops launching batches, drains the ones in flight and says where to
//       resume.
//   F7  Running without the admin token still sends requests (or sends an empty
//       Bearer). It must refuse before the first call.
//   F8  It runs right after the 00:00 UTC reset and spends the day's D1
//       allowance up front (AGENTS.md: spend the allowance at the end of the
//       UTC day). Execute refuses before 20:00 UTC unless the operator names an
//       incident reason, which the receipt records.
//   F9  A mistyped --limit, --from, --concurrency or an unknown option widens or
//       corrupts the sweep. All are refused.
//  F10  Verification trusts a stale cached copy, or misses a Tags subtree in an
//       unexpected place. It reads each object past the cache, polls a flagged
//       one while the CDN purge lands, and walks the JSON for the keys
//       (accepted_tags_derivative, tags_text, fields_json) at any depth.
//  F11  Verification flags prose that merely says "tags_text" and blocks a clean
//       sweep. It checks keys, not substrings.
//  F12  The symbol list comes from a broken source (CDN 503, wrong schema) and
//       the sweep runs over nothing or over junk.
//  F13  The run leaves no record. The receipt is written even when the run
//       stops, so the owner can resume and a later agent can verify.
//  F14  The sweep runs before the fixed Worker is deployed. Every gene would be
//       rewritten with its Tags again and the whole sweep would be wasted. The
//       first batch is read back from the CDN before the rest is sent; if it
//       still carries Tags the run stops after that one call.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  REPUBLISH_MAX_SYMBOLS,
  createIconoplasmAdminRepublishHandlers,
} from "../workers/iconoplasm-admin-republish-route.js"
import {
  LATE_UTC_HOUR,
  createRoutePoster,
  loadCatalogSymbols,
  objectCarriesTags,
  parseRepublishArgs,
  republishGeneObjects,
  verifyGeneObjects,
  writeReceipt,
} from "./republish-iconoplasm-gene-objects.mjs"

const EVENING = new Date("2026-10-03T21:00:00.000Z")
const EARLY = new Date("2026-10-03T05:00:00.000Z")

const SYMBOLS = [
  ...Array.from({ length: 98 }, (_, index) => `G${String(index).padStart(3, "0")}`),
  "HLA-A",
  "C1ORF112",
].sort()

const noSleep = async () => {}

// The real route handler, with a recording publisher standing in for the
// per-gene publisher. `fail(symbol)` makes the publisher throw for a gene, as
// it does when a body fails its integrity check.
function routePoster({
  fail = () => false,
  wholesale = () => false,
  withdrawn = () => false,
} = {}) {
  const published = []
  const calls = []
  const handlers = createIconoplasmAdminRepublishHandlers({
    isAdmin: async () => true,
    json: (body, status = 200) => Response.json(body, { status }),
    publish: async (_env, symbol) => {
      if (fail(symbol)) throw new Error(`Canonical manifestation body failed for ${symbol}`)
      if (withdrawn(symbol)) return { symbol, withdrawn: true, stable: null }
      published.push(symbol)
      return { symbol, withdrawn: false }
    },
  })
  const post = async (symbols) => {
    calls.push([...symbols])
    if (wholesale(symbols, calls.length)) return { status: 503, body: { error: "unavailable" } }
    const response = await handlers["admin_publication.republish"]({
      request: new Request("https://iconoplasm.test/api/iconoplasm/admin/publication/republish", {
        method: "POST",
        body: JSON.stringify({ symbols }),
      }),
      env: {},
      done: (_id, reply) => reply,
    })
    return { status: response.status, body: await response.json() }
  }
  return { post, published, calls }
}

test("F1 a dry run sends nothing and prices the sweep", async () => {
  const { post, calls } = routePoster()
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: false,
    now: EARLY,
    sleep: noSleep,
  })
  assert.equal(calls.length, 0)
  assert.equal(receipt.mode, "dry-run")
  assert.equal(receipt.planned, 100)
  assert.equal(receipt.published, 0)
  assert.equal(receipt.cost.worker_requests, Math.ceil(100 / REPUBLISH_MAX_SYMBOLS))
  assert.equal(receipt.cost.bunny_storage_puts, 100)
  assert.ok(receipt.cost.d1_rows_read_estimate > 0)
  assert.equal(receipt.next_from, SYMBOLS[0], "a dry run leaves the cursor where it started")
})

test("F2 every batch is accepted by the real admin republish route", async () => {
  const { post, published, calls } = routePoster()
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 3,
  })
  assert.equal(receipt.published, 100)
  assert.deepEqual(receipt.failed, [])
  assert.deepEqual([...published].sort(), SYMBOLS)
  assert.ok(calls.length >= 13, "100 genes need at least 13 calls of 8")
  assert.ok(calls.every((batch) => batch.length >= 1 && batch.length <= REPUBLISH_MAX_SYMBOLS))
  assert.equal(new Set(calls.flat()).size, 100, "no gene is sent twice")
})

test("F3 a capped run names where to resume and two runs add up to one sweep", async () => {
  const first = routePoster()
  const one = await republishGeneObjects({
    symbols: SYMBOLS,
    post: first.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    limit: 20,
  })
  assert.equal(one.published, 20)
  assert.equal(one.done, false)
  assert.equal(one.next_from, SYMBOLS[20])

  const second = routePoster()
  const two = await republishGeneObjects({
    symbols: SYMBOLS,
    post: second.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    from: one.next_from,
  })
  assert.equal(two.done, true)
  assert.equal(two.next_from, null)
  assert.equal(two.published, 80)
  assert.deepEqual([...first.published, ...second.published].sort(), SYMBOLS)
  assert.equal(
    new Set([...first.published, ...second.published]).size,
    100,
    "no gene is rewritten by both runs",
  )
})

test("F4 --only rewrites exactly the named genes and refuses an unknown one", async () => {
  const { post, published } = routePoster()
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    only: ["G007", "HLA-A", "G003"],
  })
  assert.deepEqual([...published].sort(), ["G003", "G007", "HLA-A"])
  assert.equal(receipt.planned, 3)
  await assert.rejects(
    republishGeneObjects({
      symbols: SYMBOLS,
      post,
      execute: true,
      now: EVENING,
      sleep: noSleep,
      only: ["G007", "NOT-A-GENE"],
    }),
    (error) => error.code === "ONLY_UNKNOWN_SYMBOL" && /NOT-A-GENE/.test(error.message),
  )
})

test("F5 a failed call is retried once, then split; a failed gene is listed and the sweep goes on", async () => {
  // The first batch fails wholesale on both tries; its genes are then sent one
  // at a time. G002 is refused by the publisher and must be listed.
  const delays = []
  const { post, published, calls } = routePoster({
    fail: (symbol) => symbol === "G002",
    wholesale: (symbols, callNumber) => callNumber <= 2 && symbols.length > 1,
  })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: async (ms) => delays.push(ms),
    concurrency: 1,
  })
  assert.equal(receipt.done, true)
  assert.deepEqual(
    receipt.failed.map((entry) => entry.symbol),
    ["G002"],
  )
  assert.match(receipt.failed[0].error, /integrity|failed/i)
  assert.equal(receipt.published, 99)
  assert.equal(published.includes("G002"), false)
  assert.equal(new Set(published).size, 99)
  assert.deepEqual(calls[0], calls[1], "the same batch was retried once")
  assert.ok(delays.length >= 1 && delays.every((ms) => ms >= 1000), "the retry backs off")
  assert.ok(
    calls.slice(2, 10).every((batch) => batch.length === 1),
    "after two failures the batch is split into single genes",
  )
})

test("F5b a gene the publisher reports as withdrawn is listed, because its old object was not rewritten", async () => {
  const { post } = routePoster({ withdrawn: (symbol) => symbol === "G010" })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
  })
  assert.equal(receipt.published, 99)
  assert.deepEqual(
    receipt.failed.map((entry) => entry.symbol),
    ["G010"],
  )
  assert.match(receipt.failed[0].error, /withdrawn/)
})

test("F6 an outage stops the sweep after a bounded number of failures and says where to resume", async () => {
  const { post, calls } = routePoster({ wholesale: () => true })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
    maxFailures: 10,
  })
  assert.equal(receipt.published, 0)
  assert.equal(receipt.stopped, "too_many_failures")
  assert.equal(receipt.done, false)
  assert.ok(receipt.failed.length >= 10 && receipt.failed.length <= 10 + REPUBLISH_MAX_SYMBOLS)
  assert.ok(calls.length < 60, `an outage must not be hammered (${calls.length} calls)`)
  assert.equal(receipt.next_from, SYMBOLS[0], "nothing succeeded, so resume from the start")
  const resumed = routePoster()
  const finished = await republishGeneObjects({
    symbols: SYMBOLS,
    post: resumed.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    from: receipt.next_from,
  })
  assert.equal(finished.published, 100)
})

test("F7 execute refuses before the first call without an admin token", async () => {
  assert.throws(
    () => createRoutePoster({ origin: "https://iconoplasm.test", token: "" }),
    (error) => error.code === "ADMIN_TOKEN_MISSING",
  )
  assert.throws(
    () => createRoutePoster({ origin: "https://iconoplasm.test", token: "   " }),
    (error) => error.code === "ADMIN_TOKEN_MISSING",
  )
  let seenAuthorization = null
  const poster = createRoutePoster({
    origin: "https://iconoplasm.test",
    token: "test-token-value",
    fetchImpl: async (url, init) => {
      seenAuthorization = init.headers.Authorization
      assert.equal(url, "https://iconoplasm.test/api/iconoplasm/admin/publication/republish")
      assert.equal(init.method, "POST")
      return Response.json({ ok: true, published: 1, failed: 0, results: [] })
    },
  })
  const reply = await poster(["G001"])
  assert.equal(reply.status, 200)
  assert.equal(seenAuthorization, "Bearer test-token-value")
})

test("F8 execute refuses early in the UTC day unless the operator names an incident", async () => {
  const { post, calls } = routePoster()
  assert.equal(LATE_UTC_HOUR, 20)
  await assert.rejects(
    republishGeneObjects({
      symbols: SYMBOLS,
      post,
      execute: true,
      now: EARLY,
      sleep: noSleep,
    }),
    (error) => error.code === "RUN_LATE_IN_THE_UTC_DAY",
  )
  assert.equal(calls.length, 0)
  const allowed = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EARLY,
    sleep: noSleep,
    limit: 8,
    allowEarlyReason: "incident B-859: Tags are public today",
  })
  assert.equal(allowed.early_reason, "incident B-859: Tags are public today")
  assert.equal(allowed.published, 8)
})

test("F9 bad options are refused", () => {
  const ok = parseRepublishArgs([
    "--execute",
    "--limit",
    "500",
    "--from",
    "G010",
    "--concurrency",
    "2",
  ])
  assert.deepEqual(
    { execute: ok.execute, limit: ok.limit, from: ok.from, concurrency: ok.concurrency },
    { execute: true, limit: 500, from: "G010", concurrency: 2 },
  )
  assert.equal(parseRepublishArgs([]).execute, false, "dry run is the default")
  assert.deepEqual(parseRepublishArgs(["--only", "g1,G2"]).only, ["G1", "G2"])
  for (const bad of [
    ["--limit", "0"],
    ["--limit", "-5"],
    ["--limit", "abc"],
    ["--limit", "1.5"],
    ["--from", "bad symbol"],
    ["--concurrency", "0"],
    ["--concurrency", "50"],
    ["--only", ""],
    ["--bogus"],
    ["--limit"],
  ]) {
    assert.throws(() => parseRepublishArgs(bad), Error, `should refuse ${bad.join(" ")}`)
  }
})

function storedObject(extra = {}) {
  return {
    symbol: "TP53",
    canonical_manifestation: { prose: null, public_page_visible: false },
    ...extra,
  }
}

test("F10 verification polls past a stale copy and reports what still carries Tags", async () => {
  const objects = new Map([
    ["G001", [{ status: 200, json: storedObject() }]],
    // Stale for two reads while the purge lands, then clean.
    [
      "G002",
      [
        {
          status: 200,
          json: storedObject({
            canonical_manifestation: { accepted_tags_derivative: { tags_text: "red coat" } },
          }),
        },
        {
          status: 200,
          json: storedObject({
            canonical_manifestation: { accepted_tags_derivative: { tags_text: "red coat" } },
          }),
        },
        { status: 200, json: storedObject() },
      ],
    ],
    // Never clean, with the Tags somewhere unexpected.
    ["G003", [{ status: 200, json: storedObject({ nested: [{ deep: { fields_json: {} } }] }) }]],
    ["G004", [{ status: 404, json: null }]],
  ])
  const reads = []
  const result = await verifyGeneObjects({
    symbols: ["G001", "G002", "G003", "G004"],
    fetchObject: async (symbol, attempt) => {
      reads.push([symbol, attempt])
      const sequence = objects.get(symbol)
      return sequence[Math.min(attempt, sequence.length - 1)]
    },
    sleep: noSleep,
    retries: 4,
    concurrency: 2,
  })
  assert.equal(result.checked, 4)
  assert.deepEqual(result.carrying_tags, ["G003"])
  assert.deepEqual(result.missing, ["G004"])
  assert.equal(result.clean, false)
  assert.ok(reads.some(([symbol, attempt]) => symbol === "G002" && attempt === 2))
  assert.equal(
    reads.filter(([symbol]) => symbol === "G001").length,
    1,
    "a clean object is read once",
  )
})

test("F11 verification checks keys at any depth, not substrings of prose", () => {
  assert.equal(objectCarriesTags(storedObject()), false)
  assert.equal(
    objectCarriesTags(
      storedObject({
        canonical_manifestation: {
          prose: "The accepted_tags_derivative and tags_text of fields_json are private.",
        },
      }),
    ),
    false,
  )
  assert.equal(objectCarriesTags({ canonical_manifestation: null }), false)
  assert.equal(
    objectCarriesTags(
      storedObject({ canonical_manifestation: { accepted_tags_derivative: null } }),
    ),
    true,
    "the key itself is the leak, even when empty",
  )
  assert.equal(objectCarriesTags(storedObject({ a: [{ b: { tags_text: "x" } }] })), true)
  assert.equal(objectCarriesTags(storedObject({ a: [{ b: { fields_json: {} } }] })), true)
})

test("F12 the symbol list must come from a healthy catalog object", async () => {
  const catalog = {
    schema: 3,
    genes: [
      ["g002", "name"],
      ["G001", "name"],
      ["G002", "dup"],
      ["HLA-A", "name"],
    ],
  }
  const symbols = await loadCatalogSymbols({
    cdn: "https://cdn.test",
    fetchImpl: async (url) => {
      assert.match(url, /^https:\/\/cdn\.test\/catalog\/v3\/index\.json\?cb=/)
      return Response.json(catalog)
    },
  })
  assert.deepEqual(symbols, ["G001", "G002", "HLA-A"], "sorted, upper-cased, unique")
  await assert.rejects(
    loadCatalogSymbols({
      cdn: "https://cdn.test",
      fetchImpl: async () => new Response("", { status: 503 }),
    }),
    (error) => error.code === "CATALOG_UNAVAILABLE",
  )
  await assert.rejects(
    loadCatalogSymbols({
      cdn: "https://cdn.test",
      fetchImpl: async () => Response.json({ schema: 2 }),
    }),
    (error) => error.code === "CATALOG_SCHEMA",
  )
  await assert.rejects(
    loadCatalogSymbols({
      cdn: "https://cdn.test",
      fetchImpl: async () => Response.json({ schema: 3, genes: [] }),
    }),
    (error) => error.code === "CATALOG_EMPTY",
  )
})

test("F13 the receipt is written to disk, including for a run that stopped", async () => {
  const { post } = routePoster({ wholesale: () => true })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
    maxFailures: 3,
  })
  const dir = mkdtempSync(path.join(tmpdir(), "republish-receipt-"))
  const file = writeReceipt(dir, { ...receipt, args: { limit: null } })
  assert.deepEqual(readdirSync(dir), [path.basename(file)])
  const written = JSON.parse(readFileSync(file, "utf8"))
  assert.equal(written.stopped, "too_many_failures")
  assert.equal(written.next_from, SYMBOLS[0])
  assert.equal(written.mode, "execute")
})

test("F14 the first batch is read back from the CDN, and Tags still published stop the sweep", async () => {
  const leaking = storedObject({
    canonical_manifestation: { accepted_tags_derivative: { tags_text: "red coat" } },
  })
  const stale = routePoster()
  const stopped = await republishGeneObjects({
    symbols: SYMBOLS,
    post: stale.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 3,
    canary: { fetchObject: async () => ({ status: 200, json: leaking }), retries: 2 },
  })
  assert.equal(stopped.stopped, "tags_still_published")
  assert.equal(stale.calls.length, 1, "only the first batch was sent")
  assert.equal(stopped.published, REPUBLISH_MAX_SYMBOLS)
  assert.equal(stopped.done, false)
  assert.equal(stopped.next_from, SYMBOLS[0], "after the deploy, start again from the beginning")
  assert.ok(stopped.canary.carrying_tags.length >= 1)

  const reads = []
  const healthy = routePoster()
  const finished = await republishGeneObjects({
    symbols: SYMBOLS,
    post: healthy.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 3,
    canary: {
      fetchObject: async (symbol) => {
        reads.push(symbol)
        return { status: 200, json: storedObject() }
      },
      retries: 2,
    },
  })
  assert.equal(finished.published, 100)
  assert.equal(finished.done, true)
  assert.ok(reads.length >= 1 && reads.length <= 3, "a few genes of the first batch are read back")
  assert.ok(reads.every((symbol) => healthy.calls[0].includes(symbol)))
  assert.ok(finished.elapsed_seconds >= 0)
})
