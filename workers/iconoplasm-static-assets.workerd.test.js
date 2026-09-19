import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import test from "node:test"
import { parse as parseToml } from "toml"
import { prepareIconoplasmEdgeAssets } from "../scripts/prepare-iconoplasm-edge-assets.mjs"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"))

test(
  "real workerd static asset routing keeps every anonymous read route out of the Worker",
  { timeout: 30_000 },
  async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-assets-"))
    const sourceRoot = path.join(temporaryRoot, "public")
    const outputRoot = path.join(temporaryRoot, "public-iconoplasm-edge")
    await mkdir(path.join(sourceRoot, "apps", "iconoplasm"), { recursive: true })
    await mkdir(path.join(sourceRoot, "static"), { recursive: true })
    await cp(
      path.join(repoRoot, "quartz", "static", "iconoplasm"),
      path.join(sourceRoot, "static", "iconoplasm"),
      {
        recursive: true,
      },
    )
    const shell = `<!doctype html><script type="module" src="/static/iconoplasm/app.js"></script>`
    for (const page of ["index", "privacy", "license", "caretaker-terms"])
      await writeFile(path.join(sourceRoot, "apps", "iconoplasm", `${page}.html`), shell)
    await writeFile(path.join(sourceRoot, "favicon.ico"), "fixture")

    let runtime
    try {
      const summary = await prepareIconoplasmEdgeAssets({ sourceRoot, outputRoot })
      assert.ok(
        summary.fileCount > 10,
        "the prepared bundle contains the actual Iconoplasm modules",
      )
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
        "/portraits/TP53.webp",
        "/blot/TP53.webp",
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
    } finally {
      await runtime?.dispose()
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  },
)
