import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "wxt"

function readIconoplasmManifest() {
  return JSON.parse(readFileSync(resolve("iconoplasm-extension", "manifest.json"), "utf8"))
}

export default defineConfig({
  srcDir: `iconoplasm-extension/.wxt-${process.env.ICONOPLASM_WXT_BROWSER || "chrome"}/src`,
  publicDir: `iconoplasm-extension/.wxt-${process.env.ICONOPLASM_WXT_BROWSER || "chrome"}/public`,
  outDir: "iconoplasm-extension/dist/wxt",
  outDirTemplate: "{{browser}}-mv{{manifestVersion}}",
  manifest: ({ browser }) => {
    const manifest = readIconoplasmManifest()
    if (browser === "firefox") {
      manifest.background = { scripts: ["service-worker.js"] }
    }
    if (browser !== "firefox") {
      delete manifest.browser_specific_settings
    }
    return manifest
  },
  zip: {
    name: "iconoplasm",
    artifactTemplate: "iconoplasm-{{browser}}-v{{version}}.zip",
    sourcesTemplate: "iconoplasm-firefox-v{{version}}-sources.zip",
    zipSources: false,
  },
})
