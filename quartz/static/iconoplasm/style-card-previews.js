// B-896: which portraits each style card in the Free queue picker shows.
// The owner's rule (2026-10-05): canonical portraits first, most upvoted
// first, then candidates; and one gene never shows twice on the screen. The
// server sends each style's best five, canonical first, so a card has a spare
// when another card already shows one of its genes.
//
// A gene that is canonical in a visible card belongs to that card. Every card
// first gets its best free portrait; then, in screen order, a card becomes a
// 2x2 mosaic only if three more free genes remain for it. A card whose every
// gene is already on screen shows its least-shown one rather than going blank:
// tiny styles drawn on the same few genes have nothing else to show, and on
// 2026-10-05 three of them all fell back to STAT5A, which then showed 4 times.
export const STYLE_CARD_MOSAIC_SIZE = 4

function geneKey(preview) {
  return String((preview && (preview.gene_symbol || preview.asset_sha256)) || "").toUpperCase()
}

function rankedByGene(previews) {
  var list = Array.isArray(previews) ? previews : []
  var ordered = list
    .filter(function (preview) {
      return preview && preview.is_current
    })
    .concat(
      list.filter(function (preview) {
        return preview && !preview.is_current
      }),
    )
  var seen = new Set()
  return ordered.filter(function (preview) {
    var key = geneKey(preview)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Returns one array of previews per option, in the same order: four for a
// mosaic, one otherwise, none for a style without portraits.
export function assignStyleCardPreviews(options, mosaicSize) {
  var size = mosaicSize || STYLE_CARD_MOSAIC_SIZE
  var lists = (Array.isArray(options) ? options : []).map(function (option) {
    return rankedByGene(option && option.preview_assets)
  })
  var owner = new Map()
  lists.forEach(function (list, index) {
    list
      .filter(function (preview) {
        return preview.is_current
      })
      .slice(0, size)
      .forEach(function (preview) {
        if (!owner.has(geneKey(preview))) owner.set(geneKey(preview), index)
      })
  })
  var used = new Set()
  // How often each gene is on screen, for the fallback. A card's best canonical
  // portrait always shows, so it counts from the start.
  var shownCount = new Map()
  function count(preview) {
    shownCount.set(geneKey(preview), (shownCount.get(geneKey(preview)) || 0) + 1)
  }
  lists.forEach(function (list, index) {
    var canonical = list.find(function (preview) {
      return preview.is_current && owner.get(geneKey(preview)) === index
    })
    if (canonical) count(canonical)
  })
  function show(preview) {
    used.add(geneKey(preview))
    count(preview)
  }
  function free(preview, index) {
    var key = geneKey(preview)
    if (used.has(key)) return false
    return !owner.has(key) || owner.get(key) === index
  }
  var shown = lists.map(function (list, index) {
    var lead = list.find(function (preview) {
      return free(preview, index)
    })
    if (lead) {
      if (!(lead.is_current && owner.get(geneKey(lead)) === index)) count(lead)
      used.add(geneKey(lead))
      return { previews: [lead], own: true }
    }
    var fallback = list.reduce(function (best, preview) {
      return (shownCount.get(geneKey(preview)) || 0) < (shownCount.get(geneKey(best)) || 0)
        ? preview
        : best
    }, list[0])
    if (!fallback) return { previews: [], own: false }
    // Counted, never claimed: the gene may be a later card's own canonical.
    count(fallback)
    return { previews: [fallback], own: false }
  })
  lists.forEach(function (list, index) {
    if (!shown[index].own) return
    var rest = list.filter(function (preview) {
      return preview !== shown[index].previews[0] && free(preview, index)
    })
    if (rest.length < size - 1) return
    rest.slice(0, size - 1).forEach(function (preview) {
      show(preview)
      shown[index].previews.push(preview)
    })
  })
  return shown.map(function (entry) {
    return entry.previews
  })
}
