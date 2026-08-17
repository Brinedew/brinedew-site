import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..")
const certificationPath = resolve(
  repoRoot,
  "iconoplasm-extension",
  "pdf-ownership-certification.json",
)
const targetArgument = process.argv.find((argument) => argument.startsWith("--target="))
const target = String(targetArgument?.slice("--target=".length) || "").toLowerCase()
const certification = JSON.parse(readFileSync(certificationPath, "utf8"))
const targetCertification = certification.targets?.[target]

if (!targetCertification) {
  throw new Error(`Unknown Iconoplasm PDF ownership target: ${target || "<missing>"}`)
}
if (!targetCertification.store_release_ready) {
  const blockers = (targetCertification.blockers || []).map((blocker) => `- ${blocker}`).join("\n")
  throw new Error(
    `Iconoplasm ${target} PDF ownership is not store-certified.\n${blockers || "- No blocker was recorded."}`,
  )
}

console.log(
  `[verify-iconoplasm-pdf-release-gate] ${target} is certified with ${targetCertification.driver}`,
)
