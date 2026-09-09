import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { createIconoplasmAdminPublicationHandlers } from "../workers/iconoplasm-admin-publication-routes.js"
import { readCatalogStateRows } from "../workers/iconoplasm/sync-state-selection.js"

// Diagnostic only. Execute the real handler and SQL-producing source functions
// with a local SQLite adapter. No Worker, Cloudflare credential or network call.
// Returned SQL rows are measured here, not Cloudflare billable rows_read.
const source = readFileSync(
  new URL("../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js", import.meta.url),
  "utf8",
)
function extractFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"))
  assert.ok(start >= 0, `missing source function: ${name}`)
  const tail = source.slice(start)
  const end = tail.indexOf("\n}\n")
  assert.ok(end >= 0, `missing function end: ${name}`)
  return tail.slice(0, end + 2)
}
const normalizeSymbol = (value) => String(value || "").trim().toUpperCase()
const sanitizeText = (value, maximum) => String(value || "").slice(0, maximum)
const coerceBoolean = (value) => Boolean(value)
const normalizers = {
  normalizeSymbol,
  sanitizeText,
  coerceBoolean,
  normalizeUniprot: (value) => value || null,
  normalizeHexColor: (value) => value || null,
  normalizeCatalogAliases: (value) => typeof value === "string" ? JSON.parse(value) : value,
  // Hashing is not the measured dependency; preserve its call and deterministic
  // output while testing exact SQL, cardinality and repeated request behavior.
  hashCatalogItems: async (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  readCatalogStateRows,
}
const functions = new Function(
  ...Object.keys(normalizers),
  ["loadCatalogRowsForPublish", "fetchCatalogState", "fetchCatalogStateRows"]
    .map(extractFunction).join("\n") + "\nreturn { fetchCatalogState, fetchCatalogStateRows };",
)(...Object.values(normalizers))
const unused = () => { throw new Error("unrelated service reached") }
const handler = createIconoplasmAdminPublicationHandlers({
  ...functions,
  actor: unused,
  coerceBoolean,
  fetchEssenceStateRows: unused,
  fetchManifestationStateRows: unused,
  isAdmin: async () => true,
  json: (payload, status) => Response.json(payload, { status }),
  mutationLimiterSnapshot: unused,
  normalizeCatalogPayloadItem: unused,
  normalizeEssencePayload: unused,
  normalizeSymbol,
  prepareGeneEssenceUpsertStatement: unused,
  publishCatalogArtifact: unused,
  rebuildSharedGeneDiscoveryRollup: unused,
  sanitizeText,
  syncAdminReadModels: unused,
})["admin_publication.catalog_state"]

async function measure(size) {
  const sql = new DatabaseSync(":memory:")
  sql.exec("CREATE TABLE icono_gene_catalog (gene_symbol TEXT PRIMARY KEY, full_name TEXT, uniprot TEXT, color_hex TEXT, tmh INTEGER, aliases_json TEXT)")
  const insert = sql.prepare("INSERT INTO icono_gene_catalog VALUES (?, ?, NULL, NULL, 0, '[]')")
  sql.exec("BEGIN")
  for (let index = 0; index < size; index++) insert.run(`GENE${String(index).padStart(6, "0")}`, `Gene ${index}`)
  sql.exec("COMMIT")
  const queries = []
  const db = {
    prepare(query) {
      let arguments_ = []
      return {
        bind(...values) { arguments_ = values; return this },
        async all() {
          const results = sql.prepare(query).all(...arguments_)
          const plan = sql.prepare("EXPLAIN QUERY PLAN " + query).all(...arguments_).map((row) => row.detail)
          queries.push({ query, returned_rows: results.length, plan })
          return { results }
        },
      }
    },
  }
  async function call(method, payload) {
    queries.length = 0
    const response = await handler({
      request: new Request("https://example.invalid/api/iconoplasm/admin/catalog/state", {
        method,
        ...(method === "POST" ? { body: JSON.stringify(payload), headers: { "content-type": "application/json" } } : {}),
      }),
      env: { ICONOPLASM_DB: db },
      done: (_label, response) => response,
    })
    return { status: response.status, sql_calls: queries.length,
      returned_rows: queries.reduce((total, query) => total + query.returned_rows, 0),
      plans: queries.map((query) => query.plan) }
  }
  const first = await call("GET")
  const repeat = await call("GET")
  const scoped = await call("POST", { symbols: ["GENE000000"] })
  const invalid = await call("POST", { symbols: [] })
  assert.equal(first.status, 200)
  assert.equal(first.returned_rows, size)
  assert.equal(repeat.returned_rows, size)
  assert.equal(scoped.status, 200)
  assert.equal(scoped.returned_rows, 1)
  assert.equal(invalid.status, 400)
  assert.equal(invalid.sql_calls, 0)
  sql.close()
  return { catalog_size: size, get: first, repeat_get: repeat, scoped_post: scoped, empty_post: invalid }
}
const before = await measure(19023)
const after = await measure(79023)
assert.equal(after.get.returned_rows - before.get.returned_rows, 60000)
assert.equal(after.scoped_post.returned_rows, before.scoped_post.returned_rows)
console.log(JSON.stringify({ source_question: "remaining full-table catalog GET after POST scope validation", metrics: "local SQLite returned rows; not provider billing", before, after }, null, 2))
