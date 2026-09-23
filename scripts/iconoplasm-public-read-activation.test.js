import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parse as parseToml } from "toml"
import { matchIconoplasmRouteContract } from "../workers/iconoplasm-route-contract.js"
import * as cutover from "./prepare-iconoplasm-public-read-cutover.mjs"

const { preparePublicReadCutoverConfig, verifyPublicReadArtifacts, waitForPublicReadArtifacts } =
  cutover

const configUrl = new URL(
  "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  import.meta.url,
)

test("preparation retains the live asset bundle and exact pre-cutover route topology", async () => {
  const prepared = parseToml(preparePublicReadCutoverConfig(await readFile(configUrl, "utf8")))
  assert.equal(prepared.routes.length, 1)
  assert.equal(prepared.routes[0].pattern, "iconoplasm.brinedew.bio/*")
  assert.equal(prepared.routes[0].zone_name, "brinedew.bio")
  assert.equal(prepared.preview_urls, false)
  assert.equal(prepared.assets, undefined)
  assert.equal(prepared.unsafe.metadata.keep_assets, true)
  assert.equal(prepared.unsafe.metadata.assets.config.not_found_handling, "none")
  assert.deepEqual(prepared.unsafe.metadata.assets.config.run_worker_first, [
    "/api/*",
    "/blot/*",
    "/portraits/*",
    "/published-cards/v2/immutable/*",
    "/admin*",
    "/blocklist*",
    "/artist-styles*",
    "/health",
    "/gene/*",
    "/genes*",
    "/sitemap*",
    "/robots.txt",
    "/llms.txt",
  ])
})

test("migration progress is read from the existing authenticated owner route", () => {
  const match = matchIconoplasmRouteContract(
    "/api/iconoplasm/admin/gallery/migrate-card-storage/status",
    "GET",
  )
  assert.equal(match?.methodAllowed, true)
  assert.equal(match?.route.auth, "administrator")
})

test("activation gate reads and hashes every advertised compact index", async () => {
  const hash = "a".repeat(64)
  const indexHash = "b".repeat(64)
  const requests = []
  const result = await verifyPublicReadArtifacts({
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      requests.push(pathname)
      if (pathname === "/api/public/v1/card-current")
        return Response.json({ schema_version: 2, current: `ccv2-${hash}` })
      if (pathname.endsWith(`/${hash}.json`))
        return Response.json({
          build_revision: 3,
          storage: "bunny_card_catalog_v2",
          card_count: 2,
          shards: [
            {
              catalog_index: {
                key: `published-cards/v2/immutable/catalogindexes/${indexHash}.json`,
              },
            },
          ],
        })
      return Response.json({
        schema_version: 2,
        pages: [],
        search_entries: [
          ["RB1", "RB transcriptional corepressor 1", 0, 0],
          ["TP53", "tumor protein p53", 0, 1],
        ],
        gallery_entries: [
          ["RB1", 0, 0],
          ["TP53", 0, 1],
        ],
      })
    },
    verifyHash: false,
  })
  assert.deepEqual(result, {
    version: `ccv2-${hash}`,
    geneCount: 2,
    indexCount: 1,
    symbols: ["RB1", "TP53"],
  })
  assert.equal(requests.length, 3)
})

test("activation gate refuses the currently deployed manifest shape", async () => {
  const hash = "a".repeat(64)
  await assert.rejects(
    verifyPublicReadArtifacts({
      fetchImpl: async (url) =>
        new URL(url).pathname === "/api/public/v1/card-current"
          ? Response.json({ schema_version: 2, current: `ccv2-${hash}` })
          : Response.json({
              build_revision: 2,
              storage: "bunny_card_catalog_v2",
              card_count: 19023,
              shards: [{ delivery_indexes: [] }],
            }),
      verifyHash: false,
    }),
    /public read artifacts are not activated/,
  )
})

test("activation gate waits for the CDN head to expose one coherent publication", async () => {
  let checks = 0
  let waits = 0
  const result = await waitForPublicReadArtifacts({
    attempts: 3,
    intervalMs: 1,
    verify: async () => {
      checks += 1
      if (checks < 3) throw new Error("public read artifacts are not activated")
      return { version: "ccv2-ready" }
    },
    wait: async () => {
      waits += 1
    },
  })
  assert.deepEqual(result, { version: "ccv2-ready" })
  assert.equal(checks, 3)
  assert.equal(waits, 2)
})

function migrating({ group = 0, offset = 0, sealOffset = 0 } = {}) {
  return {
    current: "ccv2-old",
    build_revision: 2,
    failure: null,
    job: {
      migration: true,
      group,
      groups: 26,
      offset,
      seal_offset: sealOffset,
      started_at: "2026-09-19T00:00:00.000Z",
    },
  }
}

test("slow migration keeps waiting while monotonic owner receipts make progress", async () => {
  let now = 0
  const statuses = [
    migrating(),
    new Error("transient owner status timeout"),
    migrating({ offset: 6 }),
    migrating({ offset: 12 }),
    migrating({ offset: 12, sealOffset: 128 }),
    { current: "ccv2-new", build_revision: 3, failure: null, job: null },
  ]
  const result = await cutover.waitForPublicationMigration({
    readStatus: async () => {
      const status = statuses.shift()
      if (status instanceof Error) throw status
      return status
    },
    intervalMs: 240_000,
    stallMs: 300_000,
    windowMs: 1_500_000,
    now: () => now,
    wait: async (milliseconds) => {
      now += milliseconds
    },
  })
  assert.equal(result.current, "ccv2-new")
  assert.equal(now, 1_020_000, "status retries are bounded by the remaining stall window")
})

test("an already activated catalog does not restart migration during an unrelated release", async () => {
  let starts = 0
  const status = { current: "ccv2-current", build_revision: 4, failure: null, job: null }

  const result = await cutover.startPublicationMigrationIfRequired({
    readStatus: async () => status,
    startMigration: async () => {
      starts += 1
    },
  })

  assert.equal(result.started, false)
  assert.equal(result.status, status)
  assert.equal(starts, 0)
})

test("a compatibility alias backfill cannot hold an activated catalog release open", async () => {
  let starts = 0
  let reads = 0
  const status = {
    current: "ccv2-current",
    build_revision: 4,
    failure: null,
    job: {
      alias_backfill: true,
      group: 0,
      groups: 29,
      offset: 421,
      started_at: "2026-09-20T04:38:16.168Z",
    },
  }

  const start = await cutover.startPublicationMigrationIfRequired({
    readStatus: async () => status,
    startMigration: async () => {
      starts += 1
    },
  })
  const completed = await cutover.waitForPublicationMigration({
    readStatus: async () => {
      reads += 1
      return status
    },
  })

  assert.equal(start.started, false)
  assert.equal(starts, 0)
  assert.equal(reads, 1)
  assert.equal(completed, status)
})

test("a content rematerialization cannot hold an activated catalog release open", async () => {
  let starts = 0
  let reads = 0
  const status = {
    current: "ccv2-current",
    build_revision: 4,
    failure: null,
    job: {
      rematerialize: true,
      group: 1,
      groups: 29,
      offset: 204,
      started_at: "2026-09-21T07:42:24.151Z",
    },
  }

  const start = await cutover.startPublicationMigrationIfRequired({
    readStatus: async () => status,
    startMigration: async () => {
      starts += 1
    },
  })
  const completed = await cutover.waitForPublicationMigration({
    readStatus: async () => {
      reads += 1
      return status
    },
  })

  assert.equal(start.started, false)
  assert.equal(starts, 0)
  assert.equal(reads, 1)
  assert.equal(completed, status)
})

test("an incomplete catalog starts migration through its existing owner", async () => {
  let starts = 0
  const status = { current: "ccv2-old", build_revision: 2, failure: null, job: null }

  const result = await cutover.startPublicationMigrationIfRequired({
    readStatus: async () => status,
    startMigration: async () => {
      starts += 1
    },
  })

  assert.equal(result.started, true)
  assert.equal(result.status, status)
  assert.equal(starts, 1)
})

test("catalog status tolerates bounded preparation-deploy propagation before deciding", async () => {
  let reads = 0
  let starts = 0
  let waited = 0
  const status = { current: "ccv2-current", build_revision: 4, failure: null, job: null }

  const result = await cutover.startPublicationMigrationIfRequired({
    readStatus: async () => {
      reads += 1
      if (reads < 3) throw new Error("status 503")
      return status
    },
    startMigration: async () => {
      starts += 1
    },
    attempts: 4,
    intervalMs: 250,
    wait: async (milliseconds) => {
      waited += milliseconds
    },
  })

  assert.equal(result.started, false)
  assert.equal(reads, 3)
  assert.equal(starts, 0)
  assert.equal(waited, 500)
})

test("stalled migration fails closed before activation", async () => {
  assert.equal(typeof cutover.releasePublicReadCutover, "function")
  const operations = []
  let now = 0
  await assert.rejects(
    cutover.releasePublicReadCutover({
      deployPreparation: async () => operations.push("deploy-retained-assets"),
      startMigration: async () => operations.push("migrate-existing-owner"),
      waitForMigration: () =>
        cutover.waitForPublicationMigration({
          readStatus: async () => migrating(),
          intervalMs: 60_000,
          stallMs: 180_000,
          windowMs: 600_000,
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds
          },
        }),
      verifyArtifacts: async () => operations.push("verify-bunny"),
      activate: async () => operations.push("activate-production"),
    }),
    /stalled/i,
  )
  assert.deepEqual(operations, ["deploy-retained-assets", "migrate-existing-owner"])
})

test("workflow-window exhaustion preserves retained assets and never activates", async () => {
  const operations = []
  let now = 0
  let offset = 0
  await assert.rejects(
    cutover.releasePublicReadCutover({
      deployPreparation: async () => operations.push("deploy-retained-assets"),
      startMigration: async () => operations.push("migrate-existing-owner"),
      waitForMigration: () =>
        cutover.waitForPublicationMigration({
          readStatus: async () => {
            offset += 6
            return migrating({ offset })
          },
          intervalMs: 60_000,
          stallMs: 180_000,
          windowMs: 240_000,
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds
          },
        }),
      verifyArtifacts: async () => operations.push("verify-bunny"),
      activate: async () => operations.push("activate-production"),
    }),
    /execution window/i,
  )
  assert.deepEqual(operations, ["deploy-retained-assets", "migrate-existing-owner"])
})

test("completed owner migration still requires exact Bunny proof before activation", async () => {
  const operations = []
  await assert.rejects(
    cutover.releasePublicReadCutover({
      deployPreparation: async () => operations.push("deploy-retained-assets"),
      startMigration: async () => operations.push("migrate-existing-owner"),
      waitForMigration: async () => ({ current: "ccv2-new", build_revision: 3, job: null }),
      verifyArtifacts: async () => {
        operations.push("verify-bunny")
        throw new Error("Bunny artifacts incomplete")
      },
      activate: async () => operations.push("activate-production"),
    }),
    /Bunny artifacts incomplete/,
  )
  assert.deepEqual(operations, ["deploy-retained-assets", "migrate-existing-owner", "verify-bunny"])
})

test("activation writes static compatibility artifacts from the verified immutable index first", async () => {
  const operations = []
  const verification = {
    version: `ccv2-${"a".repeat(64)}`,
    geneCount: 2,
    indexCount: 1,
    symbols: ["RB1", "TP53"],
  }
  await cutover.releasePublicReadCutover({
    deployPreparation: async () => operations.push("deploy-retained-assets"),
    startMigration: async () => operations.push("migrate-existing-owner"),
    waitForMigration: async () => operations.push("migration-complete"),
    verifyArtifacts: async () => {
      operations.push("verify-bunny")
      return verification
    },
    prepareStaticCompatibility: async (received) => {
      assert.deepEqual(received, verification)
      operations.push("write-static-sitemap")
    },
    activate: async () => operations.push("activate-production"),
  })
  assert.deepEqual(operations, [
    "deploy-retained-assets",
    "migrate-existing-owner",
    "migration-complete",
    "verify-bunny",
    "write-static-sitemap",
    "activate-production",
  ])
})
