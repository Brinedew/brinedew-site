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
    const windowRef = options.windowRef || root
    const documentRef = options.documentRef || root.document
    const getHost = typeof options.getHost === "function" ? options.getHost : () => null
    const frameUrl = String(options.frameUrl || "")
    const frameOrigin = String(options.frameOrigin || "")
    const prewarmClass = String(options.prewarmClass || "iconoplasm-tooltip-lit-frame--prewarm")
    const onPostError = typeof options.onPostError === "function" ? options.onPostError : () => {}
    let frame = null
    let imageSerial = 0
    const imageRequests = new Map()

    function sendImageRequest(entry) {
      if (entry.sent || entry.frame !== frame || frame?.dataset.iconoFrameReady !== "true") return
      entry.sent = true
      try {
        frame.contentWindow.postMessage(
          {
            type: "ICONOPLASM_FRAME_LOAD_IMAGE",
            requestId: entry.id,
            url: entry.url,
            timeoutMs: entry.timeoutMs,
          },
          frameOrigin,
        )
      } catch (error) {
        entry.finish(error)
      }
    }

    // Image preparation must happen in the displaying frame's cache partition.
    // The parent still owns source policy/hedging; this RPC only loads/decodes
    // that exact URL, with source identity, deadline and cancellation ownership.
    function loadImage(url, timeoutMs, signal) {
      const activeFrame = ensure()
      if (!activeFrame || imageRequests.size >= 8)
        return Promise.reject(new Error("Card image loader unavailable"))
      return new Promise((resolve, reject) => {
        const id = `image-${++imageSerial}`
        const entry = { id, url, timeoutMs, frame: activeFrame, sent: false, finish }
        const abort = () => {
          const error = new Error("Card image load aborted")
          error.name = "AbortError"
          finish(error)
        }
        const timer = windowRef.setTimeout(
          () => finish(new Error("Card image load timed out")),
          Math.max(250, Number(timeoutMs) || 2500) + 500,
        )
        function finish(error) {
          if (!imageRequests.delete(id)) return
          windowRef.clearTimeout(timer)
          signal?.removeEventListener?.("abort", abort)
          if (error && entry.sent) {
            try {
              entry.frame.contentWindow?.postMessage(
                { type: "ICONOPLASM_FRAME_CANCEL_IMAGE", requestId: id },
                frameOrigin,
              )
            } catch (postError) {
              onPostError(postError)
            }
          }
          if (error) reject(error)
          else resolve(url)
        }
        imageRequests.set(id, entry)
        if (signal?.aborted) return abort()
        signal?.addEventListener?.("abort", abort, { once: true })
        sendImageRequest(entry)
      })
    }

    function acceptImageResult(source, data) {
      if (data?.type !== "ICONOPLASM_FRAME_IMAGE_RESULT") return false
      const entry = imageRequests.get(data.requestId)
      if (!entry || source !== entry.frame.contentWindow || data.url !== entry.url) return false
      entry.finish(data.ok === true ? null : new Error("Card image source failed"))
      return true
    }

    function cancelImages() {
      for (const entry of imageRequests.values())
        entry.finish(new Error("Card image loader disposed"))
    }

    function ensure() {
      if (frame && frame.isConnected) return frame
      cancelImages()
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
      for (const entry of imageRequests.values()) sendImageRequest(entry)
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
      loadImage,
      acceptImageResult,
      cancelImages,
      getFrame: () => frame,
    })
  }

  root.IconoplasmContentTooltip = {
    createTooltipShell,
    createAuthToast,
    postBackgroundTask,
    isFrameRequestCurrent,
    createAdapterOwnedPortraitState,
    createPersistentFrameController,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
