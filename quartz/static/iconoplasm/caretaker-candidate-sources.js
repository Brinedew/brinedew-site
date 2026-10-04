// B-724: a caretaker sees, under each candidate image, which saved version of the
// prose made it, and one click opens that version in the History tab. The link comes
// only from the caretaker dossier (candidate_sources); the public gene object has no
// such field, and a candidate without a recorded source gets no link at all.
import { versionLabelForRevision } from "./caretaker-manifestations-view.js?v=3ffe9bbb030cb69d"

const CARD_SELECTOR = "[data-icono-candidate-asset]"
const LINK_SELECTOR = "[data-icono-candidate-source]"

function sourceByAsset(dossier) {
  const sources = new Map()
  for (const entry of dossier?.candidate_sources || []) {
    sources.set(String(entry.asset_sha256 || ""), String(entry.source_manifestation_revision_id))
  }
  return sources
}

export function createCandidateSourceLinks() {
  const mounted = new WeakMap()

  function annotate(state) {
    // Our own edits must not re-trigger the observer that calls us.
    state.observer?.disconnect()
    const sources = sourceByAsset(state.dossier)
    state.root.querySelectorAll(CARD_SELECTOR).forEach(function (card) {
      const revisionId = sources.get(card.getAttribute("data-icono-candidate-asset") || "") || ""
      const existing = card.querySelector(LINK_SELECTOR)
      if (!revisionId) {
        existing?.remove()
        return
      }
      const known = versionLabelForRevision(state.dossier, revisionId)
      const text = known ? "Made from " + known.toLowerCase() : "Made from an earlier version"
      const link = existing || card.ownerDocument.createElement("button")
      link.type = "button"
      link.className = "icono-candidate-source-link"
      link.setAttribute("data-icono-candidate-source", revisionId)
      link.title = "Open this saved version in History"
      link.textContent = text
      // After the footer row, which is a nowrap flex line of vote buttons and labels.
      if (!existing) card.appendChild(link)
    })
    state.observer?.observe(state.root, { childList: true, subtree: true })
  }

  function mount(root, { dossier, openVersion } = {}) {
    if (!root) return
    const isCaretaker = dossier?.viewer?.is_caretaker === true
    if (!isCaretaker) {
      unmount(root)
      return
    }
    let state = mounted.get(root)
    if (!state) {
      state = { root, dossier, openVersion, observer: null, listener: null }
      state.listener = function (event) {
        const link = event.target?.closest?.(LINK_SELECTOR)
        if (!link || !state.root.contains(link)) return
        event.preventDefault()
        void state.openVersion?.(link.getAttribute("data-icono-candidate-source"))
      }
      root.addEventListener("click", state.listener)
      // The gallery renders (and re-renders) after the dossier loads.
      if (typeof MutationObserver === "function") {
        state.observer = new MutationObserver(function (records) {
          const cardAdded = records.some(function (record) {
            return Array.from(record.addedNodes).some(function (node) {
              return (
                node.nodeType === 1 &&
                (node.matches?.(CARD_SELECTOR) || node.querySelector?.(CARD_SELECTOR))
              )
            })
          })
          if (cardAdded) annotate(state)
        })
      }
      mounted.set(root, state)
    }
    state.dossier = dossier
    state.openVersion = openVersion
    annotate(state)
  }

  function unmount(root) {
    const state = root && mounted.get(root)
    if (!state) return
    state.observer?.disconnect()
    root.removeEventListener("click", state.listener)
    root.querySelectorAll(LINK_SELECTOR).forEach(function (link) {
      link.remove()
    })
    mounted.delete(root)
  }

  return Object.freeze({ mount, unmount })
}
