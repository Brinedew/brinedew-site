;(function (root) {
  "use strict"

  // Chesterton's fence: this matcher scores text against published data only. Broad
  // HGNC coverage belongs in the workstation export; deliberately curated page
  // labels belong in the website-owned publication-alias manifest overlay. Do not
  // teach the content script to guess missing biology facts on its own.

  const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u

  function normalizeSymbol(rawSymbol) {
    return String(rawSymbol || "")
      .trim()
      .toUpperCase()
  }

  function normalizeAliasKey(rawAlias) {
    return String(rawAlias || "")
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
  }

  function foldAliasTextForScan(rawText) {
    return String(rawText || "").replace(/[\u2010-\u2015\u2212]/g, "-")
  }

  function isUppercaseLetterCode(code) {
    return code >= 65 && code <= 90
  }

  function isDigitCode(code) {
    return code >= 48 && code <= 57
  }

  function isCoreGeneCharCode(code) {
    return isUppercaseLetterCode(code) || isDigitCode(code)
  }

  function isGeneTokenChar(text, index) {
    if (index < 0 || index >= text.length) return false
    const code = text.charCodeAt(index)
    if (isCoreGeneCharCode(code)) return true
    if (code !== 45) return false
    if (index <= 0 || index >= text.length - 1) return false
    return (
      isCoreGeneCharCode(text.charCodeAt(index - 1)) &&
      isCoreGeneCharCode(text.charCodeAt(index + 1))
    )
  }

  function hasLeftBoundary(text, index) {
    if (index <= 0) return true
    return !isLetterOrNumber(text, index - 1)
  }

  function hasRightBoundary(text, index) {
    if (index >= text.length) return true
    return !isLetterOrNumber(text, index)
  }

  function buildTrie(symbols, normalizeToken) {
    const rootNode = { children: Object.create(null), terminal: "" }
    const normalizer = typeof normalizeToken === "function" ? normalizeToken : normalizeSymbol
    for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
      const symbol = normalizer(rawSymbol)
      if (!symbol) continue
      let node = rootNode
      for (let i = 0; i < symbol.length; i += 1) {
        const ch = symbol.charAt(i)
        if (!node.children[ch]) {
          node.children[ch] = { children: Object.create(null), terminal: "" }
        }
        node = node.children[ch]
      }
      node.terminal = symbol
    }
    return rootNode
  }

  function buildAliasLookup(geneMap) {
    const lookup = Object.create(null)
    const duplicates = new Set()
    const safeGeneMap = geneMap && typeof geneMap === "object" ? geneMap : {}
    for (const symbol of Object.keys(safeGeneMap)) {
      const aliases = Array.isArray(safeGeneMap[symbol] && safeGeneMap[symbol].a)
        ? safeGeneMap[symbol].a
        : []
      for (const rawAlias of aliases) {
        const aliasKey = normalizeAliasKey(rawAlias)
        if (!aliasKey || aliasKey === symbol || safeGeneMap[aliasKey]) continue
        if (duplicates.has(aliasKey)) continue
        if (lookup[aliasKey] && lookup[aliasKey] !== symbol) {
          delete lookup[aliasKey]
          duplicates.add(aliasKey)
          continue
        }
        lookup[aliasKey] = symbol
      }
    }
    return lookup
  }

  function compareCandidateLists(left, right) {
    const leftList = Array.isArray(left) ? left : []
    const rightList = Array.isArray(right) ? right : []
    const leftScore = leftList.reduce((sum, item) => sum + (Number(item && item.length) || 0), 0)
    const rightScore = rightList.reduce((sum, item) => sum + (Number(item && item.length) || 0), 0)
    if (leftScore !== rightScore) return leftScore - rightScore
    if (leftList.length !== rightList.length) return rightList.length - leftList.length
    for (let i = 0; i < Math.min(leftList.length, rightList.length); i += 1) {
      const byStart =
        (Number(rightList[i] && rightList[i].index) || 0) -
        (Number(leftList[i] && leftList[i].index) || 0)
      if (byStart !== 0) return byStart
      const byLength =
        (Number(leftList[i] && leftList[i].length) || 0) -
        (Number(rightList[i] && rightList[i].length) || 0)
      if (byLength !== 0) return byLength
    }
    return 0
  }

  function selectBestRunCandidates(candidates) {
    const sorted = sortCandidates(candidates)
    const memo = new Map()

    function solve(index) {
      if (index >= sorted.length) return []
      if (memo.has(index)) return memo.get(index)

      const skipped = solve(index + 1)
      const current = sorted[index]
      const currentEnd =
        (Number(current && current.index) || 0) + (Number(current && current.length) || 0)
      let nextIndex = index + 1
      while (nextIndex < sorted.length) {
        const nextStart = Number(sorted[nextIndex] && sorted[nextIndex].index) || 0
        if (nextStart >= currentEnd) break
        nextIndex += 1
      }
      const taken = [current].concat(solve(nextIndex))
      const best = compareCandidateLists(taken, skipped) >= 0 ? taken : skipped
      memo.set(index, best)
      return best
    }

    return solve(0)
  }

  function collectRunCandidates(tokenText, runOffset, trieRoot) {
    const source = String(tokenText || "")
    if (!source || !trieRoot) return []
    const candidates = []

    for (let start = 0; start < source.length; start += 1) {
      if (start > 0 && source.charAt(start - 1) !== "-") continue
      let node = trieRoot
      let cursor = start
      while (cursor < source.length) {
        const ch = source.charAt(cursor)
        node = node.children[ch]
        if (!node) break
        cursor += 1
        if (node.terminal && (cursor === source.length || source.charAt(cursor) === "-")) {
          candidates.push({
            symbol: node.terminal,
            index: runOffset + start,
            length: cursor - start,
            text: source.slice(start, cursor),
          })
        }
      }
    }

    return selectBestRunCandidates(candidates)
  }

  function collectCandidates(text, trieRoot) {
    const source = String(text || "")
    if (!source || !trieRoot) return []

    const matches = []
    let index = 0
    while (index < source.length) {
      const firstCode = source.charCodeAt(index)
      if (!isUppercaseLetterCode(firstCode) || !hasLeftBoundary(source, index)) {
        index += 1
        continue
      }

      let runEnd = index
      while (runEnd < source.length && isGeneTokenChar(source, runEnd)) {
        runEnd += 1
      }
      if (!hasRightBoundary(source, runEnd)) {
        index = Math.max(runEnd, index + 1)
        continue
      }
      const runText = source.slice(index, runEnd)
      const runMatches = collectRunCandidates(runText, index, trieRoot)
      if (runMatches.length) {
        matches.push(...runMatches)
      }
      index = Math.max(runEnd, index + 1)
    }

    return matches
  }

  function isLetterOrNumber(text, index) {
    if (index < 0 || index >= text.length) return false
    return LETTER_OR_NUMBER_RE.test(text.charAt(index))
  }

  function hasAliasLeftBoundary(text, index) {
    if (index <= 0) return true
    return !isLetterOrNumber(text, index - 1)
  }

  function hasAliasRightBoundary(text, index) {
    if (index >= text.length) return true
    return !isLetterOrNumber(text, index)
  }

  function collectAliasCandidates(text, trieRoot, aliasLookup) {
    const source = String(text || "")
    if (!source || !trieRoot || !aliasLookup) return []
    const folded = foldAliasTextForScan(source)
    const matches = []
    let index = 0

    while (index < folded.length) {
      if (!hasAliasLeftBoundary(source, index)) {
        index += 1
        continue
      }

      let node = trieRoot
      let cursor = index
      let bestCandidate = null

      while (cursor < folded.length) {
        const ch = folded.charAt(cursor)
        node = node.children[ch]
        if (!node) break
        cursor += 1

        if (node.terminal && hasAliasRightBoundary(source, cursor)) {
          const symbol = aliasLookup[node.terminal]
          if (symbol) {
            bestCandidate = {
              symbol,
              index,
              length: cursor - index,
              text: source.slice(index, cursor),
              matchedBy: "alias",
            }
          }
        }
      }

      if (bestCandidate) {
        matches.push(bestCandidate)
        index = bestCandidate.index + bestCandidate.length
        continue
      }

      index += 1
    }

    return matches
  }

  function filterCandidates(candidates, options) {
    const opts = options && typeof options === "object" ? options : {}
    const geneMap = opts.geneMap && typeof opts.geneMap === "object" ? opts.geneMap : null
    // Single blocklist Set — the caller (content.js) merges defaults + user choices
    // into one set, so the matcher just blocks whatever it's told to block.
    const blocklist =
      opts.blocklist instanceof Set
        ? opts.blocklist
        : new Set(Array.isArray(opts.blocklist) ? opts.blocklist.map(normalizeSymbol) : [])
    const accepted = []

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const symbol = normalizeSymbol(candidate && candidate.symbol)
      if (!symbol) continue
      if (geneMap && !geneMap[symbol]) continue
      const candidateText = String(candidate.text || symbol)
      const candidateKey = normalizeSymbol(candidateText)
      if (blocklist.has(candidateKey) || blocklist.has(symbol)) continue
      accepted.push({
        symbol,
        index: Number(candidate.index || 0),
        length: Number(candidate.length || symbol.length),
        text: candidateText,
        matchedBy: String(candidate.matchedBy || "symbol"),
      })
    }

    return accepted
  }

  function sortCandidates(candidates) {
    return [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) => {
      const leftIndex = Number(left && left.index) || 0
      const rightIndex = Number(right && right.index) || 0
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      const leftLength = Number(left && left.length) || 0
      const rightLength = Number(right && right.length) || 0
      return rightLength - leftLength
    })
  }

  function overlapsAccepted(candidate, accepted) {
    const start = Number(candidate && candidate.index) || 0
    const end = start + (Number(candidate && candidate.length) || 0)
    for (const match of Array.isArray(accepted) ? accepted : []) {
      const left = Number(match && match.index) || 0
      const right = left + (Number(match && match.length) || 0)
      if (start < right && end > left) return true
    }
    return false
  }

  function createGeneMatcher(geneMap, options) {
    const safeGeneMap = geneMap && typeof geneMap === "object" ? geneMap : {}
    const exactTrie = buildTrie(Object.keys(safeGeneMap))
    const aliasLookup = buildAliasLookup(safeGeneMap)
    // Fence: alias hover matching must stay case-sensitive. The extension's job is
    // to instrument symbol-like tokens, not to reinterpret ordinary English prose
    // after case-folding it into an all-caps gene namespace. Upstream publication
    // should emit the exact alias spellings we want to recognize on-page.
    const aliasTrie = buildTrie(Object.keys(aliasLookup), normalizeAliasKey)
    const matcherOptions = Object.assign({}, options || {}, { geneMap: safeGeneMap })
    return {
      collectCandidates(text) {
        return collectCandidates(text, exactTrie)
      },
      collectAliasCandidates(text) {
        return collectAliasCandidates(text, aliasTrie, aliasLookup)
      },
      filterCandidates(candidates) {
        return filterCandidates(candidates, matcherOptions)
      },
      findMatches(text) {
        const acceptedExact = sortCandidates(
          filterCandidates(collectCandidates(text, exactTrie), matcherOptions),
        )
        const aliasCandidates = sortCandidates(
          filterCandidates(collectAliasCandidates(text, aliasTrie, aliasLookup), matcherOptions),
        )
        // Fence: exact canonical symbols win. The alias layer only fills empty spans so
        // `NFKB1` still beats `NF-κB`-style convenience names when both could plausibly fire.
        const accepted = [...acceptedExact]
        for (const candidate of aliasCandidates) {
          if (overlapsAccepted(candidate, accepted)) continue
          accepted.push(candidate)
        }
        return sortCandidates(accepted)
      },
    }
  }

  const api = {
    buildTrie,
    buildAliasLookup,
    collectCandidates,
    collectAliasCandidates,
    filterCandidates,
    createGeneMatcher,
  }

  root.IconoplasmContentMatcher = api
})(typeof globalThis !== "undefined" ? globalThis : this)
