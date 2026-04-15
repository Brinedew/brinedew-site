import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

function createDb(rowsByUniprot) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM proteins/i)
      return {
        bind(uniprot) {
          return {
            async first() {
              return rowsByUniprot[String(uniprot || "").toUpperCase()] || null
            },
          }
        },
      }
    },
  }
}

function createCtx(waits) {
  return {
    waitUntil(promise) {
      waits.push(Promise.resolve(promise))
    },
  }
}

test("structure-cached falls back to stored AlphaFold upstream when R2 reads fail", async () => {
  const waits = []
  const upstreamRequests = []
  const puts = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    upstreamRequests.push({ url: String(input), method: init?.method || "GET" })
    return new Response("alphafold-cif", {
      status: 200,
      headers: { "Content-Type": "chemical/x-cif" },
    })
  }

  try {
    const response = await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/structure-cached?key=alphafold/P11532.cif"),
      {
        DB: createDb({
          P11532: {
            uniprot: "P11532",
            structure_source: "alphafold",
            pdb_id: null,
            alphafold_url: "https://alphafold.example/files/AF-P11532-3-F1-model_v4.cif",
            swissmodel_url: null,
            swissmodel_template: null,
          },
        }),
        STRUCTURES_BUCKET: {
          async get(key) {
            assert.equal(key, "alphafold/P11532.cif")
            throw new Error("Please enable R2 through the Cloudflare Dashboard. (10042)")
          },
          async put(key, body, options) {
            puts.push({
              key,
              byteLength: body?.byteLength || 0,
              contentType: options?.httpMetadata?.contentType || "",
            })
          },
        },
      },
      createCtx(waits),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "chemical/x-cif")
    assert.equal(await response.text(), "alphafold-cif")
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://alphafold.example/files/AF-P11532-3-F1-model_v4.cif",
        method: "GET",
      },
    ])

    await Promise.allSettled(waits)
    assert.equal(puts.length, 1)
    assert.equal(puts[0]?.key, "alphafold/P11532.cif")
    assert.equal(puts[0]?.contentType, "chemical/x-cif")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("structure-cached recovers SWISS-MODEL upstream from stored metadata without client upstream hint", async () => {
  const waits = []
  const upstreamRequests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    upstreamRequests.push({ url: String(input), method: init?.method || "GET" })
    return new Response("swissmodel-cif", {
      status: 200,
      headers: { "Content-Type": "chemical/x-cif" },
    })
  }

  try {
    const response = await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/structure-cached?key=swissmodel/Q9TEST_tpl_A.cif"),
      {
        DB: createDb({
          Q9TEST: {
            uniprot: "Q9TEST",
            structure_source: "swissmodel",
            pdb_id: null,
            alphafold_url: null,
            swissmodel_url: "https://swissmodel.example/download/model.cif",
            swissmodel_template: "tpl/A",
          },
        }),
        STRUCTURES_BUCKET: {
          async get(key) {
            assert.equal(key, "swissmodel/Q9TEST_tpl_A.cif")
            throw new Error("Please enable R2 through the Cloudflare Dashboard. (10042)")
          },
          async put() {},
        },
      },
      createCtx(waits),
    )

    assert.equal(response.status, 200)
    assert.equal(await response.text(), "swissmodel-cif")
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://swissmodel.example/download/model.cif",
        method: "GET",
      },
    ])

    await Promise.allSettled(waits)
  } finally {
    globalThis.fetch = originalFetch
  }
})
