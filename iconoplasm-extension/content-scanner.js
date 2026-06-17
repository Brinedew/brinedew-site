;(function (root) {
  "use strict"

  function createPageScanner(options = {}) {
    const documentRef = options.documentRef || root.document
    const nodeFilter = options.nodeFilter || root.NodeFilter
    const skipTags = options.skipTags || new Set()
    const placeholderColor = options.placeholderColor || "#6B6B78"
    const getMatcher = typeof options.getMatcher === "function" ? options.getMatcher : () => null
    const getGeneMap = typeof options.getGeneMap === "function" ? options.getGeneMap : () => null
    const applyHighlightStyle =
      typeof options.applyHighlightStyle === "function" ? options.applyHighlightStyle : () => {}
    const observeGeneElement =
      typeof options.observeGeneElement === "function" ? options.observeGeneElement : () => {}

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
      if (parent.classList && parent.classList.contains("iconoplasm-gene")) {
        return nodeFilter.FILTER_REJECT
      }
      if (skipTags.has(parent.tagName)) return nodeFilter.FILTER_REJECT
      if (String(node.textContent || "").trim().length < 2) return nodeFilter.FILTER_REJECT
      return nodeFilter.FILTER_ACCEPT
    }

    function processTextNode(textNode) {
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
        observeGeneElement(span)
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

    return {
      scanPage,
      processTextNode,
    }
  }

  root.IconoplasmContentScanner = {
    createPageScanner,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
