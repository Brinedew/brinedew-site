import assert from "node:assert/strict"
import test from "node:test"

import {
  createIconoplasmAdminRepublishHandlers,
  REPUBLISH_MAX_SYMBOLS,
} from "./iconoplasm-admin-republish-route.js"

// B-898 deletion stage, step A: the Actions publisher asks the Worker to
// rewrite the stable object of each gene that changed. Failure modes written
// before the code:
// 1. not an administrator -> 403, nothing published;
// 2. no symbols, or more than the per-call bound -> 400, nothing published
//    (the bound keeps one call under the Worker's 50-subrequest ceiling);
// 3. symbols are normalised and de-duplicated, invalid ones dropped;
// 4. one gene failing does not stop the others: the reply names it and the
//    call is still 200, so the caller retries only that gene;
// 5. a withdrawn gene (no card) is reported, not treated as a failure.
function harness({ admin = true, fail = new Set(), withdrawn = new Set() } = {}) {
  const published = []
  const handlers = createIconoplasmAdminRepublishHandlers({
    isAdmin: async () => admin,
    json: (body, status = 200, headers = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    publish: async (env, symbol) => {
      if (fail.has(symbol)) throw new Error(`storage down for ${symbol}`)
      published.push(symbol)
      if (withdrawn.has(symbol)) return { symbol, withdrawn: true, stable: null }
      return {
        symbol,
        withdrawn: false,
        stable: { key: `genes/v3/${symbol}.json`, hash: "e".repeat(64) },
      }
    },
  })
  const call = (body) =>
    handlers["admin_publication.republish"]({
      env: {},
      done: (_name, response) => response,
      request: new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/republish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        },
      ),
    })
  return { call, published }
}

test("a non-administrator is refused and nothing is published", async () => {
  const h = harness({ admin: false })
  assert.equal((await h.call({ symbols: ["TP53"] })).status, 403)
  assert.deepEqual(h.published, [])
})

test("no symbols or too many symbols are refused", async () => {
  const h = harness()
  assert.equal((await h.call({ symbols: [] })).status, 400)
  assert.equal((await h.call("not json")).status, 400)
  const tooMany = Array.from({ length: REPUBLISH_MAX_SYMBOLS + 1 }, (_, i) => `G${i}`)
  assert.equal((await h.call({ symbols: tooMany })).status, 400)
  assert.deepEqual(h.published, [])
})

test("symbols are normalised, de-duplicated and published one by one", async () => {
  const h = harness()
  const response = await h.call({ symbols: ["tp53", "TP53", " a1bg ", "not valid!"] })
  assert.equal(response.status, 200)
  const reply = await response.json()
  assert.deepEqual(h.published, ["TP53", "A1BG"])
  assert.equal(reply.ok, true)
  assert.equal(reply.published, 2)
  assert.equal(reply.failed, 0)
  assert.equal(reply.results[0].stable.key, "genes/v3/TP53.json")
})

test("one failing gene is reported and the others still publish", async () => {
  const h = harness({ fail: new Set(["BRCA1"]) })
  const reply = await (await h.call({ symbols: ["TP53", "BRCA1", "A1BG"] })).json()
  assert.deepEqual(h.published, ["TP53", "A1BG"])
  assert.equal(reply.published, 2)
  assert.equal(reply.failed, 1)
  const failure = reply.results.find((r) => r.symbol === "BRCA1")
  assert.equal(failure.ok, false)
  assert.match(failure.error, /storage down/)
})

test("a withdrawn gene is a result, not a failure", async () => {
  const h = harness({ withdrawn: new Set(["ZZZ3"]) })
  const reply = await (await h.call({ symbols: ["ZZZ3"] })).json()
  assert.equal(reply.failed, 0)
  assert.equal(reply.results[0].withdrawn, true)
})
