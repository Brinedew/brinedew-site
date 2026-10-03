import { existsSync } from "node:fs"
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
  assert.ok(
    existsSync(new URL(`./quartz${metadata.chromeDeveloperPackageUrl}`, import.meta.url)),
    "the package the metadata names is in the tree",
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

// B-932: the site publishes only the package extension-release.json names, so
// app.js must not carry a version of its own. A literal there is a link to a file
// the bundle no longer holds, and it is what a visitor gets when the panel opens
// before the metadata fetch returns or the fetch fails.
// Failure modes, written before the change:
// 1. an inline default or a string fallback names a version (0.4.7, 0.4.3);
// 2. the download button points anywhere but the loaded metadata's package;
// 3. with no metadata the panel shows a button that goes nowhere.
test("the install panel links the Chrome package only from the loaded release metadata", async () => {
  const app = await readFile(appPath, "utf8")

  assert.doesNotMatch(app, /iconoplasm-extension-v\d/, "no versioned package name in app.js")
  assert.doesNotMatch(app, /\/static\/iconoplasm\/downloads/, "no downloads path in app.js")
  assert.doesNotMatch(app, /"0\.4\.\d+"/, "no inline version fallback")
  assert.match(
    app,
    /release:\s*\{\s*version:\s*"",\s*chromeDeveloperPackageUrl:\s*"",/,
    "the inline default names no version and no package",
  )
  assert.match(app, /The download link has not loaded/, "the panel says so when it has no package")
})

test("manual Chromium install steps derive the package name from release metadata", async () => {
  const app = await readFile(appPath, "utf8")

  assert.doesNotMatch(app, /iconoplasm-extension-v\d/)
  assert.match(app, /function chromeDeveloperPackageName\(url\)/)
  assert.match(app, /Tap the button above to download the extension zip/)
  assert.match(app, /Your browser will save it to your Downloads folder/)
  assert.match(app, /extract "' \+ chromePackageName \+ '"/)
  assert.match(
    app,
    /select the extracted "' \+[\s\S]*chromePackageBaseName[\s\S]*\+[\s\S]*'" folder/,
  )
})
