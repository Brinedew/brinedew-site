import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parse as parseToml } from "toml"
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
          card_count: 19023,
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
        search_entries: [],
        gallery_entries: [],
      })
    },
    verifyHash: false,
  })
  assert.deepEqual(result, { version: `ccv2-${hash}`, geneCount: 19023, indexCount: 1 })
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

test("migration verification deadline is derived from catalog work instead of a short constant", () => {
  assert.equal(typeof cutover.migrationVerificationPlan, "function")
  assert.deepEqual(cutover.migrationVerificationPlan(19_023), {
    cardCount: 19_023,
    prepareRounds: 3_171,
    sealRounds: 26,
    controlRounds: 2,
    cadenceMs: 1_000,
    propagationMs: 60_000,
    intervalMs: 10_000,
    deadlineMs: 3_259_000,
    attempts: 327,
  })
})

test("failed artifact verification leaves production on the retained pre-cutover assets", async () => {
  assert.equal(typeof cutover.releasePublicReadCutover, "function")
  const operations = []
  await assert.rejects(
    cutover.releasePublicReadCutover({
      deployPreparation: async () => operations.push("deploy-retained-assets"),
      currentCardCount: async () => 19_023,
      startMigration: async () => operations.push("migrate-existing-owner"),
      verify: async () => {
        operations.push("verify-bunny")
        throw new Error("Bunny artifacts incomplete")
      },
      activate: async () => operations.push("activate-production"),
    }),
    /Bunny artifacts incomplete/,
  )
  assert.deepEqual(operations, ["deploy-retained-assets", "migrate-existing-owner", "verify-bunny"])
})
