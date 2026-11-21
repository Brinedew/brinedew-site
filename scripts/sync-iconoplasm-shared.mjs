import esbuild from "esbuild"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

async function writeFileAtomicIfChanged(targetPath, data, encoding) {
  const nextBytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), encoding || "utf8")
  try {
    const existing = await readFile(targetPath)
    if (existing.equals(nextBytes)) return
  } catch {
    // Missing target: write it below.
  }
  await mkdir(path.dirname(targetPath), { recursive: true })
  const tmpPath = `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmpPath, nextBytes)
  await rename(tmpPath, targetPath)
}
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
    source: path.join(
      repoRoot,
      "workers",
      "generated",
      "iconoplasm-anima-emulsion-slot-contract.js",
    ),
    outputs: [
      path.join(
        repoRoot,
        "quartz",
        "static",
        "iconoplasm",
        "generated",
        "anima-emulsion-slot-contract.js",
      ),
    ],
  },
  {
    // B-879: the one tag-category tree, for the caretaker editor.
    source: path.join(repoRoot, "shared", "iconoplasm-tag-categories.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "tag-categories.js"),
    ],
  },
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
    outputs: [path.join(repoRoot, "iconoplasm-extension", "generated", "shared-card-label.css")],
  },
  {
    // B-1068, B-1131: the blot painter, with the card's own faces. The print
    // button and scripts/draw-iconoplasm-blots.mjs both load this copy.
    source: path.join(repoRoot, "shared", "iconoplasm-card", "blot-painter.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "blot-painter.js"),
    ],
    replace: [
      "const FONT_FACES = []",
      `const FONT_FACES = ${JSON.stringify(
        iconoplasmFontContract.fonts.map(({ family, url, weight }) => ({ family, url, weight })),
      )}`,
    ],
  },
  {
    // B-1136: blot fingerprint & CDN key derivation shared with Diagram Studio.
    source: path.join(repoRoot, "workers", "lib", "iconoplasm-blot.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "blot-identity.js"),
    ],
  },
  {
    // B-1136: compact resolver binary search shared with browser CDN fallback.
    source: path.join(repoRoot, "workers", "lib", "iconoplasm-resolver-index.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "resolver-index.js"),
    ],
  },
]

function renderIconoplasmExtensionFontRuntime() {
  const definitions = iconoplasmFontContract.fonts.map((font) => ({
    family: font.family,
    path: `fonts/${font.stem}.woff2`,
    weight: String(font.weight),
    style: "normal",
    display: iconoplasmFontContract.extensionDisplay,
  }))
  const definitionSource = JSON.stringify(definitions, null, 2)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")

  return `/* GENERATED FILE. Edit shared/iconoplasm-card/font-contract.json and rerun node scripts/sync-iconoplasm-shared.mjs. */

;(function installIconoplasmExtensionFontRuntime(root) {
  "use strict"

  const FONT_DEFINITIONS = Object.freeze(
${definitionSource}.map((font) => Object.freeze(font)),
  )
  const installedFontSets = new WeakSet()

  function install(options = {}) {
    try {
      const documentRef = options.documentRef || root.document
      const runtime = options.runtime || root.browser?.runtime || root.chrome?.runtime
      const FontFaceCtor = options.FontFaceCtor || root.FontFace
      const fontSet = options.fontSet || documentRef?.fonts
      if (!runtime || typeof runtime.getURL !== "function") return []
      if (typeof FontFaceCtor !== "function" || !fontSet || typeof fontSet.add !== "function") {
        return []
      }
      if (installedFontSets.has(fontSet)) return []

      const faces = FONT_DEFINITIONS.map((font) => {
        const source = \`url(\${JSON.stringify(runtime.getURL(font.path))}) format("woff2")\`
        return new FontFaceCtor(font.family, source, {
          weight: font.weight,
          style: font.style,
          display: font.display,
        })
      })
      for (const face of faces) fontSet.add(face)
      installedFontSets.add(fontSet)
      return faces
    } catch (error) {
      root.console?.warn?.("[Iconoplasm] Packaged fonts could not be registered", error)
      return []
    }
  }

  const api = Object.freeze({ definitions: FONT_DEFINITIONS, install })
  root.IconoplasmExtensionFonts = api
  install()
})(typeof globalThis !== "undefined" ? globalThis : this)
`
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
    source: path.join(repoRoot, "node_modules", "driver.js", "dist", "driver.css"),
    outputs: [path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "driver.css")],
  },
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
    source: path.join(repoRoot, "shared", "iconoplasm-diagram", "tour-runtime.js"),
    outputs: [
      path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "tour-runtime.js"),
    ],
    format: "esm",
    minify: true,
  },
  {
    source: path.join(repoRoot, "shared", "iconoplasm-diagram", "x6-runtime.js"),
    outputs: [path.join(repoRoot, "quartz", "static", "iconoplasm", "generated", "x6-runtime.js")],
    format: "esm",
    minify: true,
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

async function syncTarget({ source, prefix = "", outputs, replace }) {
  const outputsToWrite = selectedOutputs(outputs)
  if (outputsToWrite.length === 0) return
  let content = await readFile(source, "utf8")
  if (replace) {
    if (!content.includes(replace[0])) throw new Error(`${source} no longer contains ${replace[0]}`)
    content = content.replace(replace[0], replace[1])
  }
  const relativeSource = path.relative(repoRoot, source).replaceAll("\\", "/")
  const banner = source.endsWith(".css")
    ? `/* GENERATED FILE. Edit ${relativeSource}${prefix ? " and shared/iconoplasm-card/font-contract.json" : ""} and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n`
    : `/* GENERATED FILE. Edit ${path.relative(repoRoot, source).replaceAll("\\", "/")} and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n`

  for (const output of outputsToWrite) {
    await writeFileAtomicIfChanged(output, banner + prefix + content, "utf8")
  }
}

await Promise.all(targets.map(syncTarget))

const extensionFontRuntimePath = path.join(
  repoRoot,
  "iconoplasm-extension",
  "generated",
  "iconoplasm-font-runtime.js",
)
await writeFileAtomicIfChanged(
  extensionFontRuntimePath,
  renderIconoplasmExtensionFontRuntime(),
  "utf8",
)

async function syncBinaryTarget({ source, outputs }) {
  const outputsToWrite = selectedOutputs(outputs)
  if (outputsToWrite.length === 0) return
  const content = await readFile(source)

  for (const output of outputsToWrite) {
    await writeFileAtomicIfChanged(output, content)
  }
}

await Promise.all(binaryTargets.map(syncBinaryTarget))

async function bundleTarget({ source, outputs, format = "esm", globalName, minify = false }) {
  const outputsToWrite = selectedOutputs(outputs)
  if (outputsToWrite.length === 0) return
  const result = await esbuild.build({
    entryPoints: [source],
    bundle: true,
    format,
    ...(globalName ? { globalName } : {}),
    platform: "browser",
    target: ["es2022"],
    minify,
    write: false,
  })
  const outputFile = Array.isArray(result.outputFiles) ? result.outputFiles[0] : null
  if (!outputFile) throw new Error("Failed to bundle " + source)
  const banner =
    "/* GENERATED FILE. Edit " +
    path.relative(repoRoot, source).replaceAll("\\", "/") +
    " and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\n"
  const generated = minify
    ? (banner + outputFile.text).replace(/[ \t]+$/gm, "")
    : banner + outputFile.text

  for (const output of outputsToWrite) {
    await writeFileAtomicIfChanged(output, generated, "utf8")
  }
}

await Promise.all(bundledTargets.map(bundleTarget))

const catalogContractRuntimePath = path.join(
  repoRoot,
  "iconoplasm-extension",
  "generated",
  "catalog-contract.js",
)
await writeFileAtomicIfChanged(
  catalogContractRuntimePath,
  renderIconoplasmCatalogContractRuntime(publisherRelease),
  "utf8",
)

if (!extensionOnly) {
  const { ICONOPLASM_DEFAULT_PUBLICATION_ALIASES } =
    await import("../workers/iconoplasm-publication-aliases.js")
  const publicationAliasBootstrapPath = path.join(
    repoRoot,
    "quartz",
    "static",
    "iconoplasm",
    "generated",
    "publication-alias-bootstrap.js",
  )
  await writeFileAtomicIfChanged(
    publicationAliasBootstrapPath,
    `/* GENERATED FILE. Edit workers/iconoplasm-publication-aliases.js and rerun node scripts/sync-iconoplasm-shared.mjs. */\n\nexport const ICONOPLASM_PUBLICATION_ALIAS_BOOTSTRAP = ${JSON.stringify(
      {
        by_symbol: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol,
        remove_by_symbol: ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.remove_by_symbol,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  const { syncStaticImportVersions, syncStudioImportVersions } =
    await import("./lib/static-import-versions.mjs")
  const staticRoot = path.join(repoRoot, "quartz", "static")
  // THE ONLY BROWSER MODULE VERSION GRAPH — DO NOT HAND-BUMP IMPORT URLS.
  // Hash leaves before their consumers so a source edit reaches the entrypoint
  // that fresh HTML loads. The HTML itself is stamped with the release SHA.
  await syncStaticImportVersions(staticRoot, "site-preferences.js", [
    "shared/sidebar-shell.js",
    "iconoplasm/diagram-studio.js",
    "iconoplasm/app.js",
    "site-settings/app.js",
  ])
  await syncStaticImportVersions(staticRoot, "shared/sidebar-shell.js", [
    "iconoplasm/app.js",
    "geneguessr/app.js",
    "site-settings/app.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/portrait-delivery.js", [
    "iconoplasm/app.js",
    "iconoplasm/gene-card-thumb-delivery.js",
  ])
  await syncStaticImportVersions(
    staticRoot,
    "iconoplasm/generated/publication-alias-bootstrap.js",
    ["iconoplasm/publication-reader.js"],
  )
  await syncStaticImportVersions(staticRoot, "iconoplasm/generated/resolver-index.js", [
    "iconoplasm/publication-reader.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/publication-reader.js", [
    "iconoplasm/diagram-studio.js",
    "iconoplasm/app.js",
    "iconoplasm/admin.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/generated/blot-identity.js", [
    "iconoplasm/diagram-studio.js",
  ])
  await syncStudioImportVersions(staticRoot)

  // B-849: the one dialog template is a leaf under every dialog module.
  await syncStaticImportVersions(staticRoot, "iconoplasm/dialog.js", [
    "iconoplasm/vote-login-dialog.js",
    "iconoplasm/candidate-delete-dialog.js",
    "iconoplasm/caretaker-manifestations-view.js",
    "iconoplasm/caretaker-manifestations-controller.js",
    "iconoplasm/app.js",
  ])

  // The caretaker editor was stranded on a cached pre-fix view module even
  // though the current source and API were healthy. Cover the full lazy graph.
  await syncStaticImportVersions(staticRoot, "iconoplasm/caretaker-manifestations-model.js", [
    "iconoplasm/caretaker-manifestations-view.js",
    "iconoplasm/caretaker-manifestations-events.js",
    "iconoplasm/caretaker-manifestations-controller.js",
    "iconoplasm/caretaker-manifestations.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/caretaker-manifestations-view.js", [
    "iconoplasm/caretaker-manifestations-events.js",
    "iconoplasm/caretaker-manifestations-controller.js",
    "iconoplasm/caretaker-manifestations.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/caretaker-manifestations-events.js", [
    "iconoplasm/caretaker-manifestations-controller.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/caretaker-tag-editor.js", [
    "iconoplasm/caretaker-manifestations-controller.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/caretaker-manifestations-controller.js", [
    "iconoplasm/caretaker-manifestations.js",
  ])
  for (const asset of [
    "caretaker-manifestations.js",
    "caretaker-supervote.js",
    "caretaker-manifestations.css",
    "caretaker-supervote.css",
  ]) {
    await syncStaticImportVersions(staticRoot, `iconoplasm/${asset}`, ["iconoplasm/app.js"])
  }

  for (const asset of ["photoswipe.css", "photoswipe.esm.js"]) {
    await syncStaticImportVersions(staticRoot, `iconoplasm/vendor/${asset}`, [
      "iconoplasm/lightbox.js",
    ])
  }
  await syncStaticImportVersions(staticRoot, "iconoplasm/lightbox.js", [
    "iconoplasm/lightbox-bootstrap.js",
    "iconoplasm/app.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/home-orders.js", [
    "iconoplasm/discovery-collection.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/guest-discovery-contract.js", [
    "iconoplasm/guest-discovery-store.js",
  ])
  for (const asset of [
    "discovery-collection.js",
    "home-orders.js",
    "request-inbox.js",
    "emulsion-favorites.js",
    "collection-feed.js",
    "iconoplasm-collection-route-state.js",
    "guest-discovery-store.js",
    "home-play-strip.js",
    "vote-login-dialog.js",
    "candidate-delete-dialog.js",
    "generated/anima-emulsion-slot-contract.js",
    "generated/blot-painter.js",
    "vendor/img-comparison-slider.js",
    "vendor/thumbhash.js",
    "vendor/masonry.pkgd.min.js",
    "vendor/imagesloaded.pkgd.min.js",
  ]) {
    await syncStaticImportVersions(staticRoot, `iconoplasm/${asset}`, ["iconoplasm/app.js"])
  }
}
