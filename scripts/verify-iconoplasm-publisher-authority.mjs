import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertIconoplasmPublisherAuthority } from "./lib/iconoplasm-publisher-authority.mjs"

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..")
const expectedArg = process.argv.find((arg) => arg.startsWith("--expected="))
const expectedVersion = expectedArg ? expectedArg.slice("--expected=".length) : undefined

try {
  const result = assertIconoplasmPublisherAuthority(repoRoot, { expectedVersion })
  console.log(
    `[iconoplasm-publisher-authority] ${result.version} (catalog schema ${result.contractSchemaVersion}, revision ${result.contractRevision})`,
  )
} catch (error) {
  console.error(`[iconoplasm-publisher-authority] ${error.message}`)
  process.exit(1)
}
