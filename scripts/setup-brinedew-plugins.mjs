import { symlinkSync, existsSync, lstatSync, statSync, rmSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginsDir = join(__dirname, "..", ".quartz", "plugins")

const links = [
  { name: "homepage-crawl-frontier", target: "brinedew-components" },
  { name: "iconoplasm-page-switcher", target: "brinedew-components" },
  { name: "tag-sections", target: "brinedew-components" },
  { name: "draft-tag-injector", target: "brinedew-components" },
  { name: "image-captions", target: "brinedew-image-captions" },
]

function isValidSymlink(linkPath, expectedTarget) {
  try {
    const lst = lstatSync(linkPath)
    if (!lst.isSymbolicLink()) return false
    const resolvedTarget = resolve(dirname(linkPath), expectedTarget)
    const targetStat = statSync(resolvedTarget)
    return targetStat.isDirectory()
  } catch {
    return false
  }
}

for (const { name, target } of links) {
  const linkPath = join(pluginsDir, name)
  const targetPath = join(pluginsDir, target)
  if (!existsSync(targetPath)) {
    console.error(`  ✗ ${name}: target ${target} does not exist at ${targetPath}`)
    continue
  }
  if (isValidSymlink(linkPath, target)) {
    console.log(`  = ${name} (symlink already present and resolves)`)
    continue
  }
  if (existsSync(linkPath)) {
    try {
      rmSync(linkPath, { recursive: true, force: true })
      console.log(`  - removed stale ${name}`)
    } catch (err) {
      console.error(`  ✗ ${name}: failed to remove stale entry: ${err.message}`)
      continue
    }
  }
  try {
    symlinkSync(target, linkPath, "dir")
    console.log(`  ✓ ${name} -> ${target}`)
  } catch (err) {
    console.error(`  ✗ Failed to create symlink ${name}: ${err.message}`)
  }
}
