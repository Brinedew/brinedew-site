import { FilePath, QUARTZ, joinSegments } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import fs from "fs"
import { glob } from "../../util/glob"
import { dirname } from "path"

// B-905: quartz/static holds the browser modules and, beside each, the test that
// covers it. A test is source, never an asset: published, it spends one of the
// Iconoplasm bundle's 20,000 files and puts test code on the open web. This
// emitter is the one place that decides what quartz/static publishes, and the
// Iconoplasm bundle (scripts/prepare-iconoplasm-edge-assets.mjs) is copied from
// its output, which refuses a bundle that still holds a test file.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

export const Static: QuartzEmitterPlugin = () => ({
  name: "Static",
  async *emit({ argv, cfg }) {
    const staticPath = joinSegments(QUARTZ, "static")
    const fps = (await glob("**", staticPath, cfg.configuration.ignorePatterns)).filter(
      (fp) => !TEST_FILE.test(fp),
    )
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
