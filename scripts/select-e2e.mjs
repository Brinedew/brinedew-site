#!/usr/bin/env node
// Picks the browser E2E files a change can break, so a run doesn't sit through
// all of them. On 2026-10-16 every PR and every main push ran all 23 files in
// series (588 s), and production deploys wait for main's run: a one-panel admin
// fix waited about 40 minutes from push to live.
//
// A file runs when the change touches:
// - the file itself;
// - anything it imports, followed through relative imports (so a worker file
//   counts only for the E2E files that execute it);
// - a path under one of its `// E2E scope:` prefixes, for inputs it reads at
//   run time instead of importing (the built site, static files). A script
//   named there counts with its imports too (the site build imports worker
//   modules).
// A scope prefix starting with "!" excludes paths under it, imports included:
// the GeneGuessr tests load the whole internal Worker, which imports every
// Iconoplasm module, but drive only GeneGuessr's routes. A module that fails
// to load still fails the Test step, which imports the same Worker.
// Everything runs when the change touches the shared harness, the dependency
// set, CI, or this script, or when there is no base to compare with.
//
// Each run also sweeps one file, rotating through all of them by run number,
// so every file still runs at least once every N runs, whatever changed.
//
// Usage: node scripts/select-e2e.mjs [--base <sha>] [--rotate <n>]
// Prints the chosen files, space-separated (nothing when none).
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const RUN_ALL = [
  "e2e/harness.mjs",
  "e2e/fixtures/",
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yaml",
  "scripts/select-e2e.mjs",
]
const IMPORT =
  /(?:^|[\s;])(?:import|export)\s[^"'`]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|^\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ""
}
const base = option("--base")
const rotate = Number.parseInt(option("--rotate"), 10)

const repoPath = (absolute) => path.relative(ROOT, absolute).split(path.sep).join("/")
const files = readdirSync(path.join(ROOT, "e2e"))
  .filter((name) => name.endsWith(".e2e.mjs"))
  .sort()
  .map((name) => `e2e/${name}`)

function imports(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  let source
  try {
    source = readFileSync(path.join(ROOT, file), "utf8")
  } catch {
    return seen
  }
  for (const match of source.matchAll(IMPORT)) {
    const target = (match[1] || match[2] || match[3]).split("?")[0]
    const resolved = repoPath(path.resolve(path.dirname(path.join(ROOT, file)), target))
    if (existsSync(path.join(ROOT, resolved))) imports(resolved, seen)
  }
  return seen
}

function scope(file) {
  const line = readFileSync(path.join(ROOT, file), "utf8").match(/^\/\/ E2E scope:(.*)$/m)
  const prefixes = line ? line[1].trim().split(/\s+/).filter(Boolean) : []
  return {
    include: prefixes.filter((prefix) => !prefix.startsWith("!")),
    exclude: prefixes.filter((prefix) => prefix.startsWith("!")).map((prefix) => prefix.slice(1)),
  }
}

function changedFiles() {
  if (!base || /^0+$/.test(base)) return null
  try {
    return execFileSync("git", ["diff", "--name-only", base, "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
  } catch {
    return null
  }
}

const changed = changedFiles()
let chosen
if (!changed || changed.some((file) => RUN_ALL.some((shared) => file.startsWith(shared)))) {
  chosen = files
} else {
  chosen = files.filter((file) => {
    const { include, exclude } = scope(file)
    const graph = imports(file)
    for (const entry of include) if (/\.m?js$/.test(entry)) imports(entry, graph)
    return changed.some(
      (path) =>
        !exclude.some((prefix) => path.startsWith(prefix)) &&
        (graph.has(path) || include.some((prefix) => path.startsWith(prefix))),
    )
  })
  const swept = Number.isFinite(rotate) ? files[rotate % files.length] : null
  if (swept && !chosen.includes(swept)) chosen = [...chosen, swept]
}
process.stdout.write(chosen.join(" "))
