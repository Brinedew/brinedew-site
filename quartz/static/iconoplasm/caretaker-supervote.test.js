import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  caretakerSupervoteButtonMarkup,
  caretakerSupervoteMutation,
  createCaretakerSupervoteControls,
  normalizeCaretakerSupervoteSnapshot,
} from "./caretaker-supervote.js"

const FIRST_ASSET = "a".repeat(64)
const SECOND_ASSET = "b".repeat(64)

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function activeSnapshot(overrides = {}) {
  return {
    assignment_status: "active",
    assignment_version: 7,
    accepted_event_sequence: 41,
    supervote_version: 3,
    asset_sha256: FIRST_ASSET,
    active: true,
    suspended: false,
    can_mutate: true,
    ...overrides,
  }
}

function caretakerDossier(status = "active") {
  return {
    gene: { gene_id: "gene_tp53", symbol: "TP53" },
    viewer: { is_caretaker: true },
    assignment: {
      caretaker_assignment_id: "assignment_tp53",
      assignment_version: 7,
      status,
    },
  }
}

test("the rendered marker names the fixed +10 weight and exposes move/remove state", () => {
  const selected = caretakerSupervoteButtonMarkup(
    { assetSha256: FIRST_ASSET, snapshot: activeSnapshot() },
    escapeHtml,
  )
  const movable = caretakerSupervoteButtonMarkup(
    { assetSha256: SECOND_ASSET, snapshot: activeSnapshot() },
    escapeHtml,
  )

  assert.match(
    selected,
    /Caretaker supervote <span aria-hidden="true">·<\/span> <strong>\+10<\/strong>/,
  )
  assert.match(selected, /aria-pressed="true"/)
  assert.match(selected, /Remove caretaker supervote/)
  assert.match(movable, /aria-pressed="false"/)
  assert.match(movable, /Move caretaker supervote/)
})

test("suspension preserves the visible selection but disables its control", () => {
  const html = caretakerSupervoteButtonMarkup(
    {
      assetSha256: FIRST_ASSET,
      snapshot: activeSnapshot({
        assignment_status: "suspended",
        suspended: true,
        can_mutate: false,
      }),
    },
    escapeHtml,
  )

  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /is-suspended/)
  assert.match(html, / disabled/)
  assert.match(html, />Suspended</)
})

test("move and remove commands carry both server CAS versions", () => {
  const move = caretakerSupervoteMutation({
    snapshot: activeSnapshot(),
    assetSha256: SECOND_ASSET,
  })
  const remove = caretakerSupervoteMutation({
    snapshot: activeSnapshot(),
    assetSha256: FIRST_ASSET,
    remove: true,
  })

  assert.equal(move.method, "PUT")
  assert.equal(move.body.asset_sha256, SECOND_ASSET)
  assert.equal(move.body.expected_assignment_version, 7)
  assert.equal(move.body.expected_supervote_version, 3)
  assert.match(move.body.command_id, /^cmd_/)
  assert.equal(remove.method, "DELETE")
  assert.equal("asset_sha256" in remove.body, false)
  assert.equal(remove.body.expected_assignment_version, 7)
  assert.equal(remove.body.expected_supervote_version, 3)
})

test("the caretaker island renders beside ordinary FIT boxes and moves selection without rewriting totals", async () => {
  const { document, Event } = parseHTML(
    `<main id="root">
      <div data-icono-gene-vote-box="${FIRST_ASSET}" data-image-score="4"></div>
      <div data-icono-candidate-vote-box="${SECOND_ASSET}" data-image-score="1"></div>
    </main>`,
  )
  globalThis.document = document
  const calls = []
  const controls = createCaretakerSupervoteControls({
    escapeHtml,
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      if (init.method === "GET") return { supervote: activeSnapshot() }
      return {
        supervote: activeSnapshot({ supervote_version: 4, asset_sha256: SECOND_ASSET }),
      }
    },
  })
  const root = document.getElementById("root")

  await controls.mount(root, { symbol: "TP53", dossier: caretakerDossier() })
  const moveButton = root.querySelector(`[data-icono-caretaker-supervote="${SECOND_ASSET}"]`)
  moveButton.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  const mutation = calls.find((call) => call.init.method === "PUT")
  assert.ok(mutation)
  assert.equal(mutation.path, "/api/iconoplasm/caretaker/genes/TP53/supervote")
  assert.equal(JSON.parse(mutation.init.body).asset_sha256, SECOND_ASSET)
  assert.equal(
    root
      .querySelector(`[data-icono-caretaker-supervote="${SECOND_ASSET}"]`)
      .getAttribute("aria-pressed"),
    "true",
  )
  assert.equal(root.querySelector(`[data-icono-gene-vote-box]`).dataset.imageScore, "4")
  assert.equal(root.querySelector(`[data-icono-candidate-vote-box]`).dataset.imageScore, "1")
})

test("the main app lazy-loads the control with the caretaker dossier instead of a parallel auth read", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8")
  assert.match(source, /import\("\.\/caretaker-supervote\.js\?v=/)
  assert.match(source, /caretaker-supervote\.css\?v=/)
  assert.match(source, /onDossierChanged: function \(detail\)/)
  assert.match(source, /supervoteControls\.mount\(geneContent/)

  const normalized = normalizeCaretakerSupervoteSnapshot({ supervote: activeSnapshot() })
  assert.equal(normalized.assignment_version, 7)
  assert.equal(normalized.supervote_version, 3)
})
