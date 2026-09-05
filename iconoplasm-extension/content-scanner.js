;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: bounded recognition leaves host Text objects
  // intact. Range decorations paint without replacing framework content.

  function createPageScanner(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || documentRef?.defaultView || root
    const nodeFilter = options.nodeFilter || root.NodeFilter
    const skipTags = options.skipTags || new Set()
    const getMatcher = typeof options.getMatcher === "function" ? options.getMatcher : () => null
    const annotations = options.annotations

    function isEditableTextSurface(element) {
      if (!element || typeof element.closest !== "function") return false
      return !!element.closest(
        "[contenteditable], textarea, input, select, [role='textbox'], [role=\"textbox\"]",
      )
    }

    function acceptScanNode(node) {
      const parent = node && node.parentElement
      if (!parent) return nodeFilter.FILTER_REJECT
      if (isEditableTextSurface(parent)) return nodeFilter.FILTER_REJECT
      if (parent.closest && parent.closest(".iconoplasm-tooltip")) return nodeFilter.FILTER_REJECT
      if (parent.closest?.(".iconoplasm-gene")) {
        return nodeFilter.FILTER_REJECT
      }
      if (skipTags.has(parent.tagName)) return nodeFilter.FILTER_REJECT
      if (String(node.textContent || "").trim().length < 2) return nodeFilter.FILTER_REJECT
      return nodeFilter.FILTER_ACCEPT
    }

    function processTextNode(textNode) {
      // A queued node can move into an extension/editable surface between slices.
      if (acceptScanNode(textNode) !== nodeFilter.FILTER_ACCEPT) {
        annotations.remove(textNode)
        return 0
      }
      const text = String((textNode && textNode.textContent) || "")
      const matcher = getMatcher()
      if (!text || !matcher || typeof matcher.findMatches !== "function") return 0

      const matches = matcher.findMatches(text)
      return annotations.update(textNode, matches)
    }

    function scanPage(rootNode) {
      if (!rootNode || typeof rootNode.nodeType !== "number") return 0
      if (rootNode.nodeType === 3) {
        return acceptScanNode(rootNode) === nodeFilter.FILTER_ACCEPT ? processTextNode(rootNode) : 0
      }
      const walker = documentRef.createTreeWalker(rootNode, nodeFilter.SHOW_TEXT, {
        acceptNode: acceptScanNode,
      })
      const textNodes = []
      while (walker.nextNode()) textNodes.push(walker.currentNode)
      let wrappedCount = 0
      for (const textNode of textNodes) {
        wrappedCount += processTextNode(textNode)
      }
      return wrappedCount
    }

    function scanPageCooperatively(rootNode, cooperativeOptions = {}) {
      if (!rootNode || typeof rootNode.nodeType !== "number") return Promise.resolve(0)

      const maxNodesPerSlice = Math.max(1, Number(cooperativeOptions.maxNodesPerSlice || 64))
      const minTimeRemainingMs = Math.max(0, Number(cooperativeOptions.minTimeRemainingMs ?? 2))
      const requestIdle =
        cooperativeOptions.requestIdleCallback ||
        (typeof windowRef?.requestIdleCallback === "function"
          ? windowRef.requestIdleCallback.bind(windowRef)
          : null)
      const setTimeoutFn =
        cooperativeOptions.setTimeoutFn || windowRef?.setTimeout?.bind(windowRef) || root.setTimeout
      const walker =
        rootNode.nodeType === 3
          ? { nextNode: () => null }
          : documentRef.createTreeWalker(rootNode, nodeFilter.SHOW_TEXT, {
              acceptNode: acceptScanNode,
            })
      let nextNode =
        rootNode.nodeType === 3
          ? acceptScanNode(rootNode) === nodeFilter.FILTER_ACCEPT
            ? rootNode
            : null
          : walker.nextNode()
      let wrappedCount = 0

      return new Promise((resolve) => {
        const scheduleSlice = () => {
          root.IconoplasmContentLifecycle.scheduleRecognitionWork(runSlice, {
            documentRef,
            windowRef,
            requestIdleCallback: requestIdle,
            setTimeoutFn,
          })
        }
        const runSlice = (deadline) => {
          let processed = 0
          const now = () => windowRef.performance?.now?.() ?? Date.now()
          const startedAt = now()
          if (
            documentRef.readyState !== "complete" &&
            deadline?.timeRemaining?.() <= minTimeRemainingMs
          ) {
            scheduleSlice()
            return
          }
          while (
            nextNode &&
            processed < maxNodesPerSlice &&
            now() - startedAt < 4 &&
            (documentRef.readyState === "complete" ||
              processed === 0 ||
              !deadline ||
              typeof deadline.timeRemaining !== "function" ||
              deadline.timeRemaining() > minTimeRemainingMs)
          ) {
            const textNode = nextNode
            // Keep traversal state local to this slice; painting is separately queued.
            nextNode = walker.nextNode()
            wrappedCount += processTextNode(textNode)
            processed += 1
          }
          if (nextNode) {
            scheduleSlice()
            return
          }
          resolve(wrappedCount)
        }
        scheduleSlice()
      })
    }

    async function scanDocumentCooperatively() {
      // The article comes before navigation/footer chrome in reading priority.
      // This changes traversal order only: the same matcher and whole-body pass
      // still cover every eligible node, without another prediction mechanism.
      const roots = Array.from(documentRef.querySelectorAll("main, article, [role='main']"))
        .filter((element) => !element.parentElement?.closest("main, article, [role='main']"))
        .slice(0, 4)
      let count = 0
      for (const element of roots) count += await scanPageCooperatively(element)
      return count + (await scanPageCooperatively(documentRef.body))
    }

    return {
      scanPage,
      scanPageCooperatively,
      scanDocumentCooperatively,
      processTextNode,
    }
  }

  root.IconoplasmContentScanner = {
    createPageScanner,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
