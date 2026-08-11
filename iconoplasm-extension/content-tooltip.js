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

  function createHoverIntentTracker() {
    let serial = 0
    let activeSymbol = ""

    function enter(rawSymbol) {
      activeSymbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      serial += 1
      return Object.freeze({ serial, symbol: activeSymbol })
    }

    function invalidate() {
      activeSymbol = ""
      serial += 1
    }

    function isCurrent(intent) {
      return Boolean(
        intent && Number(intent.serial) === serial && String(intent.symbol || "") === activeSymbol,
      )
    }

    return Object.freeze({ enter, invalidate, isCurrent })
  }

  function allowsSpeculativePrewarm(connection = root.navigator && root.navigator.connection) {
    if (!connection) return true
    if (connection.saveData === true) return false
    const effectiveType = String(connection.effectiveType || "")
      .trim()
      .toLowerCase()
    return effectiveType !== "slow-2g" && effectiveType !== "2g"
  }

  function postBackgroundTask(task, options = {}) {
    const windowRef = options.windowRef || root
    const signal = options.signal || null
    const delay = Math.max(0, Number(options.delay) || 0)
    const timeout = Math.max(0, Number(options.timeout) || 1000)
    if (signal && signal.aborted) return Promise.resolve(false)

    if (windowRef.scheduler && typeof windowRef.scheduler.postTask === "function") {
      return windowRef.scheduler
        .postTask(
          () => {
            if (signal && signal.aborted) return false
            task()
            return true
          },
          { priority: "background", delay, ...(signal ? { signal } : {}) },
        )
        .catch((error) => {
          if ((signal && signal.aborted) || (error && error.name === "AbortError")) return false
          throw error
        })
    }

    return new Promise((resolve) => {
      let timeoutId = 0
      let idleId = 0
      let settled = false
      const finish = (ran) => {
        if (settled) return
        settled = true
        if (signal) signal.removeEventListener("abort", onAbort)
        resolve(ran)
      }
      const onAbort = () => {
        if (timeoutId) windowRef.clearTimeout(timeoutId)
        if (idleId && typeof windowRef.cancelIdleCallback === "function") {
          windowRef.cancelIdleCallback(idleId)
        }
        finish(false)
      }
      const run = () => {
        if (signal && signal.aborted) {
          finish(false)
          return
        }
        task()
        finish(true)
      }
      const queueIdle = () => {
        timeoutId = 0
        if (typeof windowRef.requestIdleCallback === "function") {
          idleId = windowRef.requestIdleCallback(run, { timeout })
          return
        }
        run()
      }
      if (signal) signal.addEventListener("abort", onAbort, { once: true })
      timeoutId = windowRef.setTimeout(queueIdle, delay)
    })
  }

  function isFrameRequestCurrent(iframe, requestId) {
    if (!iframe || !iframe.isConnected) return false
    const normalizedRequestId = String(requestId || "")
    if (!normalizedRequestId) return false
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") {
      return (
        String((iframe.__iconoPendingPayload && iframe.__iconoPendingPayload.requestId) || "") ===
        normalizedRequestId
      )
    }
    return String(iframe.dataset.iconoFrameActiveRequest || "") === normalizedRequestId
  }

  function createAdapterOwnedPortraitState(rawPortraitSrc, cachedPortraitSrc) {
    return Object.freeze({
      requestSrc: String(rawPortraitSrc || "").trim(),
      frameSrc: String(cachedPortraitSrc || "").trim(),
    })
  }

  // ARCHITECTURE FENCE [IPD-008]: the rich hover surface has one permanent browsing
  // context. Pending renders, exact request ownership, and adapter-only hydration live
  // together so initialization retries and A -> B -> A movement cannot revive stale work.
  function createPersistentFrameController(options = {}) {
    const documentRef = options.documentRef || root.document
    const getHost = typeof options.getHost === "function" ? options.getHost : () => null
    const frameUrl = String(options.frameUrl || "")
    const frameOrigin = String(options.frameOrigin || "")
    const prewarmClass = String(options.prewarmClass || "iconoplasm-tooltip-lit-frame--prewarm")
    const onPostError = typeof options.onPostError === "function" ? options.onPostError : () => {}
    let frame = null

    function ensure() {
      if (frame && frame.isConnected) return frame
      const host = getHost()
      if (!host || typeof host.appendChild !== "function") return null
      const nextFrame = documentRef.createElement("iframe")
      nextFrame.className = `iconoplasm-tooltip-lit-frame ${prewarmClass}`.trim()
      nextFrame.dataset.iconoFrameReady = "false"
      nextFrame.src = frameUrl
      nextFrame.title = "Iconoplasm hover card preloader"
      nextFrame.scrolling = "no"
      nextFrame.tabIndex = -1
      nextFrame.setAttribute("aria-hidden", "true")
      host.appendChild(nextFrame)
      frame = nextFrame
      return frame
    }

    function park() {
      if (!frame) return null
      frame.classList.add(prewarmClass)
      frame.setAttribute("aria-hidden", "true")
      frame.title = "Iconoplasm hover card preloader"
      return frame
    }

    function show(title) {
      const activeFrame = ensure()
      if (!activeFrame) return null
      activeFrame.classList.remove(prewarmClass)
      activeFrame.removeAttribute("aria-hidden")
      activeFrame.title = String(title || "Gene hover card")
      return activeFrame
    }

    function post(payload) {
      const activeFrame = ensure()
      if (!activeFrame || !activeFrame.isConnected || !activeFrame.contentWindow) return false
      const requestId = String((payload && payload.requestId) || "")
      const symbol = String((payload && payload.symbol) || "")
        .trim()
        .toUpperCase()
      if (!activeFrame.dataset || activeFrame.dataset.iconoFrameReady !== "true") {
        activeFrame.__iconoPendingPayload = payload
        return false
      }
      const previousSymbol = String(activeFrame.dataset.iconoFrameSymbol || "")
        .trim()
        .toUpperCase()
      activeFrame.dataset.iconoFrameActiveRequest = requestId
      if (previousSymbol && symbol && previousSymbol !== symbol) {
        activeFrame.dataset.iconoFrameRenderState = "pending"
      }
      try {
        activeFrame.contentWindow.postMessage(payload, frameOrigin)
        return true
      } catch (error) {
        onPostError(error)
        return false
      }
    }

    function markReady(source) {
      if (!frame || (source && source !== frame.contentWindow)) return false
      frame.dataset.iconoFrameReady = "true"
      const pendingPayload = frame.__iconoPendingPayload
      frame.__iconoPendingPayload = null
      if (pendingPayload) post(pendingPayload)
      return true
    }

    function isCurrent(requestId) {
      return isFrameRequestCurrent(frame, requestId)
    }

    async function postHydrated(requestId, sourcePromise, createPayload) {
      let source = ""
      try {
        source = String((await sourcePromise) || "").trim()
      } catch (_) {
        return false
      }
      if (!source || !isCurrent(requestId)) return false
      const payload = typeof createPayload === "function" ? createPayload(source) : null
      if (!payload || !isCurrent(requestId)) return false
      post(payload)
      return true
    }

    return Object.freeze({
      ensure,
      park,
      show,
      post,
      markReady,
      isCurrent,
      postHydrated,
      getFrame: () => frame,
    })
  }

  root.IconoplasmContentTooltip = {
    createTooltipShell,
    createAuthToast,
    createHoverIntentTracker,
    allowsSpeculativePrewarm,
    postBackgroundTask,
    isFrameRequestCurrent,
    createAdapterOwnedPortraitState,
    createPersistentFrameController,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
