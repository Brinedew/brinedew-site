import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

for (const source of ["local", "production mirror"]) {
  test(`a ${source} recorded daily answer boots after a cache miss without rereading the full protein pool`, async () => {
    const today = new Date().toISOString().slice(0, 10)
    const targetId = source === "local" ? "P12345" : "P67890"
    const waits = []
    const queries = []
    const actual = JSON.stringify({ date: today, uniprot_id: targetId, source: "computed" })
    const kv = new Map(source === "local" ? [[`puzzle_actual:${today}`, actual]] : [])
    let session = null
    const env = {
      DB: {
        prepare(sql) {
          queries.push(sql)
          if (/SELECT \* FROM proteins WHERE uniprot = \?/i.test(sql)) {
            return {
              bind(uniprot) {
                return {
                  async first() {
                    return uniprot === targetId
                      ? {
                          id: 1,
                          uniprot: targetId,
                          gene: "TEST",
                          gene_surname: "TEST",
                          full_name: "Test protein",
                          length: 100,
                          gene_summary: "A test protein",
                          has_structure: 1,
                          structure_source: "pdb",
                          pdb_id: "1ABC",
                        }
                      : null
                  },
                }
              },
            }
          }
          throw new Error(`Unexpected D1 statement: ${sql}`)
        },
      },
      KV: {
        async get(key, options) {
          const value = kv.get(key) ?? null
          return options?.type === "json" && value ? JSON.parse(value) : value
        },
        async put(key, value) {
          kv.set(key, value)
        },
      },
      ...(source === "production mirror"
        ? {
            PROD_KV: {
              async get(key) {
                return key === `puzzle_actual:${today}` ? actual : null
              },
            },
          }
        : {}),
      GAME_SESSIONS: {
        idFromName(name) {
          return name
        },
        get() {
          return {
            async fetch(_url, init = {}) {
              if (init.method === "POST") {
                session = JSON.parse(init.body)
                return Response.json({ ok: true })
              }
              return Response.json(session)
            },
          }
        },
      },
    }

    // The target's structure is checked before it is served: the provider answers
    // with a usable file.
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(new Uint8Array([0x83, 0xa7, 0x65, 0x6e, 0x63]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      })
    let response
    try {
      response = await worker.fetch(
        new Request("https://geneguessr.brinedew.bio/api/game/bootstrap"),
        env,
        {
          waitUntil(promise) {
            waits.push(Promise.resolve(promise))
          },
        },
      )
    } finally {
      globalThis.fetch = originalFetch
    }

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload?.status?.date ?? payload?.date, today)
    assert.ok(queries.some((sql) => /SELECT \* FROM proteins WHERE uniprot = \?/i.test(sql)))
    assert.ok(queries.every((sql) => !/gene_surname ASC, p\.uniprot ASC/i.test(sql)))
    assert.equal(JSON.stringify(payload).includes(`"${targetId}"`), false)
    await Promise.allSettled(waits)
  })
}
