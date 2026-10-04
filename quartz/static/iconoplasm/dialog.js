// B-849: the only dialog definition. Every Iconoplasm dialog is a native <dialog>
// built from this template and styled by `.icono-dialog` in styles.css; no dialog
// has its own header, close button, radius or footer. Native <dialog> supplies
// the focus trap, Escape, the inert page behind the modal and focus restore.
// This module adds the three things it does not: one markup template, a close
// icon button, and a backdrop click that never fires from a text-selection drag.
//
//   dialogMarkup({ id, title, size, body, footer })   HTML string, for string templates
//   createDialogElement(document, { ...same })        a detached <dialog>, for DOM builders
//   openDialog(dialog) / closeDialog(dialog)          show it modally / ask it to close
//
// Sizes: compact (28rem confirmations and sign-in), standard (36rem forms),
// wide (72rem work surfaces). `fixed` pins the height for dialogs whose content
// changes under tabs, so the frame never jumps.
const SIZES = new Set(["compact", "standard", "wide"])

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>'

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function classNames(...names) {
  return names.filter(Boolean).join(" ")
}

function titleIdOf(options) {
  return options.titleId || (options.id ? options.id + "-title" : "icono-dialog-title")
}

export function dialogAttributes(options = {}) {
  const size = SIZES.has(options.size) ? options.size : "standard"
  return {
    class: classNames(
      "icono-dialog",
      "icono-dialog--" + size,
      options.fixed && "icono-dialog--fixed",
      options.className,
    ),
    "aria-labelledby": titleIdOf(options),
    ...(options.id ? { id: options.id } : {}),
  }
}

// Everything inside <dialog>: panel, header (title, optional extra, close), the
// optional strip under the header, the scrolling body and the sticky footer.
export function dialogInnerMarkup(options = {}) {
  const titleId = titleIdOf(options)
  return (
    '<div class="' +
    classNames("icono-dialog__panel", options.panelClass) +
    '">' +
    '<header class="icono-dialog__header">' +
    '<h2 class="icono-dialog__title" id="' +
    escapeText(titleId) +
    '" data-icono-dialog-title>' +
    escapeText(options.title) +
    "</h2>" +
    (options.headerExtra || "") +
    '<button type="button" class="icono-button icono-button--icon icono-dialog__close" data-icono-dialog-close aria-label="Close">' +
    CLOSE_ICON +
    "</button>" +
    "</header>" +
    (options.afterHeader || "") +
    '<div class="' +
    classNames("icono-dialog__body", options.bodyClass) +
    '">' +
    (options.body || "") +
    "</div>" +
    (options.footer
      ? '<footer class="' +
        classNames("icono-dialog__footer", options.footerClass) +
        '">' +
        options.footer +
        "</footer>"
      : "") +
    "</div>"
  )
}

export function dialogMarkup(options = {}) {
  const attributes = dialogAttributes(options)
  const attributeText = Object.entries(attributes)
    .map(([name, value]) => name + '="' + escapeText(value) + '"')
    .join(" ")
  return (
    "<dialog " +
    attributeText +
    (options.attributes ? " " + options.attributes : "") +
    ">" +
    dialogInnerMarkup(options) +
    "</dialog>"
  )
}

export function createDialogElement(ownerDocument, options = {}) {
  const dialog = ownerDocument.createElement("dialog")
  for (const [name, value] of Object.entries(dialogAttributes(options))) {
    dialog.setAttribute(name, value)
  }
  for (const [name, value] of Object.entries(options.dataAttributes || {})) {
    dialog.setAttribute(name, value)
  }
  dialog.innerHTML = dialogInnerMarkup(options)
  return dialog
}

export function setDialogTitle(dialog, title) {
  const element = dialog?.querySelector?.("[data-icono-dialog-title]")
  if (element) element.textContent = String(title ?? "")
}

// Escape, the close button and the backdrop all go through one cancelable
// request, so a dialog that must not close mid-submit blocks every route by
// preventing the native `cancel` event once.
export function closeDialog(dialog, returnValue) {
  if (!dialog || dialog.open === false) return false
  const view = dialog.ownerDocument?.defaultView
  const EventConstructor = view?.Event || globalThis.Event
  const cancel = new EventConstructor("cancel", { cancelable: true })
  if (dialog.dispatchEvent(cancel) === false) return false
  dialog.close(returnValue)
  return true
}

// Idempotent: a dialog that is re-rendered gets a new element and is bound again.
export function bindDialog(dialog) {
  if (!dialog || dialog.hasAttribute("data-icono-dialog-bound")) return dialog
  dialog.setAttribute("data-icono-dialog-bound", "")
  let pressStartedOnBackdrop = null
  dialog.addEventListener("mousedown", function (event) {
    pressStartedOnBackdrop = event.target === dialog
  })
  dialog.addEventListener("click", function (event) {
    const closeButton = event.target?.closest?.("[data-icono-dialog-close]")
    if (closeButton && dialog.contains(closeButton)) {
      closeDialog(dialog, "dismiss")
      return
    }
    const startedOnBackdrop = pressStartedOnBackdrop
    pressStartedOnBackdrop = null
    if (event.target !== dialog || startedOnBackdrop === false) return
    const bounds = dialog.getBoundingClientRect()
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    if (outside) closeDialog(dialog, "dismiss")
  })
  return dialog
}

export function openDialog(dialog) {
  if (!dialog) return false
  bindDialog(dialog)
  if (!dialog.open) dialog.showModal()
  return true
}
