;(function (root) {
  "use strict"

  function buildVoteIconSvg(documentRef, kind) {
    const svgNs = "http://www.w3.org/2000/svg"
    const svg = documentRef.createElementNS(svgNs, "svg")
    svg.setAttribute("viewBox", "0 0 20 20")
    svg.setAttribute("fill", "none")
    svg.setAttribute("aria-hidden", "true")

    const path = documentRef.createElementNS(svgNs, "path")
    if (kind === "approve") {
      path.setAttribute("d", "M5 10.5 8.25 13.75 15 7")
      path.setAttribute("stroke-linejoin", "round")
    } else {
      path.setAttribute("d", "M6 6 14 14M14 6 6 14")
    }
    path.setAttribute("stroke", "currentColor")
    path.setAttribute("stroke-width", "2")
    path.setAttribute("stroke-linecap", "round")
    svg.appendChild(path)
    return svg
  }

  function createVoteBoxNode(documentRef) {
    const box = documentRef.createElement("div")
    box.className = "icono-vote-box icono-vote-box--brick"
    box.setAttribute("data-icono-vote-box", "")

    const approve = documentRef.createElement("button")
    approve.type = "button"
    approve.className = "icono-vote-btn icono-vote-btn--approve"
    approve.setAttribute("data-icono-vote-up", "")
    approve.setAttribute("aria-label", "Approve portrait")
    approve.title = "Approve portrait"
    approve.appendChild(buildVoteIconSvg(documentRef, "approve"))

    const reject = documentRef.createElement("button")
    reject.type = "button"
    reject.className = "icono-vote-btn icono-vote-btn--reject"
    reject.setAttribute("data-icono-vote-down", "")
    reject.setAttribute("aria-label", "Reject portrait")
    reject.title = "Reject portrait"
    reject.appendChild(buildVoteIconSvg(documentRef, "reject"))

    box.append(approve, reject)
    return box
  }

  function buildTooltipVoteConfig(options = {}) {
    if (options.imageOnly) return null
    const detail =
      options.geneDetail && typeof options.geneDetail === "object" ? options.geneDetail : null
    const symbol = String((detail && detail.symbol) || options.activeSymbol || "")
      .trim()
      .toUpperCase()
    const portrait = (detail || {}).portrait || {}
    const assetSha = String(portrait.asset_sha256 || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return null
    return {
      symbol,
      assetSha,
      visionId: String(portrait.vision_id || "").trim(),
      candidateImageId: Number(portrait.candidate_image_id || 0),
      apiBaseUrl: String(options.apiBaseUrl || ""),
    }
  }

  function wireRenderedTooltipVoteBox(options = {}) {
    const tooltip = options.tooltip
    if (!tooltip || !options.geneDetail) return
    const box = tooltip.querySelector("[data-icono-vote-box]")
    if (!box) return
    const config = buildTooltipVoteConfig(options)
    if (!config) return
    const cardShared = options.cardShared
    if (!cardShared || typeof cardShared.wireVoteBox !== "function") return
    cardShared.wireVoteBox(
      box,
      Object.assign({}, config, {
        fetchImpl: options.fetchImpl,
        deferSnapshot: true,
        onAuthRequired: options.onAuthRequired,
        onError: options.onError,
      }),
    )
  }

  root.IconoplasmContentVoteBridge = {
    createVoteBoxNode,
    buildTooltipVoteConfig,
    wireRenderedTooltipVoteBox,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
