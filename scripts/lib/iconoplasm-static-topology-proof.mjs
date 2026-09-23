import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { parse as parseToml } from "toml"

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare")
const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"))

const ASSET_ROOT = "public-iconoplasm-edge"
const WRANGLER_CONFIG = "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"
const EXACT_CARD_BLOT_ROUTE = "/blot/TP53.webp"
const ANONYMOUS_ROUTE_CLASSES = Object.freeze([
  "/",
  "/search?q=TP53",
  "/genes",
  "/gene/TP53",
  "/portrait/TP53.webp",
  EXACT_CARD_BLOT_ROUTE,
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
  "/published-cards/v2/immutable/genes/example.json",
])

async function digestTree(root) {
  const entries = []
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(full)
      else if (entry.isFile()) {
        entries.push({
          path: path.relative(root, full).replaceAll(path.sep, "/"),
          sha256: createHash("sha256")
            .update(await readFile(full))
            .digest("hex"),
        })
      }
    }
  }
  await visit(root)
  return {
    fileCount: entries.length,
    sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  }
}

const TOPOLOGY_PROBE_WORKER = `export default {fetch(){return new Response("worker-route",{status:599})}}`

export async function proveAnonymousRouteTopology({ expectedCommit } = {}) {
  const assetRoot = path.join(repoRoot, ASSET_ROOT)
  if (!(await stat(assetRoot)).isDirectory()) throw new Error("PRODUCTION_STATIC_BUILD_MISSING")
  const requiredCommit = String(
    expectedCommit ||
      process.env.GITHUB_SHA ||
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }),
  ).trim()
  const buildManifest = JSON.parse(
    await readFile(path.join(assetRoot, "_build-manifest.json"), "utf8"),
  )
  if (buildManifest.kind !== "iconoplasm_edge_build" || buildManifest.sourceSha !== requiredCommit)
    throw new Error("STALE_PRODUCTION_STATIC_BUILD")
  const configText = await readFile(path.join(repoRoot, WRANGLER_CONFIG), "utf8")
  const config = parseToml(configText)
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "iconoplasm-exact-build-topology-proof",
      modules: true,
      script: TOPOLOGY_PROBE_WORKER,
      compatibilityDate: "2026-08-01",
      assets: {
        directory: assetRoot,
        run_worker_first: config.assets.run_worker_first,
        routerConfig: { has_user_worker: true },
        assetConfig: { not_found_handling: config.assets.not_found_handling },
      },
    }),
  )
  let statefulWorkerRouteEvents = 0
  let unexpectedStatefulWorkerRouteEvents = 0
  try {
    for (const pathname of ANONYMOUS_ROUTE_CLASSES) {
      const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`, {
        redirect: "manual",
      })
      if (pathname === EXACT_CARD_BLOT_ROUTE) {
        if (response.status === 599) statefulWorkerRouteEvents += 1
      } else if (response.status === 599) {
        unexpectedStatefulWorkerRouteEvents += 1
      }
    }
  } finally {
    await runtime.dispose()
  }
  const bundle = await digestTree(assetRoot)
  return {
    kind: "exact_build_topology_proof",
    assetRoot: ASSET_ROOT,
    assetBundle: bundle,
    sourceSha: buildManifest.sourceSha,
    wranglerConfig: WRANGLER_CONFIG,
    wranglerConfigSha256: createHash("sha256").update(configText).digest("hex"),
    physicalDispatches: ANONYMOUS_ROUTE_CLASSES.length,
    routeClasses: [...ANONYMOUS_ROUTE_CLASSES],
    statefulWorkerRouteEvents,
    unexpectedStatefulWorkerRouteEvents,
    verified: statefulWorkerRouteEvents === 1 && unexpectedStatefulWorkerRouteEvents === 0,
  }
}
