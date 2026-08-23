import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { parseArguments, parseNullDelimitedPaths, prettierArguments } from "./run-prettier.mjs"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function readRepositoryFile(relativePath) {
  return readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8")
}

test("repository exposes stable architecture and formatting commands", () => {
  const packageJson = JSON.parse(readRepositoryFile("package.json"))

  assert.equal(
    packageJson.scripts["test:architecture-fences"],
    "node ./scripts/run-tests.mjs ./scripts/architecture-fences.test.js",
  )
  assert.equal(packageJson.scripts["check:format"], "node ./scripts/run-prettier.mjs --check")
  assert.equal(
    packageJson.scripts["check:format:changed"],
    "node ./scripts/run-prettier.mjs --check --changed",
  )
  assert.equal(packageJson.scripts.format, "node ./scripts/run-prettier.mjs --write")
  assert.equal(
    packageJson.scripts["format:changed"],
    "node ./scripts/run-prettier.mjs --write --changed",
  )
})

test("formatter wrapper accepts one mode and the optional changed-file scope", () => {
  assert.deepEqual(parseArguments(["--check"]), { mode: "--check", changed: false })
  assert.deepEqual(parseArguments(["--write", "--changed"]), {
    mode: "--write",
    changed: true,
  })
  assert.throws(() => parseArguments([]), /Usage:/)
  assert.throws(() => parseArguments(["--check", "--write"]), /Usage:/)
  assert.throws(() => parseArguments(["--check", "README.md"]), /Usage:/)
})

test("formatter wrapper preserves null-delimited paths and skips unknown file types", () => {
  assert.deepEqual(parseNullDelimitedPaths("one file.js\0migrations/0001.sql\0"), [
    "one file.js",
    "migrations/0001.sql",
  ])

  const arguments_ = prettierArguments({ mode: "--check", files: ["one file.js"] })
  assert.equal(arguments_[1], "--check")
  assert.deepEqual(arguments_.slice(2), ["--ignore-unknown", "--", "one file.js"])
})

test("README names the stable repository commands", () => {
  const readme = readRepositoryFile("README.md")
  for (const command of [
    "pnpm run test:architecture-fences",
    "pnpm run check:format",
    "pnpm run check:format:changed",
    "pnpm run format:changed",
  ]) {
    assert.match(readme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
})

test("ordinary source searches exclude generated and vendored trees", () => {
  const rgIgnore = readRepositoryFile(".rgignore")

  for (const pattern of ["*.map", "**/dist/", "**/generated/", "**/vendor/"]) {
    assert.match(rgIgnore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"))
  }
  assert.match(rgIgnore, /--no-ignore/)
})

test("ISP DNS checker stays inside the Website-owned uv script", () => {
  const wrapper = readRepositoryFile("scripts/check-isp-dns-self-heal.cmd")
  const probe = readRepositoryFile("scripts/probe_isp_resolvers_for_iconoplasm_cdn.py")

  assert.match(wrapper, /uv run --managed-python --script/)
  assert.match(wrapper, /%~dp0probe_isp_resolvers_for_iconoplasm_cdn\.py/)
  assert.doesNotMatch(wrapper, /D:\\Coding\\Iconoplasm/i)
  assert.match(probe, /^# \/\/\/ script$/m)
  assert.match(probe, /^# requires-python = ">=3\.12"$/m)
  assert.match(probe, /uv run --managed-python --script/)
  assert.match(probe, /^if __name__ == "__main__":$/m)
})
