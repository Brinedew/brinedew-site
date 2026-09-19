import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parse as parseToml } from "toml"
import {
  preparePublicReadCutoverConfig,
  verifyPublicReadArtifacts,
  waitForPublicReadArtifacts,
} from "./prepare-iconoplasm-public-read-cutover.mjs"

const configUrl = new URL(
  "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  import.meta.url,
)

test("preparation config keeps legacy public reads Worker-first until artifact proof", async () => {
  const prepared = parseToml(preparePublicReadCutoverConfig(await readFile(configUrl, "utf8")))
  assert.equal(prepared.assets.not_found_handling, "none")
  assert.equal(prepared.assets.run_worker_first, true)
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

test("release prepares publication before it verifies and activates SPA routing", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const prepare = workflow.indexOf("Prepare immutable public-read publication")
  const verify = workflow.indexOf("Verify immutable public-read activation gate")
  const activate = workflow.indexOf("Activate immutable public-read routing")
  assert.equal(prepare > 0, true)
  assert.equal(verify > prepare, true)
  assert.equal(activate > verify, true)
})
