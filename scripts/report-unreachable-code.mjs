// Reachability report: what production entry points can actually reach.
//
// "Has callers" is the wrong test for dead code. Code can be kept alive by a
// circle (A calls B, B calls C, C calls A) or by its own tests, with nothing a
// reader, cron, workstation or browser ever enters. This bundles each real
// entry point with tree-shaking (tests are never entries) and reports what the
// source contains that the bundle does not.
//
//   node scripts/report-unreachable-code.mjs [--esbuild <path to esbuild/lib/main.js>]
//
// Output: artifacts/reachability/report.json and a summary on stdout.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const args = process.argv.slice(2)
const esbuildPath = args.includes("--esbuild")
  ? args[args.indexOf("--esbuild") + 1]
  : path.join(ROOT, "node_modules", "esbuild", "lib", "main.js")
const esbuild = (await import(pathToFileURL(esbuildPath).href)).default

// Real entry points only. Tests, fixtures and one-off scripts are not roots.
const ENTRIES = [
  {
    name: "stateful-worker",
    file: "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
    platform: "neutral",
  },
  {
    name: "public-edge-worker",
    file: "workers/the-only-allowed-public-edge-worker-that-must-not-touch-state.js",
    platform: "neutral",
  },
]
const SCOPE = ["workers"]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (["node_modules", "generated", "test-helpers", "fixtures"].includes(entry.name)) continue
      walk(full, out)
    } else if (
      /\.(m?js)$/.test(entry.name) &&
      !/\.(test|spec|e2e)\.m?js$/.test(entry.name) &&
      !/\.workerd\.test\./.test(entry.name)
    ) {
      out.push(path.relative(ROOT, full).replaceAll(path.sep, "/"))
    }
  }
  return out
}

const reachedBytes = new Map()
let bundleText = ""
for (const entry of ENTRIES) {
  const result = await esbuild.build({
    entryPoints: [entry.file],
    bundle: true,
    write: false,
    format: "esm",
    platform: entry.platform,
    mainFields: ["module", "main"],
    packages: "external",
    external: ["cloudflare:*", "node:*"],
    // Generated build output is not source; treat it as outside the graph.
    plugins: [
      {
        name: "generated-external",
        setup(build) {
          build.onResolve({ filter: /\/generated\// }, (args) => ({
            path: args.path,
            external: true,
          }))
        },
      },
    ],
    treeShaking: true,
    minify: false,
    metafile: true,
    logLevel: "error",
    loader: { ".txt": "text", ".html": "text", ".sql": "text", ".wasm": "binary", ".json": "json" },
  })
  bundleText += "\n" + result.outputFiles.map((file) => file.text).join("\n")
  for (const output of Object.values(result.metafile.outputs)) {
    for (const [input, info] of Object.entries(output.inputs)) {
      const key = input.replaceAll("\\", "/")
      reachedBytes.set(key, Math.max(reachedBytes.get(key) || 0, info.bytesInOutput))
    }
  }
}

const sources = SCOPE.flatMap((dir) => walk(path.join(ROOT, dir)))
const unreachedFiles = []
const zeroByteFiles = []
const deadFunctions = []
for (const file of sources) {
  const lines = readFileSync(file, "utf8").split("\n").length
  if (!reachedBytes.has(file)) {
    unreachedFiles.push({ file, lines })
    continue
  }
  if (reachedBytes.get(file) === 0) {
    zeroByteFiles.push({ file, lines })
    continue
  }
  // Top-level function declarations that tree-shaking dropped. esbuild may add
  // a numeric suffix on name collisions, so accept name, name2, name3...
  const text = readFileSync(file, "utf8")
  for (const match of text.matchAll(
    /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm,
  )) {
    const name = match[1]
    const present = new RegExp(
      `\\b(?:function\\s*\\*?\\s*${name}\\d*\\s*\\(|${name}\\d*\\s*=)`,
    ).test(bundleText)
    if (!present) {
      const line = text.slice(0, match.index).split("\n").length
      deadFunctions.push({ file, name, line })
    }
  }
}

const report = {
  generated_at: new Date().toISOString(),
  entries: ENTRIES.map((entry) => entry.file),
  source_files: sources.length,
  unreached_files: unreachedFiles.sort((a, b) => b.lines - a.lines),
  zero_byte_files: zeroByteFiles.sort((a, b) => b.lines - a.lines),
  dead_top_level_functions: deadFunctions,
}
mkdirSync("artifacts/reachability", { recursive: true })
writeFileSync("artifacts/reachability/report.json", JSON.stringify(report, null, 2))
const sum = (list) => list.reduce((total, item) => total + item.lines, 0)
console.log(`entries: ${ENTRIES.length}, source files in scope: ${sources.length}`)
console.log(`unreached files: ${unreachedFiles.length} (${sum(unreachedFiles)} lines)`)
console.log(`zero-byte files: ${zeroByteFiles.length} (${sum(zeroByteFiles)} lines)`)
console.log(`dead top-level functions in reached files: ${deadFunctions.length}`)
