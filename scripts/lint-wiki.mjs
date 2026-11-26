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
import { spawnSync } from "node:child_process"

const REPO_ROOT = path.resolve(import.meta.dirname, "..")
const WIKI_DIR = path.join(REPO_ROOT, "content", "wiki")
const POSTS_DIR = path.join(REPO_ROOT, "content", "posts")
const ATTACHMENTS_DIR = path.join(REPO_ROOT, "content", "Attachments")

function listMarkdownStems(dir) {
  if (!fs.existsSync(dir)) return new Set()
  return new Set(
    fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -3).toLowerCase()),
  )
}

const WIKI_STEMS = listMarkdownStems(WIKI_DIR)
const POST_STEMS = listMarkdownStems(POSTS_DIR)

const PIPELINE_LEAK_RE =
  /\bdoc:[A-Za-z0-9_-]+\/page:\d+|\*\*OCR excerpt:\*\*|\bOCR packaging\b|\bOCR unavailable\b/i

const CHAT_RESIDUE_RE =
  /^\s*(?:You are completely right|The short answer:|Sanity-check verdict:|In your framing\b)|^#{1,4}\s+(?:Editorial synthesis|Wiki adjudication)\b/i

const PRE_BUNKING_RE =
  /(?:^#{1,4}\s+Beyond\b|\b(?:(?:directly )?refutes any (?:strong|naive|simple)|contrary to (?:popular|naive|common) (?:belief|views?|readings?|wisdom)|far from being (?:an? )?(?:passive|static|mere|simple)|(?:framing|treating|viewing) .{1,60} (?:solely|merely|simply|only) as .{1,60} is (?:incomplete|misleading|wrong|insufficient)|does not merely\b|(?:is|are|was|were) not (?:merely|simply|just|automatic|absolute|static|passive|a literal|an? (?:automatic|passive|simple|mere|static|peripheral|minor|trivial|secondary|side))\b|rather than (?:absolute|static|passive|automatic|merely|simply|just|solely|assuming\b|a [a-z-]+ quirk|a restart of\b|an? (?:absolute|literal|simple|passive|static)\b))\b)/i

const META_DEF_LEAD_RE =
  /\b(?:refers\s+to\s+the\s+(?:observation|claim|idea|concept|phenomenon|fact)\s+that|is\s+the\s+(?:claim|observation|inference\s+trap|idea)\s+that|describes\s+how\b|asks\s+when\b)/i

const STYLE_ENGINE_PATH = path.join(REPO_ROOT, "scripts", "lib", "_wiki-style-engine.py")

const HTML_AVAILABLE_SOURCE_RE =
  /(?:doi[:/]?\s*|doi\.org\/)(?:10\.1371\/|10\.7554\/|10\.1038\/(?:ncomms|s41467|s41598)|10\.1098\/rsos|10\.3389\/|10\.1186\/|10\.3390\/|10\.1101\/)|pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc|journals\.plos\.org|elifesciences\.org|frontiersin\.org|biomedcentral\.com/i

const PDF_CROP_FILENAME_RE = /-p\d+-b\d+(?:-[a-f0-9]+)?\.png$/i

const CANONICAL_WIKI_CATEGORIES = new Set([
  "category/aging",
  "category/cancer",
  "category/clonal-governance",
  "category/evolution",
  "category/cell-biology",
  "category/development",
  "category/proteins",
  "category/models",
  "category/experiments",
  "category/researchers",
  "category/fiction",
  "category/reference",
])

function readPngDimensions(filePath) {
  try {
    const fd = fs.openSync(filePath, "r")
    const buf = Buffer.alloc(24)
    fs.readSync(fd, buf, 0, 24, 0)
    fs.closeSync(fd)
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  } catch {
    return null
  }
}

function readPngTextChunks(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return {}
    const out = {}
    let offset = 8
    while (offset + 8 <= buf.length) {
      const len = buf.readUInt32BE(offset)
      const type = buf.toString("ascii", offset + 4, offset + 8)
      if (type === "tEXt" && offset + 8 + len <= buf.length) {
        const chunk = buf.subarray(offset + 8, offset + 8 + len)
        const nul = chunk.indexOf(0)
        if (nul > 0) {
          out[chunk.toString("latin1", 0, nul)] = chunk.toString("latin1", nul + 1)
        }
      }
      offset += 12 + len
    }
    return out
  } catch {
    return {}
  }
}

function lintFile(filePath) {
  const relPath = path.relative(REPO_ROOT, filePath).replaceAll("\\", "/")
  const baseName = path.basename(filePath)
  const raw = fs.readFileSync(filePath, "utf8")
  const lines = raw.split(/\r?\n/)
  const findings = []

  // Category taxonomy check (every wiki article except index.md must have >= 1 canonical category/... tag)
  if (baseName !== "index.md") {
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const fm = fmMatch ? fmMatch[1] : ""
    const catTags = [...fm.matchAll(/^\s*-\s*(category\/[^\s#]+)\s*$/gm)].map((m) => m[1].trim())
    if (catTags.length === 0) {
      findings.push({
        file: relPath,
        line: 1,
        rule: "missing-wiki-category",
        message:
          "Wiki article has no `category/...` tag in frontmatter. Add 1–3 canonical categories from CANONICAL_WIKI_CATEGORIES in scripts/lint-wiki.mjs.",
      })
    } else {
      for (const cat of catTags) {
        if (!CANONICAL_WIKI_CATEGORIES.has(cat)) {
          findings.push({
            file: relPath,
            line: 1,
            rule: "unknown-wiki-category",
            message: `Unknown wiki category \`${cat}\`. Use an existing category or register it in CANONICAL_WIKI_CATEGORIES in scripts/lint-wiki.mjs.`,
          })
        }
      }
    }
  }

  const classMatch = raw.match(/^class:\s*([A-Za-z]+)/m)
  const articleClass = classMatch ? classMatch[1].toUpperCase() : ""
  const isBOrAbove = ["B", "GA", "A", "FA"].includes(articleClass)

  // Count lead paragraphs (prose paragraphs between `# Title` and first `##` heading)
  // and high-effort body visuals (excluding References and > [!info]- excerpt callouts)
  let inFrontmatter = false
  let seenH1 = false
  let seenH2 = false
  let leadParas = 0
  let inLeadPara = false
  let bodyVisuals = 0
  let inBodyCode = false
  let inBodyRefs = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (i === 0 && l.trim() === "---") {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (l.trim() === "---") inFrontmatter = false
      continue
    }
    if (/^##\s+References\b/i.test(l)) inBodyRefs = true
    if (/^```/.test(l.trim())) {
      if (!inBodyCode && !inBodyRefs && /^```vega-lite\b/i.test(l.trim())) {
        bodyVisuals++
      }
      inBodyCode = !inBodyCode
      continue
    }
    if (inBodyCode) continue
    if (!seenH1 && /^#\s+/.test(l)) {
      seenH1 = true
      continue
    }
    if (seenH1 && !seenH2) {
      if (/^##\s+/.test(l)) {
        seenH2 = true
      } else if (
        l.trim() &&
        !/^\*(?:For |Part of |Main article:|Further information:)/i.test(l.trim()) &&
        !/^>/.test(l.trim()) &&
        !/^```/.test(l.trim())
      ) {
        if (!inLeadPara) {
          leadParas++
          inLeadPara = true
        }
      } else if (!l.trim()) {
        inLeadPara = false
      }
    }
    if (
      !inBodyRefs &&
      !/^\s*>/.test(l) &&
      /!\[\[[^\]|]+\.(?:png|jpe?g|webp|svg)(?:\|[^\]]+)?\]\]/i.test(l)
    ) {
      bodyVisuals++
    }
  }
  if (isBOrAbove) {
    if (leadParas < 2) {
      findings.push({
        file: relPath,
        line: 1,
        rule: "b-class-lead-too-short",
        message: `Article is marked \`class: ${articleClass}\` but has only ${leadParas} lead paragraph(s) before the first \`##\` heading (B-class requires 2–3 cohesive lead paragraphs per Wiki Assessment).`,
      })
    }
    if (bodyVisuals < 2) {
      findings.push({
        file: relPath,
        line: 1,
        rule: "b-class-missing-visuals",
        message: `Article is marked \`class: ${articleClass}\` but has only ${bodyVisuals} body figure/vega-lite visual(s) (B-class requires >= 2 high-craft visuals/interactives; excerpt callouts and lone Mermaid flowcharts do not satisfy this gate).`,
      })
    }
  }

  let inMainFrontmatter = false
  let inCodeFence = false
  let inMermaid = false
  let mermaidStartLine = 0
  let mermaidLines = []
  let inExcerptCallout = false
  let inInfoCallout = false
  let inReferences = false
  let currentFootnoteLine = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    if (i === 0 && line.trim() === "---") {
      inMainFrontmatter = true
      continue
    }
    if (inMainFrontmatter) {
      if (line.trim() === "---") inMainFrontmatter = false
      continue
    }

    if (/^##\s+References\b/i.test(line)) {
      inReferences = true
    } else if (/^##\s+/.test(line) && inReferences) {
      inReferences = false
    }

    if (/^\[\^[^\]]+\]:/.test(line)) {
      currentFootnoteLine = line
    } else if (/^\S/.test(line) && !/^\s*$/.test(line)) {
      currentFootnoteLine = ""
    }

    if (/^```/.test(line.trim())) {
      if (!inCodeFence) {
        if (/^```svg\b/i.test(line.trim())) {
          findings.push({
            file: relPath,
            line: lineNum,
            rule: "raw-svg-codeblock",
            message:
              "Raw ```svg code block in wiki markdown breaks dark mode; use theme-aware vega-lite or an Attachment.",
          })
        } else if (/^```mermaid\b/i.test(line.trim())) {
          inMermaid = true
          mermaidStartLine = lineNum
          mermaidLines = []
        }
      } else if (inMermaid) {
        // Lint Mermaid block for wall-of-text / obscured flowchart anti-patterns
        const labels = []
        let hasInlineArrow = false
        for (const ml of mermaidLines) {
          for (const m of ml.matchAll(/"([^"]+)"/g)) {
            const txt = m[1].trim()
            if (!txt) continue
            labels.push(txt)
            if (/\s(?:->|-->|→)\s/.test(txt)) hasInlineArrow = true
          }
          for (const m of ml.matchAll(/\|([^|"]+)\|/g)) {
            const txt = m[1].trim()
            if (!txt) continue
            labels.push(txt)
            if (/\s(?:->|-->|→)\s/.test(txt)) hasInlineArrow = true
          }
        }
        const longLabels = labels.filter((t) => t.split(/\s+/).length > 6)
        if (hasInlineArrow) {
          findings.push({
            file: relPath,
            line: mermaidStartLine,
            rule: "mermaid-inline-arrow",
            message:
              "Mermaid diagram stuffs ASCII arrows (`->`) inside box labels instead of drawing proper nodes/edges. Keep labels to 2–4 words.",
          })
        }
        if (longLabels.length > 0) {
          findings.push({
            file: relPath,
            line: mermaidStartLine,
            rule: "mermaid-wall-of-text",
            message: `Mermaid diagram has ${longLabels.length} verbose label(s) > 6 words (e.g. \`${longLabels[0].slice(0, 50)}\`). Good diagrams use 2–4 word labels and visual grouping, not sentences in boxes.`,
          })
        }
        inMermaid = false
        mermaidLines = []
      }
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) {
      if (inMermaid) mermaidLines.push(line)
      continue
    }

    // Track whether we are inside any info callout or primary-source/OCR excerpt callout
    if (/^\s*>\s*\[!info\]-?/i.test(line)) {
      inInfoCallout = true
      if (/(?:excerpt|ocr|primary source|source passage)/i.test(line)) {
        inExcerptCallout = true
      }
    } else if ((inInfoCallout || inExcerptCallout) && !/^\s*>/.test(line)) {
      inInfoCallout = false
      inExcerptCallout = false
    }

    // Check embedded PNG screenshots inside evidence callouts for aspect ratio & PDF-when-HTML-available
    if (inInfoCallout) {
      const imgMatch = line.match(/!\[\[([^\]|]+\.png)(?:\|[^\]]+)?\]\]/i)
      if (imgMatch) {
        const imgName = imgMatch[1].trim()
        const imgPath = path.join(ATTACHMENTS_DIR, imgName)
        const dims = readPngDimensions(imgPath)
        if (dims && dims.height > 0) {
          const aspect = dims.width / dims.height
          if (dims.height < 140 || aspect > 4.5 || aspect < 0.55) {
            findings.push({
              file: relPath,
              line: lineNum,
              rule: "evidence-bad-aspect-ratio",
              message: `Evidence screenshot \`${imgName}\` is ${dims.width}x${dims.height} (aspect ${aspect.toFixed(2)}:1). Capture a readable paragraph-level HTML screenshot (height >= 140px, aspect 0.55–4.5:1) instead of a thin sliver.`,
            })
          }
        }
        if (
          PDF_CROP_FILENAME_RE.test(imgName) &&
          HTML_AVAILABLE_SOURCE_RE.test(currentFootnoteLine)
        ) {
          findings.push({
            file: relPath,
            line: lineNum,
            rule: "evidence-pdf-when-html-available",
            message: `PDF crop \`${imgName}\` used for a footnote whose publisher/PMC provides HTML full text. Prefer a crisp HTML paragraph screenshot (~700px wide, clean aspect ratio) over a PDF crop.`,
          })
        }
        const pngMeta = readPngTextChunks(imgPath)
        if (
          pngMeta.Source &&
          /(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed|europepmc\.org\/abstract\/|semanticscholar\.org|scholar\.google\.)/i.test(
            pngMeta.Source,
          )
        ) {
          findings.push({
            file: relPath,
            line: lineNum,
            rule: "evidence-abstract-only",
            message: `Evidence screenshot \`${imgName}\` was captured from an abstract-only page (${pngMeta.Source}), not the paper's full-text body. Per Wiki Assessment, abstract-only crops are disqualified for primary evidence; crop from PMC/publisher full-text HTML or an OCR-parsed full-text PDF.`,
          })
        }
      }
    }

    // 1. Top-level (not indented inside a footnote) > [!info] primary-source / OCR excerpt callout
    if (/^>\s*\[!info\]-?.*(?:excerpt|ocr|primary source|source passage)/i.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        rule: "ocr-callout-not-in-footnote",
        message:
          "OCR/primary-source screenshot callout is at top level (mid-page or detached from its footnote). Indent it 4 spaces directly inside its `[^key]:` footnote under `## References`.",
      })
    }

    // 2. Descriptive |caption alias on OCR screenshot embed inside an excerpt callout
    if (inExcerptCallout && /!\[\[[^\]|]+\.(?:png|jpe?g|webp|svg)\|[^\]]+\]\]/i.test(line)) {
      findings.push({
        file: relPath,
        line: lineNum,
        rule: "ocr-image-caption-description",
        message:
          "OCR screenshot embed has a `|description` alias (which renders a description under the screenshot). Use a bare `![[filename.png]]` embed followed only by the verbatim OCR text.",
      })
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

    // Single prose-eligibility gate for all prose style rules:
    // skip quotes/callouts, References/footnotes, figure embeds, tables, headings, and rules.
    const isBodyProse =
      !inInfoCallout &&
      !inReferences &&
      !/^\[\^[^\]]+\]:/.test(line) &&
      !/^\s*>/.test(line) &&
      !/^\s*!\[\[/.test(line) &&
      !/^\s*!\[/.test(line) &&
      !/^\s*\|/.test(line) &&
      !/^\s*\$\$/.test(line) &&
      !/^#{1,6}\s/.test(line) &&
      !/^\s*---+\s*$/.test(line)

    if (isBodyProse) {
      // Strip verbatim quoted text, inline code, and display/inline math once for all prose rules
      const proseText = line
        .replace(/`[^`]*`/g, "")
        .replace(/\$\$[^]*?\$\$/g, "")
        .replace(/\$[^$\n]*\$/g, "")
        .replace(/"[^"\n]{2,}"/g, "")
        .replace(/“[^”\n]{2,}”/g, "")
        .replace(/\[\^[^\]]+\]/g, "")
        .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")

      // 3b. Pre-bunking / strawman-debunking prose (wording rules live in Vale: styles/Brinedew/)
      if (PRE_BUNKING_RE.test(proseText)) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: "pre-bunking",
          message:
            "Pre-bunking / strawman-debunking phrasing (`not merely/automatic`, `rather than assuming`, `refutes any strong reading`, `framing X solely as ... is incomplete`). State the mechanism directly without lecturing an imaginary naive reader.",
        })
      }

      // 3d. Semicolon-chained run-on sentences (>= 55 words with a semicolon, excluding compact code-enum lists)
      if (proseText.includes(";") && (line.match(/`[^`]+`/g) || []).length < 3) {
        for (const sentence of proseText.split(/(?<=[.!?])\s+/)) {
          const semis = (sentence.match(/;/g) || []).length
          const words = sentence.trim().split(/\s+/).filter(Boolean).length
          if (semis >= 1 && words >= 55) {
            findings.push({
              file: relPath,
              line: lineNum,
              rule: "academese-runon",
              message: `Long semicolon-chained sentence (${words} words, ${semis} semicolon(s)). Break into direct, sequential sentences.`,
            })
            break
          }
        }
      }

      // 3f. Overuse of parentheticals (>= 3 substantive (...) in one paragraph/line)
      const strippedForParen = proseText
        .replace(/\[[^\]]*\]\([^)]*\)/g, "") // drop markdown links
        .replace(/\(\s*(?:1[6-9]\d\d|20\d\d)(?:[–-](?:1[6-9]\d\d|20\d\d|\d\d))?\s*\)/g, "") // drop bare year citations like (1957)
      const parens = [...strippedForParen.matchAll(/\([^()]{4,}\)/g)]
      if (parens.length >= 3) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: "parenthetical-overuse",
          message: `Paragraph packs ${parens.length} parentheticals in one block. Break them into a bullet or numbered list instead.`,
        })
      }
    }

    // 4. Bare lowercase-hyphenated filename wikilinks without a readable |display label
    const bareSlugRe = /(?<!!)\[\[([a-z0-9]+(?:-[a-z0-9]+)+(?:#[^|\]]+)?)\]\]/g
    for (const match of line.matchAll(bareSlugRe)) {
      findings.push({
        file: relPath,
        line: lineNum,
        rule: "bare-slug-wikilink",
        message: `Wikilink \`[[${match[1]}]]\` exposes a lowercase hyphenated filename to readers; add a readable display title (e.g. \`[[${match[1]}|Article Title]]\`).`,
      })
    }

    // 5. Linking to Brinedew blog posts (`content/posts/`) as if they were wiki articles
    const wikilinkRe = /(?<!!)\[\[([^\]|#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/g
    for (const match of line.matchAll(wikilinkRe)) {
      const rawTarget = match[1].trim().replaceAll("\\", "/")
      const lowerTarget = rawTarget.toLowerCase().replace(/\.md$/, "")
      const isExplicitPost = /^(?:\.\.\/)?posts\//.test(lowerTarget)
      const stem = lowerTarget.split("/").pop()
      if (isExplicitPost || (POST_STEMS.has(stem) && !WIKI_STEMS.has(stem))) {
        findings.push({
          file: relPath,
          line: lineNum,
          rule: "wiki-links-to-blog-post",
          message: `Wikilink \`[[${rawTarget}]]\` points to a Brinedew blog post (\`content/posts/\`), not a wiki article. Blog posts are separate from the wiki.`,
        })
      }
    }
    const mdPostLinkRe = /\[[^\]]+\]\(((?!https?:\/\/)[^)]*posts\/[^)]+)\)/gi
    for (const match of line.matchAll(mdPostLinkRe)) {
      findings.push({
        file: relPath,
        line: lineNum,
        rule: "wiki-links-to-blog-post",
        message: `Markdown link \`(${match[1]})\` points to a Brinedew blog post (\`content/posts/\`), not a wiki article. Blog posts are separate from the wiki.`,
      })
    }
  }

  // Lead meta-definition check
  if (seenH1 && !["LIST", "FL", "NA"].includes(articleClass)) {
    let inFm = false
    let pastH1 = false
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (i === 0 && l.trim() === "---") {
        inFm = true
        continue
      }
      if (inFm) {
        if (l.trim() === "---") inFm = false
        continue
      }
      if (!pastH1) {
        if (/^#\s+/.test(l)) pastH1 = true
        continue
      }
      if (/^##\s+/.test(l)) break
      if (l.trim() && !/^\*/.test(l.trim()) && META_DEF_LEAD_RE.test(l)) {
        findings.push({
          file: relPath,
          line: i + 1,
          rule: "stylometry-meta-definition",
          message: `Bloated meta-definition opener in lead ("${l.match(META_DEF_LEAD_RE)[0]}"). Define the phenomenon directly.`,
        })
        break
      }
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

// Phase 2: Internal spaCy stylometry, Biber syntax, and crash-blossom engine
const styleRun = spawnSync("python", [STYLE_ENGINE_PATH, ...targets], {
  cwd: REPO_ROOT,
  env: { ...process.env, BRINEDEW_LINT_WIKI_INTERNAL: "1" },
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
})
if (styleRun.error?.code === "ENOENT") {
  console.error("lint-wiki: `python` binary not found on PATH; cannot run spaCy stylometry engine.")
  process.exit(1)
}
if (styleRun.status !== 0) {
  console.error(styleRun.stderr || "lint-wiki: internal spaCy stylometry engine failed.")
  process.exit(1)
}
try {
  const parsed = JSON.parse(styleRun.stdout || "{}")
  if (Array.isArray(parsed.findings)) {
    allFindings.push(...parsed.findings)
  }
} catch (err) {
  console.error(`lint-wiki: failed to parse stylometry engine output: ${err.message}`)
  process.exit(1)
}

// Phase 3: Vale prose linter (warnings/suggestions are reported; errors fail)
const valeTargets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["content/wiki"]
const valeRun = spawnSync("vale", valeTargets, {
  cwd: REPO_ROOT,
  stdio: "inherit",
})
if (valeRun.error?.code === "ENOENT") {
  console.error(
    "lint-wiki: `vale` binary not found on PATH. Install it (e.g. `winget install errata-ai.Vale` or `brew install vale`).",
  )
  process.exit(1)
}
const valeFailed = valeRun.status !== null && valeRun.status !== 0

if (allFindings.length === 0 && !valeFailed) {
  console.log(`lint-wiki: ${targets.length} file(s) checked, 0 issues found.`)
  process.exit(0)
}

for (const f of allFindings) {
  console.error(`${f.file}:${f.line} [${f.rule}] ${f.message}`)
}
if (allFindings.length > 0) {
  console.error(
    `\nlint-wiki: ${allFindings.length} issue(s) found across ${targets.length} file(s).`,
  )
}
process.exit(1)
