import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "wxt"

function readIconoplasmManifest() {
  return JSON.parse(readFileSync(resolve("iconoplasm-extension", "manifest.json"), "utf8"))
}

export default defineConfig({
  srcDir: `iconoplasm-extension/.wxt-${process.env.ICONOPLASM_WXT_BROWSER || "chrome"}/src`,
  publicDir: `iconoplasm-extension/.wxt-${process.env.ICONOPLASM_WXT_BROWSER || "chrome"}/public`,
  outDir: process.env.ICONOPLASM_WXT_OUT_DIR || "iconoplasm-extension/dist/validation/wxt",
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}",
  manifest: ({ browser }) => {
    const manifest = readIconoplasmManifest()
    if (browser === "firefox") {
      // Firefox implements MV3 background execution as a background page, where
      // importScripts is unavailable. Declare every top-level service-worker
      // dependency explicitly and in dependency order; otherwise the background
      // script can fail before it registers the gene-data message listener.
      manifest.background = {
        scripts: [
          "pdf-byte-store.js",
          "pdf-gecko-ownership.js",
          "generated/catalog-contract.js",
          "generated/portrait-delivery-core.js",
          "publication-alias-overlay.js",
          "content-settings.js",
          "service-worker.js",
        ],
      }
      manifest.permissions = [
        ...new Set([
          ...(manifest.permissions || []),
          "webRequest",
          "webRequestBlocking",
          "webRequestFilterResponse",
          "webNavigation",
        ]),
      ]
      manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), "<all_urls>"])]
      manifest.content_scripts = [
        {
          matches: ["http://*/*", "https://*/*"],
          js: ["pdf-gecko-redirect.js"],
          run_at: "document_start",
        },
        ...manifest.content_scripts,
      ]
      delete manifest.mime_types_handler
    }
    if (browser === "safari") {
      delete manifest.mime_types_handler
    }
    if (browser !== "firefox") {
      delete manifest.browser_specific_settings
    }
    return manifest
  },
  zip: {
    name: "iconoplasm",
    artifactTemplate: process.env.ICONOPLASM_WXT_ARTIFACT_TEMPLATE || "wxt-validation.zip",
    sourcesTemplate: "iconoplasm-firefox-v{{version}}-sources.zip",
    zipSources: false,
  },
})
