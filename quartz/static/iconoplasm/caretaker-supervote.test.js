import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  LONG_PRESS_MS,
  caretakerSupervoteMutation,
  createCaretakerSupervoteControls,
  normalizeCaretakerSupervoteSnapshot,
} from "./caretaker-supervote.js"

const FIRST_ASSET = "a".repeat(64)
const SECOND_ASSET = "b".repeat(64)

function activeSnapshot(overrides = {}) {
  return {
    assignment_status: "active",
    assignment_version: 7,
    accepted_event_sequence: 41,
    supervote_version: 3,
    asset_sha256: FIRST_ASSET,
    direction: 1,
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

function fixture() {
  const { document, Event } = parseHTML(
    `<main id="root">
      <div data-icono-gene-vote-box="${FIRST_ASSET}" data-image-score="4">
        <button data-icono-vote-down aria-label="Misfit">MISFIT</button>
        <button data-icono-vote-up aria-label="Fit">FIT</button>
      </div>
      <div data-icono-candidate-vote-box="${SECOND_ASSET}" data-image-score="1">
        <button data-icono-vote-down aria-label="Misfit">MISFIT</button>
        <button data-icono-vote-up aria-label="Fit">FIT</button>
      </div>
    </main>`,
  )
  globalThis.document = document
  globalThis.window = document.defaultView
  return { document, Event, root: document.getElementById("root") }
}

test("signed move, reverse, and recall commands bind both authority versions", () => {
  const moveNegative = caretakerSupervoteMutation({
    snapshot: activeSnapshot(),
    assetSha256: SECOND_ASSET,
    direction: -1,
  })
  const reverseCurrent = caretakerSupervoteMutation({
    snapshot: activeSnapshot(),
    assetSha256: FIRST_ASSET,
    direction: -1,
  })
  const recall = caretakerSupervoteMutation({
    snapshot: activeSnapshot(),
    assetSha256: FIRST_ASSET,
    direction: 1,
  })

  for (const mutation of [moveNegative, reverseCurrent]) {
    assert.equal(mutation.method, "PUT")
    assert.equal(mutation.body.direction, -1)
    assert.equal(mutation.body.expected_assignment_version, 7)
    assert.equal(mutation.body.expected_supervote_version, 3)
  }
  assert.equal(recall.method, "DELETE")
  assert.equal("asset_sha256" in recall.body, false)
  assert.equal("direction" in recall.body, false)
})

test("the selected ordinary vote button carries a non-color 10x marker and no parallel button", async () => {
  const { root } = fixture()
  const controls = createCaretakerSupervoteControls({
    fetchJSON: async () => ({ supervote: activeSnapshot() }),
  })
  await controls.mount(root, { symbol: "TP53", dossier: caretakerDossier() })

  const selected = root.querySelector(`[data-icono-gene-vote-box] [data-icono-vote-up]`)
  assert.equal(selected.classList.contains("is-caretaker-supervoted"), true)
  assert.equal(
    selected.parentElement.querySelector("[data-icono-caretaker-supervote-mark]").textContent,
    "+10",
  )
  assert.equal(selected.querySelector("[data-icono-caretaker-supervote-mark]"), null)
  assert.match(selected.getAttribute("aria-label"), /Long-press to recall your \+10/)
  assert.equal(root.querySelector(".icono-caretaker-supervote"), null)
  assert.equal(root.querySelector(`[data-icono-gene-vote-box]`).dataset.imageScore, "4")
})

test("Shift plus Space transfers a negative supervote without casting an ordinary vote", async () => {
  const { root, Event } = fixture()
  const calls = []
  let ordinaryClicks = 0
  const target = root.querySelector(`[data-icono-candidate-vote-box] [data-icono-vote-down]`)
  root.addEventListener("click", () => ordinaryClicks++)
  const controls = createCaretakerSupervoteControls({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      if (init.method === "GET") return { supervote: activeSnapshot() }
      return {
        supervote: activeSnapshot({
          supervote_version: 4,
          asset_sha256: SECOND_ASSET,
          direction: -1,
        }),
      }
    },
  })
  await controls.mount(root, { symbol: "TP53", dossier: caretakerDossier() })
  const keydown = new Event("keydown", { bubbles: true, cancelable: true })
  Object.defineProperties(keydown, {
    key: { value: " " },
    shiftKey: { value: true },
    repeat: { value: false },
  })
  target.dispatchEvent(keydown)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  const mutation = calls.find((call) => call.init.method === "PUT")
  assert.ok(mutation)
  assert.deepEqual(
    {
      asset_sha256: JSON.parse(mutation.init.body).asset_sha256,
      direction: JSON.parse(mutation.init.body).direction,
    },
    { asset_sha256: SECOND_ASSET, direction: -1 },
  )
  assert.equal(ordinaryClicks, 0)
  assert.equal(target.classList.contains("is-caretaker-supervoted"), true)
})

test("a pointer long press assigns once and suppresses the trailing ordinary click", async () => {
  const { root, Event } = fixture()
  const calls = []
  let ordinaryClicks = 0
  const target = root.querySelector(`[data-icono-candidate-vote-box] [data-icono-vote-up]`)
  const controls = createCaretakerSupervoteControls({
    fetchJSON: async function (_path, init) {
      calls.push(init.method)
      if (init.method === "GET")
        return { supervote: activeSnapshot({ active: false, asset_sha256: "", direction: null }) }
      return {
        supervote: activeSnapshot({
          asset_sha256: SECOND_ASSET,
          direction: 1,
          supervote_version: 4,
        }),
      }
    },
  })
  await controls.mount(root, { symbol: "TP53", dossier: caretakerDossier() })
  root.addEventListener("click", () => ordinaryClicks++)
  const pointerdown = new Event("pointerdown", { bubbles: true, cancelable: true })
  Object.defineProperties(pointerdown, {
    button: { value: 0 },
    pointerId: { value: 9 },
    clientX: { value: 10 },
    clientY: { value: 10 },
  })
  target.dispatchEvent(pointerdown)
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 25))
  const pointerup = new Event("pointerup", { bubbles: true })
  Object.defineProperty(pointerup, "pointerId", { value: 9 })
  target.dispatchEvent(pointerup)
  target.click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(calls, ["GET", "PUT"])
  assert.equal(ordinaryClicks, 0)
})

test("the main app lazy-loads the signed control beside the existing voting authority", () => {
  const source = readFileSync(new URL("./app.js", import.meta.url), "utf8")
  const css = readFileSync(new URL("./caretaker-supervote.css", import.meta.url), "utf8")
  assert.match(source, /import\("\.\/caretaker-supervote\.js\?v=/)
  assert.match(
    source,
    /import \{ createRequestInbox \} from "\.\/request-inbox\.js\?v=20260901-signed-supervote-v2"/,
  )
  assert.match(source, /supervoteControls\.mount\(geneContent/)
  assert.match(css, /caretaker-seal-positive\.png/)
  assert.match(css, /caretaker-seal-negative\.png/)
  assert.match(css, /pointer-events: none/)

  const normalized = normalizeCaretakerSupervoteSnapshot({ supervote: activeSnapshot() })
  assert.equal(normalized.direction, 1)
  assert.equal(normalized.supervote_version, 3)
})
