;(function (root) {
  "use strict"

  function requestGeneData(chromeApi, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 2000
    const setTimeoutFn = options.setTimeoutFn || root.setTimeout
    const clearTimeoutFn = options.clearTimeoutFn || root.clearTimeout

    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeoutFn(timeoutId)
        resolve(value || null)
      }
      const timeoutId = setTimeoutFn(() => finish(null), timeoutMs)

      try {
        chromeApi.runtime.sendMessage({ type: "GET_GENE_DATA" }, (payload) => {
          // Reading lastError in the callback is required by Chromium and harmless
          // in Firefox. A missing background page is a retryable empty response.
          if (chromeApi.runtime.lastError) {
            finish(null)
            return
          }
          finish(payload)
        })
      } catch (_error) {
        finish(null)
      }
    })
  }

  function createMutationScanController(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || root
    const MutationObserverCtor = options.MutationObserverCtor || root.MutationObserver
    const shouldIgnoreNode =
      typeof options.shouldIgnoreNode === "function" ? options.shouldIgnoreNode : () => false
    const scanPage = typeof options.scanPage === "function" ? options.scanPage : () => 0
    const onScanComplete =
      typeof options.onScanComplete === "function" ? options.onScanComplete : () => {}
    const dirtyRoots = new Set()
    let scanScheduled = false
    let observer = null

    function nodeContains(ancestor, descendant) {
      if (!ancestor || !descendant || ancestor === descendant) return ancestor === descendant
      if (typeof ancestor.contains === "function") return ancestor.contains(descendant)
      return false
    }

    function addDirtyRoot(node) {
      if (!node || shouldIgnoreNode(node)) return false
      for (const existing of dirtyRoots) {
        if (nodeContains(existing, node)) return false
        if (nodeContains(node, existing)) dirtyRoots.delete(existing)
      }
      dirtyRoots.add(node)
      return true
    }

    function flush() {
      scanScheduled = false
      if (!dirtyRoots.size) return
      const roots = Array.from(dirtyRoots)
      dirtyRoots.clear()
      let wrappedCount = 0
      for (const rootNode of roots) wrappedCount += Number(scanPage(rootNode)) || 0
      if (wrappedCount > 0) onScanComplete(wrappedCount)
    }

    function schedule() {
      if (scanScheduled || !dirtyRoots.size) return
      scanScheduled = true
      windowRef.setTimeout(flush, 0)
    }

    function handleMutations(mutations) {
      for (const mutation of mutations || []) {
        if (mutation.type === "characterData") {
          addDirtyRoot(mutation.target)
          continue
        }
        for (const node of mutation.addedNodes || []) addDirtyRoot(node)
      }
      schedule()
    }

    function start() {
      if (observer || !documentRef.documentElement) return observer
      observer = new MutationObserverCtor(handleMutations)
      observer.observe(documentRef.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
      })
      return observer
    }

    function stop() {
      if (observer) observer.disconnect()
      observer = null
      dirtyRoots.clear()
      scanScheduled = false
    }

    return {
      start,
      stop,
      addDirtyRoot,
      flush,
    }
  }

  root.IconoplasmContentLifecycle = {
    requestGeneData,
    createMutationScanController,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
