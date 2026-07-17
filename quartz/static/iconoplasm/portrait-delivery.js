const DEFAULT_PRIMARY_ORIGIN = "https://iconoplasmportraits.b-cdn.net"
const DEFAULT_FALLBACK_ORIGIN = "https://iconoplasm.brinedew.bio"
const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_SESSION_KEY = "iconoplasm.portrait-source.v1"

function normalizeOrigin(value, fallback) {
  try {
    return new URL(String(value || fallback)).origin
  } catch (_) {
    return fallback
  }
}

function portraitPath(rawUrl, origins) {
  const raw = String(rawUrl || "").trim()
  if (!raw) return ""
  try {
    const parsed = new URL(raw, origins.fallback)
    if (parsed.origin !== origins.primary && parsed.origin !== origins.fallback) return ""
    if (!parsed.pathname.startsWith("/portraits/")) return ""
    return parsed.pathname + parsed.search
  } catch (_) {
    return ""
  }
}

export function createPortraitDelivery(options = {}) {
  const origins = {
    primary: normalizeOrigin(options.primaryOrigin, DEFAULT_PRIMARY_ORIGIN),
    fallback: normalizeOrigin(options.fallbackOrigin, DEFAULT_FALLBACK_ORIGIN),
  }
  const timeoutMs = Math.max(1, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS))
  const storageKey = String(options.storageKey || DEFAULT_SESSION_KEY)
  const storage = options.sessionStorageRef || globalThis.sessionStorage || null
  const ImageCtor = options.ImageCtor || globalThis.Image
  const setTimer = options.setTimeoutRef || globalThis.setTimeout
  const clearTimer = options.clearTimeoutRef || globalThis.clearTimeout
  let volatileState = { source: "", failed: [] }
  let decisionPromise = null
  let installedDocument = null

  function readState() {
    if (!storage || typeof storage.getItem !== "function") return volatileState
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || "null")
      const source =
        parsed && (parsed.source === "primary" || parsed.source === "fallback") ? parsed.source : ""
      const failed = Array.isArray(parsed && parsed.failed)
        ? parsed.failed.filter((item) => item === "primary" || item === "fallback")
        : []
      volatileState = { source, failed: Array.from(new Set(failed)) }
    } catch (_) {
      // A blocked or corrupt session store must not break portrait rendering.
    }
    return volatileState
  }

  function writeState(nextState) {
    volatileState = {
      source:
        nextState.source === "primary" || nextState.source === "fallback" ? nextState.source : "",
      failed: Array.from(new Set(Array.isArray(nextState.failed) ? nextState.failed : [])),
    }
    if (!storage || typeof storage.setItem !== "function") return
    try {
      storage.setItem(storageKey, JSON.stringify(volatileState))
    } catch (_) {
      // The in-memory state still protects this page when storage is unavailable.
    }
  }

  function sourceUrl(path, source) {
    if (!path) return ""
    return (source === "fallback" ? origins.fallback : origins.primary) + path
  }

  function resolve(rawUrl) {
    const path = portraitPath(rawUrl, origins)
    if (!path) return String(rawUrl || "").trim()
    const state = readState()
    return sourceUrl(path, state.source || "primary")
  }

  function choose(source, failed = []) {
    writeState({ source, failed })
    return source
  }

  function adopt(externalDecision) {
    if (!externalDecision || typeof externalDecision.then !== "function") return decisionPromise
    if (readState().source || decisionPromise) return decisionPromise
    decisionPromise = Promise.resolve(externalDecision)
      .then((source) => {
        if (source === "primary") return choose("primary", [])
        if (source === "fallback") return choose("fallback", ["primary"])
        return ""
      })
      .finally(() => {
        decisionPromise = null
      })
    return decisionPromise
  }

  function ensure(rawUrl) {
    const path = portraitPath(rawUrl, origins)
    if (!path) return Promise.resolve(String(rawUrl || "").trim())
    const existing = readState()
    if (existing.source) return Promise.resolve(sourceUrl(path, existing.source))
    if (decisionPromise) {
      return decisionPromise.then(() => {
        const decided = readState()
        return decided.source ? sourceUrl(path, decided.source) : ensure(rawUrl)
      })
    }
    if (typeof ImageCtor !== "function") {
      choose("fallback", ["primary"])
      return Promise.resolve(sourceUrl(path, "fallback"))
    }

    decisionPromise = new Promise((resolveDecision) => {
      const probe = new ImageCtor()
      let settled = false
      let timer = 0
      const settle = (source) => {
        if (settled) return
        settled = true
        if (timer) clearTimer(timer)
        probe.onload = null
        probe.onerror = null
        choose(source, source === "fallback" ? ["primary"] : [])
        resolveDecision(source)
      }
      probe.decoding = "async"
      probe.onload = () => settle("primary")
      probe.onerror = () => settle("fallback")
      timer = setTimer(() => {
        settle("fallback")
        try {
          probe.src = ""
        } catch (_) {}
      }, timeoutMs)
      probe.src = sourceUrl(path, "primary")
    }).finally(() => {
      decisionPromise = null
    })

    return decisionPromise.then(() => resolve(rawUrl))
  }

  function markFailed(source) {
    if (source !== "primary" && source !== "fallback") return readState()
    const current = readState()
    const failed = Array.from(new Set(current.failed.concat(source)))
    const alternate = source === "primary" ? "fallback" : "primary"
    const nextSource = failed.includes(alternate) ? current.source : alternate
    writeState({ source: nextSource, failed })
    return readState()
  }

  function sourceFromUrl(rawUrl) {
    const value = String(rawUrl || "").trim()
    if (!value) return ""
    try {
      const parsed = new URL(value, origins.fallback)
      if (!parsed.pathname.startsWith("/portraits/")) return ""
      if (parsed.origin === origins.primary) return "primary"
      if (parsed.origin === origins.fallback) return "fallback"
    } catch (_) {}
    return ""
  }

  function rewriteAttribute(element, attribute, source) {
    const raw = element.getAttribute(attribute)
    const path = portraitPath(raw, origins)
    if (!path || sourceFromUrl(raw) === source) return
    element.setAttribute(attribute, sourceUrl(path, source))
  }

  function rewriteDocument(documentRef, source) {
    const attributes = ["src", "data-icono-pswp-src", "data-icono-source-image-url"]
    for (const attribute of attributes) {
      const nodes = documentRef.querySelectorAll(`[${attribute}]`)
      for (const node of nodes) rewriteAttribute(node, attribute, source)
    }
  }

  function install(documentRef = globalThis.document) {
    if (!documentRef || typeof documentRef.addEventListener !== "function") return () => {}
    if (installedDocument === documentRef) return () => {}
    installedDocument = documentRef
    const onError = (event) => {
      const target = event && event.target
      if (!target || String(target.tagName || "").toUpperCase() !== "IMG") return
      const failedUrl = target.currentSrc || target.getAttribute?.("src") || ""
      const failedSource = sourceFromUrl(failedUrl)
      const current = readState()
      if (
        !failedSource ||
        failedSource !== current.source ||
        current.failed.includes(failedSource)
      ) {
        return
      }
      const next = markFailed(failedSource)
      if (!next.source || next.source === failedSource) return
      rewriteDocument(documentRef, next.source)
    }
    documentRef.addEventListener("error", onError, true)
    return () => {
      documentRef.removeEventListener("error", onError, true)
      if (installedDocument === documentRef) installedDocument = null
    }
  }

  return {
    adopt,
    ensure,
    install,
    resolve,
    markFailed,
    state: readState,
    origins: { ...origins },
    timeoutMs,
  }
}

export const portraitDelivery = createPortraitDelivery()
