;(function (root) {
  "use strict"

  function createTooltipShell(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || root
    const tooltip = documentRef.createElement("div")
    tooltip.className = "iconoplasm-tooltip"
    tooltip.setAttribute("role", "tooltip")

    const backdrop = documentRef.createElement("div")
    backdrop.className = "iconoplasm-tooltip-backdrop"
    backdrop.setAttribute("aria-hidden", "true")

    const mobileBar = documentRef.createElement("div")
    mobileBar.className = "iconoplasm-tooltip-mobile-bar"
    const close = documentRef.createElement("button")
    close.className = "iconoplasm-tooltip-mobile-close"
    close.type = "button"
    close.setAttribute("aria-label", "Close gene preview")
    close.textContent = "Close"
    const open = documentRef.createElement("a")
    open.className = "iconoplasm-tooltip-mobile-open"
    open.setAttribute("data-icono-tooltip-open", "")
    open.target = "_blank"
    open.rel = "noopener noreferrer"
    open.textContent = "Open on Iconoplasm"
    mobileBar.append(close, open)

    const portrait = documentRef.createElement("div")
    portrait.className = "iconoplasm-tooltip-portrait"
    const body = documentRef.createElement("div")
    body.className = "iconoplasm-tooltip-body"
    tooltip.append(mobileBar, portrait, body)
    documentRef.body.append(backdrop, tooltip)

    if (typeof options.applyTooltipTheme === "function") options.applyTooltipTheme()
    if (typeof options.onMouseOver === "function") {
      documentRef.addEventListener("mouseover", options.onMouseOver)
    }
    if (typeof options.onMouseOut === "function") {
      documentRef.addEventListener("mouseout", options.onMouseOut)
    }
    if (typeof options.onDocumentPointerDown === "function") {
      documentRef.addEventListener("pointerover", options.onDocumentPointerDown, true)
      documentRef.addEventListener("pointerdown", options.onDocumentPointerDown, true)
    }
    if (typeof options.onDocumentTouchStart === "function") {
      documentRef.addEventListener("touchstart", options.onDocumentTouchStart, {
        capture: true,
        passive: true,
      })
    }
    if (typeof options.onDocumentClick === "function") {
      documentRef.addEventListener("click", options.onDocumentClick, true)
    }
    if (typeof options.onDocumentKeyDown === "function") {
      documentRef.addEventListener("keydown", options.onDocumentKeyDown, true)
    }
    if (typeof options.onFrameMessage === "function") {
      windowRef.addEventListener("message", options.onFrameMessage)
    }
    if (typeof options.onTooltipClick === "function") {
      tooltip.addEventListener("click", options.onTooltipClick)
    }
    if (typeof options.onTooltipKeyDown === "function") {
      tooltip.addEventListener("keydown", options.onTooltipKeyDown)
    }
    if (typeof options.cancelHideTimer === "function") {
      tooltip.addEventListener("mouseenter", options.cancelHideTimer)
    }
    if (typeof options.onTooltipMouseLeave === "function") {
      tooltip.addEventListener("mouseleave", options.onTooltipMouseLeave)
    }
    if (typeof options.onBackdropClick === "function") {
      backdrop.addEventListener("click", options.onBackdropClick)
    }
    if (typeof options.onCloseClick === "function") {
      close.addEventListener("click", options.onCloseClick)
    }
    tooltip.tabIndex = 0
    return tooltip
  }

  function createAuthToast(documentRef) {
    const toast = documentRef.createElement("div")
    toast.className = "iconoplasm-auth-toast"
    toast.setAttribute("role", "status")
    toast.setAttribute("aria-live", "polite")
    documentRef.body.appendChild(toast)
    return toast
  }

  root.IconoplasmContentTooltip = {
    createTooltipShell,
    createAuthToast,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
