import assert from "node:assert/strict"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

test("iconoplasm top-level admin route stays wired instead of silently falling through to 404", async () => {
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/admin", { method: "GET" }),
    {},
    { waitUntil() {} },
  )

  assert.equal(response.status, 403)
  assert.match(await response.text(), /403 Unauthorized/)
})

test("iconoplasm legacy admin path redirects to the apex-hosted ops page instead of going dead", async () => {
  const worker = (await import("./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js")).default
  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/admin/iconoplasm", { method: "GET", redirect: "manual" }),
    {},
    {},
  )

  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), "https://brinedew.bio/admin/iconoplasm#costs")
})

test("admin canon audit derives portrait URLs from asset sha even when legacy key copies are blank", async () => {
  resetIconoplasmRuntimeCachesForTest()

  class FakeStatement {
    constructor(sql) {
      this.sql = String(sql || "")
      this.args = []
    }

    bind(...args) {
      this.args = args
      return this
    }

    async first() {
      if (this.sql.includes("FROM icono_admin_dashboard_summary")) {
        return { summary_key: "iconoplasm_admin_dashboard" }
      }
      throw new Error(`Unexpected SQL in fake admin-routing first(): ${this.sql}`)
    }

    async all() {
      if (this.sql.includes("FROM icono_admin_gene_rollup")) {
        return {
          results: [
            {
              gene_symbol: "TP53",
              current_asset_sha256: "a".repeat(64),
              current_asset_missing: 0,
              admin_override: 0,
              total_assets: 4,
              rejected_assets: 0,
              stale_assets: 0,
              legacy_assets: 0,
              eligible_assets: 3,
              current_resolved_asset_sha256: "a".repeat(64),
              current_r2_key_full: "",
              current_r2_key_medium: "",
              current_r2_key_thumb: "",
              current_status: "approved",
              current_is_stale: 0,
              current_is_legacy: 0,
              current_vision_id: "anima-v1-2001",
              current_artist_tag: "tag-a",
              current_artist_name: "Artist A",
              current_upvotes: 10,
              current_downvotes: 1,
              current_score: 9,
              current_created_at: "2026-04-16T00:00:00Z",
              leader_asset_sha256: "b".repeat(64),
              leader_r2_key_full: "",
              leader_r2_key_medium: "",
              leader_r2_key_thumb: "",
              leader_status: "",
              leader_is_stale: 0,
              leader_is_legacy: 0,
              leader_vision_id: "anima-v1-2002",
              leader_artist_tag: "tag-b",
              leader_artist_name: "Artist B",
              leader_upvotes: 20,
              leader_downvotes: 2,
              leader_score: 18,
              leader_created_at: "2026-04-17T00:00:00Z",
            },
          ],
        }
      }
      if (this.sql.includes("FROM icono_publish_events")) {
        return { results: [] }
      }
      throw new Error(`Unexpected SQL in fake admin-routing all(): ${this.sql}`)
    }

    async run() {
      return { success: true }
    }
  }

  class FakeDb {
    prepare(sql) {
      return new FakeStatement(sql)
    }
  }

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/canon-audit", {
      method: "GET",
      headers: {
        Authorization: "Bearer secret-admin-token",
      },
    }),
    {
      ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
      ICONOPLASM_DB: new FakeDb(),
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.rows?.[0]?.current?.medium_url, `https://iconoplasm.brinedew.bio/portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/medium.webp`)
  assert.equal(payload?.rows?.[0]?.leader?.medium_url, `https://iconoplasm.brinedew.bio/portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/medium.webp`)
})

test("admin assets list derives portrait URLs from asset sha instead of copied key columns", async () => {
  resetIconoplasmRuntimeCachesForTest()

  class FakeStatement {
    constructor(sql) {
      this.sql = String(sql || "")
      this.args = []
    }

    bind(...args) {
      this.args = args
      return this
    }

    async all() {
      if (this.sql.includes("FROM icono_portrait_assets pa")) {
        return {
          results: [
            {
              gene_symbol: "TP53",
              asset_sha256: "c".repeat(64),
              status: "approved",
              autopick_eligible: 1,
              is_stale: 0,
              is_legacy: 0,
              vision_id: "anima-v1-2003",
              artist_tag: "tag-c",
              artist_name: "Artist C",
              created_by: "tester",
              created_at: "2026-04-18T00:00:00Z",
              image_upvotes: 12,
              image_downvotes: 1,
              image_score: 11,
              is_current: 1,
              admin_override: 0,
              is_vote_leader: 0,
            },
          ],
        }
      }
      throw new Error(`Unexpected SQL in fake admin-assets all(): ${this.sql}`)
    }

    async first() {
      throw new Error(`Unexpected SQL in fake admin-assets first(): ${this.sql}`)
    }

    async run() {
      return { success: true }
    }
  }

  class FakeDb {
    prepare(sql) {
      return new FakeStatement(sql)
    }
  }

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/assets", {
      method: "GET",
      headers: {
        Authorization: "Bearer secret-admin-token",
      },
    }),
    {
      ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
      ICONOPLASM_DB: new FakeDb(),
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.assets?.[0]?.medium_url, `https://iconoplasm.brinedew.bio/portraits/v1/${"c".repeat(2)}/${"c".repeat(64)}/medium.webp`)
  assert.equal(payload?.assets?.[0]?.thumb_url, `https://iconoplasm.brinedew.bio/portraits/v1/${"c".repeat(2)}/${"c".repeat(64)}/thumb.webp`)
})
