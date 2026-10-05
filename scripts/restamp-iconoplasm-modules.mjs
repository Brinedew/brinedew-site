#!/usr/bin/env node
// Iconoplasm browser modules import each other as `./name.js?v=<16 hex>`, where
// the stamp is the first 16 hex characters of the target file's SHA-256. The
// stamp busts the CDN and browser caches when a module changes. A stamp change
// alters the importer's own hash, so stamps are rewritten until nothing moves.
//
// A local import with no stamp at all is also reported (and stamped when rewriting).
//
// Order matters: run Prettier first, then this script. Formatting changes the
// bytes and therefore the hashes.
//
//   node scripts/restamp-iconoplasm-modules.mjs          rewrite stale stamps
//   node scripts/restamp-iconoplasm-modules.mjs --check  exit 1 if any are stale
//
// This used to live only in an agent scratchpad (agent pet peeves document,
// 2026-09-25, section 1), so every agent rediscovered it or hand-edited hashes.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const check = args.includes("--check")
const dirArg = args.find((arg) => !arg.startsWith("--"))
const dir = path.resolve(dirArg || "quartz/static/iconoplasm")
// Imports of ./generated/ and ./vendor/ files are stamped too; they used to be stamped by hand.
const STAMP = /(["'(])(\.\/(?:generated\/|vendor\/)?[A-Za-z0-9._-]+\.(?:js|css))\?v=([a-f0-9]{16})/g

// The edge serves /static/iconoplasm/* as immutable, so an import with no stamp is never
// refreshed for a returning reader. Only the Iconoplasm directory is held to this rule.
const UNSTAMPED =
  /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\/(?:generated\/|vendor\/)?[A-Za-z0-9._-]+\.(?:js|css))\2/g
const requireStamps = path.basename(dir) === "iconoplasm"

const hashOf = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)
const files = readdirSync(dir).filter(
  (name) => /\.(js|css|mjs)$/.test(name) && !name.endsWith(".test.js"),
)

function restampOnce(write) {
  const stale = []
  for (const name of files) {
    const full = path.join(dir, name)
    const source = readFileSync(full, "utf8")
    const next = source.replace(STAMP, (match, quote, rel, old) => {
      const target = path.join(dir, rel)
      if (!existsSync(target)) return match
      const current = hashOf(target)
      if (current === old) return match
      stale.push(`${name} -> ${rel}`)
      return `${quote}${rel}?v=${current}`
    })
    let stamped = next
    if (requireStamps) {
      stamped = next.replace(UNSTAMPED, (match, lead, quote, rel) => {
        const target = path.join(dir, rel)
        if (!existsSync(target)) return match
        stale.push(`${name} -> ${rel} (no stamp)`)
        return `${lead}${quote}${rel}?v=${hashOf(target)}${quote}`
      })
    }
    if (write && stamped !== source) writeFileSync(full, stamped)
  }
  return stale
}

if (check) {
  const stale = restampOnce(false)
  if (stale.length) {
    console.error(`Stale module stamps (run without --check to fix):\n  ${stale.join("\n  ")}`)
    process.exit(1)
  }
  console.log("Iconoplasm module stamps are current.")
} else {
  for (let round = 0; round < 20; round += 1) {
    const changed = restampOnce(true)
    if (!changed.length) {
      console.log(round ? `Restamped in ${round} round(s).` : "Stamps already current.")
      process.exit(0)
    }
    for (const entry of changed) console.log(`round ${round}: ${entry}`)
  }
  console.error("Stamps did not reach a fixpoint in 20 rounds.")
  process.exit(1)
}
