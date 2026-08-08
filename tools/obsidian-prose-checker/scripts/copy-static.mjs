import { copyFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = resolve(packageRoot, "dist")
await mkdir(output, { recursive: true })
for (const name of ["manifest.json", "styles.css", "versions.json", "LICENSE", "NOTICE"]) {
  await copyFile(resolve(packageRoot, name), resolve(output, name))
}
