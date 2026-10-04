import assert from "node:assert/strict"
import test, { afterEach, beforeEach } from "node:test"
import { Event as DOMEvent, parseHTML } from "linkedom"

import { createCaretakerManifestationPanel } from "./caretaker-manifestations.js"
import { createCandidateSourceLinks } from "./caretaker-candidate-sources.js"

// B-724: a candidate image takes a caretaker to the saved version that made it.

const MADE_FROM_V1 = "a".repeat(64)
const MADE_FROM_V2 = "b".repeat(64)
const LEGACY = "c".repeat(64)

let originalGlobals
beforeEach(() => {
  originalGlobals = Object.fromEntries(
    ["document", "Event"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  globalThis.Event = DOMEvent
})
afterEach(() => {
  for (const key of ["document", "Event"]) {
    if (originalGlobals[key]) Object.defineProperty(globalThis, key, originalGlobals[key])
    else delete globalThis[key]
  }
})

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function revision(number, body) {
  return {
    manifestation_revision_id: `revision_${number}`,
    revision_number: number,
    event_sequence: number,
    created_at: `2026-09-0${number}T10:00:00.000Z`,
    lifecycle: "active",
    body_available: true,
    body,
  }
}

function dossier(revisionCount, candidateSources) {
  const revisions = []
  for (let number = revisionCount; number >= 1; number -= 1) {
    revisions.push(revision(number, `Prose of version ${number}`))
  }
  return {
    gene: { gene_id: "gene_sox11", symbol: "SOX11" },
    viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
    assignment: {
      caretaker_assignment_id: "assignment_sox11",
      assignment_version: 3,
      status: "active",
      leave_policy: "retain",
    },
    head: {
      head_version: 4,
      gene_revision: 9,
      canonical_selection_id: "selection_4",
      canonical_revision_id: `revision_${revisionCount}`,
    },
    manifestations: [
      {
        manifestation_id: "manifestation_own",
        author_is_viewer: true,
        belongs_to_current_assignment: true,
        status: "active",
        row_version: 2,
        manifestation_head_revision_id: `revision_${revisionCount}`,
        revisions,
      },
    ],
    candidate_sources: candidateSources,
  }
}

function card(assetSha) {
  return (
    `<article class="icono-candidate-card" data-icono-candidate-asset="${assetSha}">` +
    '<div class="icono-candidate-footer"></div></article>'
  )
}

function page() {
  const { document } = parseHTML(
    '<div id="gene"><div id="host"></div><section>' +
      card(MADE_FROM_V1) +
      card(MADE_FROM_V2) +
      card(LEGACY) +
      "</section></div>",
  )
  globalThis.document = document
  return document
}

const SOURCES = [
  { asset_sha256: MADE_FROM_V1, source_manifestation_revision_id: "revision_1" },
  { asset_sha256: MADE_FROM_V2, source_manifestation_revision_id: "revision_2" },
]

function linkOn(document, assetSha) {
  return document
    .querySelector(`[data-icono-candidate-asset="${assetSha}"]`)
    .querySelector("[data-icono-candidate-source]")
}

test("each candidate links to the version that made it, and an unbound one shows nothing", () => {
  const document = page()
  const links = createCandidateSourceLinks()
  const gene = document.getElementById("gene")

  links.mount(gene, { dossier: dossier(2, SOURCES), openVersion: () => {} })

  assert.equal(linkOn(document, MADE_FROM_V1).textContent, "Made from version 1")
  assert.equal(
    linkOn(document, MADE_FROM_V1).getAttribute("data-icono-candidate-source"),
    "revision_1",
  )
  assert.equal(linkOn(document, MADE_FROM_V2).textContent, "Made from version 2")
  assert.equal(linkOn(document, LEGACY), null, "legacy_unbound has no source and invents none")
})

test("after another edit the same image still names the same saved version", () => {
  const document = page()
  const links = createCandidateSourceLinks()
  const gene = document.getElementById("gene")
  links.mount(gene, { dossier: dossier(2, SOURCES), openVersion: () => {} })

  // The caretaker saves version 3; the dossier reloads and the page re-annotates.
  links.mount(gene, { dossier: dossier(3, SOURCES), openVersion: () => {} })

  assert.equal(linkOn(document, MADE_FROM_V1).textContent, "Made from version 1")
  assert.equal(
    linkOn(document, MADE_FROM_V1).getAttribute("data-icono-candidate-source"),
    "revision_1",
  )
  assert.equal(gene.querySelectorAll("[data-icono-candidate-source]").length, 2, "no duplicates")
})

test("a viewer who is not a caretaker gets no links", () => {
  const document = page()
  const links = createCandidateSourceLinks()
  const gene = document.getElementById("gene")
  const outsider = dossier(2, SOURCES)
  outsider.viewer.is_caretaker = false

  links.mount(gene, { dossier: outsider, openVersion: () => {} })

  assert.equal(gene.querySelectorAll("[data-icono-candidate-source]").length, 0)
})

test("clicking the link opens History on that exact version, with its own prose", async () => {
  const document = page()
  const host = document.getElementById("host")
  const gene = document.getElementById("gene")
  const current = dossier(3, SOURCES)
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async () => current,
    escapeHtml,
    storage: null,
  })
  await panel.mount(host, { symbol: "SOX11", currentUser: { id: "account_1" }, authResolved: true })
  const dialog = host.querySelector("[data-icono-caretaker-dialog]")
  let opened = false
  dialog.showModal = function () {
    opened = true
  }
  const links = createCandidateSourceLinks()
  links.mount(gene, {
    dossier: current,
    openVersion: (revisionId) => panel.showVersion(host, revisionId),
  })

  linkOn(document, MADE_FROM_V1).dispatchEvent(new DOMEvent("click", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(opened, true, "the caretaker window opens")
  assert.equal(
    host.querySelector('[data-icono-caretaker-tab="history"]').getAttribute("aria-selected"),
    "true",
  )
  assert.equal(host.querySelector("[data-icono-caretaker-tabpanel=history]").hidden, false)
  assert.equal(
    host
      .querySelector("[data-icono-caretaker-version][aria-current]")
      .getAttribute("data-icono-caretaker-version"),
    "revision_1",
  )
  assert.match(
    host.querySelector("[data-icono-caretaker-preview]").textContent,
    /Version 1[\s\S]*Prose of version 1/,
  )
})

test("a version on an older History page is loaded before it is shown", async () => {
  const document = page()
  const host = document.getElementById("host")
  const first = dossier(3, SOURCES)
  first.manifestations[0].revisions = first.manifestations[0].revisions.slice(0, 2)
  first.manifestations[0].manifestation_head_revision_id = "revision_3"
  first.history = { next_cursor: "cursor_older", total_count: 3 }
  const older = dossier(3, SOURCES)
  older.manifestations[0].revisions = older.manifestations[0].revisions.slice(2)
  older.history = { next_cursor: "", total_count: 3 }
  const requests = []
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async (path) => {
      requests.push(path)
      return path.includes("history_cursor") ? older : first
    },
    escapeHtml,
    storage: null,
  })
  await panel.mount(host, { symbol: "SOX11", currentUser: { id: "account_1" }, authResolved: true })
  host.querySelector("[data-icono-caretaker-dialog]").showModal = function () {}

  const shown = await panel.showVersion(host, "revision_1")

  assert.equal(shown, true)
  assert.equal(requests.filter((path) => path.includes("history_cursor")).length, 1)
  assert.equal(
    host
      .querySelector("[data-icono-caretaker-version][aria-current]")
      .getAttribute("data-icono-caretaker-version"),
    "revision_1",
  )
})
