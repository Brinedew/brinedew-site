// B-874 History: versions group into sessions (Google Docs), one per caretaker
// run of saves, so autosave noise collapses and the version before someone
// else's run is always one visible row (the Wikipedia rollback point).
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

const BASE = Date.parse("2026-09-20T10:00:00.000Z")
let sequence = 0

// minutes: offset from BASE. tags: the accepted tags hash letter.
function revision(id, minutes, body, tags = "a") {
  sequence++
  return {
    manifestation_revision_id: id,
    revision_number: sequence,
    event_sequence: sequence,
    lifecycle: "active",
    created_at: new Date(BASE + minutes * 60_000).toISOString(),
    body,
    derivative: { status: "accepted", tags_sha256: tags.repeat(64) },
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

function dossierWith(manifestations, canonical) {
  return {
    gene: { gene_id: "gene_tp53", symbol: "TP53" },
    viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
    assignment: {
      caretaker_assignment_id: "assignment_b",
      assignment_version: 1,
      status: "active",
    },
    head: { head_version: 9, gene_revision: 9, canonical_revision_id: canonical },
    manifestations,
  }
}

function history(dossier, options = {}) {
  const html = renderCaretakerManifestationPanel(dossier, escapeHtml, options)
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  const sessions = Array.from(document.querySelectorAll("[data-icono-caretaker-session]"))
  return {
    html,
    document,
    sessions: sessions.map((node) => ({
      id: node.getAttribute("data-icono-caretaker-session"),
      head: node
        .querySelector("[data-icono-caretaker-version]")
        .getAttribute("data-icono-caretaker-version"),
      text: node.querySelector(".icono-caretaker-timeline__item").textContent,
      toggle: node.querySelector("[data-icono-caretaker-session-toggle]")?.textContent || "",
      expanded:
        node
          .querySelector("[data-icono-caretaker-session-toggle]")
          ?.getAttribute("aria-expanded") === "true",
      inner: Array.from(
        node.querySelectorAll(
          "[data-icono-caretaker-session-versions] [data-icono-caretaker-version]",
        ),
      ).map((item) => item.getAttribute("data-icono-caretaker-version")),
      innerHidden:
        node.querySelector("[data-icono-caretaker-session-versions]")?.hasAttribute("hidden") ===
        true,
      // The first timeline item in a session is its header row.
      sourceMark:
        node
          .querySelector(".icono-caretaker-timeline__item")
          .querySelector("[data-icono-caretaker-source-mark]") !== null,
    })),
    preview: document.querySelector("[data-icono-caretaker-preview]")?.textContent || "",
  }
}

// Caretaker A wrote the text over one morning; caretaker B took over and, in
// one 10-minute burst of autosaves, replaced it. The nightmare branch.
function handover() {
  const a = lineage("manifestation_a", "Ada", [
    revision("a1", 0, "Tumour suppressor guarding the genome"),
    revision("a2", 3, "Tumour suppressor guarding the genome after DNA damage"),
    revision("a3", 6, "Tumour suppressor guarding the genome after DNA damage", "b"),
  ])
  const b = lineage("manifestation_b", "Bob", [
    revision("b1", 600, "lol"),
    revision("b2", 603, "lol gene"),
    revision("b3", 606, "lol gene go brr"),
    revision("b4", 609, "lol gene go brr brr"),
  ])
  return dossierWith([b, a], "b4")
}

test("a burst of autosaves by one caretaker is one session row, not one row per pause", () => {
  const view = history(handover())
  assert.deepEqual(
    view.sessions.map((session) => session.head),
    ["b4", "a3"],
    "two sessions: Bob's run, then Ada's run",
  )
  assert.equal(view.sessions[0].toggle.trim(), "4 saves")
  assert.equal(view.sessions[1].toggle.trim(), "3 saves")
})

test("a change of caretaker always starts a new session, however close in time", () => {
  const d = handover()
  // Bob starts one minute after Ada's last save.
  for (const [index, item] of d.manifestations[0].revisions.entries()) {
    item.created_at = new Date(BASE + (10 - index) * 60_000).toISOString()
  }
  const view = history(d)
  assert.deepEqual(
    view.sessions.map((session) => session.head),
    ["b4", "a3"],
  )
})

test("the same caretaker returning after a long pause starts a new session", () => {
  const a = lineage("manifestation_a", "Ada", [
    revision("m1", 0, "one"),
    revision("m2", 5, "one two"),
    revision("e1", 300, "one two three"),
  ])
  const view = history(dossierWith([a], "e1"))
  assert.deepEqual(
    view.sessions.map((session) => session.head),
    ["e1", "m2"],
  )
  assert.equal(view.sessions[0].toggle, "", "a one-save session has nothing to expand")
})

test("the rollback point before another caretaker's run is a visible row with Edit from here", () => {
  const view = history(handover(), { selectedRevisionId: "a3" })
  const ada = view.sessions[1]
  assert.equal(ada.head, "a3", "Ada's last version heads her session, visible while collapsed")
  assert.equal(ada.innerHidden, true)
  assert.equal(view.preview.includes("Edit from here"), true)
})

test("a collapsed session shows its net change against the version before the session", () => {
  const view = history(handover())
  const bob = view.sessions[0]
  // Ada's 8 words became Bob's 5: 5 added, 8 removed, across the whole run.
  assert.equal(bob.text.includes("+5"), true, bob.text)
  assert.equal(bob.text.includes("−8"), true, bob.text)
  assert.equal(bob.text.includes("Bob"), true)
  // The preview of Bob's head compares with Ada's last version, not with b3.
  assert.equal(view.preview.includes("changes since version 3"), true, view.preview)
})

test("a tags-only save says so instead of +0 −0", () => {
  const view = history(handover(), { expandedSessions: ["a1"] })
  const ada = view.sessions[1]
  assert.equal(ada.expanded, true)
  const { document } = view
  const a3 = document.querySelector('[data-icono-caretaker-version="a3"]')
  const text = a3 ? a3.textContent : ""
  assert.equal(text.includes("Tags changed"), true, text)
  assert.equal(text.includes("+0"), false, text)
})

test("the image-source mark never hides inside a collapsed session", () => {
  const d = handover()
  d.head.canonical_revision_id = "b2"
  const view = history(d, { selectedRevisionId: "a3" })
  assert.equal(view.sessions[0].innerHidden, true)
  assert.equal(view.sessions[0].sourceMark, true, "Bob's session row carries the mark")
})

test("the session holding the selected version opens, and chosen sessions stay open", () => {
  const selected = history(handover(), { selectedRevisionId: "b2" })
  assert.equal(selected.sessions[0].expanded, true)
  assert.equal(selected.sessions[0].innerHidden, false)
  assert.deepEqual(selected.sessions[0].inner, ["b3", "b2", "b1"])
  assert.equal(selected.sessions[1].expanded, false)
  const chosen = history(handover(), { selectedRevisionId: "b4", expandedSessions: ["a1"] })
  assert.equal(chosen.sessions[1].expanded, true)
})

test("the saves toggle opens a session in the live modal and closing it keeps the selection visible", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  const previousDocument = globalThis.document
  const previousEvent = globalThis.Event
  globalThis.document = document
  globalThis.Event = Event
  try {
    const panel = createCaretakerManifestationPanel({
      fetchJSON: async () => handover(),
      escapeHtml,
      storage: null,
    })
    const host = document.getElementById("host")
    await panel.mount(host, {
      symbol: "TP53",
      currentUser: { account_id: "acct_b" },
      authResolved: true,
    })
    const toggle = () => host.querySelector('[data-icono-caretaker-session-toggle="a1"]')
    const inner = () =>
      host.querySelector(
        '[data-icono-caretaker-session="a1"] [data-icono-caretaker-session-versions]',
      )
    const preview = () => host.querySelector("[data-icono-caretaker-preview]").textContent
    assert.equal(toggle().getAttribute("aria-expanded"), "false")
    toggle().dispatchEvent(new Event("click", { bubbles: true }))
    assert.equal(toggle().getAttribute("aria-expanded"), "true")
    assert.equal(inner().hasAttribute("hidden"), false)
    host
      .querySelector('[data-icono-caretaker-version="a2"]')
      .dispatchEvent(new Event("click", { bubbles: true }))
    assert.equal(preview().includes("changes since version 1"), true, preview())
    // Closing the session that holds the selection selects its header row instead.
    toggle().dispatchEvent(new Event("click", { bubbles: true }))
    assert.equal(toggle().getAttribute("aria-expanded"), "false")
    assert.equal(
      host
        .querySelector('[data-icono-caretaker-version][aria-current="true"]')
        .getAttribute("data-icono-caretaker-version"),
      "a3",
    )
    assert.equal(preview().includes("Version 3"), true, preview())
  } finally {
    globalThis.document = previousDocument
    globalThis.Event = previousEvent
  }
})

test("versions show their author's name, and the Original row says Original once", () => {
  const d = handover()
  d.manifestations.push({
    manifestation_id: "manifestation_seed",
    origin: "system_seed",
    author_label: "Original manifestation",
    status: "active",
    revisions: [{ ...revision("seed", -600, "Seed text"), event_sequence: 0 }],
  })
  const view = history(d)
  assert.equal(view.sessions[0].text.includes("Bob"), true, view.sessions[0].text)
  assert.equal(view.sessions[1].text.includes("Ada"), true, view.sessions[1].text)
  const seed = view.sessions.at(-1).text
  assert.equal(seed.match(/Original/g)?.length, 1, seed)
})

test("a withdrawn caretaker's run says it was withdrawn", () => {
  const d = handover()
  d.manifestations[0].status = "withdrawn"
  d.head.canonical_revision_id = "a3"
  const view = history(d, { selectedRevisionId: "a3" })
  assert.equal(view.sessions[0].text.includes("Withdrawn"), true, view.sessions[0].text)
  assert.equal(view.sessions[1].text.includes("Withdrawn"), false)
})
