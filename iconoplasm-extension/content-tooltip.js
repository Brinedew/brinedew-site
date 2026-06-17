;(function (root) {
  "use strict"

  function createTooltipShell(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || root
    const tooltip = documentRef.createElement("div")
    tooltip.className = "iconoplasm-tooltip"
    tooltip.setAttribute("role", "tooltip")

    const portrait = documentRef.createElement("div")
    portrait.className = "iconoplasm-tooltip-portrait"
    const body = documentRef.createElement("div")
    body.className = "iconoplasm-tooltip-body"
    tooltip.append(portrait, body)
    documentRef.body.appendChild(tooltip)

    if (typeof options.applyTooltipTheme === "function") options.applyTooltipTheme()
    documentRef.addEventListener("mouseover", options.onMouseOver)
    documentRef.addEventListener("mouseout", options.onMouseOut)
    windowRef.addEventListener("message", options.onFrameMessage)
    tooltip.addEventListener("click", options.onTooltipClick)
    tooltip.addEventListener("keydown", options.onTooltipKeyDown)
    tooltip.addEventListener("mouseenter", options.cancelHideTimer)
    tooltip.addEventListener("mouseleave", options.onTooltipMouseLeave)
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
