;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: Text objects, glyphs and inline layout belong to the page.
  function createRangeHighlights(options) {
    const doc = options.documentRef
    const win = doc.defaultView
    const groups = new Map()
    const painter = root.IconoplasmRangePaint.createRangePaint({
      documentRef: doc,
      highlightRuntime: options.highlightRuntime,
    })
    const sheet = doc.createElement("style")
    sheet.className = "iconoplasm-range-sheet"
    doc.documentElement.append(sheet)
    const foregrounds = new Map()
    const annotations = new win.Highlight()
    win.CSS.highlights.set("iconoplasm-gene-ranges", annotations)
    function clearForeground(item) {
      item.foreground?.delete(item.range)
      item.foreground = null
    }
    function setForeground(item, color) {
      const foregroundColor = options.highlightRuntime.getTextColors(color).primary
      let entry = foregrounds.get(foregroundColor)
      if (!entry) {
        const name = `iconoplasm-pill-glyphs-${foregrounds.size}`
        entry = new win.Highlight()
        foregrounds.set(foregroundColor, entry)
        win.CSS.highlights.set(name, entry)
        sheet.sheet.insertRule(
          `::highlight(${name}) { color: ${foregroundColor}; text-shadow: 0 .02em .12em rgba(0,0,0,.16); }`,
        )
      }
      entry.add(item.range)
      item.foreground = entry
    }
    const pending = new Set()
    let frame = false
    let hovered = null
    let serial = 0
    const nodeIds = new WeakMap()

    function clearPaint(group) {
      for (const item of group.items) {
        annotations.delete(item.range)
        clearForeground(item)
        painter.remove(item)
        options.unregisterGeneAnchor?.(item.anchor)
      }
      group.items = []
      group.cursor = 0
      painter.flush()
      return true
    }

    function remove(node) {
      const group = groups.get(node)
      if (!group) return false
      clearPaint(group)
      groups.delete(node)
      pending.delete(group)
      return true
    }

    function paintItem(group, item) {
      clearForeground(item)
      if (options.getVisibility?.() === "hover" && hovered !== item.anchor) {
        painter.remove(item)
        return
      }
      const color = options.getGeneMap()?.[item.anchor.dataset.gene]?.c || options.placeholderColor
      painter.paint(item, color, 9001 + group.id * 97 + item.range.startOffset * 31)
      if (options.highlightRuntime.getMode() === "pill") setForeground(item, color)
    }

    function paint(group, deadline, startedAt) {
      const { node, text, matches } = group
      if (!node.isConnected || node.data !== text || !node.parentElement) return remove(node)
      if (options.isEligibleNode?.(node) === false) return remove(node)
      for (let index = group.cursor; index < matches.length; index++) {
        if (
          win.performance.now() - startedAt >= 4 ||
          (doc.readyState !== "complete" && deadline?.timeRemaining?.() <= 2)
        )
          return false
        const match = matches[index]
        let item = group.items[index]
        if (!item) {
          const range = doc.createRange()
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match.length)
          const anchor = {
            dataset: {
              gene: match.symbol,
              geneLabel: text.slice(match.index, match.index + match.length),
            },
            iconoplasmSourceRange: range,
            observationElement: node.parentElement,
            get isConnected() {
              return node.isConnected && node.data === text
            },
            getBoundingClientRect: () => range.getBoundingClientRect(),
            getClientRects: () => range.getClientRects(),
          }
          item = { range, anchor }
          group.items.push(item)
          annotations.add(range)
          options.registerGeneAnchor(anchor)
        }
        paintItem(group, item)
        group.cursor = index + 1
      }
      group.cursor = 0
      return true
    }

    function flush(deadline) {
      frame = false
      const start = win.performance.now()
      for (const group of pending) {
        if (!paint(group, deadline, start)) break
        pending.delete(group)
        if (group.refreshAgain && groups.has(group.node)) {
          group.refreshAgain = false
          pending.add(group)
        }
        if (win.performance.now() - start >= 4) break
      }
      painter.flush()
      schedule()
    }

    function schedule() {
      if (frame || !pending.size) return
      frame = true
      root.IconoplasmContentLifecycle.scheduleRecognitionWork(flush, {
        documentRef: doc,
        windowRef: win,
      })
    }

    function refresh() {
      for (const group of groups.values()) {
        if (!group.node.isConnected) {
          remove(group.node)
          continue
        }
        // Unrelated animation/streaming mutations cannot keep restarting a
        // long text node before its later matches ever receive a paint turn.
        if (pending.has(group) && group.cursor > 0) group.refreshAgain = true
        else group.cursor = 0
        pending.add(group)
      }
      schedule()
    }

    function update(node, matches) {
      const previous = groups.get(node)
      if (
        previous?.text === node.data &&
        JSON.stringify(previous.matches) === JSON.stringify(matches)
      )
        return 0
      remove(node)
      if (!matches.length) return 0
      if (!nodeIds.has(node)) nodeIds.set(node, ++serial)
      const group = { node, text: node.data, matches, items: [], cursor: 0, id: nodeIds.get(node) }
      for (const match of matches) options.registerGeneSymbol?.(match.symbol)
      groups.set(node, group)
      pending.add(group)
      schedule()
      return matches.length
    }

    function hitTest(event) {
      const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY)
      const caret = position ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY)
      const node = position?.offsetNode || caret?.startContainer
      const group = groups.get(node)
      if (!group || node.data !== group.text) return null
      for (const item of group.items)
        for (const box of item.range.getClientRects())
          if (
            event.clientX >= box.left &&
            event.clientX <= box.right &&
            event.clientY >= box.top &&
            event.clientY <= box.bottom
          )
            return item.anchor
      return null
    }

    function hover(anchor) {
      if (hovered === anchor) return
      const previous = hovered
      hovered = anchor
      if (options.getVisibility?.() !== "hover") return
      for (const candidate of [previous, hovered]) {
        const group = groups.get(candidate?.iconoplasmSourceRange?.startContainer)
        const item = group?.items.find((item) => item.anchor === candidate)
        if (item) paintItem(group, item)
      }
      painter.flush()
    }

    const observer = new win.MutationObserver((records) => {
      let changed = false
      for (const record of records) {
        const el = record.target.nodeType === 1 ? record.target : record.target.parentElement
        if (
          el?.closest(".iconoplasm-range-sheet, .iconoplasm-tooltip, .iconoplasm-gene") ||
          painter.ownsMutation(record)
        )
          continue
        if (record.type === "characterData") remove(record.target)
        changed = true
      }
      if (changed) refresh()
    })
    observer.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    })
    const resize = new win.ResizeObserver(refresh)
    if (doc.body) resize.observe(doc.body)
    doc.addEventListener("load", refresh, { capture: true, passive: true })
    win.addEventListener("resize", refresh, { passive: true })
    win.visualViewport?.addEventListener("resize", refresh, { passive: true })
    doc.fonts?.addEventListener("loadingdone", refresh)

    function inspectOccurrence(symbol, occurrence = 0) {
      if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence > 1000) return null
      const candidates = []
      for (const group of groups.values()) {
        if (!group.node.isConnected || group.node.data !== group.text) continue
        for (const match of group.matches)
          if (match.symbol === symbol) candidates.push({ group, match })
      }
      candidates.sort((a, b) =>
        a.group.node === b.group.node
          ? a.match.index - b.match.index
          : a.group.node.compareDocumentPosition(b.group.node) & 4
            ? -1
            : 1,
      )
      const selected = candidates[occurrence]
      if (!selected) return null
      const { group, match } = selected
      const path = []
      let node = group.node
      while (node !== doc.documentElement) {
        if (!node.parentNode || path.length >= 64) return null
        path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node))
        node = node.parentNode
      }
      return {
        path,
        start: match.index,
        end: match.index + match.length,
        label: group.text.slice(match.index, match.index + match.length),
        rendered: group.items.some(
          (item) =>
            item.range.startOffset >= match.index &&
            item.range.startOffset < match.index + match.length,
        ),
      }
    }

    return { update, remove, refresh, hitTest, hover, groups, inspectOccurrence }
  }

  root.IconoplasmRangeHighlights = { createRangeHighlights }
})(globalThis)
