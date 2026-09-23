import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import test from "node:test"
import { parse as parseToml } from "toml"
import { prepareIconoplasmEdgeAssets } from "../scripts/prepare-iconoplasm-edge-assets.mjs"
import { preparePublicReadCutoverConfig } from "../scripts/prepare-iconoplasm-public-read-cutover.mjs"
import { proveAnonymousRouteTopology } from "../scripts/lib/iconoplasm-static-topology-proof.mjs"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"))

async function makeAssetFixture() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-assets-"))
  const sourceRoot = path.join(temporaryRoot, "public")
  const outputRoot = path.join(temporaryRoot, "public-iconoplasm-edge")
  await mkdir(path.join(sourceRoot, "apps", "iconoplasm"), { recursive: true })
  await mkdir(path.join(sourceRoot, "static"), { recursive: true })
  await cp(
    path.join(repoRoot, "quartz", "static", "iconoplasm"),
    path.join(sourceRoot, "static", "iconoplasm"),
    { recursive: true },
  )
  const shell = `<!doctype html><script type="module" src="/static/iconoplasm/app.js"></script>`
  for (const page of ["index", "privacy", "license", "caretaker-terms"])
    await writeFile(path.join(sourceRoot, "apps", "iconoplasm", `${page}.html`), shell)
  await writeFile(path.join(sourceRoot, "favicon.ico"), "fixture")
  const summary = await prepareIconoplasmEdgeAssets({
    sourceRoot,
    outputRoot,
    publicationIndexes: [
      {
        schema_version: 2,
        search_entries: [["TP53", "tumor protein p53", 0, 0]],
      },
    ],
  })
  assert.ok(summary.fileCount > 10, "the prepared bundle contains the actual Iconoplasm modules")
  return { temporaryRoot, outputRoot }
}

test(
  "real workerd routes the mutable blot and first-party portrait fallback through the Worker",
  { timeout: 30_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()

    let runtime
    try {
      const config = parseToml(
        await readFile(
          path.join(
            repoRoot,
            "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
          ),
          "utf8",
        ),
      )
      runtime = new Miniflare(
        convertV4MiniflareOptions({
          name: "iconoplasm-routing-test",
          modules: true,
          script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
          compatibilityDate: "2026-08-01",
          assets: {
            directory: outputRoot,
            run_worker_first: config.assets.run_worker_first,
            routerConfig: { has_user_worker: true },
            assetConfig: { not_found_handling: config.assets.not_found_handling },
          },
        }),
      )

      for (const pathname of [
        "/",
        "/search?q=TP53",
        "/genes",
        "/gene/TP53",
        "/portrait/TP53.webp",
        "/sitemap.xml",
        "/robots.txt",
        "/llms.txt",
        "/published-cards/v2/immutable/genes/example.json",
      ]) {
        const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)
        assert.notEqual(response.status, 599, `${pathname} invoked the stateful Worker`)
      }
      const apiResponse = await runtime.dispatchFetch("https://iconoplasm.test/api/auth/me")
      assert.equal(apiResponse.status, 599, await apiResponse.text())
      for (const method of ["GET", "HEAD"]) {
        const blotResponse = await runtime.dispatchFetch("https://iconoplasm.test/blot/TP53.webp", {
          method,
          redirect: "manual",
        })
        assert.equal(blotResponse.status, 599, "the exact-card blot handler owns the mutable alias")
        const portraitResponse = await runtime.dispatchFetch(
          "https://iconoplasm.test/portraits/v1/aa/" + "a".repeat(64) + "/full.webp",
          { method, redirect: "manual" },
        )
        assert.equal(portraitResponse.status, 599, "the first-party portrait route owns the fallback")
      }
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)

test(
  "real workerd preparation topology is exactly the retained pre-cutover route contract",
  { timeout: 30_000 },
  async () => {
    const { temporaryRoot, outputRoot } = await makeAssetFixture()
    let runtime
    try {
      const canonical = await readFile(
        path.join(
          repoRoot,
          "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
        ),
        "utf8",
      )
      const config = parseToml(preparePublicReadCutoverConfig(canonical))
      const retained = config.unsafe.metadata.assets.config
      assert.equal(config.unsafe.metadata.keep_assets, true)
      runtime = new Miniflare(
        convertV4MiniflareOptions({
          name: "iconoplasm-preparation-preview-test",
          modules: true,
          script: `export default {fetch(){return new Response("stateful-worker",{status:599})}}`,
          compatibilityDate: "2026-08-01",
          assets: {
            directory: outputRoot,
            run_worker_first: retained.run_worker_first,
            routerConfig: { has_user_worker: true },
            assetConfig: { not_found_handling: retained.not_found_handling },
          },
        }),
      )

      for (const pathname of ["/"])
        assert.notEqual(
          (await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)).status,
          599,
          pathname,
        )
      for (const method of ["GET", "HEAD"]) {
        const blotResponse = await runtime.dispatchFetch("https://iconoplasm.test/blot/TP53.webp", {
          method,
          redirect: "manual",
        })
        assert.equal(blotResponse.status, 599, "the exact-card blot handler owns the mutable alias")
      }
      for (const pathname of [
        "/search?q=TP53",
        "/gene/TP53",
        "/genes",
        "/robots.txt",
        "/api/auth/me",
      ])
        assert.equal(
          (await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)).status,
          599,
          pathname,
        )
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)

test(
  "the exact production build and Wrangler config sample anonymous route ownership",
  { timeout: 120_000 },
  async () => {
    const proof = await proveAnonymousRouteTopology()
    assert.equal(proof.kind, "exact_build_topology_proof")
    assert.equal(proof.assetRoot, "public-iconoplasm-edge")
    assert.equal(
      proof.wranglerConfig,
      "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    )
    assert.ok(proof.physicalDispatches > 0)
    assert.equal(proof.logicalDispatches, undefined)
    assert.ok(proof.routeClasses.some((route) => route.startsWith("/portraits/v1/")))
    assert.equal(proof.statefulWorkerRouteEvents, 2)
    assert.equal(proof.unexpectedStatefulWorkerRouteEvents, 0)
    assert.equal(proof.verified, true)
  },
)

test("the topology proof rejects an asset build from another commit", async () => {
  await assert.rejects(
    proveAnonymousRouteTopology({ expectedCommit: "f".repeat(40) }),
    /STALE_PRODUCTION_STATIC_BUILD/,
  )
})
