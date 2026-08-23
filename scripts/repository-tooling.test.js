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
