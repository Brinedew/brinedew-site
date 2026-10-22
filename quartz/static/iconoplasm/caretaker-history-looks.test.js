// B-1160 History: one row per look (the server keeps one working copy a day and
// seals it at an order, a new day, "Edit from here" or a handover), each with
// its tag changes against the look below it and the portraits drawn from it.
// linkedom nodes must never reach an assertion message: compare strings, counts
// and booleans only (see scripts/dom-assertions-never-print-nodes.test.js).
import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  createCaretakerManifestationPanel,
  renderCaretakerManifestationPanel,
} from "./caretaker-manifestations.js"

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

const BASE = Date.parse("2026-10-02T21:09:00.000Z")
let sequence = 0

// hours: offset from BASE. fields: the look's tags by category.
function look(id, hours, body, fields) {
  sequence++
  return {
    manifestation_revision_id: id,
    revision_number: sequence,
    event_sequence: sequence,
    lifecycle: "active",
    created_at: new Date(BASE + hours * 3_600_000).toISOString(),
    body,
    fields,
    derivative: { status: "accepted", tags_sha256: String(sequence).padStart(64, "0") },
  }
}

function lineage(id, author, revisions, extra = {}) {
  return {
    manifestation_id: id,
    author_label: author,
    author_is_viewer: false,
    status: "active",
    row_version: 1,
    revisions: revisions.slice().reverse(),
    ...extra,
  }
}

const sha = (n) => n.toString(16).padStart(64, "0")

// CTCF's shape on the 2026-10-20 nightly copy: an Original, then three looks by
// one caretaker over two days, 20 portraits from each.
const TEXT = "A bookshelf arranger who pulls the genome into loops."
function ctcf() {
  const seed = {
    manifestation_id: "manifestation_seed",
    origin: "system_seed",
    author_label: "Original manifestation",
    status: "active",
    // The factory text's row is dated by its last regeneration, after the looks.
    revisions: [
      {
        ...look("seed", 200, "The original text.", {
          archetype: ["insulator"],
          background: ["nucleus"],
        }),
        event_sequence: 0,
      },
    ],
  }
  const own = lineage("manifestation_own", "Caretaker 957F16BE", [
    look("v12", 0, TEXT, {
      archetype: ["bookshelf arranger"],
      background: ["ancient library"],
    }),
    look("v27", 7, TEXT, {
      archetype: ["bookshelf arranger", "library architect"],
      background: ["ancient library"],
      action: ["pulling on bookshelves"],
    }),
    look("v31", 7.5, TEXT + " It never lets go.", {
      archetype: ["bookshelf arranger", "library architect"],
      background: ["bookshelves with metal handles"],
      action: ["pulling on bookshelves"],
      // A tag that only moved category is no change.
      setting: ["ancient library"],
    }),
  ])
  return {
    gene: { gene_id: "gene_ctcf", symbol: "CTCF" },
    viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
    assignment: {
      caretaker_assignment_id: "assignment_own",
      assignment_version: 1,
      status: "active",
    },
    head: { head_version: 9, gene_revision: 9, canonical_revision_id: "v31" },
    manifestations: [own, seed],
    candidate_sources: ["v12", "v27", "v31"].flatMap((id, block) =>
      Array.from({ length: 20 }, (_, n) => ({
        asset_sha256: sha(block * 100 + n + 1),
        source_manifestation_revision_id: id,
      })),
    ),
  }
}

function history(dossier, options = {}) {
  const html = renderCaretakerManifestationPanel(dossier, escapeHtml, options)
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  const rows = Array.from(document.querySelectorAll("[data-icono-caretaker-version]"))
  const preview = document.querySelector("[data-icono-caretaker-preview]")
  return {
    rows: rows.map((node) => ({
      id: node.getAttribute("data-icono-caretaker-version"),
      text: node.textContent,
      thumbs: Array.from(node.querySelectorAll("img")).map((img) => img.getAttribute("src")),
      sourceMark: node.querySelector("[data-icono-caretaker-source-mark]") !== null,
    })),
    preview: {
      text: preview?.textContent || "",
      added: Array.from(preview?.querySelectorAll("ins.icono-caretaker-tag-chip") || []).map(
        (chip) => chip.textContent,
      ),
      removed: Array.from(preview?.querySelectorAll("del.icono-caretaker-tag-chip") || []).map(
        (chip) => chip.textContent,
      ),
      portraits: Array.from(preview?.querySelectorAll("[data-icono-pswp]") || []).map((button) =>
        button.getAttribute("data-icono-pswp-src"),
      ),
      inLightbox:
        preview?.querySelector("[data-icono-lightbox] [data-icono-pswp]") !== null &&
        preview?.querySelector("[data-icono-lightbox]") !== null,
    },
  }
}

test("History lists one row per look, newest first, with the Original at the bottom", () => {
  const view = history(ctcf())
  assert.deepEqual(
    view.rows.map((row) => row.id),
    ["v31", "v27", "v12", "seed"],
  )
  assert.equal(view.rows[0].text.includes("Version 3"), true, view.rows[0].text)
  assert.equal(view.rows[0].sourceMark, true, "the look new portraits use is marked")
  assert.equal(view.rows.at(-1).text.match(/Original/g)?.length, 1, view.rows.at(-1).text)
  assert.equal(view.rows[0].text.includes("Caretaker 957F16BE"), true, view.rows[0].text)
})

test("each row counts the tags it added and removed against the look below it", () => {
  const view = history(ctcf())
  // v31 against v27: +1 (metal handles), −0; the tag that moved category is no change.
  assert.equal(view.rows[0].text.includes("+1"), true, view.rows[0].text)
  assert.equal(view.rows[0].text.includes("−0"), true, view.rows[0].text)
  assert.equal(view.rows[0].text.includes("Text edited"), true, view.rows[0].text)
  // v27 against v12: +2 −0, tags only.
  assert.equal(view.rows[1].text.includes("+2"), true, view.rows[1].text)
  assert.equal(view.rows[1].text.includes("Text edited"), false, view.rows[1].text)
  // v12 against the Original: +2 −2 and a rewrite.
  assert.equal(view.rows[2].text.includes("+2"), true, view.rows[2].text)
  assert.equal(view.rows[2].text.includes("−2"), true, view.rows[2].text)
  assert.equal(view.rows[2].text.includes("Text edited"), true, view.rows[2].text)
})

test("each row shows the first four portraits drawn from it and how many more", () => {
  const view = history(ctcf())
  assert.equal(view.rows[0].thumbs.length, 4)
  assert.equal(
    view.rows[0].thumbs[0],
    `https://img.brinedew.bio/portraits/v1/00/${sha(201)}/thumb.webp`,
  )
  assert.equal(view.rows[0].text.includes("+16"), true, view.rows[0].text)
  assert.equal(view.rows.at(-1).thumbs.length, 0, "the Original made none here")
})

test("selecting a look shows its tag changes as chips and every portrait, openable in the viewer", () => {
  const view = history(ctcf(), { selectedRevisionId: "v31" })
  assert.deepEqual(view.preview.added, ["bookshelves with metal handles"])
  assert.deepEqual(view.preview.removed, [])
  assert.equal(view.preview.text.includes("changes since version 2"), true, view.preview.text)
  assert.equal(view.preview.text.includes("It never lets go."), true, "the text diff shows")
  assert.equal(view.preview.portraits.length, 20)
  assert.equal(
    view.preview.portraits[0],
    `https://img.brinedew.bio/portraits/v1/00/${sha(201)}/full.webp`,
  )
  assert.equal(view.preview.inLightbox, true)
  assert.equal(view.preview.text.includes("Edit from here"), true)

  const first = history(ctcf(), { selectedRevisionId: "v12" })
  assert.deepEqual(first.preview.added, ["bookshelf arranger", "ancient library"])
  assert.deepEqual(first.preview.removed, ["insulator", "nucleus"])
})

test("a handover keeps the previous caretaker's last look as its own row", () => {
  const d = ctcf()
  d.manifestations[0].revisions.unshift(
    look("bob1", 30, "lol gene go brr", { archetype: ["bookshelf arranger"] }),
  )
  d.manifestations.unshift(
    lineage("manifestation_bob", "Bob", [d.manifestations[0].revisions.shift()]),
  )
  d.head.canonical_revision_id = "bob1"
  const view = history(d, { selectedRevisionId: "v31" })
  assert.deepEqual(view.rows.map((row) => row.id).slice(0, 2), ["bob1", "v31"])
  assert.equal(view.rows[0].text.includes("Bob"), true, view.rows[0].text)
  assert.equal(view.preview.text.includes("Edit from here"), true)
})

test("a withdrawn caretaker's looks say they were withdrawn", () => {
  const d = ctcf()
  d.manifestations[0].status = "withdrawn"
  const view = history(d)
  assert.equal(view.rows[0].text.includes("Withdrawn"), true, view.rows[0].text)
  assert.equal(view.rows.at(-1).text.includes("Withdrawn"), false)
})

test("clicking a row in the live modal shows that look", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  const previousDocument = globalThis.document
  const previousEvent = globalThis.Event
  globalThis.document = document
  globalThis.Event = Event
  try {
    const panel = createCaretakerManifestationPanel({
      fetchJSON: async () => ctcf(),
      escapeHtml,
      storage: null,
    })
    const host = document.getElementById("host")
    await panel.mount(host, {
      symbol: "CTCF",
      currentUser: { account_id: "acct_own" },
      authResolved: true,
    })
    const preview = () => host.querySelector("[data-icono-caretaker-preview]").textContent
    host
      .querySelector('[data-icono-caretaker-version="v27"]')
      .dispatchEvent(new Event("click", { bubbles: true }))
    assert.equal(preview().includes("Version 2"), true, preview())
    assert.equal(preview().includes("changes since version 1"), true, preview())
    assert.equal(
      host.querySelectorAll("[data-icono-caretaker-preview] [data-icono-pswp]").length,
      20,
    )
  } finally {
    globalThis.document = previousDocument
    globalThis.Event = previousEvent
  }
})
