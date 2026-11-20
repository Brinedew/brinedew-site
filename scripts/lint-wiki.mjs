#!/usr/bin/env node
/**
 * Deterministic wiki editorial linter for content/wiki/*.md.
 *
 * Catches mechanical failure modes before they ship:
 *   1. ocr-callout-not-in-footnote: Top-level (non-indented) `> [!info]` primary-source
 *      excerpt callouts with embedded images — catches both mid-page OCR inserts and
 *      floating OCR callouts separated from their `[^key]:` footnote definition.
 *   2. ocr-pipeline-leak: Raw Occurock locators (`doc:.../page:...`) or internal
 *      OCR tooling labels (`OCR excerpt:`, `OCR unavailable`, `OCR packaging`).
 *   3. raw-svg-codeblock: Raw ```svg blocks in wiki markdown (breaks dark mode).
 *   4. chat-residue: Unstripped LLM Q&A chatter or bolted-on meta-scaffolding headers.
 *
 * Usage:
 *   node ./scripts/lint-wiki.mjs                     # lint all content/wiki/*.md
 *   node ./scripts/lint-wiki.mjs content/wiki/foo.md # lint specific file(s)
 */

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "..")
const WIKI_DIR = path.join(REPO_ROOT, "content", "wiki")

const PIPELINE_LEAK_RE =
  /\bdoc:[A-Za-z0-9_-]+\/page:\d+|\*\*OCR excerpt:\*\*|\bOCR packaging\b|\bOCR unavailable\b/i

const CHAT_RESIDUE_RE =
  /^\s*(?:You are completely right|The short answer:|Sanity-check verdict:|In your framing\b)|^#{1,4}\s+(?:Editorial synthesis|Wiki adjudication)\b/i

function lintFile(filePath) {
  const relPath = path.relative(REPO_ROOT, filePath).replaceAll("\\", "/")
  const raw = fs.readFileSync(filePath, "utf8")
  const lines = raw.split(/\r?\n/)
  const findings = []

  let inCodeFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (/^```/.test(line.trim())) {
      if (!inCodeFence && /^```svg\b/i.test(line.trim())) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: "raw-svg-codeblock",
          message:
            "Raw ```svg code block in wiki markdown breaks dark mode; use theme-aware vega-lite or an Attachment.",
        })
      }
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) continue

    // 1. Top-level (not indented inside a footnote) > [!info] callout with an image or primary excerpt
    if (/^>\s*\[!info\]-?/i.test(line)) {
      // Look ahead within the same callout block for an embedded image or "Primary source excerpt"
      let hasImageOrExcerpt = /primary source excerpt/i.test(line)
      for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) {
        if (/!\[\[.+?\.(?:png|jpe?g|webp|svg)/i.test(lines[j])) {
          hasImageOrExcerpt = true
          break
        }
      }
      if (hasImageOrExcerpt) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: "ocr-callout-not-in-footnote",
          message:
            "OCR/primary-source screenshot callout is at top level (mid-page or detached from its footnote). Indent it 4 spaces directly inside its `[^key]:` footnote under `## References`.",
        })
      }
    }

    // 2. Leaked Occurock locators or OCR pipeline text
    if (PIPELINE_LEAK_RE.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        rule: "ocr-pipeline-leak",
        message: "Internal OCR locator or tooling label leaked into reader-facing prose.",
      })
    }

    // 3. Chat residue / meta-scaffolding
    if (CHAT_RESIDUE_RE.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        rule: "chat-residue",
        message: "Unstripped chat residue or meta-scaffolding header found.",
      })
    }
  }

  return findings
}

function collectTargets(args) {
  if (args.length > 0) {
    return args.map((arg) => path.resolve(REPO_ROOT, arg)).filter((p) => fs.existsSync(p))
  }
  return fs
    .readdirSync(WIKI_DIR)
    .filter((name) => name.endsWith(".md") && name !== "Wiki Assessment.md")
    .sort()
    .map((name) => path.join(WIKI_DIR, name))
}

const targets = collectTargets(process.argv.slice(2))
const allFindings = targets.flatMap(lintFile)

if (allFindings.length === 0) {
  console.log(`lint-wiki: ${targets.length} file(s) checked, 0 issues found.`)
  process.exit(0)
}

for (const f of allFindings) {
  console.error(`${f.file}:${f.line} [${f.rule}] ${f.message}`)
}
console.error(`\nlint-wiki: ${allFindings.length} issue(s) found across ${targets.length} file(s).`)
process.exit(1)
