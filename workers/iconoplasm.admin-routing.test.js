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

test("admin asset repair scope reads the durable broken backlog instead of probing storage live", async () => {
  resetIconoplasmRuntimeCachesForTest()

  const missingSha = "d".repeat(64)
  const healthySha = "e".repeat(64)

  class FakePortraitBucket {
    async head() {
      throw new Error("repair scope should not HEAD portrait storage")
    }
  }

  class FakeStatement {
    constructor(db, sql) {
      this.db = db
      this.sql = String(sql || "")
      this.args = []
    }

    bind(...args) {
      this.args = args
      return this
    }

    async first() {
      if (this.sql.includes("FROM icono_storage_audit_queue_state")) {
        return this.db.queueState
      }
      if (this.sql.includes("COUNT(*) AS candidate_assets")) {
        return this.db.summaryBaseline()
      }
      if (this.sql.includes("storage_queue_backlog_assets")) {
        return this.db.queueAggregate()
      }
      if (this.sql.includes("FROM icono_website_truth_summary")) {
        return this.db.summaryRow
      }
      throw new Error(`Unexpected SQL in durable repair-scope first(): ${this.sql}`)
    }

    async all() {
      if (this.sql.includes("FROM icono_storage_audit_queue q") && this.sql.includes("q.audit_state = 'broken'")) {
        return { results: this.db.brokenRows() }
      }
      throw new Error(`Unexpected SQL in durable repair-scope all(): ${this.sql}`)
    }

    async run() {
      if (this.sql.includes("INSERT INTO icono_website_truth_summary")) {
        const [
          summaryKey,
          candidateAssets,
          staleAssets,
          legacyAssets,
          publishedLivePortraits,
          auditedAssets,
          verifiedRenderableImages,
          storageAuditCoveragePercent,
          storageIncompleteAssets,
          brokenLiveImages,
          renderableLiveConfirmed,
          unverifiedLivePortraits,
          renderableLiveExactKnown,
          lastExactAuditTotal,
          lastExactAuditAt,
          storageQueueBacklogAssets,
          storageQueueSeededComplete,
          storageAuditStatusNote,
        ] = this.args
        this.db.summaryRow = {
          summary_key: summaryKey,
          candidate_assets: candidateAssets,
          stale_assets: staleAssets,
          legacy_assets: legacyAssets,
          published_live_portraits: publishedLivePortraits,
          audited_assets: auditedAssets,
          verified_renderable_images: verifiedRenderableImages,
          storage_audit_coverage_percent: storageAuditCoveragePercent,
          storage_incomplete_assets: storageIncompleteAssets,
          broken_live_images: brokenLiveImages,
          renderable_live_confirmed: renderableLiveConfirmed,
          unverified_live_portraits: unverifiedLivePortraits,
          renderable_live_exact_known: renderableLiveExactKnown,
          last_exact_audit_total: lastExactAuditTotal,
          last_exact_audit_at: lastExactAuditAt,
          storage_queue_backlog_assets: storageQueueBacklogAssets,
          storage_queue_seeded_complete: storageQueueSeededComplete,
          storage_audit_status_note: storageAuditStatusNote,
          updated_at: "2026-04-20T00:00:00Z",
        }
        return { success: true }
      }
      throw new Error(`Unexpected SQL in durable repair-scope run(): ${this.sql}`)
    }
  }

  class FakeDb {
    constructor() {
      this.portraitAssets = [
        {
          gene_symbol: "TP53",
          asset_sha256: missingSha,
          status: "approved",
          is_stale: 0,
          is_legacy: 0,
          created_at: "2026-04-19T00:00:00Z",
          is_current: 1,
        },
        {
          gene_symbol: "EGFR",
          asset_sha256: healthySha,
          status: "approved",
          is_stale: 0,
          is_legacy: 0,
          created_at: "2026-04-18T00:00:00Z",
          is_current: 0,
        },
      ]
      this.queueRows = [
        {
          gene_symbol: "TP53",
          asset_sha256: missingSha,
          asset_status: "approved",
          is_stale: 0,
          is_legacy: 0,
          is_current: 1,
          created_at: "2026-04-19T00:00:00Z",
          audit_state: "broken",
          status: "completed",
          missing_renditions_json: JSON.stringify(["full", "medium", "thumb"]),
          last_audited_at: "2026-04-20T00:00:00Z",
          attempts: 0,
        },
        {
          gene_symbol: "EGFR",
          asset_sha256: healthySha,
          asset_status: "approved",
          is_stale: 0,
          is_legacy: 0,
          is_current: 0,
          created_at: "2026-04-18T00:00:00Z",
          audit_state: "renderable",
          status: "completed",
          missing_renditions_json: "[]",
          last_audited_at: "2026-04-20T00:00:00Z",
          attempts: 0,
        },
      ]
      this.queueState = {
        queue_key: "iconoplasm_storage_audit",
        seed_status: "complete",
        last_seeded_symbol: "TP53",
        processed_symbols: 2,
        total_symbols: 2,
        seeded_complete: 1,
        last_error: "",
        started_at: "2026-04-20T00:00:00Z",
        updated_at: "2026-04-20T00:00:00Z",
        completed_at: "2026-04-20T00:00:00Z",
      }
      this.summaryRow = null
    }

    summaryBaseline() {
      return {
        candidate_assets: this.portraitAssets.length,
        auditable_assets: this.portraitAssets.length,
        stale_assets: 0,
        legacy_assets: 0,
        published_live_portraits: this.portraitAssets.filter((row) => row.is_current).length,
      }
    }

    queueAggregate() {
      return {
        audited_assets: this.queueRows.filter((row) => row.audit_state !== "unknown").length,
        verified_renderable_images: this.queueRows.filter((row) => row.audit_state === "renderable").length,
        storage_incomplete_assets: this.queueRows.filter((row) => row.audit_state === "broken").length,
        broken_live_images: this.queueRows.filter((row) => row.audit_state === "broken" && row.is_current).length,
        renderable_live_confirmed: this.queueRows.filter((row) => row.audit_state === "renderable" && row.is_current).length,
        storage_queue_backlog_assets: this.queueRows.filter((row) => row.audit_state === "unknown").length,
      }
    }

    brokenRows() {
      return this.queueRows
        .filter((row) => row.audit_state === "broken")
        .map((row) => ({
          gene_symbol: row.gene_symbol,
          asset_sha256: row.asset_sha256,
          status: row.asset_status,
          is_stale: row.is_stale,
          is_legacy: row.is_legacy,
          is_current: row.is_current,
          created_at: row.created_at,
          last_audited_at: row.last_audited_at,
          missing_renditions_json: row.missing_renditions_json,
        }))
    }

    prepare(sql) {
      return new FakeStatement(this, sql)
    }
  }

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/assets/repair-scope", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "backlog-batch", limit: 25 }),
    }),
    {
      ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
      ICONOPLASM_DB: new FakeDb(),
      ICONOPLASM_PORTRAITS: new FakePortraitBucket(),
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.count, 1)
  assert.equal(payload?.assets?.[0]?.symbol, "TP53")
  assert.equal(payload?.assets?.[0]?.asset_sha256, missingSha)
  assert.deepEqual(payload?.assets?.[0]?.missing_renditions, ["full", "medium", "thumb"])
  assert.equal(payload?.summary?.broken_live_images, 1)
  assert.equal(payload?.summary?.renderable_live_exact_known, true)
})

test("admin asset storage audit consumes queued work and refreshes the persisted truth summary", async () => {
  resetIconoplasmRuntimeCachesForTest()

  const brokenSha = "f".repeat(64)
  const healthySha = "a".repeat(64)

  class FakePortraitBucket {
    async head(key) {
      if (key.includes(brokenSha)) return null
      if (key.includes(healthySha)) return { key }
      throw new Error(`Unexpected key in fake storage-audit bucket: ${key}`)
    }
  }

  class FakeStatement {
    constructor(db, sql) {
      this.db = db
      this.sql = String(sql || "")
      this.args = []
    }

    bind(...args) {
      this.args = args
      return this
    }

    async first() {
      if (this.sql.includes("FROM icono_storage_audit_queue_state")) {
        return this.db.queueState
      }
      if (this.sql.includes("COUNT(*) AS candidate_assets")) {
        return this.db.summaryBaseline()
      }
      if (this.sql.includes("storage_queue_backlog_assets")) {
        return this.db.queueAggregate()
      }
      if (this.sql.includes("FROM icono_website_truth_summary")) {
        return this.db.summaryRow
      }
      throw new Error(`Unexpected SQL in durable storage-audit first(): ${this.sql}`)
    }

    async all() {
      if (this.sql.includes("FROM icono_storage_audit_queue q") && this.sql.includes("q.audit_state = 'unknown'")) {
        return {
          results: this.db.queueRows
            .filter((row) => row.audit_state === "unknown")
            .map((row) => ({
              gene_symbol: row.gene_symbol,
              asset_sha256: row.asset_sha256,
              status: row.asset_status,
              is_stale: row.is_stale,
              is_legacy: row.is_legacy,
              is_current: row.is_current,
              created_at: row.created_at,
              attempts: row.attempts || 0,
            })),
        }
      }
      throw new Error(`Unexpected SQL in durable storage-audit all(): ${this.sql}`)
    }

    async run() {
      if (this.sql.includes("INSERT OR IGNORE INTO icono_storage_audit_queue") && this.sql.includes("last_audited_at")) {
        return { success: true }
      }
      if (this.sql.includes("UPDATE icono_storage_audit_queue") && this.sql.includes("last_audited_at = COALESCE")) {
        const payload = JSON.parse(String(this.args[0] || "[]"))
        for (const item of Array.isArray(payload) ? payload : []) {
          const row = this.db.queueRows.find(
            (candidate) =>
              candidate.gene_symbol === item.gene_symbol && candidate.asset_sha256 === item.asset_sha256,
          )
          if (!row) {
            throw new Error(`Missing queue row for ${item.gene_symbol}|${item.asset_sha256}`)
          }
          row.status = "completed"
          row.audit_state = item.audit_state
          row.missing_renditions_json = item.missing_renditions_json
          row.is_current = item.is_current
          row.is_stale = item.is_stale
          row.is_legacy = item.is_legacy
          row.asset_status = item.asset_status
          row.created_at = item.created_at
          row.last_audited_at = item.last_audited_at
          row.attempts = 0
        }
        return { success: true }
      }
      if (this.sql.includes("INSERT INTO icono_storage_audit_queue") && this.sql.includes("last_audited_at")) {
        const payload = JSON.parse(String(this.args[0] || "[]"))
        for (const item of Array.isArray(payload) ? payload : []) {
          const row = this.db.queueRows.find(
            (candidate) =>
              candidate.gene_symbol === item.gene_symbol && candidate.asset_sha256 === item.asset_sha256,
          )
          if (!row) {
            throw new Error(`Missing queue row for ${item.gene_symbol}|${item.asset_sha256}`)
          }
          row.status = "completed"
          row.audit_state = item.audit_state
          row.missing_renditions_json = item.missing_renditions_json
          row.is_current = item.is_current
          row.is_stale = item.is_stale
          row.is_legacy = item.is_legacy
          row.asset_status = item.asset_status
          row.created_at = item.created_at
          row.last_audited_at = item.last_audited_at
          row.attempts = 0
        }
        return { success: true }
      }
      if (this.sql.includes("INSERT INTO icono_website_truth_summary")) {
        const [
          summaryKey,
          candidateAssets,
          staleAssets,
          legacyAssets,
          publishedLivePortraits,
          auditedAssets,
          verifiedRenderableImages,
          storageAuditCoveragePercent,
          storageIncompleteAssets,
          brokenLiveImages,
          renderableLiveConfirmed,
          unverifiedLivePortraits,
          renderableLiveExactKnown,
          lastExactAuditTotal,
          lastExactAuditAt,
          storageQueueBacklogAssets,
          storageQueueSeededComplete,
          storageAuditStatusNote,
        ] = this.args
        this.db.summaryRow = {
          summary_key: summaryKey,
          candidate_assets: candidateAssets,
          stale_assets: staleAssets,
          legacy_assets: legacyAssets,
          published_live_portraits: publishedLivePortraits,
          audited_assets: auditedAssets,
          verified_renderable_images: verifiedRenderableImages,
          storage_audit_coverage_percent: storageAuditCoveragePercent,
          storage_incomplete_assets: storageIncompleteAssets,
          broken_live_images: brokenLiveImages,
          renderable_live_confirmed: renderableLiveConfirmed,
          unverified_live_portraits: unverifiedLivePortraits,
          renderable_live_exact_known: renderableLiveExactKnown,
          last_exact_audit_total: lastExactAuditTotal,
          last_exact_audit_at: lastExactAuditAt,
          storage_queue_backlog_assets: storageQueueBacklogAssets,
          storage_queue_seeded_complete: storageQueueSeededComplete,
          storage_audit_status_note: storageAuditStatusNote,
          updated_at: "2026-04-20T00:00:00Z",
        }
        return { success: true }
      }
      throw new Error(`Unexpected SQL in durable storage-audit run(): ${this.sql}`)
    }
  }

  class FakeDb {
    constructor() {
      this.portraitAssets = [
        {
          gene_symbol: "TP53",
          asset_sha256: brokenSha,
          status: "approved",
          is_stale: 0,
          is_legacy: 0,
          created_at: "2026-04-19T00:00:00Z",
          is_current: 1,
        },
        {
          gene_symbol: "EGFR",
          asset_sha256: healthySha,
          status: "approved",
          is_stale: 0,
          is_legacy: 0,
          created_at: "2026-04-18T00:00:00Z",
          is_current: 0,
        },
      ]
      this.queueRows = [
        {
          gene_symbol: "TP53",
          asset_sha256: brokenSha,
          asset_status: "approved",
          is_stale: 0,
          is_legacy: 0,
          is_current: 1,
          created_at: "2026-04-19T00:00:00Z",
          audit_state: "unknown",
          status: "queued",
          missing_renditions_json: "[]",
          last_audited_at: "",
          attempts: 0,
        },
        {
          gene_symbol: "EGFR",
          asset_sha256: healthySha,
          asset_status: "approved",
          is_stale: 0,
          is_legacy: 0,
          is_current: 0,
          created_at: "2026-04-18T00:00:00Z",
          audit_state: "unknown",
          status: "queued",
          missing_renditions_json: "[]",
          last_audited_at: "",
          attempts: 0,
        },
      ]
      this.queueState = {
        queue_key: "iconoplasm_storage_audit",
        seed_status: "complete",
        last_seeded_symbol: "TP53",
        processed_symbols: 2,
        total_symbols: 2,
        seeded_complete: 1,
        last_error: "",
        started_at: "2026-04-20T00:00:00Z",
        updated_at: "2026-04-20T00:00:00Z",
        completed_at: "2026-04-20T00:00:00Z",
      }
      this.summaryRow = null
    }

    summaryBaseline() {
      return {
        candidate_assets: this.portraitAssets.length,
        auditable_assets: this.portraitAssets.length,
        stale_assets: 0,
        legacy_assets: 0,
        published_live_portraits: this.portraitAssets.filter((row) => row.is_current).length,
      }
    }

    queueAggregate() {
      return {
        audited_assets: this.queueRows.filter((row) => row.audit_state !== "unknown").length,
        verified_renderable_images: this.queueRows.filter((row) => row.audit_state === "renderable").length,
        storage_incomplete_assets: this.queueRows.filter((row) => row.audit_state === "broken").length,
        broken_live_images: this.queueRows.filter((row) => row.audit_state === "broken" && row.is_current).length,
        renderable_live_confirmed: this.queueRows.filter((row) => row.audit_state === "renderable" && row.is_current).length,
        storage_queue_backlog_assets: this.queueRows.filter((row) => row.audit_state === "unknown").length,
      }
    }

    prepare(sql) {
      return new FakeStatement(this, sql)
    }
  }

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/assets/storage-audit", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "backlog-batch", limit: 50 }),
    }),
    {
      ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
      ICONOPLASM_DB: new FakeDb(),
      ICONOPLASM_PORTRAITS: new FakePortraitBucket(),
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.count, 2)
  assert.equal(payload?.audited_assets, 2)
  assert.equal(payload?.summary?.verified_renderable_images, 1)
  assert.equal(payload?.summary?.broken_live_images, 1)
  assert.equal(payload?.summary?.renderable_live_confirmed, 0)
  assert.equal(payload?.summary?.unverified_live_portraits, 0)
  assert.equal(payload?.summary?.storage_queue_backlog_assets, 0)
})
