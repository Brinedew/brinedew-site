import fs from "fs"
import path from "path"

// B-1161: the Iconoplasm app is a tree of browser modules with no bundler. The
// browser finds each level only after the level above has downloaded, and the
// app itself is injected at DOMContentLoaded, so a phone's first gene page used
// to wait for every stylesheet, then for app.js, then for its imports, then for
// theirs. The shell lists the whole static tree as modulepreload links instead,
// so every module downloads in parallel with the stylesheets from the start.
//
// Only static imports are followed: a dynamic import() (Diagram Studio,
// PhotoSwipe) is what a page loads on demand. The URLs are the importers' own
// stamped specifiers, resolved the way the browser resolves them, so the
// preloaded module is the one the import asks for.
const STATIC_IMPORT =
  /^\s*(?:import|export)\s[^;"']*?\sfrom\s+["'](\.{1,2}\/[^"']+)["']|^\s*import\s+["'](\.{1,2}\/[^"']+)["']/gms

export function iconoplasmModulePreloads(
  staticRoot = path.join(process.cwd(), "quartz", "static"),
  entry = "iconoplasm/app.js",
): string[] {
  const urls: string[] = []
  const seen = new Set<string>([entry])
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()!
    let source: string
    try {
      source = fs.readFileSync(path.join(staticRoot, file), "utf8")
    } catch {
      continue
    }
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] || match[2]
      const [relative, query] = specifier.split("?", 2)
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative))
      if (target.startsWith("..") || seen.has(target)) continue
      seen.add(target)
      urls.push(query ? `${target}?${query}` : target)
      queue.push(target)
    }
  }
  return urls
}
