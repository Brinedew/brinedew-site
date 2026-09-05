;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: speculative extension work starts only
  // after the host page has loaded, settled, and yielded a genuine idle turn.

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
        chromeApi.runtime.sendMessage(
          { type: "GET_GENE_DATA", cacheOnly: options.cacheOnly === true },
          (payload) => {
            // Reading lastError in the callback is required by Chromium and harmless
            // in Firefox. A missing background page is a retryable empty response.
            if (chromeApi.runtime.lastError) {
              finish(null)
              return
            }
            finish(payload)
          },
        )
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
    let flushInProgress = false
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

    async function flush() {
      if (flushInProgress) return
      scanScheduled = false
      if (!dirtyRoots.size) return
      flushInProgress = true
      const roots = Array.from(dirtyRoots)
      dirtyRoots.clear()
      let wrappedCount = 0
      try {
        for (const rootNode of roots) {
          wrappedCount += Number(await scanPage(rootNode)) || 0
        }
        if (wrappedCount > 0) onScanComplete(wrappedCount)
      } finally {
        flushInProgress = false
        if (dirtyRoots.size) schedule()
      }
    }

    function schedule() {
      // The active flush owns the next wakeup. A timer fired while it awaits
      // an idle scan would return early with scanScheduled still latched,
      // permanently stranding subsequent streaming/SPA updates.
      if (flushInProgress || scanScheduled || !dirtyRoots.size) return
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
      flushInProgress = false
    }

    return {
      start,
      stop,
      addDirtyRoot,
      flush,
    }
  }

  function scheduleHostFirstBackgroundWork(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || root
    const task = typeof options.task === "function" ? options.task : () => {}
    const quietDelayMs = Math.max(0, Number(options.quietDelayMs ?? 1000))
    let started = false
    let quietTimer = 0
    let idleId = 0
    let canceled = false

    const run = () => {
      if (started || canceled) return
      started = true
      task()
    }
    const queueWhenIdle = () => {
      if (canceled) return
      quietTimer = 0
      if (typeof windowRef.requestIdleCallback === "function") {
        // No timeout is intentional: speculative extension work must not take a
        // turn away from a host page that is still busy. Foreground hover bypasses
        // this gate through the reading session's active-priority path.
        idleId = windowRef.requestIdleCallback(run)
        return
      }
      quietTimer = windowRef.setTimeout(run, 16)
    }
    const afterLoad = () => {
      if (started || canceled || quietTimer || idleId) return
      quietTimer = windowRef.setTimeout(queueWhenIdle, quietDelayMs)
    }

    if (documentRef?.readyState === "complete") afterLoad()
    else windowRef.addEventListener?.("load", afterLoad, { once: true })

    return {
      cancel() {
        canceled = true
        windowRef.removeEventListener?.("load", afterLoad)
        if (quietTimer) windowRef.clearTimeout(quietTimer)
        if (idleId && typeof windowRef.cancelIdleCallback === "function") {
          windowRef.cancelIdleCallback(idleId)
        }
        quietTimer = 0
        idleId = 0
      },
      runNow: run,
    }
  }

  function runAfterHostLoad(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || root
    const task = typeof options.task === "function" ? options.task : () => {}
    let started = false
    const run = () => {
      if (started) return
      started = true
      task()
    }
    if (documentRef?.readyState === "complete") run()
    else windowRef.addEventListener?.("load", run, { once: true })
    return run
  }

  // ARCHITECTURE FENCE [IPD-008]: required local recognition may make bounded
  // progress after load even when no idle time remains. Speculative card work
  // deliberately does not use this scheduler. Before load, genuine idle only.
  function scheduleRecognitionWork(task, options = {}) {
    const windowRef = options.windowRef || root
    const documentRef = options.documentRef || windowRef.document
    const requestIdle =
      options.requestIdleCallback || windowRef.requestIdleCallback?.bind(windowRef)
    const setTimeoutFn =
      options.setTimeoutFn || windowRef.setTimeout?.bind(windowRef) || root.setTimeout
    let generation = 0
    let idleId
    let finished = false
    const queue = () => {
      const current = ++generation
      const run = (deadline) => {
        if (finished || current !== generation) return
        finished = true
        windowRef.removeEventListener?.("load", afterLoad)
        task(deadline)
      }
      if (documentRef?.readyState === "complete") setTimeoutFn(() => run(null), 0)
      else if (requestIdle) idleId = requestIdle(run)
      else setTimeoutFn(() => run(null), 16)
    }
    const afterLoad = () => {
      if (finished) return
      if (idleId !== undefined) windowRef.cancelIdleCallback?.(idleId)
      // Once load completes this is required, bounded local work. Yield a task
      // between slices, rather than waiting for idle time that busy chat pages
      // may never offer. Speculative downloads retain their separate idle gate.
      queue()
    }
    if (requestIdle && documentRef?.readyState !== "complete")
      windowRef.addEventListener?.("load", afterLoad, { once: true })
    queue()
  }

  // ARCHITECTURE FENCE [IPD-008]: a cached scanner is local recognition, not
  // speculative downloading. Let the host paint first, then use genuine idle
  // time even if an unrelated image/analytics request keeps load outstanding.
  // No timeout may force this pre-load task onto a busy rendering thread.
  function runAfterHostPaint(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || root
    const task = options.task || (() => {})
    if (!windowRef.requestAnimationFrame || !windowRef.requestIdleCallback) {
      return runAfterHostLoad({ documentRef, windowRef, task })
    }
    const queue = () =>
      windowRef.requestAnimationFrame(() =>
        windowRef.requestAnimationFrame(() =>
          scheduleRecognitionWork(task, { documentRef, windowRef }),
        ),
      )
    if (documentRef.readyState === "loading")
      documentRef.addEventListener("DOMContentLoaded", queue, { once: true })
    else queue()
  }

  root.IconoplasmContentLifecycle = {
    requestGeneData,
    createMutationScanController,
    scheduleHostFirstBackgroundWork,
    runAfterHostLoad,
    runAfterHostPaint,
    scheduleRecognitionWork,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
