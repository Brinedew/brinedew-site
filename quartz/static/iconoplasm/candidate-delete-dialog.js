import { bindDialog, createDialogElement } from "./dialog.js?v=a5c98f9ed0ae3eb6"

const CANDIDATE_DELETE_DIALOG_SELECTOR = "[data-icono-candidate-delete-dialog]"
const CANDIDATE_DELETE_NOTICE_SELECTOR = "[data-icono-candidate-delete-notice]"
const ANALYTICS_CONSENT_SELECTOR = ".brinedew-analytics-consent"

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

  // The analytics consent prompt owns the same corner at the top z-index, so a notice that
  // reached the corner first would sit under it, unseen. Stack above the prompt instead.
  const consent = ownerDocument.querySelector(ANALYTICS_CONSENT_SELECTOR)
  if (consent && typeof consent.getBoundingClientRect === "function") {
    const viewportHeight = (ownerDocument.defaultView || globalThis).innerHeight
    notice.style.insetBlockEnd = `${Math.round(viewportHeight - consent.getBoundingClientRect().top + 8)}px`
  }

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

  const dialog = createDialogElement(ownerDocument, {
    id: "icono-candidate-delete",
    titleId: "icono-candidate-delete-title",
    title: "Delete this candidate?",
    size: "compact",
    className: "icono-candidate-delete-dialog",
    dataAttributes: {
      "data-icono-candidate-delete-dialog": "",
      "aria-describedby": "icono-candidate-delete-consequence",
    },
    body:
      '<div class="icono-candidate-delete-body">' +
      '<p class="icono-candidate-delete-identity"></p>' +
      '<p class="icono-candidate-delete-consequence" id="icono-candidate-delete-consequence">' +
      "The image will be removed from this gene and marked for deletion from the local image lab. This cannot be undone." +
      "</p>" +
      '<p class="icono-candidate-delete-status" data-icono-candidate-delete-status role="status" aria-live="polite" hidden></p>' +
      "</div>",
    footer:
      '<button type="button" class="icono-button icono-candidate-delete-cancel" data-icono-candidate-delete-cancel autofocus>Keep candidate</button>' +
      '<button type="button" class="icono-button icono-button--danger icono-candidate-delete-confirm" data-icono-candidate-delete-confirm>Delete candidate</button>',
  })
  dialog.querySelector(".icono-candidate-delete-identity").textContent =
    identity || "Selected candidate"
  const status = dialog.querySelector("[data-icono-candidate-delete-status]")
  const cancelButton = dialog.querySelector("[data-icono-candidate-delete-cancel]")
  const confirmButton = dialog.querySelector("[data-icono-candidate-delete-confirm]")
  bindDialog(dialog)

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
