(function (global) {
  "use strict"

  if (global && global.IconoplasmCardShared) return

  var ICONO_CHECK_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10.5 8.25 13.75 15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var ICONO_CROSS_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6 14 14M14 6 6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

  function resolveApiBase(explicitBase) {
    var value = String(explicitBase || "").trim()
    if (value) return value.replace(/\/+$/, "")
    if (typeof window !== "undefined") {
      var host = String((window.location && window.location.hostname) || "").toLowerCase()
      if (host === "iconoplasm.brinedew.bio" || host === "staging.brinedew.bio") {
        return window.location.origin
      }
    }
    return "https://iconoplasm.brinedew.bio"
  }

  function fetchJSON(path, init, options) {
    var opts = options || {}
    var fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(global) : null)
    if (!fetchImpl) {
      return Promise.reject(new Error("fetch is unavailable in this runtime"))
    }
    var base = resolveApiBase(opts.apiBaseUrl)
    return fetchImpl(base + path, init || {}).then(function (response) {
      return response.text().then(function (raw) {
        var payload = null
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch (_err) {
            payload = null
          }
        }
        if (!response.ok) {
          var err = new Error((payload && payload.error) || "HTTP " + response.status)
          err.status = response.status
          err.payload = payload
          throw err
        }
        return payload
      })
    })
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  function normalizedSymbol(symbol) {
    return String(symbol || "")
      .trim()
      .toUpperCase()
  }

  function uniqueDisplayValues(values, limit) {
    var out = []
    var seen = Object.create(null)
    var source = Array.isArray(values) ? values : [values]
    for (var i = 0; i < source.length; i++) {
      var value = String(source[i] || "").trim()
      if (!value) continue
      var key = value.toLowerCase()
      if (seen[key]) continue
      seen[key] = true
      out.push(value)
      if (out.length >= (limit || 4)) break
    }
    return out
  }

  function renderTooltipMetaPairsHtml(pairs) {
    var safePairs = Array.isArray(pairs) ? pairs : []
    if (!safePairs.length) return ""
    var html = '<div class="iconoplasm-tooltip-meta-pairs">'
    for (var i = 0; i < safePairs.length; i++) {
      var pair = safePairs[i] || {}
      var character = String(pair.character || "").trim()
      var molecular = String(pair.molecular || "").trim()
      if (!character || !molecular) continue
      html +=
        '<div class="iconoplasm-tooltip-meta-pair-row">' +
        '<div class="iconoplasm-tooltip-meta-pair-cell">' +
        '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
        escapeHtml(character) +
        "</span>" +
        "</div>" +
        '<div class="iconoplasm-tooltip-meta-pair-cell iconoplasm-tooltip-meta-pair-cell--origin">' +
        '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
        escapeHtml(molecular) +
        "</span>" +
        "</div>" +
        "</div>"
    }
    html += "</div>"
    return html
  }

  function buildTooltipTraitOriginRows(essence) {
    var rows = []
    var safeEssence = essence && typeof essence === "object" ? essence : {}
    var aesthetics = uniqueDisplayValues(safeEssence.aesthetics, 4)
    var aestheticsOrigin = uniqueDisplayValues(safeEssence.aesthetics_origin, 4)
    var politicsRaw = safeEssence.politics || safeEssence.faction || ""
    var politics = String(politicsRaw || "").trim()
    var politicsOrigin = uniqueDisplayValues(safeEssence.politics_origin, 2)

    var pairedAestheticCount = Math.min(aesthetics.length, aestheticsOrigin.length)
    if (pairedAestheticCount > 0) {
      var pairs = []
      for (var i = 0; i < pairedAestheticCount; i++) {
        pairs.push({
          character: aesthetics[i],
          molecular: aestheticsOrigin[i],
        })
      }
      rows.push({ pairs: pairs })
    }

    var missingAestheticOrigins = aesthetics.length > pairedAestheticCount
    var politicsIsNeutral = politics.toLowerCase() === "neutral"
    var missingPoliticsOrigins = Boolean(politics) && !politicsIsNeutral && !politicsOrigin.length
    if (politics && !politicsIsNeutral && politicsOrigin.length) {
      rows.push({
        character: politics,
        molecular: politicsOrigin.join(", "),
      })
    }

    return {
      rows: rows,
      missingOrigins: missingAestheticOrigins || missingPoliticsOrigins,
    }
  }

  function collectTooltipMetaRows(geneDetail, options) {
    var opts = options || {}
    var safeGeneDetail = geneDetail && typeof geneDetail === "object" ? geneDetail : {}
    var essence =
      safeGeneDetail.essence && typeof safeGeneDetail.essence === "object"
        ? safeGeneDetail.essence
        : {}
    var rows = []

    var sexText = String(essence.sex || "").trim()
    var sexOrigin = uniqueDisplayValues(
      essence.sex_origin || essence.gender_origin || safeGeneDetail.sex_origin || safeGeneDetail.gender_origin,
      2,
    )
    if (sexText) {
      rows.push({
        character: sexText,
        molecular: sexOrigin.length ? sexOrigin.join(", ") : "unknown",
      })
    }

    var ageText = ""
    if (essence.age) {
      ageText = String(essence.age)
    } else if (essence.age_years != null && Number.isFinite(Number(essence.age_years))) {
      ageText = String(Math.round(Number(essence.age_years)))
    }
    var firstPublicationYear = Number(safeGeneDetail.first_publication_year)
    if (ageText && Number.isFinite(firstPublicationYear) && firstPublicationYear > 0) {
      rows.push({
        character: ageText + " years old",
        molecular: "discovered in " + String(Math.round(firstPublicationYear)),
      })
    }

    var weightKg = Number(essence.weight_kg)
    var molecularWeightKda = Number(safeGeneDetail.molecular_weight_kda)
    if (Number.isFinite(weightKg) && weightKg > 0 && Number.isFinite(molecularWeightKda) && molecularWeightKda > 0) {
      rows.push({
        character: String(Math.round(weightKg)) + " kg",
        molecular: String(Math.round(molecularWeightKda)) + " kDa",
      })
    }

    var tissue = safeGeneDetail.primary_tissue ? String(safeGeneDetail.primary_tissue).trim() : ""
    if ((essence.skin_hex || essence.skin_name) && tissue) {
      var skinDisplay = ""
      if (essence.skin_hex) {
        skinDisplay +=
          '<span class="iconoplasm-tooltip-skin-dot" style="background:' +
          String(essence.skin_hex) +
          '"></span>'
      }
      skinDisplay += String(essence.skin_name || essence.skin_hex || "")
      rows.push({
        character: skinDisplay,
        molecular: tissue,
        characterIsHtml: true,
      })
    }

    var traitOriginRows = buildTooltipTraitOriginRows(essence)
    if (traitOriginRows.missingOrigins && typeof opts.onMissingOrigins === "function") {
      var warnKey =
        String(safeGeneDetail.symbol || safeGeneDetail.canonical_symbol || "").trim() || "(unknown)"
      opts.onMissingOrigins(warnKey, safeGeneDetail)
    }
    for (var i = 0; i < traitOriginRows.rows.length; i++) {
      rows.push(traitOriginRows.rows[i])
    }

    return rows
  }

  function renderTooltipMetaRowsHtml(rows) {
    if (!Array.isArray(rows) || !rows.length) return ""
    var html = ""
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {}
      if (Array.isArray(row.pairs) && row.pairs.length) {
        html += renderTooltipMetaPairsHtml(row.pairs)
        continue
      }
      html +=
        '<div class="iconoplasm-tooltip-meta-row">' +
        '<div class="iconoplasm-tooltip-meta-cell">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.characterIsHtml ? row.character : escapeHtml(row.character || "")) +
        "</span>" +
        "</div>" +
        '<div class="iconoplasm-tooltip-meta-cell iconoplasm-tooltip-meta-cell--origin">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.molecularIsHtml ? row.molecular : escapeHtml(row.molecular || "")) +
        "</span>" +
        "</div>" +
        "</div>"
    }
    return html
  }

  function renderTooltipMetaSkeletonHtml() {
    return (
      '<div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      "</div>"
    )
  }

  function renderTooltipMobileRowGridHtml(rows, extraAttrs) {
    var safeRows = Array.isArray(rows) ? rows : []
    var attrs = extraAttrs ? " " + extraAttrs : ""
    if (!safeRows.length) return '<div class="iconoplasm-tooltip-mobile-rowgrid"' + attrs + "></div>"
    var html = '<div class="iconoplasm-tooltip-mobile-rowgrid"' + attrs + ">"
    for (var i = 0; i < safeRows.length; i++) {
      var row = safeRows[i] || {}
      if (Array.isArray(row.pairs) && row.pairs.length) {
        for (var j = 0; j < row.pairs.length; j++) {
          html +=
            '<div class="iconoplasm-tooltip-mobile-row">' +
            '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
            '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
            escapeHtml(row.pairs[j].character) +
            "</span>" +
            "</div>" +
            '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
            '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
            escapeHtml(row.pairs[j].molecular) +
            "</span>" +
            "</div>" +
            "</div>"
        }
        continue
      }
      if (!row.character && !row.molecular) continue
      html +=
        '<div class="iconoplasm-tooltip-mobile-row">' +
        '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.characterIsHtml ? row.character : escapeHtml(row.character || "")) +
        "</span>" +
        "</div>" +
        '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.molecularIsHtml ? row.molecular : escapeHtml(row.molecular || "")) +
        "</span>" +
        "</div>" +
        "</div>"
    }
    html += "</div>"
    return html
  }

  function renderTooltipMobileSkeletonHtml(extraAttrs) {
    var attrs = extraAttrs ? " " + extraAttrs : ""
    return (
      '<div class="iconoplasm-tooltip-mobile-rowgrid iconoplasm-tooltip-mobile-rowgrid--skeleton"' +
      attrs +
      ">" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      "</div>"
    )
  }

  function voteBoxMarkup(extraAttrs, options) {
    var attrs = extraAttrs ? " " + extraAttrs : ""
    var opts = options || {}
    var variant = String(opts.variant || "").trim()
    var showScore = opts.showScore !== false
    return (
      '<div class="icono-vote-box' +
      (variant === "brick" ? " icono-vote-box--brick" : "") +
      '" data-icono-vote-box' +
      attrs +
      ">" +
      '<button type="button" class="icono-vote-btn icono-vote-btn--approve" data-icono-vote-up aria-label="Approve portrait" title="Approve portrait">' +
      ICONO_CHECK_ICON +
      "</button>" +
      (showScore
        ? '<span class="icono-vote-stats" data-icono-vote-stats title="Score +0 (0 approvals / 0 rejections)" aria-live="polite">0</span>'
        : "") +
      '<button type="button" class="icono-vote-btn icono-vote-btn--reject" data-icono-vote-down aria-label="Reject portrait" title="Reject portrait">' +
      ICONO_CROSS_ICON +
      "</button>" +
      "</div>"
    )
  }

  function voteSummaryText(snapshot) {
    return String(Number((snapshot || {}).image_score || 0))
  }

  function voteSummaryDetails(snapshot) {
    var data = snapshot || {}
    var up = Number(data.image_upvotes || 0)
    var down = Number(data.image_downvotes || 0)
    var score = Number(data.image_score || 0)
    var sign = score > 0 ? "+" : ""
    return "Score " + sign + score + " (" + up + " approvals / " + down + " rejections)"
  }

  function setVoteBoxState(box, opts) {
    if (!box) return
    var statsEl = box.querySelector("[data-icono-vote-stats]")
    var upBtn = box.querySelector("[data-icono-vote-up]")
    var downBtn = box.querySelector("[data-icono-vote-down]")
    var snapshot = (opts && opts.snapshot) || {}
    var pending = !!(opts && opts.pending)
    var userVote = Number(snapshot.user_vote || 0)
    if (statsEl) {
      statsEl.textContent = voteSummaryText(snapshot)
      statsEl.setAttribute("title", voteSummaryDetails(snapshot))
    }
    if (!statsEl) {
      box.setAttribute("title", voteSummaryDetails(snapshot))
    }
    if (upBtn) {
      upBtn.disabled = pending
      upBtn.classList.toggle("active", userVote === 1)
    }
    if (downBtn) {
      downBtn.disabled = pending
      downBtn.classList.toggle("active", userVote === -1)
    }
  }

  function wireVoteBox(box, config) {
    if (!box) return null
    if (box.getAttribute("data-icono-vote-wired") === "true") return null
    var cfg = config || {}
    var symbol = normalizedSymbol(cfg.symbol)
    var assetSha = String(cfg.assetSha || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return null
    box.setAttribute("data-icono-vote-wired", "true")
    var state = {
      authenticated: false,
      pending: false,
      snapshot: {
        image_upvotes: 0,
        image_downvotes: 0,
        image_score: 0,
        user_vote: 0,
      },
    }
    var snapshotPrimed = false
    var visibilityObserver = null
    var candidateRef = "a:" + symbol + "|" + assetSha
    var upBtn = box.querySelector("[data-icono-vote-up]")
    var downBtn = box.querySelector("[data-icono-vote-down]")

    function render() {
      setVoteBoxState(box, state)
    }

    function notifySnapshot() {
      if (typeof cfg.onSnapshot === "function") {
        cfg.onSnapshot(state.snapshot, state)
      }
    }

    function cloneSnapshot(snapshot) {
      var safe = snapshot || {}
      return {
        image_upvotes: Number(safe.image_upvotes || 0),
        image_downvotes: Number(safe.image_downvotes || 0),
        image_score: Number(safe.image_score || 0),
        user_vote: Number(safe.user_vote || 0),
      }
    }

    function optimisticSnapshot(nextVote) {
      var base = cloneSnapshot(state.snapshot)
      var currentVote = Number(base.user_vote || 0)
      var resolvedVote = Number(nextVote || 0)
      if (currentVote === 1) base.image_upvotes = Math.max(0, Number(base.image_upvotes || 0) - 1)
      if (currentVote === -1)
        base.image_downvotes = Math.max(0, Number(base.image_downvotes || 0) - 1)
      if (resolvedVote === 1) base.image_upvotes += 1
      if (resolvedVote === -1) base.image_downvotes += 1
      base.user_vote = resolvedVote
      base.image_score = Number(base.image_upvotes || 0) - Number(base.image_downvotes || 0)
      return base
    }

    function refreshSnapshot() {
      state.pending = true
      render()
      return fetchJSON(
        "/api/iconoplasm/votes/snapshot",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_ref: candidateRef,
            symbol: symbol,
            asset_sha256: assetSha,
            vision_id: "",
          }),
        },
        {
          apiBaseUrl: cfg.apiBaseUrl,
          fetchImpl: cfg.fetchImpl,
        },
      )
        .then(function (data) {
          state.authenticated = !!(data && data.authenticated)
          state.snapshot = (data && data.snapshot) || state.snapshot
          notifySnapshot()
        })
        .catch(function (err) {
          if (typeof cfg.onError === "function") cfg.onError("snapshot", err)
        })
        .finally(function () {
          state.pending = false
          render()
        })
    }

    function submitVote(voteValue) {
      // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Optimistic UI) +
      // C:\Users\Admin\.codex\skills\polish\SKILL.md (Interaction states).
      // Keep the selected vote lit on click, not after the network round-trip. This is shared
      // by both the website and extension, so sluggish feedback here propagates everywhere.
      var previousSnapshot = cloneSnapshot(state.snapshot)
      var currentVote = Number(previousSnapshot.user_vote || 0)
      var requestedVote = Number(voteValue || 0)
      var nextVote = currentVote === requestedVote ? 0 : requestedVote
      state.snapshot = optimisticSnapshot(nextVote)
      state.pending = true
      notifySnapshot()
      render()
      fetchJSON(
        "/api/iconoplasm/votes/set",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_ref: candidateRef,
            symbol: symbol,
            asset_sha256: assetSha,
            vision_id: "",
            vote_value: nextVote,
          }),
        },
        {
          apiBaseUrl: cfg.apiBaseUrl,
          fetchImpl: cfg.fetchImpl,
        },
      )
        .then(function (data) {
          state.authenticated = true
          state.snapshot = (data && data.snapshot) || state.snapshot
          notifySnapshot()
        })
        .catch(function (err) {
          state.snapshot = previousSnapshot
          if (
            Number((err && err.status) || 0) === 401 ||
            (err && err.payload && err.payload.code === "AUTH_REQUIRED")
          ) {
            state.authenticated = false
            notifySnapshot()
            if (typeof cfg.onAuthRequired === "function") cfg.onAuthRequired(err)
            return
          }
          notifySnapshot()
          if (typeof cfg.onError === "function") cfg.onError("set", err)
        })
        .finally(function () {
          state.pending = false
          render()
        })
    }

    function disconnectObserver() {
      if (!visibilityObserver) return
      visibilityObserver.disconnect()
      visibilityObserver = null
    }

    function ensureSnapshot() {
      if (snapshotPrimed) return
      snapshotPrimed = true
      disconnectObserver()
      void refreshSnapshot()
    }

    function primeSnapshotOnVisibility() {
      if (snapshotPrimed || typeof IntersectionObserver !== "function") return
      visibilityObserver = new IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i] && entries[i].isIntersecting) {
              ensureSnapshot()
              return
            }
          }
        },
        {
          rootMargin: String(cfg.visibleRootMargin || "240px 0px"),
        },
      )
      visibilityObserver.observe(box)
    }

    if (upBtn) {
      upBtn.addEventListener("click", function (event) {
        event.stopPropagation()
        submitVote(1)
      })
    }
    if (downBtn) {
      downBtn.addEventListener("click", function (event) {
        event.stopPropagation()
        submitVote(-1)
      })
    }

    render()

    if (cfg.deferSnapshot) {
      primeSnapshotOnVisibility()
      box.addEventListener("pointerenter", ensureSnapshot, { once: true })
      box.addEventListener("focusin", ensureSnapshot, { once: true })
      box.addEventListener("touchstart", ensureSnapshot, { once: true, passive: true })
      return { ensureSnapshot: ensureSnapshot }
    }

    ensureSnapshot()
    return { ensureSnapshot: ensureSnapshot }
  }

  global.IconoplasmCardShared = {
    icons: {
      check: ICONO_CHECK_ICON,
      cross: ICONO_CROSS_ICON,
    },
    resolveApiBase: resolveApiBase,
    fetchJSON: fetchJSON,
    escapeHtml: escapeHtml,
    normalizedSymbol: normalizedSymbol,
    uniqueDisplayValues: uniqueDisplayValues,
    buildTooltipTraitOriginRows: buildTooltipTraitOriginRows,
    collectTooltipMetaRows: collectTooltipMetaRows,
    renderTooltipMetaRowsHtml: renderTooltipMetaRowsHtml,
    renderTooltipMetaSkeletonHtml: renderTooltipMetaSkeletonHtml,
    renderTooltipMobileRowGridHtml: renderTooltipMobileRowGridHtml,
    renderTooltipMobileSkeletonHtml: renderTooltipMobileSkeletonHtml,
    voteBoxMarkup: voteBoxMarkup,
    setVoteBoxState: setVoteBoxState,
    wireVoteBox: wireVoteBox,
    voteSummaryDetails: voteSummaryDetails,
  }
})(typeof globalThis !== "undefined" ? globalThis : window)
