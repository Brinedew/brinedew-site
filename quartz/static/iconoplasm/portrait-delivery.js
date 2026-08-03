import {
  createPortraitDeliverySession,
  normalizePortraitDeliveryPolicy,
} from "./generated/portrait-delivery-core.js?v=20260803-gene-card-fallback"

const SESSION_KEY = "iconoplasm.portrait-delivery.v2"

function readSessionState(storage) {
  if (!storage?.getItem) return null
  try {
    return JSON.parse(storage.getItem(SESSION_KEY) || "null")
  } catch (_error) {
    return null
  }
}

function imageProbe(ImageCtor, setTimer, clearTimer) {
  return (url, timeoutMs) =>
    new Promise((resolve) => {
      if (typeof ImageCtor !== "function") return resolve(false)
      const image = new ImageCtor()
      let settled = false
      let timer = 0
      const settle = (result) => {
        if (settled) return
        settled = true
        if (timer) clearTimer(timer)
        image.onload = null
        image.onerror = null
        resolve(result)
      }
      image.decoding = "async"
      image.fetchPriority = "high"
      image.onload = () => settle(true)
      image.onerror = () => settle(false)
      timer = setTimer(() => {
        settle(false)
        try {
          image.src = ""
        } catch (_error) {}
      }, timeoutMs)
      image.src = url
    })
}

export function createPortraitDelivery(options = {}) {
  const storage = options.sessionStorageRef ?? globalThis.sessionStorage ?? null
  const bindings = new Map()
  let installedDocument = null
  let policyReady = Promise.resolve()
  const session = createPortraitDeliverySession({
    policy: options.policy,
    initialState: readSessionState(storage),
    probe:
      options.probe ||
      imageProbe(
        options.ImageCtor ?? globalThis.Image,
        options.setTimeoutRef ?? globalThis.setTimeout,
        options.clearTimeoutRef ?? globalThis.clearTimeout,
      ),
    persist(state) {
      try {
        storage?.setItem?.(SESSION_KEY, JSON.stringify(state))
      } catch (_error) {}
      rewriteBindings()
    },
  })

  function resolveAttributes(attributes) {
    return Object.fromEntries(
      Object.entries(attributes || {}).map(([name, rawUrl]) => [name, session.resolve(rawUrl)]),
    )
  }

  function applyBinding(element, attributes) {
    if (!element?.setAttribute) return
    for (const [name, url] of Object.entries(resolveAttributes(attributes))) {
      if (url) element.setAttribute(name, url)
      else element.removeAttribute(name)
    }
  }

  function rewriteBindings() {
    for (const [element, attributes] of bindings) {
      if (element?.isConnected === false) {
        bindings.delete(element)
        continue
      }
      applyBinding(element, attributes)
    }
  }

  function pruneBindings() {
    for (const element of bindings.keys()) {
      if (element?.isConnected === false) bindings.delete(element)
    }
  }

  function bind(element, rawUrlOrAttributes) {
    pruneBindings()
    const attributes =
      typeof rawUrlOrAttributes === "string"
        ? { src: rawUrlOrAttributes }
        : { ...(rawUrlOrAttributes || {}) }
    bindings.set(element, attributes)
    applyBinding(element, attributes)
    return element
  }

  function unbind(element) {
    bindings.delete(element)
  }

  function install(documentRef = globalThis.document) {
    if (!documentRef?.addEventListener || installedDocument === documentRef) return () => {}
    installedDocument = documentRef
    const onError = (event) => {
      const target = event?.target
      if (String(target?.tagName || "").toUpperCase() !== "IMG") return
      const failedUrl = target.currentSrc || target.getAttribute?.("src") || ""
      const result = session.reportFailure(failedUrl)
      if (result.changed || bindings.has(target)) rewriteBindings()
      if (!bindings.has(target) && result.replacementUrl && result.replacementUrl !== failedUrl) {
        target.setAttribute("src", result.replacementUrl)
      }
    }
    documentRef.addEventListener("error", onError, true)
    return () => {
      documentRef.removeEventListener("error", onError, true)
      if (installedDocument === documentRef) installedDocument = null
    }
  }

  async function refreshPolicy(fetchRef = globalThis.fetch) {
    if (typeof fetchRef !== "function") return session.policy()
    policyReady = (async () => {
      try {
        const response = await fetchRef("/api/public/v1/metadata", { cache: "no-store" })
        if (!response.ok) return session.policy()
        const metadata = await response.json()
        return session.configure(normalizePortraitDeliveryPolicy(metadata?.portrait_delivery))
      } catch (_error) {
        return session.policy()
      }
    })()
    return policyReady
  }

  async function ensure(rawUrl) {
    await policyReady
    return session.ensure(rawUrl)
  }

  return {
    bind,
    configure: session.configure,
    ensure,
    install,
    origins: () => ({
      accelerator: session.policy().accelerator.origin,
      canonical: session.policy().canonical_origin,
    }),
    refreshPolicy,
    reportFailure: session.reportFailure,
    resolve: session.resolve,
    state: session.state,
    unbind,
  }
}

export const portraitDelivery = createPortraitDelivery()
portraitDelivery.refreshPolicy()
