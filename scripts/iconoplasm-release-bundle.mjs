import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertIconoplasmPublisherAuthority } from "./lib/iconoplasm-publisher-authority.mjs"
import {
  ReleaseArchive,
  releaseIdentity,
  releaseArtifactNames,
  createReleaseManifest,
  assertSameZipPayload,
} from "./lib/iconoplasm-release-bundle.mjs"

const root = resolve(fileURLToPath(import.meta.url), "..", "..")
const identity = releaseIdentity(
  process.env.EXPECTED_VERSION || "",
  process.env.EXPECTED_COMMIT || "",
)
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
}).trim()
if (head !== identity.commit) throw new Error("Checkout differs from the authorized release commit")
assertIconoplasmPublisherAuthority(root, { expectedVersion: identity.version })
const archive = new ReleaseArchive(identity)
const dist = resolve(root, "iconoplasm-extension", "dist")
const command = process.argv[2]

function saveVerified(files) {
  mkdirSync(dist, { recursive: true })
  for (const [name, bytes] of files) {
    const path = resolve(dist, name)
    if (existsSync(path)) {
      if (!readFileSync(path).equals(bytes))
        throw new Error(`Refusing to replace local release artifact ${name}`)
    } else writeFileSync(path, bytes, { flag: "wx" })
  }
}

if (command === "inspect") {
  const release = archive.inspect()
  const sealed = Boolean(release && !release.draft)
  if (sealed) archive.download()
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sealed=${sealed}\n`)
  console.log(`Release ${identity.tag}: ${sealed ? "sealed and verified" : "awaiting preparation"}`)
} else if (command === "download") {
  saveVerified(archive.download().files)
  console.log(`Verified immutable ${identity.tag} for ${identity.commit}`)
} else if (command === "seal") {
  if (process.env.HUMAN_CONFIRMATION !== "YES, I AM A HUMAN, PUBLISH ICONOPLASM")
    throw new Error("Sealing a release requires the existing human GUI publish gate")
  const names = releaseArtifactNames(identity.version)
  const files = new Map(names.map((name) => [name, readFileSync(resolve(dist, name))]))
  const chrome = names[0]
  const publishedChrome = readFileSync(resolve(root, "quartz/static/iconoplasm/downloads", chrome))
  // Chrome is committed by the GUI. Rebuild only to prove source parity, then
  // archive the originally approved bytes, never the rebuild's ZIP timestamps.
  await assertSameZipPayload(publishedChrome, files.get(chrome))
  files.set(chrome, publishedChrome)
  const manifest = await createReleaseManifest(identity, files)
  archive.seal(resolve(dist, "release-bundle"), manifest, files)
  console.log(`Sealed and downloaded all verified ${identity.tag} artifacts`)
} else throw new Error("Expected inspect, download, or seal")
