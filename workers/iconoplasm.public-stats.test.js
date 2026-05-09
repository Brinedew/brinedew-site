import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeKv {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
    this.puts = []
  }

  async get(key) {
    return this.entries.get(String(key)) || null
  }

  async put(key, value) {
    this.puts.push({ key: String(key), value: String(value) })
    this.entries.set(String(key), String(value))
  }
}

class ThrowingDb {
  prepare(sql) {
    throw new Error(`public stats must not read D1: ${sql}`)
  }
}

function ctx() {
  return { waitUntil() {} }
}

test("public stats expose named candidate and canonical counts without D1", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/stats"),
      {
        ICONOPLASM_DB: new ThrowingDb(),
        KV: new FakeKv({
          "iconoplasm:catalog-manifest": JSON.stringify({
            gene_count: 19023,
          }),
          "iconoplasm:public-stats:v1": JSON.stringify({
            schema_version: "iconoplasm.publicStats.v1",
            gene_count: 19023,
            canonical_blot_count: 19090,
            generated_candidate_blot_count: 39548,
            auditable_candidate_blot_count: 39179,
            storage_verified_candidate_blot_count: 21889,
            storage_audit_coverage_percent: 55.9,
            updated_at: "2026-05-03 13:02:48",
          }),
        }),
      },
      ctx(),
    )

  assert.equal(response.status, 200)
  assert.match(response.headers.get("Cache-Control") || "", /max-age=86400/)
  const payload = await response.json()
  assert.equal(payload.gene_count, 19023)
  assert.equal(payload.canonical_blot_count, 19090)
  assert.equal(payload.generated_candidate_blot_count, 39548)
  assert.equal(payload.public_copy, "19,023 genes · 39,548 AI blots")
  assert.equal(payload.published_live_portraits, undefined)
  assert.equal(payload.portrait_hash, undefined)
})

test("admin asset summary refresh writes public stats projection to KV", async () => {
  const kv = new FakeKv({
    "iconoplasm:catalog-manifest": JSON.stringify({
      gene_count: 19023,
    }),
  })
  const db = {
    prepare(sql) {
      const text = String(sql || "")
      return {
        bind() {
          return this
        },
        async first() {
          if (text.includes("COUNT(*) AS candidate_assets")) {
            assert.match(
              text,
              /AS published_live_portraits,\s*\(\s*SELECT COUNT\(\*\)[\s\S]*AS catalog_published_live_portraits/,
            )
            return {
              candidate_assets: 39548,
              catalog_candidate_assets: 39481,
              auditable_assets: 39179,
              catalog_auditable_assets: 39112,
              stale_assets: 0,
              legacy_assets: 0,
              catalog_published_live_portraits: 19023,
              published_live_portraits: 19090,
            }
          }
          if (text.includes("FROM icono_storage_audit_queue_state")) {
            return {
              queue_key: "iconoplasm_storage_audit",
              seed_status: "running",
              processed_symbols: 100,
              total_symbols: 19160,
              seeded_complete: 0,
            }
          }
          if (text.includes("storage_queue_backlog_assets")) {
            return {
              audited_assets: 21889,
              verified_renderable_images: 21889,
              storage_incomplete_assets: 0,
              broken_live_images: 0,
              renderable_live_confirmed: 18545,
              storage_queue_backlog_assets: 6054,
            }
          }
          if (text.includes("FROM icono_website_truth_summary")) return null
          throw new Error(`unexpected first SQL: ${text}`)
        },
        async run() {
          if (text.includes("INSERT INTO icono_website_truth_summary")) return { success: true }
          throw new Error(`unexpected run SQL: ${text}`)
        },
      }
    },
  }

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/assets/summary", {
        headers: { Authorization: "Bearer secret-admin-token" },
      }),
      {
        ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
        ICONOPLASM_DB: db,
        KV: kv,
      },
      ctx(),
    )

  assert.equal(response.status, 200)
  const written = kv.puts.find((entry) => entry.key === "iconoplasm:public-stats:v1")
  assert.ok(written, "admin summary refresh should publish a public stats projection")
  const projected = JSON.parse(written.value)
  assert.equal(projected.generated_candidate_blot_count, 39481)
  assert.equal(projected.auditable_candidate_blot_count, 39112)
  assert.equal(projected.canonical_blot_count, 19023)
  assert.equal(projected.gene_count, 19023)
})

test("admin public stats audit exposes catalog versus canonical drift", async () => {
  const db = {
    prepare(sql) {
      const text = String(sql || "")
      return {
        bind() {
          return this
        },
        async first() {
          if (text.includes("catalog_gene_rows")) {
            return {
              catalog_gene_rows: 19023,
              canonical_blot_rows: 19090,
              canonical_distinct_symbols: 19090,
              catalog_genes_with_canonical: 19023,
              catalog_candidate_assets: 39481,
              catalog_auditable_assets: 39112,
              catalog_genes_without_canonical: 0,
              canonical_symbols_missing_from_catalog: 67,
            }
          }
          throw new Error(`unexpected first SQL: ${text}`)
        },
        async all() {
          if (text.includes("gc.gene_symbol IS NULL")) {
            return {
              results: [
                {
                  gene_symbol: "OLD1",
                  current_asset_sha256:
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  updated_at: "2026-05-03 13:00:00",
                  updated_by: "sync",
                },
              ],
            }
          }
          if (text.includes("GROUP BY upper(gene_symbol)")) return { results: [] }
          throw new Error(`unexpected all SQL: ${text}`)
        },
      }
    },
  }

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/public-stats/audit", {
        headers: { Authorization: "Bearer secret-admin-token" },
      }),
      {
        ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
        ICONOPLASM_DB: db,
      },
      ctx(),
    )

  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.catalog_gene_rows, 19023)
  assert.equal(payload.canonical_blot_rows, 19090)
  assert.equal(payload.catalog_candidate_assets, 39481)
  assert.equal(payload.catalog_auditable_assets, 39112)
  assert.equal(payload.canonical_symbols_missing_from_catalog, 67)
  assert.equal(payload.canonical_minus_catalog_delta, 67)
  assert.deepEqual(
    payload.missing_from_catalog_sample.map((row) => row.gene_symbol),
    ["OLD1"],
  )
})
