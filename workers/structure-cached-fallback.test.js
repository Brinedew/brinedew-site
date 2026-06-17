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

function createGameSessions(state) {
  let savedState = state
  return {
    get savedState() {
      return savedState
    },
    idFromName(name) {
      return name
    },
    get() {
      return {
        async fetch(_input, init = {}) {
          if ((init.method || "GET") === "POST") {
            savedState = JSON.parse(init.body)
            return Response.json({ success: true })
          }
          return Response.json(savedState || null)
        },
      }
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
      new Request(
        "https://geneguessr.brinedew.bio/api/structure-cached?key=swissmodel/Q9TEST_tpl_A.cif",
      ),
      {
        DB: createDb({
          Q9TEST: {
            uniprot: "Q9TEST",
            structure_source: "pdb",
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

test("target structure endpoint uses the session-pinned target structure selection", async () => {
  // Regression guard for the 2026-05-19 Mol* crash.
  //
  // The target structure endpoint must use the exact structure selection pinned
  // in session state. In this fixture the DB row is intentionally misleading:
  // it contains a SWISS-MODEL URL even though the session says the player was
  // shown RCSB PDB BCIF. The correct result is to fetch the pinned RCSB BCIF
  // bytes. If this test ever starts fetching the SWISS-MODEL URL, the server is
  // again able to tell the browser one format and serve another.
  const waits = []
  const upstreamRequests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    upstreamRequests.push({ url: String(input), method: init?.method || "GET" })
    return new Response(new Uint8Array([0x83, 0xa7, 0x65, 0x6e, 0x63]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    })
  }
  const gameSessions = createGameSessions({
    date: "2026-05-19",
    targetId: "P24534",
    targetStructureMeta: {
      source: "pdb",
      r2Key: "pdb/1B64.bcif",
      upstreamUrl: "https://models.rcsb.org/v1/1B64/full?encoding=bcif&copy_all_categories=false",
      shortLabel: "RCSB PDB",
      displayLabel: "RCSB PDB (1B64)",
      format: "bcif",
    },
  })

  try {
    const response = await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/structure-cached?type=target", {
        headers: { Cookie: "geneguessr_session=test-session" },
      }),
      {
        GAME_SESSIONS: gameSessions,
        DB: createDb({
          P24534: {
            uniprot: "P24534",
            gene: "EEF1B2",
            structure_source: "pdb",
            pdb_id: "1B64",
            alphafold_url: null,
            swissmodel_url:
              "https://swissmodel.expasy.org/repository/uniprot/P24534.pdb?range=2-88&template=5dqs&provider=pdb",
            swissmodel_template: "5dqs",
          },
        }),
        KV: {
          async get() {
            return null
          },
          async put() {},
          async delete() {},
        },
      },
      createCtx(waits),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "application/octet-stream")
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://models.rcsb.org/v1/1B64/full?encoding=bcif&copy_all_categories=false",
        method: "GET",
      },
    ])
    assert.equal(gameSessions.savedState.targetStructureMeta.r2Key, "pdb/1B64.bcif")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("target structure endpoint ignores stale KV structure-source overrides when DB has a current stored source", async () => {
  // Regression guard for stale KV winning over the current database row.
  //
  // Live failure details:
  // - UniProt P24534 had a stale KV entry at `structure_source:P24534` pointing
  //   to `swissmodel/P24534_5dqs.pdb`.
  // - The current D1 row said `structure_source='pdb'` and `pdb_id='1B64'`.
  // - Bootstrap advertised `RCSB PDB` and `format='bcif'`.
  // - `/api/structure-cached?type=target` trusted KV and served PDB text.
  //
  // This test uses a synthetic UniProt ID to avoid pollution from the in-memory
  // protein cache shared by this worker module during the test process. The
  // scenario is the same: DB says PDB, KV lies and says SWISS-MODEL. The DB must
  // win, the stale KV value must be overwritten, and no availability probe may
  // fall back to SWISS-MODEL before the real fetch.
  const waits = []
  const upstreamRequests = []
  const kvWrites = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    upstreamRequests.push({
      url: String(input),
      method: init.method || "GET",
      range: init.headers?.Range,
    })
    return new Response(new Uint8Array([0x83, 0xa7, 0x65, 0x6e, 0x63]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    })
  }
  const gameSessions = createGameSessions({
    date: "2026-05-19",
    targetId: "P9KVST",
  })

  try {
    const response = await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/structure-cached?type=target", {
        headers: { Cookie: "geneguessr_session=test-session" },
      }),
      {
        GAME_SESSIONS: gameSessions,
        DB: createDb({
          P9KVST: {
            uniprot: "P9KVST",
            gene: "EEF1B2",
            structure_source: "pdb",
            pdb_id: "1B64",
            alphafold_url: null,
            swissmodel_url:
              "https://swissmodel.expasy.org/repository/uniprot/P24534.pdb?range=2-88&template=5dqs&provider=pdb",
            swissmodel_template: "5dqs",
          },
        }),
        KV: {
          async get() {
            return {
              source: "swissmodel",
              r2Key: "swissmodel/P9KVST_5dqs.pdb",
              upstreamUrl:
                "https://swissmodel.expasy.org/repository/uniprot/P24534.pdb?range=2-88&template=5dqs&provider=pdb",
              shortLabel: "SWISS-MODEL",
              displayLabel: "SWISS-MODEL (P9KVST_5dqs)",
              format: "pdb",
            }
          },
          async put(key, value) {
            kvWrites.push({ key, value: JSON.parse(value) })
          },
          async delete() {},
        },
      },
      createCtx(waits),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "application/octet-stream")
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://models.rcsb.org/v1/1B64/full?encoding=bcif&copy_all_categories=false",
        method: "GET",
        range: undefined,
      },
    ])
    assert.equal(gameSessions.savedState.targetStructureMeta.r2Key, "pdb/1B64.bcif")
    assert.equal(kvWrites[0]?.key, "structure_source:P9KVST")
    assert.equal(kvWrites[0]?.value.r2Key, "pdb/1B64.bcif")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("target structure endpoint repairs stale session-pinned target metadata from the pre-fix incident", async () => {
  // Old browser profiles can keep the same server-side Durable Object session
  // even after the Worker is fixed. During the live incident, that session may
  // have been backfilled with SWISS-MODEL PDB metadata for a target whose current
  // DB row says RCSB PDB BCIF. A hard browser reload cannot clear that because
  // it is not HTTP cache or IndexedDB; it is server-side session state. The
  // endpoint must detect the contradiction and overwrite the stale pin.
  //
  // This is intentionally framed as a cross-system regression, not just a
  // GeneGuessr structure regression. Any app that stores long-lived state in a
  // server-side session can show the same browser-specific symptom: Browser A
  // works, Browser B fails, and cache-clearing advice is useless because the
  // broken value is keyed by Browser B's cookie inside a Durable Object. The
  // correct fix is a compatibility check/migration at the boundary where the old
  // state is read.
  const waits = []
  const upstreamRequests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    upstreamRequests.push({ url: String(input), method: init.method || "GET" })
    return new Response(new Uint8Array([0x83, 0xa7, 0x65, 0x6e, 0x63]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    })
  }
  const gameSessions = createGameSessions({
    date: "2026-05-19",
    targetId: "P9EDGE",
    targetStructureMeta: {
      source: "swissmodel",
      r2Key: "swissmodel/P9EDGE_5dqs.pdb",
      upstreamUrl:
        "https://swissmodel.expasy.org/repository/uniprot/P24534.pdb?range=2-88&template=5dqs&provider=pdb",
      shortLabel: "SWISS-MODEL",
      displayLabel: "SWISS-MODEL (P9EDGE_5dqs)",
      format: "pdb",
    },
  })

  try {
    const response = await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/structure-cached?type=target", {
        headers: { Cookie: "geneguessr_session=edge-session" },
      }),
      {
        GAME_SESSIONS: gameSessions,
        DB: createDb({
          P9EDGE: {
            uniprot: "P9EDGE",
            gene: "EEF1B2",
            structure_source: "pdb",
            pdb_id: "1B64",
            alphafold_url: null,
            swissmodel_url:
              "https://swissmodel.expasy.org/repository/uniprot/P24534.pdb?range=2-88&template=5dqs&provider=pdb",
            swissmodel_template: "5dqs",
          },
        }),
        KV: {
          async get() {
            return null
          },
          async put() {},
          async delete() {},
        },
      },
      createCtx(waits),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "application/octet-stream")
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://models.rcsb.org/v1/1B64/full?encoding=bcif&copy_all_categories=false",
        method: "GET",
      },
    ])
    assert.equal(gameSessions.savedState.targetStructureMeta.source, "pdb")
    assert.equal(gameSessions.savedState.targetStructureMeta.r2Key, "pdb/1B64.bcif")
    assert.equal(gameSessions.savedState.targetStructureMeta.format, "bcif")
  } finally {
    globalThis.fetch = originalFetch
  }
})
