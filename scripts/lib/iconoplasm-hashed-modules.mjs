// Iconoplasm's browser modules are served under names that carry the SHA-256
// of their own bytes (caretaker-film.74ed28e6c4cce069.v.js), so a name can never
// answer with other bytes. The edge ignores query strings: under the old
// `?v=<hash>` stamps, a reader who loaded a page while a release was still
// spreading could cache last release's file under this release's stamp for a
// year, and its imports then broke until the reader cleared the cache by hand
// (caretaker panel, 2026-10-29). A file that is missing now answers 404
// instead, which a reload repairs (the recovery script in Head.tsx).
//
// Ways this can fail, each checked below or in
// workers/iconoplasm-static-assets.workerd.test.js:
//  1. A name stops matching its bytes: a file is renamed by its source hash and
//     a dependency changes without the importer's source changing. Names are
//     hashed from the rewritten output, dependencies first.
//  2. Modules import each other in a loop, so no order names them. The build
//     refuses the loop instead of guessing.
//  3. A reference is missed and loads the unversioned copy, so one module runs
//     twice with two copies of its state. The unversioned copy holds the same
//     bytes as the versioned one, so its imports join the same graph, and
//     pages are checked for any reference left behind.
//  4. A tab opened before a release asks later for a file the release removed.
//     The previous releases' files are carried forward for a week, as many as
//     Cloudflare's 20,000-file limit leaves room for, newest first.
//  5. A carried-forward file comes back with other bytes. Its name is its hash,
//     so the build checks the bytes and refuses a mismatch.
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

// Every script and stylesheet under static/ is versioned, the site-wide ones
// (site-preferences.js, shared/) too: Iconoplasm modules import them.
export const MODULE_ROOT = "static"
// Shoelace, Vega and the classic-script libraries keep their own paths: their
// files load each other by name, and they change only when we upgrade them.
const UNVERSIONED_FOLDERS = new Set(["vendor", "downloads"])
const MODULE_FILE = /\.(?:js|css|mjs)$/
// The ".v" before the extension is what the _headers rule `/static/*.v.js`
// matches to make a versioned file immutable. A placeholder inside a file name
// (`/static/*.:hash.js`) passes in Miniflare but never matched in production
// (measured 2026-10-29: every versioned file answered must-revalidate), so the
// rule is a splat and fixed text, the shape `/static/*.js` proves live.
export const VERSIONED_NAME = /\.([0-9a-f]{16})\.v\.(js|css|mjs)$/
// Release af8041a66 named files without the ".v"; the manifest it wrote still
// lists them, and they are as content-addressed as the new ones.
const EARLIER_NAME = /\.([0-9a-f]{16})(?:\.v)?\.(js|css|mjs)$/
// A quoted relative or root-relative module address inside a module, with or
// without the old ?v= stamp. Template strings with ${} are not addresses.
const MODULE_REFERENCE =
  /(["'`])((?:\.{1,2}\/|\/static\/)[^"'`\s?#$]*\.(?:js|css|mjs))(\?v=[A-Za-z0-9-]*)?\1/g
// The same inside a page: Quartz writes ../../static/iconoplasm/app.js inside
// scripts and /static/iconoplasm/app.js in attributes.
const PAGE_REFERENCE =
  /((?:\.\.\/)+|\/)static\/([A-Za-z0-9._/-]+\.(?:js|css|mjs))(\?v=[A-Za-z0-9-]*)?/g
export const RETENTION_DAYS = 7

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

async function moduleFiles(outputRoot, relative = MODULE_ROOT) {
  const files = []
  for (const entry of await readdir(path.join(outputRoot, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (UNVERSIONED_FOLDERS.has(entry.name)) continue
      files.push(...(await moduleFiles(outputRoot, child)))
    } else if (entry.isFile() && MODULE_FILE.test(entry.name)) files.push(child)
  }
  return files
}

function resolveReference(from, specifier) {
  if (specifier.startsWith("/")) return specifier.slice(1)
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
}

function versionedPath(file, hash) {
  return file.replace(MODULE_FILE, (extension) => `.${hash}.v${extension}`)
}

// Writes name.<hash>.ext beside every script and stylesheet under static/
// (vendor/ and downloads/ folders excepted), points every reference
// between them at the versioned names, and gives the unversioned copy the same
// bytes for callers we don't build (the Worker's admin pages, old tabs).
export async function versionIconoplasmModules({ outputRoot }) {
  const files = await moduleFiles(outputRoot)
  const known = new Set(files)
  const sources = new Map()
  for (const file of files) {
    const source = await readFile(path.join(outputRoot, file), "utf8")
    if (/\.v\.(?:js|css|mjs)$/.test(file))
      throw new Error(`${file} would be cached as immutable by its name; rename it`)
    sources.set(file, source)
  }
  const dependencies = new Map(
    files.map((file) => [
      file,
      [...sources.get(file).matchAll(MODULE_REFERENCE)]
        .map((match) => resolveReference(file, match[2]))
        .filter((target) => known.has(target) && target !== file),
    ]),
  )
  const versioned = new Map()
  const outputs = new Map()
  const visiting = new Set()
  const name = (file, trail) => {
    if (versioned.has(file)) return versioned.get(file)
    if (visiting.has(file))
      throw new Error(
        `Iconoplasm modules import each other in a loop: ${[...trail, file].join(" -> ")}`,
      )
    visiting.add(file)
    for (const dependency of dependencies.get(file)) name(dependency, [...trail, file])
    const output = sources.get(file).replace(MODULE_REFERENCE, (match, quote, specifier) => {
      const target = resolveReference(file, specifier)
      if (!versioned.has(target)) return match
      const folder = specifier.slice(0, specifier.lastIndexOf("/") + 1)
      return `${quote}${folder}${path.posix.basename(versioned.get(target))}${quote}`
    })
    visiting.delete(file)
    outputs.set(file, output)
    versioned.set(file, versionedPath(file, sha256(output).slice(0, 16)))
    return versioned.get(file)
  }
  for (const file of files) name(file, [])
  for (const file of files) {
    await writeFile(path.join(outputRoot, versioned.get(file)), outputs.get(file), "utf8")
    await writeFile(path.join(outputRoot, file), outputs.get(file), "utf8")
  }
  return versioned
}

export function versionPageReferences(html, versioned) {
  return String(html).replace(PAGE_REFERENCE, (match, prefix, relative) => {
    const target = versioned.get(`${MODULE_ROOT}/${relative}`)
    return target ? `${prefix}${target}` : match
  })
}

// Every reference a page still makes to an unversioned module or stylesheet.
export function unversionedPageReferences(html, versioned) {
  return [...String(html).matchAll(PAGE_REFERENCE)]
    .map((match) => `${MODULE_ROOT}/${match[2]}`)
    .filter((file) => versioned.has(file))
}

// Carries the previous releases' versioned files forward, so a tab opened
// before this release still finds the file it asks for later. `previous` is the
// live _build-manifest.json; its `modules` map each versioned path to the last
// time a release shipped it. Returns this release's map for the new manifest.
export async function retainEarlierModules({
  outputRoot,
  versioned,
  previous,
  room,
  fetchFile,
  now = new Date(),
  log = console,
}) {
  const current = new Set(versioned.values())
  const modules = Object.fromEntries([...current].sort().map((file) => [file, now.toISOString()]))
  const earliest = now.getTime() - RETENTION_DAYS * 86_400_000
  const candidates = Object.entries(previous?.modules || {})
    .filter(
      ([file, shipped]) =>
        !current.has(file) &&
        file.startsWith(`${MODULE_ROOT}/`) &&
        !file.split("/").includes("..") &&
        EARLIER_NAME.test(file) &&
        Date.parse(shipped) >= earliest,
    )
    .sort(([, left], [, right]) => Date.parse(right) - Date.parse(left))
  const kept = []
  for (const [file, shipped] of candidates) {
    if (kept.length >= room) {
      log.warn(
        `Iconoplasm kept ${kept.length} earlier module files; Cloudflare's file limit leaves no room for ${candidates.length - kept.length} more`,
      )
      break
    }
    let bytes
    try {
      bytes = await fetchFile(file)
    } catch (error) {
      log.warn(`Iconoplasm could not carry ${file} forward (${error.message})`)
      continue
    }
    if (!bytes) continue
    if (sha256(bytes).slice(0, 16) !== file.match(EARLIER_NAME)[1])
      throw new Error(`The live ${file} does not match the hash in its name`)
    await mkdir(path.dirname(path.join(outputRoot, file)), { recursive: true })
    await writeFile(path.join(outputRoot, file), bytes)
    modules[file] = shipped
    kept.push(file)
  }
  return { modules, kept }
}

export async function loadLiveBuildManifest({ origin, log = console }) {
  try {
    const response = await fetch(`${origin}/_build-manifest.json`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } catch (error) {
    log.warn(
      `Iconoplasm earlier modules not carried forward: live manifest unavailable (${error.message})`,
    )
    return null
  }
}

export function liveFileFetcher(origin) {
  return async (file) => {
    const response = await fetch(`${origin}/${file}`, { signal: AbortSignal.timeout(30_000) })
    if (response.status === 404) throw new Error("HTTP 404")
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }
}
