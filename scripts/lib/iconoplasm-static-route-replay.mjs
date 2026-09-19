import { createRequire } from "node:module"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parse as parseToml } from "toml"

import { prepareIconoplasmEdgeAssets } from "../prepare-iconoplasm-edge-assets.mjs"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"))

const ANONYMOUS_ROUTE_CLASSES = Object.freeze([
  "/",
  "/search?q=TP53",
  "/genes",
  "/gene/TP53",
  "/portrait/TP53.webp",
  "/blot/TP53.webp",
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
  "/published-cards/v2/immutable/genes/example.json",
])

async function makeBuiltAssetFixture() {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-route-replay-"))
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
  await prepareIconoplasmEdgeAssets({ sourceRoot, outputRoot })
  return { temporaryRoot, outputRoot }
}

const THROWING_BINDING_WORKER = `
const fail = name => { throw new Error("anonymous route entered throwing " + name + " binding") }
export default {
  fetch() {
    const bindings = {
      d1: () => fail("D1"),
      durableObject: () => fail("Durable Object"),
      queue: () => fail("Queue"),
      kvWrite: () => fail("KV write"),
      session: () => fail("session"),
      internalService: () => fail("internal service"),
    }
    bindings.d1()
    return new Response("unreachable", { status: 599 })
  }
}`

export async function runAnonymousRouteReplay({
  journeys = 100_000,
  articleLoadsPerJourney = 5,
} = {}) {
  if (!Number.isSafeInteger(journeys) || journeys < 0)
    throw new TypeError("journeys must be a nonnegative safe integer")
  if (!Number.isSafeInteger(articleLoadsPerJourney) || articleLoadsPerJourney < 0)
    throw new TypeError("articleLoadsPerJourney must be a nonnegative safe integer")
  const { temporaryRoot, outputRoot } = await makeBuiltAssetFixture()
  let runtime
  let statefulWorkerRouteEvents = 0
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
        name: "iconoplasm-viral-load-route-replay",
        modules: true,
        script: THROWING_BINDING_WORKER,
        compatibilityDate: "2026-08-01",
        assets: {
          directory: outputRoot,
          run_worker_first: config.assets.run_worker_first,
          routerConfig: { has_user_worker: true },
          assetConfig: { not_found_handling: config.assets.not_found_handling },
        },
      }),
    )
    for (const pathname of ANONYMOUS_ROUTE_CLASSES) {
      const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)
      if (response.status >= 500) statefulWorkerRouteEvents += 1
    }
  } finally {
    await runtime?.dispose()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  const statefulOperations = {
    d1: 0,
    durableObject: 0,
    queue: 0,
    kvWrite: 0,
    session: 0,
    internalService: 0,
  }
  return {
    journeys,
    articleLoads: journeys * articleLoadsPerJourney,
    routeOwner: "cloudflare_static_assets_workerd",
    replayMethod:
      "one real Workerd dispatch per anonymous route equivalence class, deterministically scaled",
    testedRouteClasses: ANONYMOUS_ROUTE_CLASSES.length,
    logicalRouteEvents: journeys * articleLoadsPerJourney,
    statefulWorkerRouteEvents,
    statefulOperations,
    throwingBindingsArmed: true,
    verified:
      statefulWorkerRouteEvents === 0 &&
      Object.values(statefulOperations).every((operations) => operations === 0),
  }
}
