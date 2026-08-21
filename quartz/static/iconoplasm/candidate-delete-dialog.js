const CANDIDATE_DELETE_DIALOG_SELECTOR = "[data-icono-candidate-delete-dialog]"
const CANDIDATE_DELETE_NOTICE_SELECTOR = "[data-icono-candidate-delete-notice]"

function focusWithoutScrolling(element) {
  if (element && typeof element.focus === "function") {
    element.focus({ preventScroll: true })
  }
}

function candidateIdentity(symbol, sampleLabel, emulsionLabel) {
  return [symbol, sampleLabel, emulsionLabel].filter(Boolean).join(" · ")
}

export function removeCandidateFromPageState(options = {}) {
  const genePayload = options.genePayload || {}
  const assetSha = String(options.assetSha || "")
    .trim()
    .toLowerCase()
  const candidates = Array.isArray(genePayload.portrait_candidates)
    ? genePayload.portrait_candidates
    : []
  genePayload.portrait_candidates = candidates.filter(function (candidate) {
    return (
      String((candidate && candidate.asset_sha256) || "")
        .trim()
        .toLowerCase() !== assetSha
    )
  })

  const card = options.card || null
  const gallery = card && card.closest(".icono-candidate-gallery")
  const grid = card && card.closest(".icono-candidate-grid")
  if (card) card.remove()
  if (grid) {
    const remainingCards = grid.querySelectorAll(".icono-candidate-card")
    grid.classList.toggle("icono-candidate-grid--single", remainingCards.length === 1)
    if (!remainingCards.length && gallery) gallery.remove()
  }

  return genePayload.portrait_candidates.length
}

export function showCandidateDeleteNotice(options = {}) {
  const ownerDocument = options.document || globalThis.document
  if (!ownerDocument?.body) return null

  const previous = ownerDocument.querySelector(CANDIDATE_DELETE_NOTICE_SELECTOR)
  if (previous) previous.remove()

  const notice = ownerDocument.createElement("div")
  notice.className = "icono-candidate-delete-notice"
  notice.setAttribute("data-icono-candidate-delete-notice", "")
  notice.setAttribute("role", "status")
  notice.setAttribute("aria-live", "polite")
  notice.textContent = String(options.message || "Candidate deleted.")
  ownerDocument.body.appendChild(notice)

  const timer = (ownerDocument.defaultView || globalThis).setTimeout(
    function () {
      notice.classList.add("is-leaving")
      ;(ownerDocument.defaultView || globalThis).setTimeout(function () {
        notice.remove()
      }, 180)
    },
    Number(options.durationMs || 4200),
  )
  notice._iconoNoticeTimer = timer
  return notice
}

export function openCandidateDeleteDialog(options = {}) {
  const ownerDocument = options.document || globalThis.document
  if (!ownerDocument?.body) {
    throw new Error("A document body is required to open the candidate delete dialog")
  }
  if (typeof options.onConfirm !== "function") {
    throw new Error("A candidate delete handler is required")
  }

  const existing = ownerDocument.querySelector(CANDIDATE_DELETE_DIALOG_SELECTOR)
  if (existing) return existing

  const symbol = String(options.symbol || "")
    .trim()
    .toUpperCase()
  const sampleLabel = String(options.sampleLabel || "").trim()
  const emulsionLabel = String(options.emulsionLabel || "").trim()
  const identity = candidateIdentity(symbol, sampleLabel, emulsionLabel)

  const dialog = ownerDocument.createElement("dialog")
  dialog.className = "icono-candidate-delete-dialog"
  dialog.setAttribute("data-icono-candidate-delete-dialog", "")
  dialog.setAttribute("aria-labelledby", "icono-candidate-delete-title")
  dialog.setAttribute("aria-describedby", "icono-candidate-delete-consequence")

  const panel = ownerDocument.createElement("div")
  panel.className = "icono-candidate-delete-panel"

  const eyebrow = ownerDocument.createElement("p")
  eyebrow.className = "icono-candidate-delete-eyebrow"
  eyebrow.textContent = "Permanent admin action"

  const title = ownerDocument.createElement("h2")
  title.className = "icono-candidate-delete-title"
  title.id = "icono-candidate-delete-title"
  title.textContent = "Delete this candidate?"

  const identityEl = ownerDocument.createElement("p")
  identityEl.className = "icono-candidate-delete-identity"
  identityEl.textContent = identity || "Selected candidate"

  const consequence = ownerDocument.createElement("p")
  consequence.className = "icono-candidate-delete-consequence"
  consequence.id = "icono-candidate-delete-consequence"
  consequence.textContent =
    "The image will be removed from this gene and marked for deletion from the local image lab. This cannot be undone."

  const status = ownerDocument.createElement("p")
  status.className = "icono-candidate-delete-status"
  status.setAttribute("data-icono-candidate-delete-status", "")
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  status.hidden = true

  const actions = ownerDocument.createElement("div")
  actions.className = "icono-candidate-delete-actions"

  const cancelButton = ownerDocument.createElement("button")
  cancelButton.type = "button"
  cancelButton.className = "icono-candidate-delete-cancel"
  cancelButton.setAttribute("data-icono-candidate-delete-cancel", "")
  cancelButton.setAttribute("autofocus", "")
  cancelButton.textContent = "Keep candidate"

  const confirmButton = ownerDocument.createElement("button")
  confirmButton.type = "button"
  confirmButton.className = "icono-candidate-delete-confirm"
  confirmButton.setAttribute("data-icono-candidate-delete-confirm", "")
  confirmButton.textContent = "Delete candidate"

  actions.append(cancelButton, confirmButton)
  panel.append(eyebrow, title, identityEl, consequence, status, actions)
  dialog.appendChild(panel)

  let isSubmitting = false
  cancelButton.addEventListener("click", function () {
    if (!isSubmitting) dialog.close("cancel")
  })
  dialog.addEventListener("cancel", function (event) {
    if (isSubmitting) event.preventDefault()
  })
  function showSubmissionError(error) {
    if (typeof options.onFailure === "function") {
      options.onFailure(error)
      return
    }
    showCandidateDeleteNotice({
      document: ownerDocument,
      message:
        "Couldn’t delete the candidate. Nothing changed. " +
        String((error && error.message) || "Please try again."),
    })
  }

  confirmButton.addEventListener("click", function () {
    if (isSubmitting) return
    isSubmitting = true
    cancelButton.disabled = true
    confirmButton.disabled = true

    let submission
    try {
      submission = options.onConfirm()
    } catch (error) {
      isSubmitting = false
      cancelButton.disabled = false
      confirmButton.disabled = false
      confirmButton.textContent = "Try again"
      status.hidden = false
      status.textContent =
        "Couldn’t delete the candidate. Nothing changed. " +
        String((error && error.message) || "Please try again.")
      focusWithoutScrolling(confirmButton)
      return
    }

    // Confirmation is complete once the request has been accepted by the page.
    // The modal must not own the slow storage and publication lifecycle.
    dialog.close("submitted")
    Promise.resolve(submission).catch(showSubmissionError)
  })
  dialog.addEventListener(
    "close",
    function () {
      const submitted = dialog.returnValue === "submitted"
      dialog.remove()
      if (!submitted) focusWithoutScrolling(options.returnFocus)
    },
    { once: true },
  )

  ownerDocument.body.appendChild(dialog)
  try {
    dialog.showModal()
  } catch (error) {
    dialog.remove()
    throw error
  }
  focusWithoutScrolling(cancelButton)
  return dialog
}
