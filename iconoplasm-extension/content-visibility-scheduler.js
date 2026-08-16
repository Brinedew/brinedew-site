;(function (root) {
  "use strict"

  function createVisibilityScheduler(options) {
    const opts = options && typeof options === "object" ? options : {}
    if (typeof root.IntersectionObserver !== "function") return null

    const visibleElements = new Set()
    const onVisibleChange =
      typeof opts.onVisibleChange === "function" ? opts.onVisibleChange : () => {}
    const observer = new root.IntersectionObserver(
      (entries) => {
        let sawVisible = false
        for (const entry of entries) {
          const target = entry && entry.target
          const symbol = target && target.dataset ? String(target.dataset.gene || "").trim() : ""
          if (!symbol) continue
          if (entry.isIntersecting) {
            visibleElements.add(target)
            sawVisible = true
          } else {
            visibleElements.delete(target)
          }
        }
        if (sawVisible) onVisibleChange()
      },
      {
        root: null,
        rootMargin:
          String(Number(opts.abovePx || 0)) +
          "px 0px " +
          String(Number(opts.belowPx || 0)) +
          "px 0px",
      },
    )

    return {
      observe(el) {
        if (!el || !el.dataset || !el.dataset.gene) return
        observer.observe(el)
      },
      disconnect() {
        visibleElements.clear()
        observer.disconnect()
      },
      getVisibleElements(limit) {
        const elements = []
        const max = Math.max(0, Number(limit || 0)) || Infinity
        for (const element of visibleElements) {
          elements.push(element)
          if (elements.length >= max) break
        }
        return elements
      },
      getVisibleSymbols(limit) {
        const symbols = []
        const seen = new Set()
        const max = Math.max(0, Number(limit || 0)) || Infinity
        for (const element of visibleElements) {
          const symbol = String(element?.dataset?.gene || "").trim()
          if (!symbol || seen.has(symbol)) continue
          seen.add(symbol)
          symbols.push(symbol)
          if (symbols.length >= max) break
        }
        return symbols
      },
      hasVisibleSymbols() {
        return visibleElements.size > 0
      },
    }
  }

  root.IconoplasmVisibilityScheduler = {
    createVisibilityScheduler,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
