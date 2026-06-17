import esbuild from "esbuild"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const targets = [
  {
    source: path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-vote.css"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "shared-card-vote.css"),
      path.join(repoRoot, "iconoplasm-extension", "generated", "shared-card-vote.css"),
    ],
  },
  {
    source: path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-label.css"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "shared-card-label.css"),
      path.join(repoRoot, "iconoplasm-extension", "generated", "shared-card-label.css"),
    ],
  },
]

const fontTargets = [
  "IBMPlexMono-Regular.woff2",
  "IBMPlexMono-Medium.woff2",
  "LeagueSpartan-800.woff2",
  "SpecialElite-Regular.woff2",
  "Caveat-400.woff2",
  "IBMPlexMono-Regular-critical.woff2",
  "IBMPlexMono-Medium-critical.woff2",
  "LeagueSpartan-800-critical.woff2",
  "SpecialElite-Regular-critical.woff2",
  "Caveat-400-critical.woff2",
].map((name) => ({
  source: path.join(repoRoot, "shared", "iconoplasm-card", "fonts", name),
  outputs: [
    path.join(repoRoot, "quartz", "static", "iconoplasm", "fonts", name),
    path.join(repoRoot, "iconoplasm-extension", "fonts", name),
  ],
}))

const binaryTargets = [
  ...fontTargets,
  {
    source: path.join(repoRoot, "node_modules", "roughjs", "bundled", "rough.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "rough.js"),
      path.join(repoRoot, "iconoplasm-extension", "generated", "rough.js"),
    ],
  },
]

const bundledTargets = [
  {
    source: path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-runtime.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "shared-card-runtime.js"),
      path.join(repoRoot, "iconoplasm-extension", "generated", "shared-card-runtime.js"),
    ],
    format: "iife",
  },
  {
    source: path.join(repoRoot, "shared", "iconoplasm-card", "lit-archival-card.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "lit-archival-card.js"),
      path.join(repoRoot, "iconoplasm-extension", "generated", "lit-archival-card.js"),
    ],
    format: "esm",
  },
]

async function syncTarget({ source, outputs }) {
  const content = await readFile(source, "utf8")
  const banner = source.endsWith(".css")
    ? `/* GENERATED FILE. Edit ${path.relative(repoRoot, source).replaceAll("\\", "/")} and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n`
    : `/* GENERATED FILE. Edit ${path.relative(repoRoot, source).replaceAll("\\", "/")} and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n`

  for (const output of outputs) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, banner + content, "utf8")
  }
}

await Promise.all(targets.map(syncTarget))

async function syncBinaryTarget({ source, outputs }) {
  const content = await readFile(source)

  for (const output of outputs) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, content)
  }
}

await Promise.all(binaryTargets.map(syncBinaryTarget))

async function bundleTarget({ source, outputs }) {
  const result = await esbuild.build({
    entryPoints: [source],
    bundle: true,
    format: arguments[0]?.format || "esm",
    platform: "browser",
    target: ["es2022"],
    minify: false,
    write: false,
  })
  const outputFile = Array.isArray(result.outputFiles) ? result.outputFiles[0] : null
  if (!outputFile) throw new Error("Failed to bundle " + source)
  const banner =
    "/* GENERATED FILE. Edit " +
    path.relative(repoRoot, source).replaceAll("\\", "/") +
    " and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n"

  for (const output of outputs) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, banner + outputFile.text, "utf8")
  }
}

await Promise.all(bundledTargets.map(bundleTarget))
