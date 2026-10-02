import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { PublicationDate } from "../.quartz/plugins/brinedew-components/dist/index.js"
import { CURRENT_CARETAKER_TERMS } from "../workers/iconoplasm/caretaker/caretaker-terms-registry.js"

// B-818: an Iconoplasm document's date lives in one field, frontmatter `date`.
// The folder listing, the JSON-LD and the dated line under the page heading all
// read it. Ways this can fail:
//  1. A body hand-types its own "Last updated:" or "Effective:" line again, so
//     the page and the listing drift apart (privacy said Sep 25 while the
//     listing and JSON-LD said May 22).
//  2. The rendered line drops the label the document's own text refers to
//     ('The "Last updated" date at the top', 'update the Effective Date above').
//  3. The rendered line reads a different date field from the listing.
//  4. The caretaker terms page shows a date other than the registry's effective
//     date for the version a caretaker accepts.
//  5. The app home page or a main-site essay changes how it is dated.

const contentRoot = path.join(process.cwd(), "content", "apps", "iconoplasm")
const documents = readdirSync(contentRoot).filter(
  (name) => name.endsWith(".md") && name !== "index.md",
)

function parse(file) {
  const text = readFileSync(path.join(contentRoot, file), "utf8")
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z]+):\s*"?(.*?)"?\s*$/)
    if (field) fields[field[1]] = field[2]
  }
  return { fields, body: match[2] }
}

function listingDate(data) {
  return data.dates[data.defaultDateType].toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
}

function stamp(slug, frontmatter) {
  const published = new Date(`${frontmatter.date}T00:00:00`)
  const data = {
    slug,
    frontmatter,
    dates: { created: published, modified: published, published },
    defaultDateType: "published",
  }
  const tree = {
    type: "root",
    children: [
      { type: "element", tagName: "h1", properties: {}, children: [{ type: "text", value: "T" }] },
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [{ type: "text", value: "Body" }],
      },
    ],
  }
  const [plugin] = PublicationDate().htmlPlugins()
  plugin()(tree, { data })
  return { tree, data }
}

const textOf = (node) =>
  node.type === "text" ? node.value : (node.children || []).map(textOf).join("")

test("each Iconoplasm document is dated by frontmatter alone", () => {
  assert.ok(documents.length >= 4)
  for (const name of documents) {
    const { fields, body } = parse(name)
    assert.match(fields.date || "", /^\d{4}-\d{2}-\d{2}$/, name)
    // 1
    assert.doesNotMatch(body, /^\*\*(?:last updated|effective)[^*]*:\*\*/im, name)
    // 2
    if (/"Last updated" date/.test(body)) assert.equal(fields.dateLabel, "Last updated", name)
    if (/Effective Date/.test(body)) assert.equal(fields.dateLabel, "Effective", name)
  }
  // 4
  const terms = parse("caretaker-terms.md").fields
  assert.equal(terms.date, CURRENT_CARETAKER_TERMS.effective_at.slice(0, 10))
})

test("the dated line under the heading is the listing's date, with the page's label", () => {
  for (const name of documents) {
    const { fields } = parse(name)
    if (!fields.dateLabel) continue
    const { tree, data } = stamp(`apps/iconoplasm/${name.replace(/\.md$/, "")}`, fields)
    const line = tree.children[1]
    // 2 and 3
    assert.equal(line.tagName, "p", name)
    assert.equal(textOf(line), `${fields.dateLabel}: ${listingDate(data)}`, name)
    const time = line.children.find((child) => child.tagName === "time")
    assert.equal(time.properties.datetime, data.dates.published.toISOString(), name)
    assert.equal(tree.children.length, 3, `${name} is dated once`)
  }
})

test("the app home stays undated and essays keep their plain date", () => {
  // 5
  const home = stamp("apps/iconoplasm/index", { date: "2025-12-01" })
  assert.equal(home.tree.children.length, 2)
  const essay = stamp("posts/aging-clocks", { date: "2026-03-04" })
  assert.equal(textOf(essay.tree.children[1]), listingDate(essay.data))
})

// B-818: iconoplasm.brinedew.bio answers older URL shapes with 301s (see
// scripts/prepare-iconoplasm-edge-assets.mjs), but nothing we publish should
// still link to one. Store listings, docs and the extension name the clean URL.
test("no site, extension or doc file links to an old Iconoplasm URL shape", () => {
  const result = spawnSync(
    "git",
    [
      "grep",
      "-nE",
      String.raw`iconoplasm\.brinedew\.bio/(apps/|About\.html|Iconoplasm|wiki/|posts)|/wiki/Tutorial-How-to`,
      "--",
      ".",
      ":!*.test.*",
      ":!scripts/prepare-iconoplasm-edge-assets.mjs",
    ],
    { encoding: "utf8" },
  )
  assert.equal(result.stdout, "")
})
