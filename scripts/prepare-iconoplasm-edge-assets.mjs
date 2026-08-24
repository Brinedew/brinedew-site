import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ICONOPLASM_SERVICE_DISCOVERY_LINKS } from "../workers/iconoplasm-service-discovery.js"

// ARCHITECTURE FENCE [IPD-007]: this bundle is the static half of the
// Iconoplasm failure boundary. Keep its security headers and platform-limit
// validation coupled to direct route ownership; do not replace it with a
// Worker-side cache that still consumes one invocation per file.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicRoot = path.join(repoRoot, "public")
const targetRoot = path.join(repoRoot, "public-iconoplasm-edge")
const maxAssetFiles = 20_000
const maxAssetBytes = 25 * 1024 * 1024

const iconoplasmCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://cdn.discordapp.com https://iconoplasmportraits.b-cdn.net",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "connect-src 'self' data: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com",
  "frame-src 'self' https://brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ")

const serviceDiscoveryHeaders = ICONOPLASM_SERVICE_DISCOVERY_LINKS.map(
  (link) => `  Link: ${link}`,
).join("\n")

const headersFile = `/*
  Content-Security-Policy: ${iconoplasmCsp}
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-site
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
${serviceDiscoveryHeaders}

/
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/privacy
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/license
  Cache-Control: public, max-age=0, must-revalidate, no-transform

/static/iconoplasm/*
  Cache-Control: public, max-age=31536000, immutable

/static/*
  Cache-Control: public, max-age=86400

/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable
`

async function ensureFile(filePath) {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`Expected a file: ${filePath}`)
}

async function inspectTree(directory, bundleRoot) {
  let fileCount = 0
  let totalBytes = 0
  let largest = { path: "", bytes: 0 }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const child = await inspectTree(fullPath, bundleRoot)
      fileCount += child.fileCount
      totalBytes += child.totalBytes
      if (child.largest.bytes > largest.bytes) largest = child.largest
      continue
    }
    if (!entry.isFile()) continue
    const info = await stat(fullPath)
    fileCount += 1
    totalBytes += info.size
    if (info.size > largest.bytes) {
      largest = {
        path: path.relative(bundleRoot, fullPath).replaceAll(path.sep, "/"),
        bytes: info.size,
      }
    }
  }
  return { fileCount, totalBytes, largest }
}

export async function prepareIconoplasmEdgeAssets({
  sourceRoot = publicRoot,
  outputRoot = targetRoot,
} = {}) {
  const resolvedSource = path.resolve(sourceRoot)
  const resolvedOutput = path.resolve(outputRoot)
  if (
    path.dirname(resolvedOutput) !== path.dirname(resolvedSource) ||
    path.basename(resolvedOutput) !== "public-iconoplasm-edge"
  ) {
    throw new Error(`Refusing to replace unexpected asset directory: ${resolvedOutput}`)
  }

  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "index.html"))
  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "privacy.html"))
  await ensureFile(path.join(resolvedSource, "apps", "iconoplasm", "license.html"))
  await ensureFile(path.join(resolvedSource, "favicon.ico"))

  await rm(resolvedOutput, { recursive: true, force: true })
  await mkdir(resolvedOutput, { recursive: true })

  await cp(path.join(resolvedSource, "static"), path.join(resolvedOutput, "static"), {
    recursive: true,
    force: true,
  })

  const rootEntries = await readdir(resolvedSource, { withFileTypes: true })
  for (const entry of rootEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue
    if (!/\.(?:css|js)$/i.test(entry.name) && entry.name !== "favicon.ico") continue
    await copyFile(path.join(resolvedSource, entry.name), path.join(resolvedOutput, entry.name))
  }

  const sourceHome = await readFile(
    path.join(resolvedSource, "apps", "iconoplasm", "index.html"),
    "utf8",
  )
  const standaloneHome = sourceHome
    .replaceAll("../../apps/iconoplasm/privacy", "/privacy")
    .replaceAll("../../apps/iconoplasm/license", "/license")
  await writeFile(path.join(resolvedOutput, "index.html"), standaloneHome, "utf8")
  await copyFile(
    path.join(resolvedSource, "apps", "iconoplasm", "privacy.html"),
    path.join(resolvedOutput, "privacy.html"),
  )
  await copyFile(
    path.join(resolvedSource, "apps", "iconoplasm", "license.html"),
    path.join(resolvedOutput, "license.html"),
  )
  await writeFile(path.join(resolvedOutput, "_headers"), headersFile, "utf8")

  const report = await inspectTree(resolvedOutput, resolvedOutput)
  if (report.fileCount > maxAssetFiles) {
    throw new Error(
      `Iconoplasm asset bundle has ${report.fileCount} files; Cloudflare allows ${maxAssetFiles}`,
    )
  }
  if (report.largest.bytes > maxAssetBytes) {
    throw new Error(
      `Iconoplasm asset ${report.largest.path} is ${report.largest.bytes} bytes; Cloudflare allows ${maxAssetBytes}`,
    )
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await prepareIconoplasmEdgeAssets()
  console.log(
    JSON.stringify({
      output: path.relative(repoRoot, targetRoot).replaceAll(path.sep, "/"),
      file_count: report.fileCount,
      total_bytes: report.totalBytes,
      largest_file: report.largest,
    }),
  )
}
