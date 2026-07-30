import esbuild from "esbuild"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertIconoplasmPublisherAuthority,
  renderIconoplasmCatalogContractRuntime,
} from "./lib/iconoplasm-publisher-authority.mjs"
import iconoplasmFontContract from "../shared/iconoplasm-card/font-contract.json" with { type: "json" }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const extensionRoot = path.join(repoRoot, "iconoplasm-extension")
const extensionOnly = process.argv.includes("--extension-only")
const publisherRelease = assertIconoplasmPublisherAuthority(repoRoot)

function selectedOutputs(outputs) {
  if (!extensionOnly) return outputs
  const prefix = extensionRoot + path.sep
  return outputs.filter((output) => output === extensionRoot || output.startsWith(prefix))
}

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
    ],
  },
  {
    source: path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-label.css"),
    prefix: renderIconoplasmExtensionFontFaceCss("../fonts/"),
    outputs: [path.join(repoRoot, "iconoplasm-extension", "generated", "shared-card-label.css")],
  },
]

function renderIconoplasmExtensionFontFaceCss(baseUrl) {
  return (
    iconoplasmFontContract.fonts
      .map(
        (font) => `@font-face {
  font-family: "${font.family}";
  src: url("${baseUrl}${font.stem}.woff2") format("woff2");
  font-weight: ${font.weight};
  font-style: normal;
  font-display: ${iconoplasmFontContract.extensionDisplay};
}`,
      )
      .join("\n\n") + "\n\n"
  )
}

const fontTargets = iconoplasmFontContract.fonts
  .map((font) => `${font.stem}.woff2`)
  .map((name) => ({
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
    source: path.join(repoRoot, "shared", "iconoplasm-portrait", "portrait-delivery-core.js"),
    outputs: [
      path.join(
        repoRoot,
        "quartz",
        "static",
        "iconoplasm",
        "generated",
        "portrait-delivery-core.js",
      ),
    ],
    format: "esm",
  },
  {
    source: path.join(repoRoot, "shared", "iconoplasm-portrait", "portrait-delivery-core.js"),
    outputs: [
      path.join(repoRoot, "iconoplasm-extension", "generated", "portrait-delivery-core.js"),
    ],
    format: "iife",
    globalName: "IconoplasmPortraitDelivery",
  },
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
    ],
    format: "esm",
  },
]

async function syncTarget({ source, prefix = "", outputs }) {
  const outputsToWrite = selectedOutputs(outputs)
  if (outputsToWrite.length === 0) return
  const content = await readFile(source, "utf8")
  const relativeSource = path.relative(repoRoot, source).replaceAll("\\", "/")
  const banner = source.endsWith(".css")
    ? `/* GENERATED FILE. Edit ${relativeSource}${prefix ? " and shared/iconoplasm-card/font-contract.json" : ""} and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n`
    : `/* GENERATED FILE. Edit ${path.relative(repoRoot, source).replaceAll("\\", "/")} and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n`

  for (const output of outputsToWrite) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, banner + prefix + content, "utf8")
  }
}

await Promise.all(targets.map(syncTarget))

async function syncBinaryTarget({ source, outputs }) {
  const outputsToWrite = selectedOutputs(outputs)
  if (outputsToWrite.length === 0) return
  const content = await readFile(source)

  for (const output of outputsToWrite) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, content)
  }
}

await Promise.all(binaryTargets.map(syncBinaryTarget))

async function bundleTarget({ source, outputs, format = "esm", globalName }) {
  const outputsToWrite = selectedOutputs(outputs)
  if (outputsToWrite.length === 0) return
  const result = await esbuild.build({
    entryPoints: [source],
    bundle: true,
    format,
    ...(globalName ? { globalName } : {}),
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

  for (const output of outputsToWrite) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, banner + outputFile.text, "utf8")
  }
}

await Promise.all(bundledTargets.map(bundleTarget))

const catalogContractRuntimePath = path.join(
  repoRoot,
  "iconoplasm-extension",
  "generated",
  "catalog-contract.js",
)
await mkdir(path.dirname(catalogContractRuntimePath), { recursive: true })
await writeFile(
  catalogContractRuntimePath,
  renderIconoplasmCatalogContractRuntime(publisherRelease),
  "utf8",
)

async function syncSidebarShellImportVersions() {
  const sidebarShellPath = path.join(repoRoot, "quartz", "static", "shared", "sidebar-shell.js")
  const sidebarShell = await readFile(sidebarShellPath)
  const version = createHash("sha256").update(sidebarShell).digest("hex").slice(0, 16)
  const consumers = [
    path.join(repoRoot, "quartz", "static", "shared", "auth-sidebar.mjs"),
    path.join(repoRoot, "quartz", "static", "iconoplasm", "app.js"),
    path.join(repoRoot, "quartz", "static", "geneguessr", "app.js"),
    path.join(repoRoot, "quartz", "static", "site-settings", "app.js"),
  ]

  for (const consumer of consumers) {
    const source = await readFile(consumer, "utf8")
    const next = source.replace(
      /(["'])(\.\.\/shared\/|\.\/)sidebar-shell\.js(?:\?v=[a-f0-9]+)?\1/g,
      `$1$2sidebar-shell.js?v=${version}$1`,
    )
    if (next === source && !source.includes(`sidebar-shell.js?v=${version}`)) {
      throw new Error(
        `Unable to synchronize sidebar-shell import in ${path.relative(repoRoot, consumer)}`,
      )
    }
    await writeFile(consumer, next, "utf8")
  }
}

if (!extensionOnly) {
  await syncSidebarShellImportVersions()
}
