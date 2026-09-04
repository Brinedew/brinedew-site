import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { format, resolveConfig } from "prettier"

export async function syncStaticImportVersions(staticRoot, modulePath, consumerPaths) {
  const moduleFile = path.join(staticRoot, modulePath)
  const version = createHash("sha256")
    .update(await readFile(moduleFile))
    .digest("hex")
    .slice(0, 16)
  for (const consumerPath of consumerPaths) {
    const consumer = path.join(staticRoot, consumerPath)
    let specifier = path.relative(path.dirname(consumer), moduleFile).replaceAll("\\", "/")
    if (!specifier.startsWith(".")) specifier = `./${specifier}`
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`(["'])${escaped}(?:\\?v=[^"']+)?\\1`, "g")
    const source = await readFile(consumer, "utf8")
    const next = source.replace(pattern, `$1${specifier}?v=${version}$1`)
    if (next === source && !source.includes(`${specifier}?v=${version}`)) {
      throw new Error(`Unable to synchronize ${modulePath} import in ${consumerPath}`)
    }
    const formatted = await format(next, { ...(await resolveConfig(consumer)), filepath: consumer })
    if (formatted !== source) await writeFile(consumer, formatted, "utf8")
  }
}

// Child versions must reach their parents before those parents are hashed.
// X6 uses a runtime URL constant rather than a literal import expression.
export async function syncStudioImportVersions(staticRoot) {
  await syncStaticImportVersions(staticRoot, "iconoplasm/generated/x6-runtime.js", [
    "iconoplasm/diagram-x6-editor.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/diagram-document.js", [
    "iconoplasm/diagram-studio.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/diagram-x6-editor.js", [
    "iconoplasm/diagram-studio.js",
  ])
  await syncStaticImportVersions(staticRoot, "iconoplasm/diagram-studio.js", ["iconoplasm/app.js"])
}
