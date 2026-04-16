import assert from "node:assert/strict"
import test from "node:test"

import { searchProteins } from "./lib/protein-store.js"

function makeDb({ allResults = [] } = {}) {
  const calls = []
  const allQueue = Array.isArray(allResults) ? allResults.slice() : []
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: null }
      calls.push(call)
      return {
        bind(...bindings) {
          call.bindings = bindings
          return {
            all: async () => allQueue.shift() || { results: [] },
            run: async () => ({ success: true }),
            first: async () => null,
          }
        },
        all: async () => allQueue.shift() || { results: [] },
        run: async () => ({ success: true }),
        first: async () => null,
      }
    },
  }
}

test("protein search queries the FTS index instead of broad LIKE scans", async () => {
  const db = makeDb({
    allResults: [
      {
        results: [
          {
            uniprot: "P04637",
            gene: "TP53",
            full_name: "Cellular tumor antigen p53",
            length: 393,
            match_rank: 0,
            relevance: -1.25,
          },
        ],
      },
    ],
  })

  const results = await searchProteins(db, "tp53", 5, ["Q99999"])

  assert.equal(results.length, 1)
  assert.equal(results[0].hgnc, "TP53")

  const searchQuery = db.calls.find((entry) => entry.sql.includes("FROM protein_search"))
  assert.ok(searchQuery, "expected the protein search query to hit the FTS table")
  assert.match(searchQuery.sql, /protein_search MATCH \?/)
  assert.match(searchQuery.sql, /bm25\(protein_search\)/)
  assert.match(searchQuery.sql, /sf\.uniprot = p\.uniprot/)
  assert.match(searchQuery.sql, /p\.uniprot NOT IN/)
  assert.doesNotMatch(searchQuery.sql, /lower\(p\.full_name\) LIKE/)
  assert.doesNotMatch(searchQuery.sql, /lower\(p\.gene\) LIKE/)

  assert.ok(searchQuery.bindings.includes("tp53*"))
})

test("protein search tokenizes punctuation-heavy queries into an FTS prefix query", async () => {
  const db = makeDb({ allResults: [{ results: [] }] })

  const results = await searchProteins(db, "HLA-DRA", 5)

  assert.deepEqual(results, [])
  const searchQuery = db.calls.find((entry) => entry.sql.includes("FROM protein_search"))
  assert.ok(searchQuery, "expected the protein search query to run")
  assert.ok(searchQuery.bindings.includes("HLA* DRA*"))
})

test("protein search fails loud when the search index query errors", async () => {
  const db = {
    prepare(sql) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS structure_failures")) {
        return {
          run: async () => ({ success: true }),
        }
      }
      return {
        bind() {
          return {
            all: async () => {
              throw new Error("no such table: protein_search")
            },
          }
        },
      }
    },
  }

  await assert.rejects(
    () => searchProteins(db, "TP53", 5),
    /no such table: protein_search/,
  )
})
