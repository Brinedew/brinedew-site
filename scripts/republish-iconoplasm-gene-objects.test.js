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
//       route handler, not a copy of its limits. Calls carry 4 genes by
//       default; the route's 8 is its limit, not a target (B-859, 2026-10-03:
//       one call in five at 8 genes was killed by the free plan's CPU cap).
//   F3  A run that cannot be resumed or capped. `--limit` must stop on a gene
//       boundary and name the next symbol; a second run from that symbol must
//       finish the rest, with no gene rewritten twice across the two runs.
//   F4  A repair path that cannot target the genes that failed. `--only` must
//       rewrite exactly those symbols, and refuse a symbol the catalog does not
//       list (a typo would otherwise republish nothing and say "ok").
//   F5  A transient Worker failure (a CPU kill on a cold isolate, a body-less
//       503, a dropped connection) loses a whole batch. It is retried twice with
//       growing pauses, then split into single genes; a gene the route reports
//       as failed is listed, never silently skipped, and the rest of the sweep
//       continues. A refused token stops the run; a refused request is not
//       retried.
//   F6  A real outage hammered forever. After too many failed genes the run
//       stops launching batches, drains the ones in flight and says where to
//       resume. The failed genes are listed apart, and the hint plus that list
//       cover every gene.
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
//  F15  The resume hint is wrong under concurrency: it names the earliest FAILED
//       gene while parallel batches went far beyond it (a shell loop that
//       followed it redid hundreds of genes a round, 2026-10-03), or it names
//       a gene past one that never finished (a skipped gene).
//  F16  `--batch` is mistyped or exceeds the route's limit.
//  F17  `--from-verify` republishes the wrong genes, or nothing while saying ok.
//       It takes exactly the genes a verify receipt listed as carrying Tags and
//       refuses a file that is not a verify receipt.
//  F18  Verification waits once per object, so 10,000 flagged objects take
//       a day. It waits once per round for all of them.
//  F14  The sweep runs before the fixed Worker is deployed. Every gene would be
//       rewritten with its Tags again and the whole sweep would be wasted. The
//       first batch is read back from the CDN before the rest is sent; if it
//       still carries Tags the run stops after that one call.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  REPUBLISH_MAX_SYMBOLS,
  createIconoplasmAdminRepublishHandlers,
} from "../workers/iconoplasm-admin-republish-route.js"
import {
  DEFAULT_BATCH_SYMBOLS,
  LATE_UTC_HOUR,
  RETRY_DELAYS_MS,
  createRoutePoster,
  loadCatalogSymbols,
  objectCarriesTags,
  parseRepublishArgs,
  republishGeneObjects,
  symbolsFromVerifyReceipt,
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
  refuse = null,
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
    // Cloudflare's own answer to a call killed by the CPU cap: no JSON body.
    if (wholesale(symbols, calls.length))
      return { status: 503, body: null, raw: "error code: 1102" }
    if (refuse) {
      const reply = refuse(symbols, calls.length)
      if (reply) return reply
    }
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
  assert.equal(receipt.batch_size, DEFAULT_BATCH_SYMBOLS)
  assert.equal(DEFAULT_BATCH_SYMBOLS, 4)
  assert.equal(receipt.cost.worker_requests, Math.ceil(100 / DEFAULT_BATCH_SYMBOLS))
  assert.ok(receipt.cost.worker_requests_with_retries > receipt.cost.worker_requests)
  assert.equal(receipt.cost.bunny_storage_puts, 100)
  assert.equal(receipt.cost.bunny_purge_calls, undefined, "nothing is purged any more (#460)")
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
  assert.equal(calls.length, 25, "100 genes at 4 a call")
  assert.ok(calls.every((batch) => batch.length >= 1 && batch.length <= DEFAULT_BATCH_SYMBOLS))
  assert.equal(new Set(calls.flat()).size, 100, "no gene is sent twice")

  // The route's own maximum is still accepted when asked for.
  const wide = routePoster()
  const widest = await republishGeneObjects({
    symbols: SYMBOLS,
    post: wide.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    batchSize: REPUBLISH_MAX_SYMBOLS,
  })
  assert.equal(widest.published, 100)
  assert.equal(Math.max(...wide.calls.map((batch) => batch.length)), REPUBLISH_MAX_SYMBOLS)
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

test("F5 a failed call is retried twice with growing pauses, then split; a failed gene is listed and the sweep goes on", async () => {
  // The first batch fails wholesale on its three tries (a body-less 503, as the
  // CPU cap answers); its genes are then sent one at a time. G002 is refused by
  // the publisher and must be listed.
  const delays = []
  const { post, published, calls } = routePoster({
    fail: (symbol) => symbol === "G002",
    wholesale: (symbols, callNumber) => callNumber <= 3 && symbols.length > 1,
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
  assert.deepEqual(calls[0], calls[1], "the same batch was retried")
  assert.deepEqual(calls[0], calls[2], "and retried a second time")
  assert.equal(receipt.retries, 2)
  assert.deepEqual(delays, [...RETRY_DELAYS_MS], "the retries back off, growing")
  assert.ok(delays[0] >= 1000 && delays[1] > delays[0])
  assert.ok(
    calls.slice(3, 3 + DEFAULT_BATCH_SYMBOLS).every((batch) => batch.length === 1),
    "after three failures the batch is split into single genes",
  )
})

test("F5a one failed call that the retry fixes loses no gene and lists nothing", async () => {
  const { post, published, calls } = routePoster({
    wholesale: (_symbols, callNumber) => callNumber === 1 || callNumber === 5,
  })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
  })
  assert.deepEqual(receipt.failed, [])
  assert.equal(receipt.published, 100)
  assert.equal(receipt.retries, 2)
  assert.equal(new Set(published).size, 100)
  assert.equal(calls.length, 25 + 2)
})

test("F5c a body-less 503 is reported as what it is, a refused request is not retried, and a refused token stops the run", async () => {
  const dead = routePoster({ wholesale: () => true })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post: dead.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
    maxFailures: 1,
  })
  assert.match(receipt.failed[0].error, /HTTP 503 \(no JSON body: "error code: 1102"\)/)

  // A 400 from the route is the script's own mistake: trying again cannot help.
  const refused = routePoster({
    refuse: () => ({ status: 400, body: { error: "Provide 1 to 8 gene symbols" } }),
  })
  const bad = await republishGeneObjects({
    symbols: SYMBOLS,
    post: refused.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
    maxFailures: 4,
  })
  assert.equal(bad.stopped, "too_many_failures")
  assert.equal(bad.retries, 0)
  assert.equal(refused.calls.length, 1 + DEFAULT_BATCH_SYMBOLS, "the batch, then each gene once")

  // A refused token stops the run at once, before any batch is marked done.
  const locked = routePoster({ refuse: () => ({ status: 403, body: { error: "Unauthorized" } }) })
  const stopped = await republishGeneObjects({
    symbols: SYMBOLS,
    post: locked.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
  })
  assert.equal(stopped.stopped, "unauthorized")
  assert.equal(stopped.published, 0)
  assert.deepEqual(stopped.failed, [])
  assert.equal(stopped.next_from, SYMBOLS[0], "nothing finished, so resume from the start")
  assert.equal(locked.calls.length, 1)
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

test("F6 an outage stops the sweep after a bounded number of failures; the hint and the failed list together cover every gene", async () => {
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
  assert.ok(receipt.failed.length >= 10 && receipt.failed.length <= 10 + DEFAULT_BATCH_SYMBOLS)
  // Per batch: 3 tries of the batch, then 3 tries of each of its genes.
  assert.ok(calls.length <= 3 * (3 + 3 * DEFAULT_BATCH_SYMBOLS), `${calls.length} calls`)
  assert.equal(
    receipt.next_from,
    SYMBOLS[receipt.failed.length],
    "every batch before the hint reached a final outcome: here, a failed one",
  )
  const failed = receipt.failed.map((entry) => entry.symbol)
  assert.deepEqual(failed, SYMBOLS.slice(0, failed.length))

  // Resume from the hint and re-run the listed genes: every gene is published.
  const resumed = routePoster()
  const finished = await republishGeneObjects({
    symbols: SYMBOLS,
    post: resumed.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    from: receipt.next_from,
  })
  const again = routePoster()
  await republishGeneObjects({
    symbols: SYMBOLS,
    post: again.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    only: failed,
  })
  assert.deepEqual([...resumed.published, ...again.published].sort(), SYMBOLS)
  assert.equal(finished.done, true)
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

  // Cloudflare's own page for a call killed by the CPU cap has no JSON body.
  const killed = createRoutePoster({
    origin: "https://iconoplasm.test",
    token: "test-token-value",
    fetchImpl: async () => new Response("error code: 1102", { status: 503 }),
  })
  assert.deepEqual(await killed(["G001"]), { status: 503, body: null, raw: "error code: 1102" })
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
  assert.equal(parseRepublishArgs([]).batch, DEFAULT_BATCH_SYMBOLS)
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
  assert.equal(
    written.next_from,
    SYMBOLS[DEFAULT_BATCH_SYMBOLS],
    "the first batch finished, failed",
  )
  assert.equal(written.failed.length, DEFAULT_BATCH_SYMBOLS)
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
  assert.equal(stopped.published, DEFAULT_BATCH_SYMBOLS)
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

test("F15 after a stop under concurrency the hint names the first batch that never finished, never an earlier failure and never a skipped gene", async () => {
  // G005 and G040 are refused by the publisher every time. Three batches run at
  // once, and the run stops when the second of them is listed. The old hint was
  // the earliest failure (G005), far behind the batches already done.
  const first = routePoster({ fail: (symbol) => symbol === "G005" || symbol === "G040" })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post: first.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 3,
    maxFailures: 2,
  })
  assert.equal(receipt.stopped, "too_many_failures")
  assert.deepEqual(
    receipt.failed.map((entry) => entry.symbol),
    ["G005", "G040"],
  )
  const hint = SYMBOLS.indexOf(receipt.next_from)
  assert.ok(hint > SYMBOLS.indexOf("G040"), `the hint ${receipt.next_from} is past the frontier`)
  assert.notEqual(receipt.next_from, "G005")
  const sent = new Set(first.calls.flat())
  assert.ok(
    SYMBOLS.slice(0, hint).every((symbol) => sent.has(symbol)),
    "every gene before the hint was sent: none is skipped",
  )
  assert.ok(
    SYMBOLS.slice(hint).every((symbol) => !sent.has(symbol)),
    "no gene at or after the hint was sent: resuming redoes nothing",
  )

  // Resume at the hint, then re-run the two listed genes: every gene is
  // published once, and no gene is published by two runs.
  const second = routePoster()
  await republishGeneObjects({
    symbols: SYMBOLS,
    post: second.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    from: receipt.next_from,
  })
  const third = routePoster()
  await republishGeneObjects({
    symbols: SYMBOLS,
    post: third.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    only: ["G005", "G040"],
  })
  const everything = [...first.published, ...second.published, ...third.published]
  assert.deepEqual([...everything].sort(), SYMBOLS)
  assert.equal(new Set(everything).size, SYMBOLS.length, "no gene is published twice")
})

test("F15b a batch that stopped before it finished is the hint, and the genes before it are untouched", async () => {
  // The token is refused from the sixth call on: five batches finished, the
  // sixth did not.
  const { post, published } = routePoster({
    refuse: (_symbols, callNumber) =>
      callNumber >= 6 ? { status: 403, body: { error: "Unauthorized" } } : null,
  })
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    concurrency: 1,
  })
  assert.equal(receipt.stopped, "unauthorized")
  assert.equal(published.length, 5 * DEFAULT_BATCH_SYMBOLS)
  assert.equal(receipt.next_from, SYMBOLS[5 * DEFAULT_BATCH_SYMBOLS])
  assert.deepEqual(receipt.batches, { total: 25, finished: 5 })
})

test("F16 --batch takes 1 to the route's limit and nothing else", async () => {
  assert.equal(parseRepublishArgs(["--batch", "1"]).batch, 1)
  assert.equal(parseRepublishArgs(["--batch", String(REPUBLISH_MAX_SYMBOLS)]).batch, 8)
  for (const bad of [
    ["--batch", "0"],
    ["--batch", "9"],
    ["--batch", "2.5"],
    ["--batch", "x"],
    ["--batch"],
  ])
    assert.throws(() => parseRepublishArgs(bad), Error, `should refuse ${bad.join(" ")}`)
  const { post, calls } = routePoster()
  await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    batchSize: 1,
    limit: 6,
  })
  assert.deepEqual(
    calls.map((batch) => batch.length),
    [1, 1, 1, 1, 1, 1],
  )
  await assert.rejects(
    republishGeneObjects({
      symbols: SYMBOLS,
      post,
      execute: true,
      now: EVENING,
      sleep: noSleep,
      batchSize: REPUBLISH_MAX_SYMBOLS + 1,
    }),
    (error) => error.code === "BATCH_INVALID",
  )
})

test("F17 --from-verify republishes exactly the genes a verify receipt listed as carrying Tags", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "republish-from-verify-"))
  const file = writeReceipt(dir, {
    mode: "verify",
    started_at: "2026-10-04T20:05:00.000Z",
    checked: 100,
    carrying_tags: ["G050", "g007", "HLA-A", "G050", "not a symbol!"],
    missing: ["G001"],
    unreadable: [],
    clean: false,
  })
  assert.deepEqual(symbolsFromVerifyReceipt(file), ["G007", "G050", "HLA-A"])

  const { post, published } = routePoster()
  const receipt = await republishGeneObjects({
    symbols: SYMBOLS,
    post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    only: symbolsFromVerifyReceipt(file),
  })
  assert.deepEqual([...published].sort(), ["G007", "G050", "HLA-A"])
  assert.equal(receipt.planned, 3)

  // `--from` resumes inside the same list.
  const inside = routePoster()
  await republishGeneObjects({
    symbols: SYMBOLS,
    post: inside.post,
    execute: true,
    now: EVENING,
    sleep: noSleep,
    only: ["G007", "G050", "HLA-A"],
    from: "G050",
  })
  assert.deepEqual([...inside.published].sort(), ["G050", "HLA-A"])

  // A file that is not a verify receipt, or lists nothing, is refused.
  const executed = writeReceipt(dir, { mode: "execute", started_at: "2026-10-04T20:06:00.000Z" })
  assert.throws(
    () => symbolsFromVerifyReceipt(executed),
    (error) => error.code === "NOT_A_VERIFY_RECEIPT",
  )
  const clean = writeReceipt(dir, {
    mode: "verify",
    started_at: "2026-10-04T20:07:00.000Z",
    carrying_tags: [],
    clean: true,
  })
  assert.throws(
    () => symbolsFromVerifyReceipt(clean),
    (error) => error.code === "VERIFY_RECEIPT_CLEAN",
  )
  assert.throws(
    () => symbolsFromVerifyReceipt(path.join(dir, "missing.json")),
    (error) => error.code === "VERIFY_RECEIPT_UNREADABLE",
  )
  writeFileSync(path.join(dir, "junk.json"), "{nope")
  assert.throws(
    () => symbolsFromVerifyReceipt(path.join(dir, "junk.json")),
    (error) => error.code === "VERIFY_RECEIPT_UNREADABLE",
  )

  assert.equal(parseRepublishArgs(["--execute", "--from-verify", "r.json"]).fromVerify, "r.json")
  for (const bad of [
    ["--only", "A", "--from-verify", "r.json"],
    ["--verify", "--from-verify", "r.json"],
    ["--verify", "--only", "A"],
    ["--from-verify"],
  ])
    assert.throws(() => parseRepublishArgs(bad), Error, `should refuse ${bad.join(" ")}`)
})

test("F18 verification waits once per round for every flagged object, not once per object", async () => {
  const symbols = Array.from({ length: 60 }, (_, index) => `V${String(index).padStart(3, "0")}`)
  const leaking = storedObject({
    canonical_manifestation: { accepted_tags_derivative: null },
  })
  const reads = new Map()
  const sleeps = []
  const result = await verifyGeneObjects({
    symbols,
    // V000 to V029 are stale for the first round and clean after it; the rest
    // never clear.
    fetchObject: async (symbol, round) => {
      reads.set(symbol, (reads.get(symbol) ?? 0) + 1)
      return { status: 200, json: round >= 1 && symbol < "V030" ? storedObject() : leaking }
    },
    sleep: async (ms) => sleeps.push(ms),
    retries: 2,
    retryDelayMs: 65_000,
    concurrency: 8,
  })
  assert.deepEqual(result.carrying_tags, symbols.slice(30))
  assert.equal(result.clean, false)
  assert.deepEqual(sleeps, [65_000, 65_000], "two waits for sixty objects")
  assert.equal(reads.get("V000"), 2, "an object that cleared is not read again")
  assert.equal(reads.get("V059"), 3, "a flagged one is read once per round")

  const quiet = []
  const clean = await verifyGeneObjects({
    symbols,
    fetchObject: async () => ({ status: 200, json: storedObject() }),
    sleep: async (ms) => quiet.push(ms),
    retries: 2,
  })
  assert.equal(clean.clean, true)
  assert.deepEqual(quiet, [], "a clean catalog is read once and never waited for")
})
