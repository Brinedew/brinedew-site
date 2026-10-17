// B-1090: the public catalogue release, run here instead of in the Worker.
//
// The release behind the public API (resolve, gene search, metadata, the
// extension's scanner, the JSONL dump) rebuilds one artifact from all 19k
// catalogue rows. A free-plan Worker request has 10 ms of CPU, so the admin
// route that used to run it died with "stateful worker unavailable" every
// time it got past its checks, and the public API stayed frozen at the
// 2026-07-30 release (19,023 genes) while the site moved on. This runs the
// Worker's own publishCatalogArtifact under Node, with D1 and KV reached
// through Cloudflare's REST API, so there is one release code path and no CPU
// cap. Readers keep reading the same KV objects as before.
//
// Price per release, measured on the 2026-10-17 nightly copy: 58,151 D1 rows
// read (catalogue, published portraits, policies), 1 D1 row written (the
// recognition receipt), 71 KV writes (64 recognition shards plus the
// catalogue, scanner, hydrated artifact, portrait refs and manifest) of the
// free plan's 1,000 a day, and one Bunny upload (the JSONL dump). The catalog
// job releases only when a gene's symbol, name or UniProt changes, which
// happened twice in the 14 runs before this change.

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const WRANGLER = path.join(
  ROOT,
  "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
)

function need(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function api(pathname) {
  return `https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}${pathname}`
}

function auth(extra = {}) {
  return { Authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`, ...extra }
}

// The Worker's production bindings, read from its wrangler file so the two
// can't drift: the ICONOPLASM_DB id, the KV namespace id and the plain [vars].
export function workerBindings(toml = readFileSync(WRANGLER, "utf8")) {
  const production = toml.split(/^\[env\./m)[0]
  const d1 = production.match(/binding = "ICONOPLASM_DB"[\s\S]*?database_id = "([0-9a-f-]+)"/)
  const kv = production.match(/binding = "KV"\s*\nid = "([0-9a-f]+)"/)
  if (!d1 || !kv)
    throw new Error("ICONOPLASM_DB or KV binding missing from the Worker's wrangler file")
  const vars = {}
  const block = production.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] || ""
  for (const match of block.matchAll(/^([A-Z0-9_]+) = "([^"]*)"\s*$/gm)) vars[match[1]] = match[2]
  return { d1DatabaseId: d1[1], kvNamespaceId: kv[1], vars }
}

// The subset of the D1 binding the release uses: prepare, bind, all, first, run, raw.
export function d1OverHttp(
  databaseId,
  { fetchImpl = fetch, counter = { read: 0, written: 0 } } = {},
) {
  async function query(sql, params) {
    const response = await fetchImpl(api(`/d1/database/${databaseId}/query`), {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sql, params }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.success !== true) {
      throw new Error(
        `D1 query failed (${response.status}): ${JSON.stringify(body?.errors || body)}`,
      )
    }
    const first = Array.isArray(body.result) ? body.result[0] : null
    counter.read += Number(first?.meta?.rows_read) || 0
    counter.written += Number(first?.meta?.rows_written) || 0
    return { results: first?.results || [], meta: first?.meta || {}, success: true }
  }
  function statement(sql, params = []) {
    return {
      bind: (...values) => statement(sql, values),
      all: () => query(sql, params),
      run: () => query(sql, params),
      raw: async () => (await query(sql, params)).results.map((row) => Object.values(row)),
      first: async (column) => {
        const row = (await query(sql, params)).results[0]
        if (row == null) return null
        return column ? (row[column] ?? null) : row
      },
    }
  }
  return { prepare: (sql) => statement(sql), counter }
}

// The subset of the KV binding the release uses: get (text or json) and put.
export function kvOverHttp(
  namespaceId,
  { fetchImpl = fetch, counter = { read: 0, written: 0 } } = {},
) {
  const url = (key) =>
    api(`/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`)
  return {
    counter,
    async get(key, type) {
      const response = await fetchImpl(url(key), { headers: auth() })
      counter.read += 1
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`KV read ${key} failed (${response.status})`)
      const text = await response.text()
      const format = typeof type === "object" ? type?.type : type
      return format === "json" ? JSON.parse(text) : text
    },
    async put(key, value) {
      const response = await fetchImpl(url(key), {
        method: "PUT",
        headers: auth({ "Content-Type": "text/plain; charset=utf-8" }),
        body: value,
      })
      counter.written += 1
      if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`KV write ${key} failed (${response.status}): ${body.slice(0, 200)}`)
      }
    },
  }
}

export async function releaseCatalog({ fetchImpl = fetch } = {}) {
  const { d1DatabaseId, kvNamespaceId, vars } = workerBindings()
  const d1Counter = { read: 0, written: 0 }
  const kvCounter = { read: 0, written: 0 }
  const env = {
    ...vars,
    ICONOPLASM_DB: d1OverHttp(d1DatabaseId, { fetchImpl, counter: d1Counter }),
    KV: kvOverHttp(kvNamespaceId, { fetchImpl, counter: kvCounter }),
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: need(
      "ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD",
    ),
  }
  const { publishCatalogArtifact } =
    await import("../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")
  try {
    const released = await publishCatalogArtifact(env)
    return { ...released, d1: d1Counter, kv: kvCounter }
  } catch (error) {
    // The refusal's own details (which blocklist terms, which aliases) travel
    // with it; on 2026-10-17 a bare message hid the one dead term (BASE) that
    // had frozen the release for eleven weeks.
    return {
      ok: false,
      error: String(error?.message || error).slice(0, 300),
      code: error?.code || null,
      details: error?.details || null,
      d1: d1Counter,
      kv: kvCounter,
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await releaseCatalog()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}
