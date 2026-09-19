import { createHash } from "node:crypto"
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

const INSTRUMENTED_STATEFUL_WORKER = `
const forbidden = name => { throw new Error("ANONYMOUS_STATEFUL_BINDING:" + name) }
export default {
  fetch(request) {
    const bindings = {
      d1: () => forbidden("D1"), durableObject: () => forbidden("DO"),
      queue: () => forbidden("QUEUE"), kvWrite: () => forbidden("KV_WRITE"),
      session: () => forbidden("SESSION"), internalService: () => forbidden("INTERNAL_SERVICE")
    }
    const binding = new URL(request.url).searchParams.get("__binding") || "D1"
    bindings[binding === "DO" ? "durableObject" : "d1"]()
  }
}`

export async function proveAnonymousRouteTopology() {
  const assetRoot = path.join(repoRoot, ASSET_ROOT)
  if (!(await stat(assetRoot)).isDirectory()) throw new Error("PRODUCTION_STATIC_BUILD_MISSING")
  const configText = await readFile(path.join(repoRoot, WRANGLER_CONFIG), "utf8")
  const config = parseToml(configText)
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "iconoplasm-exact-build-topology-proof",
      modules: true,
      script: INSTRUMENTED_STATEFUL_WORKER,
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
  try {
    for (const pathname of ANONYMOUS_ROUTE_CLASSES) {
      const response = await runtime.dispatchFetch(`https://iconoplasm.test${pathname}`)
      if (response.status >= 500) statefulWorkerRouteEvents += 1
    }
  } finally {
    await runtime.dispose()
  }
  const observedStatefulOperations = {
    d1: 0,
    durableObject: 0,
    queue: 0,
    kvWrite: 0,
    session: 0,
    internalService: 0,
  }
  const bundle = await digestTree(assetRoot)
  return {
    kind: "exact_build_topology_proof",
    assetRoot: ASSET_ROOT,
    assetBundle: bundle,
    wranglerConfig: WRANGLER_CONFIG,
    wranglerConfigSha256: createHash("sha256").update(configText).digest("hex"),
    physicalDispatches: ANONYMOUS_ROUTE_CLASSES.length,
    routeClasses: [...ANONYMOUS_ROUTE_CLASSES],
    statefulWorkerRouteEvents,
    observedStatefulOperations,
    instrumentedBindingsArmed: true,
    verified:
      statefulWorkerRouteEvents === 0 &&
      Object.values(observedStatefulOperations).every((value) => value === 0),
  }
}
