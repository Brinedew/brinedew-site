import assert from "node:assert/strict"
import test from "node:test"

import { republishGenes } from "./publish-iconoplasm-catalog.mjs"

// B-1055: a catalogue delivery dirties a thousand genes in one run. Failure modes:
// 1. a batch killed by the 10 ms CPU cap twice throws the whole run, and the held
//    watermark makes every later run throw on the same genes;
// 2. a gene that never republishes is silently dropped from its object;
// 3. a per-gene result the route reports as failed is lost.
function cpuCappedRoute({ alwaysFails = new Set() } = {}) {
  const calls = []
  return {
    calls,
    async post(symbols) {
      calls.push(symbols.join(","))
      // Four-gene calls die at the cap; single-gene calls fit.
      if (symbols.length > 1) return { ok: false, status: 503, body: null }
      if (alwaysFails.has(symbols[0])) return { ok: false, status: 503, body: null }
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          published: 1,
          results: [{ symbol: symbols[0], ok: symbols[0] !== "BADROW" }],
        },
      }
    },
  }
}

const noWait = async () => {}

test("a batch the CPU cap kills is retried, then republished one gene a call", async () => {
  const route = cpuCappedRoute()
  const symbols = ["ADGRE4P", "BADROW", "C10ORF143", "PABIR3", "ZNF892"]

  const result = await republishGenes(symbols, { post: route.post, sleep: noWait })

  assert.equal(result.published, 5)
  // Three tries of each four-gene batch, then one call per gene: nothing is skipped.
  assert.deepEqual(route.calls.slice(0, 3), Array(3).fill("ADGRE4P,BADROW,C10ORF143,PABIR3"))
  assert.equal(route.calls.filter((call) => !call.includes(",")).length, 5)
  // A per-gene failure the route reports is kept in the receipt.
  assert.deepEqual(result.failed, [{ symbol: "BADROW", ok: false }])
})

test("a gene that fails every try fails the run instead of vanishing", async () => {
  const route = cpuCappedRoute({ alwaysFails: new Set(["PABIR3"]) })
  await assert.rejects(
    republishGenes(["C10ORF143", "PABIR3"], { post: route.post, sleep: noWait }),
    /Republish of PABIR3 failed after retries \(503\)/,
  )
})
