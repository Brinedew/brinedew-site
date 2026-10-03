import { FilePath, QUARTZ, joinSegments } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import fs from "fs"
import { glob } from "../../util/glob"
import { basename, dirname } from "path"

// B-905: quartz/static holds the browser modules and, beside each, the test that
// covers it. A test is source, never an asset: published, it spends one of the
// Iconoplasm bundle's 20,000 files and puts test code on the open web. This
// emitter is the one place that decides what quartz/static publishes, and the
// Iconoplasm bundle (scripts/prepare-iconoplasm-edge-assets.mjs) is copied from
// its output, which refuses a bundle that still holds a test file.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

// B-932: the GUI release transaction commits one extension package per release
// into iconoplasm/downloads/. The site offers a single manual-install download,
// the one iconoplasm/extension-release.json names; the immutable GitHub release
// and git history keep every other version. A package the metadata does not name
// is a file of the bundle's cap and megabytes nobody downloads, so it is not
// published, and the bundle build refuses one that still arrives.
const EXTENSION_DOWNLOADS = "iconoplasm/downloads/"
const EXTENSION_RELEASE = "iconoplasm/extension-release.json"
const isExtensionPackage = (fp: string) =>
  fp.startsWith(EXTENSION_DOWNLOADS) &&
  fp.endsWith(".zip") &&
  !fp.slice(EXTENSION_DOWNLOADS.length).includes("/")

// The one package the metadata names, as a path relative to quartz/static.
function namedExtensionPackage(staticPath: string): string {
  let release: { chromeDeveloperPackageUrl?: unknown }
  try {
    release = JSON.parse(fs.readFileSync(joinSegments(staticPath, EXTENSION_RELEASE), "utf8"))
  } catch (error) {
    throw new Error(
      `${EXTENSION_RELEASE} cannot be read, so the published extension package is unknown: ${error}`,
    )
  }
  const url = release?.chromeDeveloperPackageUrl
  if (typeof url !== "string" || !url.endsWith(".zip"))
    throw new Error(`${EXTENSION_RELEASE} names no chromeDeveloperPackageUrl`)
  if (dirname(url) + "/" !== `/static/${EXTENSION_DOWNLOADS}`)
    throw new Error(
      `${EXTENSION_RELEASE} names ${url}, which is not a package in /static/${EXTENSION_DOWNLOADS}`,
    )
  return EXTENSION_DOWNLOADS + basename(url)
}

export const Static: QuartzEmitterPlugin = () => ({
  name: "Static",
  async *emit({ argv, cfg }) {
    const staticPath = joinSegments(QUARTZ, "static")
    const candidates = (await glob("**", staticPath, cfg.configuration.ignorePatterns)).filter(
      (fp) => !TEST_FILE.test(fp),
    )
    let fps: typeof candidates = candidates
    if (candidates.some((fp) => isExtensionPackage(fp) || fp === EXTENSION_RELEASE)) {
      const named = namedExtensionPackage(staticPath)
      if (!candidates.includes(named as FilePath))
        throw new Error(`${EXTENSION_RELEASE} names ${named}, which is not in quartz/static`)
      fps = candidates.filter((fp) => !isExtensionPackage(fp) || fp === named)
    }
    const outputStaticPath = joinSegments(argv.output, "static")
    await fs.promises.mkdir(outputStaticPath, { recursive: true })
    for (const fp of fps) {
      const src = joinSegments(staticPath, fp) as FilePath
      const dest = joinSegments(outputStaticPath, fp) as FilePath
      await fs.promises.mkdir(dirname(dest), { recursive: true })
      await fs.promises.copyFile(src, dest)
      yield dest
    }
  },
  async *partialEmit() {},
})
