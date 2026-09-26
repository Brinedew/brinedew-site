import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

// When assert.equal/deepEqual fails, Node prints both values with util.inspect
// at depth 1000 with getters on. A linkedom node reaches the whole document, and
// every getter hands back fresh objects, so the printer never finishes. Measured
// 26 Sep 2026: one failing assert.equal(host.querySelector(...), null) grew a
// test process past 8 GB in 16 seconds, and a --max-old-space-size cap did not
// stop it. It crashed the owner's desktop twice. Compare nodes with === and assert
// the boolean instead: assert.equal(host.querySelector(sel) === null, true).
const NODE_VALUED =
  /(?:\.(?:querySelector|getElementById|closest)\([^()]*\)|\.(?:activeElement|parentNode|parentElement|firstChild|lastChild|firstElementChild|lastElementChild|nextSibling|previousSibling|nextElementSibling|previousElementSibling|documentElement))$/

const printsNode = (arg) => !/[!=]==/.test(arg) && NODE_VALUED.test(arg)

function assertionArguments(source) {
  const found = []
  const opener =
    /\bassert\.(?:equal|strictEqual|notEqual|notStrictEqual|deepEqual|deepStrictEqual)\(/g
  for (const match of source.matchAll(opener)) {
    const args = []
    let depth = 0
    let quote = null
    let start = match.index + match[0].length
    for (let i = start; i < source.length; i++) {
      const c = source[i]
      if (quote) {
        if (c === "\\") i++
        else if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === "`") quote = c
      else if ("([{".includes(c)) depth++
      else if (")]}".includes(c) && depth > 0) depth--
      else if ((c === "," || c === ")") && depth === 0) {
        args.push(source.slice(start, i).trim())
        start = i + 1
        if (c === ")" || args.length === 2) break
      }
    }
    const line = source.slice(0, match.index).split("\n").length
    found.push({ line, args })
  }
  return found
}

test("DOM tests never hand a node to an assertion printer", () => {
  const files = execFileSync("git", ["ls-files", "*.test.js", "*.test.mjs", "*.test.ts"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
  const offenders = []
  for (const file of files) {
    const source = readFileSync(file, "utf8")
    if (!/from "linkedom"/.test(source)) continue
    for (const { line, args } of assertionArguments(source)) {
      if (args.some(printsNode)) offenders.push(`${file}:${line}`)
    }
  }
  assert.deepEqual(offenders, [], "compare DOM nodes with === and assert the boolean")
})

test("the node detector sees the shapes that crashed the desktop", () => {
  const probe = (text) => assertionArguments(text).some(({ args }) => args.some(printsNode))
  assert.equal(probe(`assert.equal(host.querySelector('[aria-label="Add"]'), null)`), true)
  assert.equal(probe(`assert.equal(doc.activeElement, invoker)`), true)
  assert.equal(probe(`assert.equal(\n  parent.firstChild,\n  original,\n)`), true)
  assert.equal(probe(`assert.equal(host.querySelector("a") === null, true)`), false)
  assert.equal(probe(`assert.equal(doc.activeElement === host.querySelector("a"), true)`), false)
  assert.equal(probe(`assert.equal(host.querySelector("a").textContent, "Sign in")`), false)
  assert.equal(probe(`assert.equal(document.querySelector("main")?.id, "icono-main")`), false)
})
