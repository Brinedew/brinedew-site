import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const appPath = new URL("./quartz/static/iconoplasm/app.js", import.meta.url)
const releasePath = new URL("./quartz/static/iconoplasm/extension-release.json", import.meta.url)

test("install panel exposes separate Chrome, Edge, and Firefox public instructions", async () => {
  const app = await readFile(appPath, "utf8")

  assert.match(
    app,
    /ICONO_EXTENSION_RELEASE_METADATA_URL\s*=\s*"\/static\/iconoplasm\/extension-release\.json"/,
  )
  assert.match(app, /requested === "edge"/)
  assert.match(app, /id:\s*"edge"/)
  assert.match(app, /label:\s*"Edge"/)
  assert.match(app, /edge:\/\/extensions/)
  assert.match(app, /addons\.mozilla\.org\/en-US\/firefox\/addon\/iconoplasm-gene-illustrations/)
  assert.match(
    app,
    /microsoftedge\.microsoft\.com\/addons\/detail\/ocfhohjhkflpmaiimgjfobdoogdfpmog/,
  )
  assert.match(app, /chromeDeveloperPackageUrl/)
  assert.doesNotMatch(app, /github\.com\/Brinedew\/brinedew-site/)
  assert.doesNotMatch(app, /label:\s*"Source"/)
  assert.doesNotMatch(app, /Firefox needs the signed AMO release/)
  assert.doesNotMatch(app, /Store listing is not live yet/)
  assert.doesNotMatch(app, /Use Chrome or Edge for now/)
  assert.doesNotMatch(app, /Edge Add-ons listing is approved/)
  assert.doesNotMatch(app, /1152921505700927252|PackageValid|Partner Center|Linear B-500/)
})

test("Iconoplasm app routes render the homepage shell on the hosted Quartz path", async () => {
  const app = await readFile(appPath, "utf8")

  const start = app.indexOf("function getRoute()")
  const end = app.indexOf("/* ─── Rendering: Home page ─── */", start)
  assert.notEqual(start, -1, "missing getRoute")
  assert.notEqual(end, -1, "missing getRoute boundary")
  const block = app.slice(start, end)

  assert.match(block, /\/apps\/iconoplasm/)
  assert.match(block, /\/Iconoplasm/)
  assert.match(block, /return \{ page: "home" \}/)
})

test("public release metadata points Chrome developer installs at the current package only", async () => {
  const metadata = JSON.parse(await readFile(releasePath, "utf8"))
  const version = String(metadata.version || "")

  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.equal(
    metadata.chromeDeveloperPackageUrl,
    `/static/iconoplasm/downloads/iconoplasm-extension-v${version}.zip`,
  )
  assert.equal(
    metadata.firefoxListingUrl,
    "https://addons.mozilla.org/en-US/firefox/addon/iconoplasm-gene-illustrations/",
  )
  if (metadata.edgeListingUrl) {
    assert.equal(
      metadata.edgeListingUrl,
      "https://microsoftedge.microsoft.com/addons/detail/ocfhohjhkflpmaiimgjfobdoogdfpmog",
    )
  }
  assert.match(metadata.edgeListingStatus, /^(live|pending)$/)
  assert.doesNotMatch(JSON.stringify(metadata), /github\.com\/Brinedew\/brinedew-site/)
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /1152921505700927252|PackageValid|Partner Center|Linear B-500/,
  )
})

test("manual Chromium install steps derive the package name from release metadata", async () => {
  const app = await readFile(appPath, "utf8")

  assert.doesNotMatch(app, /iconoplasm-extension-v0\.4\.2/)
  assert.match(app, /function chromeDeveloperPackageName\(url\)/)
  assert.match(app, /Tap the button above to download the extension zip/)
  assert.match(app, /Your browser will save it to your Downloads folder/)
  assert.match(app, /extract "' \+ chromePackageName \+ '"/)
  assert.match(
    app,
    /select the extracted "' \+[\s\S]*chromePackageBaseName[\s\S]*\+[\s\S]*'" folder/,
  )
})
