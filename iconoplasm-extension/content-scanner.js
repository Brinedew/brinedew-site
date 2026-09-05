;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: recognition mutates host DOM only in
  // bounded cooperative slices so extension work cannot monopolize rendering.

  function createPageScanner(options = {}) {
    const documentRef = options.documentRef || root.document
    const windowRef = options.windowRef || documentRef?.defaultView || root
    const nodeFilter = options.nodeFilter || root.NodeFilter
    const skipTags = options.skipTags || new Set()
    const placeholderColor = options.placeholderColor || "#6B6B78"
    const getMatcher = typeof options.getMatcher === "function" ? options.getMatcher : () => null
    const getGeneMap = typeof options.getGeneMap === "function" ? options.getGeneMap : () => null
    const applyHighlightStyle =
      typeof options.applyHighlightStyle === "function" ? options.applyHighlightStyle : () => {}
    const registerGeneAnchor =
      typeof options.registerGeneAnchor === "function" ? options.registerGeneAnchor : () => {}

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
      if (acceptScanNode(textNode) !== nodeFilter.FILTER_ACCEPT) return 0
      const text = String((textNode && textNode.textContent) || "")
      const matcher = getMatcher()
      if (!text || !matcher || typeof matcher.findMatches !== "function") return 0

      const matches = matcher.findMatches(text)
      if (!matches.length) return 0

      const geneMap = getGeneMap() || {}
      const fragment = documentRef.createDocumentFragment()
      let cursor = 0
      for (const match of matches) {
        const index = Number(match && match.index) || 0
        const length = Number(match && match.length) || 0
        const symbol = String((match && match.symbol) || "").trim()
        if (!symbol || length <= 0) continue
        if (index > cursor) {
          fragment.appendChild(documentRef.createTextNode(text.slice(cursor, index)))
        }
        const span = documentRef.createElement("span")
        span.className = "iconoplasm-gene"
        span.dataset.geneLabel = text.slice(index, index + length)

        const copy = documentRef.createElement("span")
        copy.className = "iconoplasm-gene-copy"
        copy.setAttribute("data-icono-rough-copy", "true")
        copy.textContent = span.dataset.geneLabel
        span.appendChild(copy)

        const gene = geneMap[symbol] || {}
        applyHighlightStyle(span, symbol, gene.c || placeholderColor)
        registerGeneAnchor(span)
        fragment.appendChild(span)
        cursor = index + length
      }

      if (cursor < text.length) {
        fragment.appendChild(documentRef.createTextNode(text.slice(cursor)))
      }
      if (!textNode.parentNode) return 0
      textNode.parentNode.replaceChild(fragment, textNode)
      return matches.length
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
            // Advance before replacing the current text node so TreeWalker never
            // has to resume from a node that the extension removed.
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
