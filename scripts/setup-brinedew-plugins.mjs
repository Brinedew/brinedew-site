import { symlinkSync, existsSync, lstatSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
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

for (const { name, target } of links) {
  const linkPath = join(pluginsDir, name)
  let needsLink = true
  if (existsSync(linkPath)) {
    try {
      const lst = lstatSync(linkPath)
      if (lst.isSymbolicLink()) {
        needsLink = false
      } else {
        rmSync(linkPath, { recursive: true, force: true })
      }
    } catch {
      rmSync(linkPath, { recursive: true, force: true })
    }
  }
  if (!needsLink) {
    console.log(`  = ${name} (symlink already present)`)
    continue
  }
  try {
    symlinkSync(target, linkPath, "dir")
    console.log(`  ✓ ${name} -> ${target}`)
  } catch (err) {
    console.error(`  ✗ Failed to create symlink ${name}: ${err.message}`)
  }
}
