// B-874 walkthrough: the modal is named in the owner's words (2026-10-05),
// not after a database object, and history speaks plainly.
// String assertions only; no DOM nodes reach an assertion.
import assert from "node:assert/strict"
import test from "node:test"

import { renderCaretakerManifestationPanel } from "./caretaker-manifestations.js"

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function dossier({ visible = false, state = "active" } = {}) {
  return {
    gene: { gene_id: "gene_stat5a", symbol: "STAT5A" },
    viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
    assignment: { caretaker_assignment_id: "assignment_1", assignment_version: 1, status: state },
    head: { head_version: 2, gene_revision: 2, canonical_revision_id: "r1" },
    manifestations: [
      {
        manifestation_id: "m1",
        author_is_viewer: true,
        belongs_to_current_assignment: true,
        status: "active",
        row_version: 1,
        public_page_visible: visible,
        head_body: "A signal transducer.",
        revisions: [
          {
            manifestation_revision_id: "r1",
            revision_number: 1,
            lifecycle: "active",
            body: "A signal transducer.",
            derivative: { status: "accepted", recipe_version: "3", tags_sha256: "a".repeat(64) },
            generation_provenance: {
              origin: "generated",
              source_label: "openai · gpt-x",
              recipe_version: "3",
            },
          },
        ],
      },
    ],
  }
}

test("the title is the panel and the gene, not a record", () => {
  const html = renderCaretakerManifestationPanel(dossier(), escapeHtml)
  assert.equal(html.includes("Caretaker record"), false)
  assert.equal(
    /<h2 class="icono-dialog__title" id="icono-caretaker-title"[^>]*>Caretaker panel: STAT5A<\/h2>/.test(
      html,
    ),
    true,
  )
})

test("an active role shows no state pill; exceptional states still do", () => {
  assert.equal(
    renderCaretakerManifestationPanel(dossier(), escapeHtml).includes(
      "icono-caretaker-panel__state",
    ),
    false,
  )
  const suspended = renderCaretakerManifestationPanel(dossier({ state: "suspended" }), escapeHtml)
  assert.equal(
    /icono-caretaker-panel__state" data-state="suspended">suspended</.test(suspended),
    true,
  )
})

test("history speaks plainly about how tags were made", () => {
  const html = renderCaretakerManifestationPanel(dossier(), escapeHtml, {
    selectedRevisionId: "r1",
  })
  assert.equal(html.includes("Generation provenance"), false)
  assert.equal(/recipe \d/.test(html), false)
  assert.equal(html.includes("How the tags were made"), true)
})
