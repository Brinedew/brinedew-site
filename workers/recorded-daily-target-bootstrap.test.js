import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("a recorded daily answer boots after a cache miss without rereading the full protein pool", async () => {
  const today = new Date().toISOString().slice(0, 10)
  const waits = []
  const queries = []
  const kv = new Map([
    [
      `puzzle_actual:${today}`,
      JSON.stringify({ date: today, uniprot_id: "P12345", source: "computed" }),
    ],
  ])
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
                  return uniprot === "P12345"
                    ? {
                        id: 1,
                        uniprot: "P12345",
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
    STRUCTURES_BUCKET: {
      async head() {
        return { size: 1200 }
      },
    },
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

  const response = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/api/game/bootstrap"),
    env,
    {
      waitUntil(promise) {
        waits.push(Promise.resolve(promise))
      },
    },
  )

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload?.status?.date ?? payload?.date, today)
  assert.ok(queries.some((sql) => /SELECT \* FROM proteins WHERE uniprot = \?/i.test(sql)))
  assert.ok(queries.every((sql) => !/gene_surname ASC, p\.uniprot ASC/i.test(sql)))
  assert.equal(JSON.stringify(payload).includes('"P12345"'), false)
  await Promise.allSettled(waits)
})
