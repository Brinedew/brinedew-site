import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 1_000_000 }).trim()
const requested = process.env.BASE_SHA || ""
if (requested && !/^[a-f0-9]{40}$/.test(requested))
  throw new Error("Invalid release-history base SHA")
const base = requested && !/^0+$/.test(requested) ? requested : git(["rev-parse", "HEAD^"])
// The bytes behind a published version never change. Removing a superseded public
// copy is allowed (B-932): the immutable GitHub release and git history keep it,
// and the site publishes only the package extension-release.json names.
const changes = git([
  "diff",
  "--name-status",
  "--no-renames",
  "--diff-filter=MT",
  base,
  "HEAD",
  "--",
  "quartz/static/iconoplasm/downloads/*.zip",
])
if (changes) throw new Error(`Published extension downloads must never be modified:\n${changes}`)
if (process.argv.includes("--verify-new-package")) {
  const added = git([
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=A",
    base,
    "HEAD",
    "--",
    "quartz/static/iconoplasm/downloads/*.zip",
  ])
  if (added) {
    const { assertSameZipPayload } = await import("./lib/iconoplasm-release-bundle.mjs")
    const version = JSON.parse(
      readFileSync("iconoplasm-extension/publisher-release.json", "utf8"),
    ).version
    const name = `iconoplasm-extension-v${version}.zip`
    if (added !== `quartz/static/iconoplasm/downloads/${name}`)
      throw new Error("Only the newly authorized version may add a public extension package")
    const directory = mkdtempSync(join(tmpdir(), "iconoplasm-release-parity-"))
    try {
      execFileSync(
        process.execPath,
        [
          "scripts/package-iconoplasm-extension.mjs",
          "--release",
          `--expected-version=${version}`,
          `--out-dir=${directory}`,
        ],
        { timeout: 180_000, maxBuffer: 2_000_000 },
      )
      await assertSameZipPayload(readFileSync(added), readFileSync(resolve(directory, name)))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
console.log("No published extension download was modified; new versions must use new files.")
