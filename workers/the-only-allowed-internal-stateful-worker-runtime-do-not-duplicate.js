import "../shared/iconoplasm-card/shared-card-runtime.js"

// CORS headers for frontend access - supports both main domain and subdomain
function getCorsHeaders(origin, requestHost = "") {
  const allowedOrigins = [
    "https://brinedew.bio",
    "https://geneguessr.brinedew.bio",
    "https://iconoplasm.brinedew.bio",
  ]
  const stagingOrigins = [
    "https://staging.brinedew.bio",
    "https://brinedew-bio-staging.pages.dev",
    "https://staging.brinedew-bio.pages.dev",
  ]
  const lowerHost = String(requestHost || "").toLowerCase()
  const lowerOrigin = String(origin || "").toLowerCase()
  const isWorkersDev = lowerHost.endsWith(".workers.dev")
  const isLocalHost =
    lowerHost === "localhost" || lowerHost === "127.0.0.1" || lowerHost === "0.0.0.0"
  const isLocalOrigin =
    lowerOrigin.startsWith("http://localhost") ||
    lowerOrigin.startsWith("http://127.0.0.1") ||
    lowerOrigin.startsWith("http://0.0.0.0")

  // Allow localhost origins only when we're running on localhost (wrangler dev)
  // or on a workers.dev hostname (staging/dev). Do NOT allow localhost origins on prod custom domains.
  const allowLocalOrigin = isLocalOrigin && (isLocalHost || isWorkersDev)
  const corsOrigin =
    allowedOrigins.includes(origin) ||
    (isWorkersDev && stagingOrigins.includes(origin)) ||
    allowLocalOrigin
      ? origin
      : "https://brinedew.bio"
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  }
}

// Backward compatibility - default CORS headers for main domain
const CORS_HEADERS = getCorsHeaders("https://brinedew.bio", "brinedew.bio")
const JSON_HEADERS = { "Content-Type": "application/json" }
const BYTES_PER_GB = 1024 * 1024 * 1024
const STRUCTURE_BUCKET_CAP_BYTES = Math.floor(9.5 * BYTES_PER_GB)
// Safety cap: refuse to stream/cache extremely large structure files.
// Mol* can choke on multi-10MB models and Workers memory is not infinite.
const MAX_STRUCTURE_FILE_BYTES = 20 * 1024 * 1024
const STRUCTURE_CACHE_META_PREFIX = "structure_meta:"
const STRUCTURE_CACHE_TARGET_RATIO = 0.9
const DAILY_TARGET_SALT = "geneguessr-v2-939b5a0b"
const DAILY_BOOTSTRAP_CACHE_PREFIX = "daily_bootstrap:"
const DAILY_BOOTSTRAP_CACHE_TTL = 86400 // 24 hours

const GENEGUESSR_HOST = "geneguessr.brinedew.bio"
const BENCHMARK_HOST = "geneguessr-bench.brinedew.bio"
const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const STATIC_SITE_ORIGIN_PROD = "https://brinedew-bio.pages.dev"
const STATIC_SITE_ORIGIN_STAGING = "https://brinedew-bio-staging.pages.dev"
const ICONOPLASM_SCHEDULED_MAINTENANCE_CRONS = new Set(["17 * * * *", "55 23 * * *", "3 0 * * *"])
const MOLSTAR_VENDOR_ALLOWED_PREFIXES = [
  "/static/vendor/pdbe-molstar@3.8.0/",
  "/static/vendor/pdbe-molstar@3.7.1/",
]
const KATEX_VENDOR_PREFIX = "/static/vendor/katex/"
const KATEX_VENDOR_VERSION = "0.16.21"
const ICONOPLASM_GENE_FONT_PRELOAD_LINKS = [
  "</static/iconoplasm/fonts/IBMPlexMono-Regular.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
  "</static/iconoplasm/fonts/IBMPlexMono-Medium.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
  "</static/iconoplasm/fonts/LeagueSpartan-800.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
  "</static/iconoplasm/fonts/SpecialElite-Regular.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
  "</static/iconoplasm/fonts/Caveat-400.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
]
const ICONOPLASM_HTML_SHELL_EDGE_CACHE_TTL_SECONDS = 300
const ICONOPLASM_HTML_SHELL_EDGE_CACHE_VERSION = "2026-06-17-remove-static-shell-v2"
const ICONOPLASM_PUBLIC_NO_VARY_SEARCH =
  'params=("utm_source" "utm_medium" "utm_campaign" "utm_content" "utm_term" "fbclid" "gclid" "mc_cid" "mc_eid" "codex_verify")'

const PRACTICE_RESOLVE_MAX_INPUTS = 10000
// Cloudflare D1 enforces a relatively small limit on bound parameters per query.
// Keep this low enough to avoid `too many SQL variables`-style failures when users paste 100+ symbols.
const PRACTICE_RESOLVE_SQL_CHUNK = 100

function addIconoplasmGeneShellHeaders(headers, path) {
  const next = new Headers(headers)
  if (!String(path || "").startsWith("/gene/")) return next
  for (const link of ICONOPLASM_GENE_FONT_PRELOAD_LINKS) next.append("Link", link)
  next.set("No-Vary-Search", ICONOPLASM_PUBLIC_NO_VARY_SEARCH)
  next.set("X-Robots-Tag", "noindex, follow, noarchive")
  return next
}

function escapeIconoplasmStaticShellText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeIconoplasmHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
}

function iconoplasmSafeJsonScriptPayload(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function iconoplasmStaticGeneSymbolFromPath(path) {
  const match = /^\/gene\/([^/?#]+)/.exec(String(path || ""))
  if (!match) return null
  try {
    return decodeURIComponent(match[1] || "")
      .trim()
      .toUpperCase()
  } catch (_) {
    return String(match[1] || "")
      .trim()
      .toUpperCase()
  }
}

function iconoplasmStaticGeneShellHtml(safeSymbol, safeLetter) {
  return `
  <div class="icono-nav icono-static-shell-only"><a href="/" data-icono-nav>All genes</a></div>
  <div id="icono-gene-content" class="icono-static-shell-only">
    <section class="icono-gene-lead icono-gene-lead--static-shell">
      <article class="icono-card icono-card--brick icono-card--brick-static icono-gene-lead-card icono-card--variant-lab-label" style="--width:882;--height:1134;--icono-card-accent:#8a6f4d" data-icono-card-variant="lit-archival" data-icono-static-gene-shell="true">
        <div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing">
          <div class="icono-label-specimen-viewport">
            <div class="iconoplasm-tooltip-portrait-fallback"><div class="iconoplasm-tooltip-portrait-status" aria-hidden="true"></div><div class="iconoplasm-tooltip-portrait-symbol" data-icono-static-symbol>${safeSymbol}</div></div>
          </div>
          <div class="icono-label-specimen-footer"><div class="icono-label-specimen-notes"><div class="icono-label-specimen-note">emulsion note / glass plate spectral analysis</div></div><div class="icono-label-specimen-micro"><div class="icono-label-specimen-color-row"><span class="icono-label-specimen-swatch-hex"><span class="icono-label-specimen-swatch"></span><span class="icono-label-specimen-metric-value">UNFILED</span></span></div><div class="icono-label-specimen-decomposition"><span class="icono-label-specimen-cell icono-label-specimen-cell--metric icono-label-specimen-cell--row-1"><span class="icono-label-specimen-metric">letter</span></span><span class="icono-label-specimen-cell icono-label-specimen-cell--value icono-label-specimen-cell--row-1"><span class="icono-label-specimen-metric-value" data-icono-static-letter>${safeLetter}</span></span><span class="icono-label-specimen-cell icono-label-specimen-cell--hand icono-label-specimen-cell--row-1"><span class="icono-label-specimen-hand-analysis">filing</span></span></div></div></div><div class="iconoplasm-tooltip-portrait-fade"></div>
        </div>
        <div class="iconoplasm-tooltip-body icono-label-mobile-info-card">
          <div class="icono-label-sheet-body">
            <div class="icono-label-header-row"><div class="icono-label-title-block"><div class="icono-label-caption">gene name</div><div class="icono-label-symbol" data-icono-static-symbol>${safeSymbol}</div><div class="icono-label-name"></div><div class="icono-label-registry-line">ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03</div></div><div class="icono-label-header-stack"><div class="icono-label-header-meta"><div class="icono-label-header-meta-cell"><div class="icono-label-caption">emulsion no.</div><div class="icono-label-serial">filing</div></div><div class="icono-label-header-meta-cell"><div class="icono-label-caption">family</div><div class="icono-label-family" data-icono-static-symbol>${safeSymbol}</div></div></div><div class="icono-label-filed-block"><div class="icono-label-caption">family trait</div><div class="icono-label-family-trait-field icono-label-family-trait-field--empty"></div></div></div><div class="icono-label-qc-block"><div class="icono-label-caption">qc</div><div class="icono-label-qc-empty"></div><div class="icono-label-qc-meta"><div class="icono-label-qc-meta-item">inspect. A3</div><div class="icono-label-qc-meta-item">plate 7</div></div><div class="icono-label-qc-note">pending review</div></div></div>
            <div class="icono-label-band-row"><div class="icono-label-row-label">field notes</div><div class="icono-label-band-grid"><div class="icono-label-band-cell icono-label-band-cell--category"><div class="icono-label-caption">category</div><div class="icono-label-band-primary"><div class="icono-label-category-grid"><div class="icono-label-category-option icono-label-category-option--transmembrane"><span class="icono-label-option"><span class="icono-label-option-copy">TRANSMEMBRANE</span></span></div><div class="icono-label-category-option icono-label-category-option--soluble"><span class="icono-label-option"><span class="icono-label-option-copy">SOLUBLE</span></span></div></div></div></div><div class="icono-label-band-cell icono-label-band-cell--noted"><div class="icono-label-caption">first noted</div></div><div class="icono-label-band-cell icono-label-band-cell--mass"><div class="icono-label-caption">mass</div><div class="icono-label-band-primary"><div class="icono-label-mass-line"><span class="icono-label-mass-fill"></span><span class="icono-label-mass-unit-stack"><span class="icono-label-typed-value icono-label-typed-value--band icono-label-typed-value--crossed icono-label-typed-value--unit-kda">kDa</span><span class="icono-label-hand-note icono-label-hand-note--unit">kg</span></span></div></div></div></div></div>
            <div class="icono-label-style-row"><div class="icono-label-row-label">pfam clans</div><div class="icono-label-style-stack"></div></div>
            <div class="icono-label-alignment-row"><div class="icono-label-row-label">alignment</div><div class="icono-label-alignment-body"><div class="icono-label-selector-row icono-label-selector-row--alignment is-neither"><span class="icono-label-option"><span class="icono-label-option-copy">ONCOGENE</span></span><span class="icono-label-option"><span class="icono-label-option-copy">TUMOR SUPPRESSOR</span></span><span class="icono-label-alignment-strike" aria-hidden="true"></span></div></div></div>
            <div class="icono-label-footer-row"><div class="icono-label-row-label">remarks</div><div class="icono-label-footer-copy"><div class="icono-label-footer-copy-main"><div class="icono-label-footer-line icono-label-footer-line--caption">labelled / inspected / filed</div><div class="icono-label-footer-line icono-label-footer-line--typed">archive room b / bench 3 / human gene cabinet</div><div class="icono-label-footer-line icono-label-footer-line--typed">stock tone filing / sheet filing / print run 07</div><div class="icono-label-footer-line icono-label-footer-line--typed">seal after review / do not expose to open air</div></div><div class="icono-label-footer-copy-side"><div class="icono-label-footer-line icono-label-footer-line--caption">brinedew institute / internal matter</div><div class="icono-label-footer-line icono-label-footer-line--caption">keep away from heat and moisture</div><div class="icono-label-footer-line icono-label-footer-line--caption">registry copy retained in cabinet 5A</div></div></div></div>
          </div>
        </div>
      </article>
    </section>
  </div>`
}

function personalizeIconoplasmStaticGeneShell(html, path) {
  const symbol = iconoplasmStaticGeneSymbolFromPath(path)
  if (!symbol) {
    return String(html)
      .replace(
        /\s*<!-- iconoplasm-static-gene-shell:start -->[\s\S]*?<!-- iconoplasm-static-gene-shell:end -->\s*/g,
        "",
      )
      .replace(
        /(<div\b[^>]*\bid=["']iconoplasm-root["'][^>]*)(>)/,
        `$1 data-icono-startup-route="home"$2`,
      )
  }
  const safeSymbol = escapeIconoplasmStaticShellText(symbol)
  const safeLetter = escapeIconoplasmStaticShellText(symbol.charAt(0) || "G")
  let next = String(html)
    .replace(/(<div\b[^>]*\bid=["']iconoplasm-root["'][^>]*)(>)/, (_match, open, close) => {
      return `${open} data-icono-startup-route="gene"${close}`
    })
    .replace(/<div\b[^>]*\bclass="icono-nav icono-static-shell-only"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*\bid="icono-gene-content"[^>]*>[\s\S]*?<\/div>\s*(?=[\s]*<\/div>)/gi, "")
    .replace(/(<[^>]*\bdata-icono-static-symbol\b[^>]*>)(.*?)(<\/[^>]+>)/g, `$1${safeSymbol}$3`)
    .replace(/(<[^>]*\bdata-icono-static-letter\b[^>]*>)(.*?)(<\/[^>]+>)/g, `$1${safeLetter}$3`)
  return next
}

function iconoplasmCardPayloadFromManifest(payload) {
  const card = payload && (payload.card || (payload.cards && payload.cards[0]))
  return (card && card.payload) || (payload && payload.payload) || null
}

function iconoplasmPortraitPreloadUrlFromCardPayload(manifestPayload, cardPayload) {
  const card =
    manifestPayload && (manifestPayload.card || (manifestPayload.cards && manifestPayload.cards[0]))
  return (
    cardPayload?.portrait?.medium_url ||
    cardPayload?.portrait?.hero_url ||
    cardPayload?.portrait?.thumb_url ||
    card?.portrait?.url ||
    card?.portrait?.full_url ||
    card?.portrait?.thumb_url ||
    ""
  )
}

function iconoplasmCanonicalAssetFromCardPayload(cardPayload) {
  const value = String(cardPayload?.portrait?.asset_sha256 || "")
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(value) ? value : ""
}

function iconoplasmGeneDetailShellVersion(cardPayload) {
  const assetSha = iconoplasmCanonicalAssetFromCardPayload(cardPayload)
  return assetSha ? `site-gene-detail-${assetSha}` : "site-gene-detail-no-published-portrait"
}

function iconoplasmPublishedPortraitUrlFromCardPayload(cardPayload, preferredSize) {
  const portrait = cardPayload && cardPayload.portrait
  const flatHeroUrl = String((cardPayload && cardPayload.ph) || "").trim()
  const flatMediumUrl = String((cardPayload && cardPayload.pt) || "").trim()
  const isPublished =
    (portrait && portrait.status === "published") || Boolean(flatHeroUrl || flatMediumUrl)
  if (!isPublished) return ""
  const heroUrl = String((portrait && portrait.hero_url) || flatHeroUrl).trim()
  const mediumUrl = String((portrait && portrait.medium_url) || flatMediumUrl).trim()
  const thumbUrl = String((portrait && portrait.thumb_url) || "").trim()
  if (preferredSize === "medium") return mediumUrl || thumbUrl || heroUrl
  if (preferredSize === "thumb") return thumbUrl || mediumUrl || heroUrl
  return heroUrl || mediumUrl || thumbUrl
}

function iconoplasmLabelVoteBoxMarkup(cardPayload) {
  const shared = globalThis.IconoplasmCardShared
  const portrait = (cardPayload && cardPayload.portrait) || {}
  const assetSha = String(portrait.asset_sha256 || "")
    .trim()
    .toLowerCase()
  if (!shared || !assetSha) return ""
  let attrs = `data-icono-gene-vote-box="${escapeIconoplasmHtmlAttribute(assetSha)}"`
  const candidateImageId = Number(portrait.candidate_image_id || 0)
  if (Number.isFinite(candidateImageId) && candidateImageId > 0) {
    attrs += ` data-icono-candidate-image-id="${escapeIconoplasmHtmlAttribute(String(Math.round(candidateImageId)))}"`
  }
  const visionId = String(portrait.vision_id || "").trim()
  if (visionId) attrs += ` data-icono-vision-id="${escapeIconoplasmHtmlAttribute(visionId)}"`
  return shared.voteBoxMarkup(attrs, {
    variant: "label",
    showScore: false,
    showArrows: false,
  })
}

function iconoplasmStaticGeneLeadCardHtmlFromPayload(cardPayload) {
  const shared = globalThis.IconoplasmCardShared
  if (!shared || !cardPayload) return ""
  const symbol = shared.normalizedSymbol(cardPayload.symbol || cardPayload.canonical_symbol)
  if (!symbol) return ""
  const dims = shared.portraitDimensions(cardPayload)
  const portraitUrl = iconoplasmPublishedPortraitUrlFromCardPayload(cardPayload, "medium")
  const portraitFullUrl =
    iconoplasmPublishedPortraitUrlFromCardPayload(cardPayload, "full") || portraitUrl
  const portraitAttrs =
    portraitUrl && portraitFullUrl
      ? `data-icono-pswp data-icono-pswp-src="${escapeIconoplasmHtmlAttribute(portraitFullUrl)}" data-icono-pswp-alt="${escapeIconoplasmHtmlAttribute(symbol + " blot")}" data-pswp-width="${escapeIconoplasmHtmlAttribute(String(dims.width))}" data-pswp-height="${escapeIconoplasmHtmlAttribute(String(dims.height))}"`
      : ""
  const portraitMediaHtml = portraitUrl
    ? shared.renderLabLabelPortraitMediaHtml(symbol, portraitUrl, portraitFullUrl, dims, {
        buttonAttrs: portraitAttrs,
        fetchPriority: "high",
      })
    : '<img class="iconoplasm-tooltip-portrait-img" alt="">' +
      '<div class="iconoplasm-tooltip-portrait-fallback">' +
      '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
      '<div class="iconoplasm-tooltip-portrait-symbol">' +
      escapeIconoplasmStaticShellText(symbol) +
      "</div>" +
      "</div>"
  const portraitStateClass = portraitUrl
    ? "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--ready"
    : "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing"
  const portraitMarkup =
    '<div class="' +
    portraitStateClass +
    '"' +
    (portraitUrl ? " data-icono-lightbox" : "") +
    ">" +
    shared.renderLabLabelSpecimenRailHtml(portraitMediaHtml, cardPayload) +
    "</div>"
  const bodyHtml =
    '<div class="iconoplasm-tooltip-body icono-label-mobile-info-card">' +
    shared.renderLabLabelCardHtml(cardPayload, {
      mode: "sheet",
      layoutVariant: "lit-archival",
      mobileReview: false,
      portraitAlt: symbol + " blot",
      portraitSrc: portraitUrl,
      voteHtml: iconoplasmLabelVoteBoxMarkup(cardPayload),
    }) +
    "</div>"
  return (
    '<article class="icono-card icono-card--brick icono-card--brick-static icono-gene-lead-card icono-card--variant-lab-label icono-card--variant-lit-archival" style="--width:' +
    escapeIconoplasmHtmlAttribute(String(dims.width)) +
    ";--height:" +
    escapeIconoplasmHtmlAttribute(String(dims.height)) +
    ";--icono-card-accent:" +
    escapeIconoplasmHtmlAttribute(cardPayload.color || "#888") +
    '" data-icono-card-variant="lit-archival" data-icono-static-gene-shell="true">' +
    '<div class="icono-mobile-card-physical-object" data-icono-mobile-physical-object>' +
    portraitMarkup +
    bodyHtml +
    "</div>" +
    "</article>"
  )
}

function replaceIconoplasmStaticGeneLeadShell(html, leadCardHtml) {
  if (!leadCardHtml) return html
  return String(html).replace(
    /(<section class="icono-gene-lead icono-gene-lead--static-shell">)[\s\S]*?(<\/section>\s*<\/div>)/,
    `$1${leadCardHtml}$2`,
  )
}

async function iconoplasmGeneCardBootstrapInjection(request, env, ctx, path) {
  // ICONOPLASM CANONICAL PORTRAIT PUBLISH CONTRACT.
  // Search terms: PRL split-brain, gene page bootstrap, canonical blot,
  // public card artifact, KV_GALLERY_VERSION.
  //
  // Gene pages are the per-symbol freshness surface. The public card artifact
  // remains the coarse browse/extension snapshot, but this first-paint shell
  // must match the current D1 canonical exposed by /api/iconoplasm/site/genes.
  // Keep this routed through the Iconoplasm runtime endpoint rather than adding
  // a local SQL clone in the HTML worker.
  if (request.method === "HEAD") return { injection: "", leadCardHtml: "", snapshotVersion: "" }
  const symbol = iconoplasmStaticGeneSymbolFromPath(path)
  if (!symbol) return { injection: "", leadCardHtml: "", snapshotVersion: "" }
  try {
    const apiUrl = new URL(request.url)
    apiUrl.pathname = `/api/iconoplasm/site/genes/${encodeURIComponent(symbol)}`
    apiUrl.search = ""
    apiUrl.searchParams.set("fields", "symbol,full_name,color,portrait")
    apiUrl.hash = ""
    const detailResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(apiUrl.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
        }),
        env,
        ctx,
      )
    if (!detailResponse || !detailResponse.ok) {
      return { injection: "", leadCardHtml: "", snapshotVersion: "" }
    }
    const cardPayload = await detailResponse.json()
    if (!cardPayload) return { injection: "", leadCardHtml: "", snapshotVersion: "" }
    const snapshotVersion = iconoplasmGeneDetailShellVersion(cardPayload)
    const payload = {
      symbol,
      snapshot_version: snapshotVersion,
      source: "site_gene_detail",
      payload: cardPayload,
    }
    const portraitUrl = iconoplasmPortraitPreloadUrlFromCardPayload(null, cardPayload)
    const portraitPreload = portraitUrl
      ? `<link rel="preload" as="image" href="${escapeIconoplasmHtmlAttribute(portraitUrl)}" fetchpriority="high">`
      : ""
    return {
      injection: `${portraitPreload}<script type="application/json" id="iconoplasm-card-bootstrap">${iconoplasmSafeJsonScriptPayload(payload)}</script>`,
      leadCardHtml: iconoplasmStaticGeneLeadCardHtmlFromPayload(cardPayload),
      snapshotVersion,
    }
  } catch (error) {
    console.warn("Iconoplasm gene card bootstrap injection failed:", error)
    return { injection: "", leadCardHtml: "", snapshotVersion: "" }
  }
}

function insertIconoplasmGeneCardBootstrap(html, injection) {
  if (!injection) return html
  const marker = 'if (typeof window === "undefined" || window.__iconoplasmBootstrap) return'
  const markerIndex = String(html).indexOf(marker)
  if (markerIndex >= 0) {
    const scriptStart = String(html).lastIndexOf("<script", markerIndex)
    if (scriptStart >= 0) {
      return `${html.slice(0, scriptStart)}${injection}${html.slice(scriptStart)}`
    }
  }
  return String(html).replace(/<\/head>/i, `${injection}</head>`)
}

const ANALYTICS_CONSENT_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
])

function requestCountryCode(request) {
  return String(request.headers.get("CF-IPCountry") || request.cf?.country || "").toUpperCase()
}

function requestRequiresAnalyticsConsent(request) {
  return ANALYTICS_CONSENT_COUNTRIES.has(requestCountryCode(request))
}

function shouldShowAnalyticsConsentPrompt(request) {
  try {
    const host = new URL(request.url).hostname
    return (
      isProductionBrinedewHtmlHost(host) &&
      requestRequiresAnalyticsConsent(request) &&
      !requestHasAnalyticsConsent(request)
    )
  } catch {
    return false
  }
}

function injectAnalyticsConsentBootstrap(html, request) {
  if (!html || !shouldShowAnalyticsConsentPrompt(request)) return html
  const bootstrap = "<script>window.__brinedewAnalyticsConsentRequired=true</script>"
  return String(html).replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`)
}

function iconoplasmHtmlShellCacheKey(url) {
  const key = new URL("https://iconoplasm.brinedew.bio/__edge-cache/iconoplasm-html-shell")
  key.searchParams.set("version", ICONOPLASM_HTML_SHELL_EDGE_CACHE_VERSION)
  key.searchParams.set("staticOrigin", buildStaticSiteUrl(url, "/").origin)
  return new Request(key.toString(), { method: "GET" })
}

function iconoplasmGeneHtmlCacheKey(url, path, snapshotVersion) {
  const symbol = iconoplasmStaticGeneSymbolFromPath(path)
  if (!symbol) return null
  const snapshot = String(snapshotVersion || "").trim()
  if (!snapshot) return null
  const key = new URL("https://iconoplasm.brinedew.bio/__edge-cache/iconoplasm-gene-html")
  key.searchParams.set("version", ICONOPLASM_HTML_SHELL_EDGE_CACHE_VERSION)
  key.searchParams.set("staticOrigin", buildStaticSiteUrl(url, "/").origin)
  key.searchParams.set("symbol", symbol)
  key.searchParams.set("snapshot", snapshot)
  return new Request(key.toString(), { method: "GET" })
}

async function iconoplasmCacheableHtmlShellResponse(
  html,
  response,
  request,
  env,
  ctx,
  path,
  cacheStatus,
  preloadedGeneShell = null,
) {
  const headers = addIconoplasmGeneShellHeaders(response.headers, path)
  // The cached object is the generic rewritten shell in caches.default. The response
  // returned to browsers is route-tailored, so Cloudflare's outer HTTP cache must
  // not store it and replay a home shell for /gene/* or vice versa.
  headers.set("Cache-Control", "no-store")
  headers.set("X-Iconoplasm-HTML-Shell-Cache", cacheStatus)
  let body = response.status === 204 ? null : personalizeIconoplasmStaticGeneShell(html, path)
  if (body && String(path || "").startsWith("/gene/")) {
    body = rewriteIconoplasmGeneDiscoveryMetadata(body, path)
  }
  let geneShell = preloadedGeneShell
  if (body && String(path || "").startsWith("/gene/")) {
    if (!geneShell) geneShell = await iconoplasmGeneCardBootstrapInjection(request, env, ctx, path)
    if (geneShell && geneShell.leadCardHtml) {
      body = replaceIconoplasmStaticGeneLeadShell(body, geneShell.leadCardHtml)
    }
    if (geneShell && geneShell.injection) {
      body = insertIconoplasmGeneCardBootstrap(body, geneShell.injection)
    }
  }
  if (
    body &&
    request.method === "GET" &&
    String(path || "").startsWith("/gene/") &&
    typeof caches !== "undefined" &&
    caches.default
  ) {
    // This is only a short-lived HTML shell cache. It is not the canonical card
    // freshness barrier. The embedded card above is still sourced through
    // `/api/iconoplasm/cards/:symbol`, and the client immediately follows with
    // the richer gene detail load. Do not stretch this TTL or turn it into a
    // long-lived symbol-only card cache; the public card artifact and
    // KV_GALLERY_VERSION barrier own canonical portrait freshness.
    const geneCacheKey = iconoplasmGeneHtmlCacheKey(
      new URL(request.url),
      path,
      geneShell?.snapshotVersion,
    )
    if (geneCacheKey) {
      const cacheHeaders = new Headers(headers)
      cacheHeaders.set(
        "Cache-Control",
        `public, max-age=0, s-maxage=${ICONOPLASM_HTML_SHELL_EDGE_CACHE_TTL_SECONDS}`,
      )
      cacheHeaders.set("X-Iconoplasm-HTML-Shell-Cache", `${cacheStatus}-GENE-STORED`)
      ctx?.waitUntil(
        caches.default.put(
          geneCacheKey,
          new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: cacheHeaders,
          }),
        ),
      )
    }
  }
  body = injectAnalyticsConsentBootstrap(body, request)
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function buildPublicSubdomainRobotsTxt(host) {
  return `# robots.txt for ${host}
#
# Notes:
# - Non-standard directives are not valid robots.txt and break parsers.
# - Google ignores crawler-rate fields here, so keep rate control outside robots.txt.

User-agent: *
Allow: /
Disallow: /api/

User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: BLEXBot
Disallow: /

User-agent: DataForSeoBot
Disallow: /

Sitemap: https://${host}/sitemap.xml
`
}

function buildGeneguessrSubdomainRobotsTxt() {
  return buildPublicSubdomainRobotsTxt(GENEGUESSR_HOST)
}

function buildIconoplasmSubdomainRobotsTxt() {
  return buildPublicSubdomainRobotsTxt(ICONOPLASM_HOST)
}

async function runScheduledIconoplasmMaintenance(env, ctx) {
  try {
    const voteProjectionResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          "https://geneguessr-api/__internal/iconoplasm/process-vote-projection-refresh",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              limit: 250,
            }),
          },
        ),
        env,
        ctx,
      )
    const voteProjectionResult = await voteProjectionResponse.json()
    console.log("[CRON] Iconoplasm vote projection refresh result:", voteProjectionResult)

    const maintenanceResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request("https://geneguessr-api/__internal/iconoplasm/repair-canon-invariants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            limit: 250,
            actorId: "cron",
            reason: "scheduled_canon_invariant_repair",
          }),
        }),
        env,
        ctx,
      )
    const result = await maintenanceResponse.json()
    console.log("[CRON] Iconoplasm canon maintenance result:", result)

    // Bounded gallery freshness: after repairing canon, republish the public
    // card-catalog so canonical changes reach the home gallery / game cards
    // within ~24h instead of waiting for a manual sync. No-op by content hash
    // when nothing changed; self-skips (budget preflight throws, caught inside
    // the route) when there is no free-tier KV/D1 headroom.
    const galleryResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request("https://geneguessr-api/__internal/iconoplasm/refresh-gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "scheduled_gallery_refresh" }),
        }),
        env,
        ctx,
      )
    const galleryResult = await galleryResponse.json()
    console.log("[CRON] Iconoplasm gallery refresh result:", galleryResult)
  } catch (err) {
    console.error("[CRON] Iconoplasm canon maintenance failed:", err)
  }
}

async function runScheduledIconoplasmGalleryRefresh(env, ctx) {
  // Frequent, cheap gallery-only tick (the "*/15" cron). It does NOT run the heavy
  // maintenance (vote-projection refresh / canon repair). It just republishes the
  // public card-catalog so a canonical change — e.g. a vote auto-promote — reaches
  // the home gallery / game cards within ~15min instead of waiting for the nightly
  // run. invalidateGalleryCache no-ops by content hash when nothing changed (one
  // indexed changes-since query + reuse), and self-skips on exhausted free-tier
  // budget (caught inside the route).
  try {
    const galleryResponse =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request("https://geneguessr-api/__internal/iconoplasm/refresh-gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "scheduled_gallery_refresh_frequent" }),
        }),
        env,
        ctx,
      )
    const galleryResult = await galleryResponse.json()
    console.log("[CRON] Iconoplasm frequent gallery refresh result:", galleryResult)
  } catch (err) {
    console.error(
      "[CRON] Iconoplasm frequent gallery refresh failed:",
      String(err?.message || err || "unknown error"),
      "code=" + String(err?.code || ""),
    )
  }
}
}

function stableSitemapDate() {
  // Keep `lastmod` stable within a day to avoid thrashing crawlers with a constantly-changing sitemap.
  return new Date().toISOString().slice(0, 10)
}

function buildSubdomainSitemapXml(entries) {
  const now = stableSitemapDate()
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

function buildGeneguessrSubdomainSitemapXml() {
  return buildSubdomainSitemapXml([
    { loc: `https://${GENEGUESSR_HOST}/`, changefreq: "daily", priority: "1.0" },
    { loc: `https://${GENEGUESSR_HOST}/privacy`, changefreq: "monthly", priority: "0.3" },
  ])
}

function buildIconoplasmSubdomainSitemapXml() {
  return buildSubdomainSitemapXml([
    { loc: `https://${ICONOPLASM_HOST}/`, changefreq: "daily", priority: "1.0" },
    { loc: `https://${ICONOPLASM_HOST}/privacy`, changefreq: "monthly", priority: "0.3" },
  ])
}

function buildGeneguessrSubdomainLlmsTxt() {
  return `# GeneGuessr

GeneGuessr is a daily protein guessing game. Players infer the target gene from a protein structure, biological hints, similarity feedback, domains, pathways, and molecular-function clues.

## Core links

- [GeneGuessr](https://${GENEGUESSR_HOST}/): Daily protein guessing game
- [Privacy Policy](https://${GENEGUESSR_HOST}/privacy): Data handling for gameplay and login
- [Sitemap](https://${GENEGUESSR_HOST}/sitemap.xml): Crawlable GeneGuessr URLs
`
}

function buildIconoplasmSubdomainLlmsTxt() {
  return `# Iconoplasm

Iconoplasm turns human gene symbols into memorable character cards called blots. It includes a web catalog and a browser extension for recognizing genes while reading papers, databases, and other biology pages.

## Core links

- [Iconoplasm](https://${ICONOPLASM_HOST}/): Search and browse human gene character cards
- [Iconoplasm FAQ](https://brinedew.bio/wiki/iconoplasm-faq): Project background and use cases
- [Privacy Policy](https://${ICONOPLASM_HOST}/privacy): Data handling for the website and extension
- [Sitemap](https://${ICONOPLASM_HOST}/sitemap.xml): Crawlable Iconoplasm URLs

## Indexing note

Individual gene-card URLs are intentionally not listed here or in the XML sitemap until they have enough standalone explanatory content to be useful search results.
`
}

function replaceOrInsertHeadMarkup(html, pattern, replacement) {
  const source = String(html || "")
  if (pattern.test(source)) return source.replace(pattern, replacement)
  return source.replace(/<\/head>/i, `${replacement}\n</head>`)
}

function rewritePrivacyCanonicalMetadata(html, host) {
  const privacyUrl = `https://${host}/privacy`
  let next = String(html || "")
  next = replaceOrInsertHeadMarkup(
    next,
    /<link\b[^>]*\brel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${privacyUrl}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/i,
    `<meta property="og:url" content="${privacyUrl}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/i,
    `<meta name="twitter:url" content="${privacyUrl}">`,
  )
  return next
}

export function rewriteIconoplasmGeneDiscoveryMetadata(html, path) {
  const symbol = iconoplasmStaticGeneSymbolFromPath(path)
  if (!symbol) return html
  const geneUrl = `https://${ICONOPLASM_HOST}/gene/${encodeURIComponent(symbol)}`
  const safeTitle = escapeIconoplasmStaticShellText(`${symbol} - Iconoplasm gene card`)
  const safeDescription = escapeIconoplasmHtmlAttribute(
    `Iconoplasm gene card for ${symbol}. This visual card is available for sharing and app navigation, but is not indexed as a standalone search result yet.`,
  )
  let next = String(html || "")
  next = replaceOrInsertHeadMarkup(next, /<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\bname=["']description["'][^>]*>/i,
    `<meta name="description" content="${safeDescription}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\bname=["']robots["'][^>]*>/i,
    `<meta name="robots" content="noindex,follow,noarchive">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<link\b[^>]*\brel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${geneUrl}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/i,
    `<meta property="og:url" content="${geneUrl}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/i,
    `<meta name="twitter:url" content="${geneUrl}">`,
  )
  return next.replace(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi,
    "",
  )
}

function resolveStaticSiteOrigin(hostname) {
  const host = String(hostname || "").toLowerCase()
  if (
    host === "staging.brinedew.bio" ||
    host.endsWith(".workers.dev") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0"
  ) {
    return STATIC_SITE_ORIGIN_STAGING
  }
  return STATIC_SITE_ORIGIN_PROD
}

function buildStaticSiteUrl(url, pathOverride = null) {
  const targetPath = pathOverride ?? url.pathname
  const upstreamUrl = new URL(targetPath, resolveStaticSiteOrigin(url.hostname))
  upstreamUrl.search = url.search
  return upstreamUrl
}

function canonicalGeneguessrSubdomainPath(pathname) {
  if (
    pathname === "/apps/geneguessr" ||
    pathname === "/apps/geneguessr/" ||
    pathname === "/apps/geneguessr/index" ||
    pathname === "/apps/geneguessr/index/"
  ) {
    return "/"
  }

  if (pathname === "/apps/geneguessr/privacy" || pathname === "/apps/geneguessr/privacy/") {
    return "/privacy"
  }

  return ""
}

function redirectToGeneguessrCanonicalHost(url, targetPath) {
  const targetUrl = new URL(`https://${GENEGUESSR_HOST}${targetPath}`)
  targetUrl.search = url.search
  return Response.redirect(targetUrl.toString(), 301)
}

// Similarity configuration
// SIMILARITY_MODE: 'legacy' (HiG2Vec only), 'blended' (HiG2Vec + ESM2)
// ESM2_WEIGHT: 0-1, how much to weight ESM2 structural similarity (0.5 = equal blend)
const SIMILARITY_MODE = "blended"
const ESM2_WEIGHT = 0.25

// Import auth handlers
import {
  getDiscordAuthConfigStatus,
  handleLogin,
  handleCallback,
  handleMe,
  handleLogout,
} from "./auth.js"
// Import Iconoplasm stateful handlers
import {
  isIconoplasmRequest,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  IconoplasmVoteCoordinator,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  IconoplasmSyncGovernor,
  handleIconoplasmQueue,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { handleRequestAtTheOnlyAllowedStatefulWorkerForBenchmarkDoNotDuplicate } from "./benchmark/the-only-allowed-benchmark-stateful-runtime-do-not-duplicate.js"

export { IconoplasmVoteCoordinator }
export { IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate }
export { IconoplasmSyncGovernor }
// Import Discord bot handlers
import {
  handleDailySummary,
  handleInteractions,
  handleMarkPosted,
  handlePostDailyRecap,
  handlePostRecap,
  handleRenderPage,
} from "./discord.js"
import { handleContactSubmission } from "./contact-form.js"
import { handlePostDailyFeed, handlePostFeed } from "./discord-feed.js"
// Import stats handlers
import {
  handleMigrateStats,
  handleGetStats,
  handleUpdateStats,
  handleGetLeaderboard,
  handleSetLeaderboardVisibility,
} from "./stats.js"
// Import admin handlers
import {
  handleOverrideProtein,
  handleFeatureFlags,
  handleAdminStatus,
  handleDeleteOverride,
  handleAdminDiscordRecapImageUpload,
  handleAdminDiscordRecapImageStatus,
  handleAdminDiscordRecapImageStatuses,
  handleGraphicsSettings,
  DEFAULT_GRAPHICS_SETTINGS,
  normalizeGraphicsSettings,
  handleAdminSchedule,
  handleAdminCards,
  handleAdminGuessStats,
  handleAdminGuessAnalytics,
  handleAdminSimilarity,
  isAdmin,
} from "./admin.js"
// Import admin HTML
import { ADMIN_HTML } from "./admin-html.js"
import { ADMIN_V2_HTML } from "./admin-v2-html.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import {
  DEFAULT_HINT_COST,
  HINT_REWARD_ON_INCORRECT,
  MAX_GUESSES,
  cleanGeneSummary,
  buildClueSections,
  buildFeedbackSections,
  getDomainSpoilerTokensFromFullName,
  collectMatchedHintTexts,
  extractHintData,
  maskClueSections,
  sanitizeTargetProtein,
  scoreGuess,
} from "./lib/game-engine.js"
import {
  fetchProteinByUniprot,
  searchProteins,
  getEligibleProteinIds,
  pickDailyTarget,
  pickRandomProteinBalanced,
  getBlendedSimilarity,
  getHig2vecSimilarity,
  markStructureFailure,
  clearStructureFailure,
} from "./lib/protein-store.js"
import {
  resolveStructureRepresentation,
  buildStructureMetaFromStoredSource,
} from "./lib/structure-utils.js"
import { recordDailyGuessAggregates } from "./lib/guess-aggregates.js"
import { withObservedGameSessionWrite } from "./lib/game-session-write-evidence.js"
import { getMolstarSharedSource } from "./lib/molstar-shared-bundle.js"
import { extractAvatarUpstreamFromRequest } from "./lib/avatar-proxy.js"

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
}

// Hard-path rationale:
// Mol* uses dynamic evaluation/WASM bootstrap patterns that require `unsafe-eval`
// and `data:`/`blob:` fetches. We intentionally scope that CSP relaxation to the
// smallest GeneGuessr surface instead of weakening CSP for the whole site.
function shouldAllowUnsafeEval(url) {
  const host = String(url?.hostname || "").toLowerCase()
  const path = String(url?.pathname || "")
  if (host === GENEGUESSR_HOST && path === "/") {
    return true
  }
  if (path.startsWith("/static/geneguessr/") || path.startsWith("/static/vendor/pdbe-molstar@")) {
    return true
  }
  // Admin panel also loads Mol* for protein preview
  if (path === "/admin" || path === "/admin-v2") {
    return true
  }
  return (
    path === "/apps/geneguessr" ||
    path === "/apps/geneguessr/" ||
    path === "/apps/geneguessr/index" ||
    path === "/apps/geneguessr/index/" ||
    path === "/apps/geneguessr/render"
  )
}

function shouldAllowIconoplasmShoelaceDataIcons(url) {
  const host = String(url?.hostname || "").toLowerCase()
  const path = String(url?.pathname || "")
  // Shoelace's bundled system icon library resolves checkbox/select/dialog icons
  // as data: SVG URLs and then fetches them. Scope that connect-src exception to
  // Iconoplasm surfaces instead of weakening the shared site CSP.
  if (host === ICONOPLASM_HOST) {
    return true
  }
  return path === "/apps/iconoplasm" || path.startsWith("/apps/iconoplasm/")
}

function isSiteSettingsBridgeRequest(request) {
  try {
    const reqUrl = new URL(request.url)
    return reqUrl.pathname === "/static/site-preferences/bridge.html"
  } catch {
    return false
  }
}

function buildContentSecurityPolicy(request) {
  let allowUnsafeEval = false
  try {
    allowUnsafeEval = shouldAllowUnsafeEval(new URL(request.url))
  } catch {
    allowUnsafeEval = false
  }

  const scriptSrc = allowUnsafeEval
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://static.cloudflareinsights.com"
    : "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://static.cloudflareinsights.com"
  const allowIconoplasmShoelaceDataIcons = (() => {
    try {
      return shouldAllowIconoplasmShoelaceDataIcons(new URL(request.url))
    } catch {
      return false
    }
  })()
  const connectSrc = allowUnsafeEval
    ? "connect-src 'self' data: blob: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
    : allowIconoplasmShoelaceDataIcons
      ? "connect-src 'self' data: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
      : "connect-src 'self' https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
  const frameAncestors = isSiteSettingsBridgeRequest(request)
    ? "frame-ancestors https://brinedew.bio https://*.brinedew.bio"
    : "frame-ancestors 'none'"
  const frameSrc = isSiteSettingsBridgeRequest(request)
    ? "frame-src 'self' https://brinedew.bio https://*.brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com"
    : "frame-src 'self' https://brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com"

  return `default-src 'self'; base-uri 'self'; object-src 'none'; ${frameAncestors}; img-src 'self' data: blob: https://cdn.discordapp.com https://iconoplasmportraits.b-cdn.net; font-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; ${connectSrc}; ${frameSrc}; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests`
}

function crossOriginResourcePolicyForRequest(request) {
  try {
    const reqUrl = new URL(request.url)
    if (reqUrl.hostname === ICONOPLASM_HOST && reqUrl.pathname.startsWith("/portraits/")) {
      return "cross-origin"
    }
  } catch {
    // Ignore malformed request URLs and fall back to the default site-wide policy.
  }
  return SECURITY_HEADERS["Cross-Origin-Resource-Policy"]
}

const STRIP_RESPONSE_HEADERS = [
  "x-powered-by",
  "x-github-request-id",
  "x-proxy-cache",
  "x-served-by",
  "x-cache",
  "x-cache-hits",
  "x-timer",
  "x-fastly-request-id",
  "via",
]

function cloneHeadersPreservingCookies(sourceHeaders) {
  const headers = new Headers()
  for (const [name, value] of sourceHeaders.entries()) {
    if (name.toLowerCase() === "set-cookie") continue
    headers.append(name, value)
  }
  if (typeof sourceHeaders.getSetCookie === "function") {
    const cookies = sourceHeaders.getSetCookie()
    for (const cookie of cookies) {
      headers.append("Set-Cookie", cookie)
    }
  } else {
    const cookie = sourceHeaders.get("set-cookie")
    if (cookie) headers.append("Set-Cookie", cookie)
  }
  return headers
}

function appendCacheControlDirective(cacheControl, directive) {
  const existing = String(cacheControl || "").trim()
  const normalizedDirective = String(directive || "")
    .trim()
    .toLowerCase()
  if (!existing) return directive
  const hasDirective = existing
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(normalizedDirective)
  return hasDirective ? existing : `${existing}, ${directive}`
}

function removeCacheControlDirective(cacheControl, directive) {
  const existing = String(cacheControl || "").trim()
  const normalizedDirective = String(directive || "")
    .trim()
    .toLowerCase()
  if (!existing) return existing
  return existing
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase() !== normalizedDirective)
    .join(", ")
}

function isProductionBrinedewHtmlHost(hostname) {
  const host = String(hostname || "").toLowerCase()
  return (
    host === "brinedew.bio" ||
    host === "www.brinedew.bio" ||
    host === "iconoplasm.brinedew.bio" ||
    host === "geneguessr.brinedew.bio"
  )
}

function requestHasAnalyticsConsent(request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  return cookies.brinedew_analytics_consent === "accepted"
}

function enforceNoTransformForHtml(headers, request) {
  const contentType = String(headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("text/html")) {
    return
  }
  const host = (() => {
    try {
      return new URL(request.url).hostname.toLowerCase()
    } catch {
      return ""
    }
  })()
  if (
    isProductionBrinedewHtmlHost(host) &&
    (!requestRequiresAnalyticsConsent(request) || requestHasAnalyticsConsent(request))
  ) {
    const updated = removeCacheControlDirective(headers.get("cache-control"), "no-transform")
    if (updated) headers.set("Cache-Control", updated)
    else headers.delete("Cache-Control")
    return
  }
  // Hard-path rationale:
  // Cloudflare Web Analytics automatic setup mutates HTML by injecting its beacon.
  // Keep that transform blocked unless the visitor has explicitly opted in. This
  // gives EU visitors analytics coverage after consent without tracking anyone on
  // the first page load or relying on a client-only race.
  const updated = appendCacheControlDirective(headers.get("cache-control"), "no-transform")
  headers.set("Cache-Control", updated)
}

function applySecurityHeaders(response, request) {
  const headers = cloneHeadersPreservingCookies(response.headers)
  for (const name of STRIP_RESPONSE_HEADERS) {
    headers.delete(name)
  }
  enforceNoTransformForHtml(headers, request)
  headers.set("Content-Security-Policy", buildContentSecurityPolicy(request))
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  if (isSiteSettingsBridgeRequest(request)) {
    headers.delete("X-Frame-Options")
  }
  headers.set("Cross-Origin-Resource-Policy", crossOriginResourcePolicyForRequest(request))
  try {
    const reqUrl = new URL(request.url)
    if (reqUrl.protocol === "https:") {
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    }
  } catch {
    // Ignore malformed request URL.
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isStagingOrDevHost(hostname) {
  const host = String(hostname || "").toLowerCase()
  return (
    host.endsWith(".workers.dev") ||
    host.endsWith(".pages.dev") ||
    host === "staging.brinedew.bio" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0"
  )
}

function isHealthCheckAuthorized(request, env, url) {
  if (isStagingOrDevHost(url.hostname)) return true
  const token = String(env?.HEALTHCHECK_TOKEN || "").trim()
  if (!token) return false
  const headerToken = String(request.headers.get("X-Health-Token") || "").trim()
  const authHeader = String(request.headers.get("Authorization") || "").trim()
  return headerToken === token || authHeader === `Bearer ${token}`
}

function isDraftHtmlDocument(html) {
  const source = String(html || "")
  return (
    /\bdata-page-draft=["']true["']/i.test(source) ||
    /<article\b[^>]*\bdata-draft=["']true["']/i.test(source)
  )
}

function draftNotFoundResponse(method) {
  return new Response(method === "HEAD" ? null : "Not found", { status: 404 })
}

async function getUserAccessLevel(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const sessionId = cookies.session
  if (!sessionId) return 1

  try {
    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    const session = await resp.json()
    if (!session || !session.user_id) return 1
    if (Date.now() > session.expires_at) return 1

    const adminUserId = String(env.ADMIN_DISCORD_USER_ID || "").trim()
    if (adminUserId.length > 0 && session.user_id === adminUserId) return 4
    if (session.is_guild_member) return 3
    return 2
  } catch {
    return 1
  }
}

function truncateDraftHtml(html, request) {
  if (/data-truncated=["']/i.test(html)) return html

  const articleMatch = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)
  if (!articleMatch) return html

  const fullArticle = articleMatch[0]
  const closeTag = "</article>"
  const articleContent = fullArticle.slice(0, -closeTag.length)

  // Strip .draft-locked content entirely from the HTML served to low-access users.
  // This prevents locked text from being in the source even though CSS hides it.
  let cleanedContent = articleContent.replace(
    /<div\b[^>]*class="[^"]*draft-locked[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  )

  // Also strip the draft-cta article (it will be re-added by the template)
  cleanedContent = cleanedContent.replace(
    /<article\b[^>]*id="draft-cta"[^>]*>[\s\S]*?<\/article>/gi,
    "",
  )

  // Try to find first <hr> at top level (not inside tables/blockquotes/figures)
  let hrIdx = -1
  let depth = 0
  const skipTags = /^<\/(td|th|table|tr|blockquote|figure|details)>/i
  const enterTags = /^<(td|th|table|tr|blockquote|figure|details)\b/i
  for (let i = 0; i < cleanedContent.length; i++) {
    if (cleanedContent[i] !== "<") continue
    const tagEnd = cleanedContent.indexOf(">", i)
    if (tagEnd < 0) continue
    const tag = cleanedContent.substring(i, tagEnd + 1)
    if (skipTags.test(tag)) depth--
    else if (enterTags.test(tag)) depth++
    else if (/^<hr\b/i.test(tag) && depth === 0) {
      hrIdx = i
      break
    }
    i = tagEnd
  }

  if (hrIdx >= 0) {
    const preview = cleanedContent.substring(0, hrIdx)
    return html.replace(fullArticle, preview + closeTag + '<div data-truncated="true"></div>')
  }

  // 100-word fallback: count words only from cleaned (non-locked) content
  const textOnly = cleanedContent.replace(/<[^>]+>/g, " ")
  const words = textOnly.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  if (words.length <= 100) {
    return html.replace(fullArticle, cleanedContent + closeTag)
  }

  // Find table position
  const tableStart = cleanedContent.match(/<(table|div class="table-container")/i)

  // 100-word truncation
  let wordCount = 0
  let inTag = false
  let truncIdx = -1
  for (let i = 0; i < cleanedContent.length; i++) {
    const ch = cleanedContent[i]
    if (ch === "<") inTag = true
    else if (ch === ">") {
      inTag = false
      continue
    }
    if (inTag) continue
    if (ch === " " && i > 0 && cleanedContent[i - 1] !== ">" && cleanedContent[i + 1] !== "<") {
      wordCount++
      if (wordCount >= 100) {
        truncIdx = i
        break
      }
    }
  }
  if (truncIdx < 0) {
    return html.replace(fullArticle, cleanedContent + closeTag)
  }
  // If truncation point lands inside/after a table, back up to before the table
  if (tableStart && tableStart.index > 0 && tableStart.index <= truncIdx) {
    const preview = cleanedContent.substring(0, tableStart.index).trim()
    if (preview.length > 0) {
      return html.replace(fullArticle, preview + closeTag + '<div data-truncated="true"></div>')
    }
    return html.replace(fullArticle, cleanedContent + closeTag)
  }
  const preview = cleanedContent.substring(0, truncIdx)
  return html.replace(fullArticle, preview + closeTag + '<div data-truncated="true"></div>')
}

export async function handleRequestAtTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx,
) {
  const url = new URL(request.url)
  console.log(`[WORKER] Incoming: ${request.method} ${url.pathname}`)
  const origin = request.headers.get("Origin") || ""
  const corsHeaders = getCorsHeaders(origin, url.hostname)
  const routeRequest = async () => {
    if (url.hostname === BENCHMARK_HOST) {
      return handleRequestAtTheOnlyAllowedStatefulWorkerForBenchmarkDoNotDuplicate(request, env)
    }

    if (url.hostname === "www.brinedew.bio") {
      const canonicalUrl = new URL(url)
      canonicalUrl.host = "brinedew.bio"
      return Response.redirect(
        canonicalUrl.toString(),
        request.method === "GET" || request.method === "HEAD" ? 301 : 308,
      )
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/apps/iconoplasm" ||
        url.pathname === "/apps/iconoplasm/" ||
        url.pathname === "/apps/iconoplasm/index" ||
        url.pathname === "/apps/iconoplasm/index/")
    ) {
      return Response.redirect(`https://${ICONOPLASM_HOST}/`, 301)
    }

    // Serve the shared Mol* initializer from the Worker so staging (workers.dev) can load it.
    // Production can still proxy /static/* from the Quartz site, but this keeps staging self-contained.
    if (
      url.pathname === "/static/geneguessr/molstar-shared.js" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return new Response(request.method === "HEAD" ? null : getMolstarSharedSource(), {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          // Keep this easy to update after deploys; avoid sticky CDN/browser caching of the initializer.
          "Cache-Control": "no-cache, max-age=0",
        },
      })
    }

    // Proxy Mol* assets through the Worker so worker-served pages do not depend on the client being
    // able to reach jsDelivr directly (helps CI screenshots and restrictive networks).
    if (request.method === "GET" || request.method === "HEAD") {
      const allowedPrefix = MOLSTAR_VENDOR_ALLOWED_PREFIXES.find((prefix) =>
        url.pathname.startsWith(prefix),
      )
      if (allowedPrefix) {
        const upstream = `https://cdn.jsdelivr.net/npm${url.pathname.replace("/static/vendor", "")}`
        const upstreamResp = await fetch(upstream, {
          cf: {
            cacheEverything: true,
            cacheTtl: 86400,
          },
        })
        const headers = new Headers(upstreamResp.headers)
        headers.set("Cache-Control", "public, max-age=86400")
        return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
          status: upstreamResp.status,
          headers,
        })
      }
    }

    // Serve KaTeX assets from same-origin vendor paths.
    // Hard-path rationale:
    // We rewrite stale upstream HTML from jsDelivr URLs to `/static/vendor/katex/*` to keep CSP strict.
    // Some upstream builds don't yet contain those local files, so the worker must backfill them.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.startsWith(KATEX_VENDOR_PREFIX)
    ) {
      const relativePath = url.pathname.slice(KATEX_VENDOR_PREFIX.length)
      const normalized = relativePath.replace(/^\/+/, "")
      if (normalized.length === 0) {
        return new Response("Not found", { status: 404 })
      }
      const upstream = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VENDOR_VERSION}/dist/${normalized}`
      const upstreamResp = await fetch(upstream, {
        cf: {
          cacheEverything: true,
          cacheTtl: 86400,
        },
      })
      const headers = new Headers(upstreamResp.headers)
      headers.set("Cache-Control", "public, max-age=86400")
      return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers,
      })
    }

    // Serve host-scoped robots/sitemap for the geneguessr subdomain.
    // This prevents Google Search Console from seeing a sitemap full of brinedew.bio URLs.
    if (
      url.hostname === GENEGUESSR_HOST &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (url.pathname === "/robots.txt") {
        return new Response(
          request.method === "HEAD" ? null : buildGeneguessrSubdomainRobotsTxt(),
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "max-age=600",
            },
          },
        )
      }

      if (url.pathname === "/sitemap.xml") {
        return new Response(
          request.method === "HEAD" ? null : buildGeneguessrSubdomainSitemapXml(),
          {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "max-age=600",
            },
          },
        )
      }

      if (url.pathname === "/llms.txt") {
        return new Response(request.method === "HEAD" ? null : buildGeneguessrSubdomainLlmsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "max-age=600",
          },
        })
      }
    }

    // Discord render page for screenshots - served by worker, not proxied
    if (url.pathname === "/apps/geneguessr/render" && request.method === "GET") {
      return handleRenderPage(request, env)
    }

    // Shared platform route: avatar proxy belongs to the common shell, not any single app router.
    // Handle it before host-based dispatch so every Brinedew app resolves avatars through one path
    // instead of re-implementing the same proxy inside each app-specific API surface.
    if (url.pathname === "/api/avatar" && (request.method === "GET" || request.method === "HEAD")) {
      const upstreamUrl = extractAvatarUpstreamFromRequest(url)
      if (!upstreamUrl) {
        return Response.json({ error: "Invalid avatar URL" }, { status: 400, headers: corsHeaders })
      }
      const upstreamResp = await fetch(upstreamUrl, {
        cf: {
          cacheEverything: true,
          cacheTtl: 86400,
        },
      })
      if (!upstreamResp.ok) {
        return Response.json({ error: "Avatar not found" }, { status: 404, headers: corsHeaders })
      }
      const headers = new Headers(corsHeaders)
      headers.set("Content-Type", upstreamResp.headers.get("Content-Type") || "image/png")
      headers.set("Cache-Control", "public, max-age=86400")
      return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
        status: upstreamResp.status,
        headers,
      })
    }

    // Shared platform route: auth is a site-wide concern (cookie domain = .brinedew.bio),
    // not a feature of any single subdomain. Handle it before host-based dispatch so every
    // Brinedew app can initiate and complete the Discord OAuth flow through one code path.
    if (url.pathname.startsWith("/api/auth/")) {
      if (url.pathname === "/api/auth/login" && request.method === "GET") {
        return handleLogin(request, env)
      }
      if (url.pathname === "/api/auth/config" && request.method === "GET") {
        if (!(await isAdmin(request, env))) {
          return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders })
        }
        return Response.json(getDiscordAuthConfigStatus(env), { headers: corsHeaders })
      }
      if (url.pathname === "/api/auth/callback" && request.method === "GET") {
        return handleCallback(request, env)
      }
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const response = await handleMe(request, env)
        return new Response(response.body, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
        })
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const response = await handleLogout(request, env)
        return new Response(response.body, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
        })
      }
    }

    // Site-wide contact form (brinedew.bio/About). Lives next to /api/auth/*
    // because both are platform-level concerns that don't belong to any single
    // Brinedew app subdomain.
    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContactSubmission(request, env, ctx, corsHeaders)
    }

    // The live settings page runs on brinedew.bio and probes Iconoplasm admin state via
    // same-origin /api/iconoplasm/* requests. Route those to the Iconoplasm caller worker no
    // matter which Brinedew host receives them, otherwise apex settings fetches fall through
    // to a generic 404 despite the endpoint existing in the caller boundary module.
    if (
      (url.pathname === "/api/iconoplasm" || url.pathname.startsWith("/api/iconoplasm/")) &&
      request.method !== "OPTIONS"
    ) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        env,
        ctx,
      )
    }

    // Portrait binaries must resolve even after service-binding hops or route
    // reassignment, so do not make them depend on the incoming hostname still
    // looking like iconoplasm.brinedew.bio.
    if (url.pathname.startsWith("/portraits/")) {
      const key = url.pathname.replace(/^\/+/, "")
      const object = await env.ICONOPLASM_PORTRAITS?.get?.(key)
      if (object) {
        return new Response(request.method === "HEAD" ? null : object.body, {
          status: 200,
          headers: {
            "Content-Type": object.httpMetadata?.contentType || "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
            ETag: `"${object.httpEtag || key}"`,
            "Access-Control-Allow-Origin": "*",
          },
        })
      }
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        env,
        ctx,
      )
    }

    // Iconoplasm subdomain: proxy non-API requests through Pages (same pattern as geneguessr),
    // delegate API/portrait/admin to the iconoplasm handler.
    if (isIconoplasmRequest(url.hostname)) {
      if (url.pathname === "/admin/iconoplasm" || url.pathname === "/admin/iconoplasm/") {
        return Response.redirect("https://brinedew.bio/admin/iconoplasm#costs", 302)
      }

      const isApiOrWorker =
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/portraits/") ||
        url.pathname === "/admin" ||
        url.pathname === "/blocklist" ||
        url.pathname === "/blocklist/" ||
        url.pathname === "/artist-styles" ||
        url.pathname === "/artist-styles/" ||
        url.pathname === "/health"

      if (isApiOrWorker) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          env,
          ctx,
        )
      }

      // Host-scoped crawler files. Do not proxy these from the generic Pages build:
      // Iconoplasm needs its own sitemap and LLM map, and gene-card routes are
      // intentionally excluded until they have standalone explanatory content.
      if (request.method === "GET" || request.method === "HEAD") {
        if (url.pathname === "/robots.txt") {
          return new Response(
            request.method === "HEAD" ? null : buildIconoplasmSubdomainRobotsTxt(),
            {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "max-age=600",
              },
            },
          )
        }

        if (url.pathname === "/sitemap.xml") {
          return new Response(
            request.method === "HEAD" ? null : buildIconoplasmSubdomainSitemapXml(),
            {
              headers: {
                "Content-Type": "application/xml; charset=utf-8",
                "Cache-Control": "max-age=600",
              },
            },
          )
        }

        if (url.pathname === "/llms.txt") {
          return new Response(
            request.method === "HEAD" ? null : buildIconoplasmSubdomainLlmsTxt(),
            {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "max-age=600",
              },
            },
          )
        }
      }

      // Versioned iconoplasm static assets: extend cache aggressively
      if (
        url.pathname.startsWith("/static/iconoplasm/") &&
        url.searchParams.has("v") &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const assetUrl = buildStaticSiteUrl(url)
        const assetResp = await fetch(assetUrl.toString(), {
          method: request.method,
          headers: request.headers,
        })
        const headers = new Headers(assetResp.headers)
        headers.set("Cache-Control", "public, max-age=31536000, immutable")
        return new Response(request.method === "HEAD" ? null : assetResp.body, {
          status: assetResp.status,
          statusText: assetResp.statusText,
          headers,
        })
      }

      // For other static assets (CSS, JS, fonts, Quartz runtime files), proxy directly from Pages
      if (
        url.pathname.startsWith("/static/") ||
        url.pathname === "/index.css" ||
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".json") ||
        url.pathname.endsWith(".css") ||
        url.pathname.endsWith(".woff2") ||
        url.pathname.endsWith(".png") ||
        url.pathname.endsWith(".svg") ||
        url.pathname.endsWith(".ico") ||
        url.pathname.endsWith(".xml")
      ) {
        const assetUrl = buildStaticSiteUrl(url)
        const assetResp = await fetch(assetUrl.toString(), {
          method: request.method,
          headers: request.headers,
        })
        const assetHeaders = new Headers(assetResp.headers)
        // Versioned CSS/JS/fonts are immutable — cache aggressively to avoid SPA flash
        if (url.searchParams.has("v")) {
          assetHeaders.set("Cache-Control", "public, max-age=31536000, immutable")
        }
        return new Response(request.method === "HEAD" ? null : assetResp.body, {
          status: assetResp.status,
          statusText: assetResp.statusText,
          headers: assetHeaders,
        })
      }

      // Privacy policy: serve the actual Hugo page, not the SPA shell.
      // CWS requires a privacy policy URL; this serves content/apps/iconoplasm/privacy.md.
      if (request.method === "GET" || request.method === "HEAD") {
        if (url.pathname === "/privacy/") {
          return Response.redirect(`https://${ICONOPLASM_HOST}/privacy`, 301)
        }
        if (
          url.pathname === "/apps/iconoplasm/privacy" ||
          url.pathname === "/apps/iconoplasm/privacy/"
        ) {
          return Response.redirect(`https://${ICONOPLASM_HOST}/privacy`, 301)
        }
        if (url.pathname === "/privacy") {
          const privacyUrl = buildStaticSiteUrl(url, "/apps/iconoplasm/privacy")
          const privacyResp = await fetch(privacyUrl.toString(), {
            method: request.method,
            headers: request.headers,
          })
          if (privacyResp.headers.get("content-type")?.includes("text/html")) {
            let html = await privacyResp.text()
            if (isDraftHtmlDocument(html) && !(await isAdmin(request, env))) {
              return draftNotFoundResponse(request.method)
            }
            html = rewritePrivacyCanonicalMetadata(html, ICONOPLASM_HOST)
            return new Response(request.method === "HEAD" ? null : html, {
              status: privacyResp.status,
              statusText: privacyResp.statusText,
              headers: privacyResp.headers,
            })
          }
          return new Response(request.method === "HEAD" ? null : privacyResp.body, {
            status: privacyResp.status,
            statusText: privacyResp.statusText,
            headers: privacyResp.headers,
          })
        }
      }

      // All non-API, non-static routes serve the same Quartz HTML shell (client-side app handles routing).
      // For root, /gene/*, or any other path, fetch the iconoplasm content page from Pages.
      const targetPath = "/apps/iconoplasm/index"
      const targetUrl = buildStaticSiteUrl(url, targetPath)
      const canUseHtmlShellEdgeCache =
        (request.method === "GET" || request.method === "HEAD") &&
        typeof caches !== "undefined" &&
        caches.default
      const geneShellForHtmlCache =
        canUseHtmlShellEdgeCache &&
        request.method === "GET" &&
        String(url.pathname || "").startsWith("/gene/")
          ? await iconoplasmGeneCardBootstrapInjection(request, env, ctx, url.pathname)
          : null

      if (canUseHtmlShellEdgeCache) {
        const geneHtmlCacheKey = geneShellForHtmlCache?.snapshotVersion
          ? iconoplasmGeneHtmlCacheKey(url, url.pathname, geneShellForHtmlCache.snapshotVersion)
          : null
        if (geneHtmlCacheKey) {
          const cachedGeneHtml = await caches.default.match(geneHtmlCacheKey)
          if (cachedGeneHtml) {
            const headers = addIconoplasmGeneShellHeaders(cachedGeneHtml.headers, url.pathname)
            headers.set("Cache-Control", "no-store")
            headers.set("X-Iconoplasm-HTML-Shell-Cache", "HIT-GENE")
            return new Response(request.method === "HEAD" ? null : cachedGeneHtml.body, {
              status: cachedGeneHtml.status,
              statusText: cachedGeneHtml.statusText,
              headers,
            })
          }
        }
        const cachedShell = await caches.default.match(iconoplasmHtmlShellCacheKey(url))
        if (cachedShell) {
          const cachedHtml = request.method === "HEAD" ? "" : await cachedShell.text()
          return await iconoplasmCacheableHtmlShellResponse(
            cachedHtml,
            cachedShell,
            request,
            env,
            ctx,
            url.pathname,
            "HIT",
            geneShellForHtmlCache,
          )
        }
      }

      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      })

      // For HTML responses, rewrite links for subdomain context
      if (response.headers.get("content-type")?.includes("text/html")) {
        let html = await response.text()
        if (isDraftHtmlDocument(html) && !(await isAdmin(request, env))) {
          return draftNotFoundResponse(request.method)
        }
        // Rewrite site-brand/home links to main site
        html = html.replace(
          /<a\b[^>]*\bclass=["'][^"']*\bsite-brand\b[^"']*["'][^>]*>/gi,
          (tag) => {
            if (!/\bhref\s*=/i.test(tag)) return tag
            return tag.replace(/\bhref=["'][^"']*["']/i, 'href="https://brinedew.bio/"')
          },
        )
        // Rewrite internal navigation links to main domain
        html = html.replace(
          /href=["']\/(tags|posts|wiki|About|index)([^"']*)["']/g,
          'href="https://brinedew.bio/$1$2"',
        )
        // Update OG metadata for subdomain
        if (url.pathname === "/" || url.pathname === "") {
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/gi,
            `<meta property="og:url" content="https://${ICONOPLASM_HOST}/">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/gi,
            `<meta name="twitter:url" content="https://${ICONOPLASM_HOST}/">`,
          )
        }
        html = html.replace(
          /<meta\b[^>]*\b(?:property|name)=["']twitter:domain["'][^>]*>/gi,
          `<meta name="twitter:domain" content="${ICONOPLASM_HOST}">`,
        )
        // Normalize KaTeX CDN URLs to self-hosted assets
        html = html.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"']+\/dist\/katex\.min\.css/gi,
          `/static/vendor/katex/katex.min.css?v=${KATEX_VENDOR_VERSION}`,
        )
        html = html.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"']+\/dist\/contrib\/copy-tex\.min\.js/gi,
          `/static/vendor/katex/contrib/copy-tex.min.js?v=${KATEX_VENDOR_VERSION}`,
        )
        html = html.replace(
          /<link\b[^>]*rel=["']preconnect["'][^>]*href=["']https:\/\/cdn\.jsdelivr\.net["'][^>]*>/gi,
          "",
        )
        if (canUseHtmlShellEdgeCache && request.method === "GET" && response.ok) {
          const cacheHeaders = new Headers(response.headers)
          cacheHeaders.set(
            "Cache-Control",
            `public, max-age=0, s-maxage=${ICONOPLASM_HTML_SHELL_EDGE_CACHE_TTL_SECONDS}`,
          )
          cacheHeaders.set("X-Iconoplasm-HTML-Shell-Cache", "STORED")
          ctx?.waitUntil(
            caches.default.put(
              iconoplasmHtmlShellCacheKey(url),
              new Response(html, {
                status: response.status,
                statusText: response.statusText,
                headers: cacheHeaders,
              }),
            ),
          )
        }
        return await iconoplasmCacheableHtmlShellResponse(
          html,
          response,
          request,
          env,
          ctx,
          url.pathname,
          "MISS",
          geneShellForHtmlCache,
        )
      }

      return response
    }

    // Route all non-API apex requests through the worker so we can enforce
    // consistent security headers for the static site.
    if (
      (url.hostname === "brinedew.bio" || url.hostname === "www.brinedew.bio") &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/admin" &&
      url.pathname !== "/admin/iconoplasm" &&
      url.pathname !== "/admin/iconoplasm/" &&
      url.pathname !== "/admin-v2"
    ) {
      if (request.method === "GET" || request.method === "HEAD") {
        const geneguessrCanonicalPath = canonicalGeneguessrSubdomainPath(url.pathname)
        if (geneguessrCanonicalPath) {
          return redirectToGeneguessrCanonicalHost(url, geneguessrCanonicalPath)
        }
      }

      if (request.method === "GET" || request.method === "HEAD") {
        if (url.pathname === "/posts" || url.pathname === "/posts/") {
          return Response.redirect("https://brinedew.bio/tags/content/post", 301)
        }
        if (url.pathname === "/wiki" || url.pathname === "/wiki/") {
          return Response.redirect("https://brinedew.bio/tags/content/wiki", 301)
        }
        if (url.pathname === "/settings" || url.pathname === "/settings/") {
          return Response.redirect(`${url.origin}/settings/index`, 301)
        }
      }

      const upstreamUrl = buildStaticSiteUrl(url)
      const upstreamResp = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        cf: { cacheEverything: false, cacheTtl: 0 },
      })
      const contentType = String(upstreamResp.headers.get("content-type") || "").toLowerCase()
      if (contentType.includes("text/html")) {
        let html = await upstreamResp.text()
        const responseHeaders = new Headers(upstreamResp.headers)
        if (isDraftHtmlDocument(html)) {
          const level = await getUserAccessLevel(request, env)
          if (level < 3) {
            html = truncateDraftHtml(html, request)
            responseHeaders.set("Cache-Control", "public, max-age=3600")
          } else {
            responseHeaders.set("Cache-Control", "private, no-cache, no-store")
          }
        }
        html = injectAnalyticsConsentBootstrap(html, request)
        return new Response(request.method === "HEAD" ? null : html, {
          status: upstreamResp.status,
          statusText: upstreamResp.statusText,
          headers: responseHeaders,
        })
      }
      const nonHtmlHeaders = new Headers(upstreamResp.headers)
      // Static assets should be cached aggressively to prevent SPA re-fetch white flash
      if (url.searchParams.has("v") || url.pathname.match(/\.(woff2|woff|ttf|otf|eot)$/)) {
        nonHtmlHeaders.set("Cache-Control", "public, max-age=31536000, immutable")
      }
      return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: nonHtmlHeaders,
      })
    }

    // Handle geneguessr subdomain proxy - proxy NON-API, NON-ADMIN requests from subdomain to main site
    // NOTE: /admin and /admin-v2 are served by the Worker and must NOT be proxied.
    if (
      url.hostname === GENEGUESSR_HOST &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/admin" &&
      url.pathname !== "/admin-v2"
    ) {
      // Avoid duplicate content at multiple paths on the subdomain.
      // Keep the canonical entrypoint at `/` and normalize a few common variants.
      if (request.method === "GET" || request.method === "HEAD") {
        if (
          url.pathname === "/apps/geneguessr" ||
          url.pathname === "/apps/geneguessr/" ||
          url.pathname === "/apps/geneguessr/index" ||
          url.pathname === "/apps/geneguessr/index/"
        ) {
          return Response.redirect(`https://${GENEGUESSR_HOST}/`, 301)
        }

        if (url.pathname === "/privacy/") {
          return Response.redirect(`https://${GENEGUESSR_HOST}/privacy`, 301)
        }

        if (
          url.pathname === "/apps/geneguessr/privacy" ||
          url.pathname === "/apps/geneguessr/privacy/"
        ) {
          return Response.redirect(`https://${GENEGUESSR_HOST}/privacy`, 301)
        }
      }

      // For root path, fetch the geneguessr app page
      let targetPath =
        url.pathname === "/"
          ? "/apps/geneguessr/index"
          : url.pathname === "/privacy"
            ? "/apps/geneguessr/privacy"
            : url.pathname

      const targetUrl = buildStaticSiteUrl(url, targetPath)

      // GeneGuessr bundle hotfix removed:
      // The app bundle now avoids global `const` redeclarations, so we can serve it directly and allow caching.

      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      })

      // For versioned GeneGuessr static assets, extend cache lifetime aggressively.
      // The upstream build emits `?v=<timestamp>` for cache busting, so `immutable` is safe here.
      if (
        url.pathname.startsWith("/static/geneguessr/") &&
        url.searchParams.has("v") &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const headers = new Headers(response.headers)
        headers.set("Cache-Control", "public, max-age=31536000, immutable")
        return new Response(request.method === "HEAD" ? null : response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      // For HTML, rewrite links so navigation goes to main site, not subdomain
      if (response.headers.get("content-type")?.includes("text/html")) {
        let html = await response.text()
        if (isDraftHtmlDocument(html) && !(await isAdmin(request, env))) {
          return draftNotFoundResponse(request.method)
        }
        // Rewrite site-brand/home links to absolute main site URL.
        // Quartz renders: <a href={baseDir} class="site-brand"> where baseDir may be "/" or "../..".
        // If left relative on the subdomain, client-side navigation can re-inject scripts and
        // cause reload-time errors (e.g., redeclared top-level consts in app bundles).
        html = html.replace(
          /<a\b[^>]*\bclass=["'][^"']*\bsite-brand\b[^"']*["'][^>]*>/gi,
          (tag) => {
            if (!/\bhref\s*=/i.test(tag)) {
              return tag
            }
            return tag.replace(/\bhref=["'][^"']*["']/i, 'href="https://brinedew.bio/"')
          },
        )

        // Rewrite all internal navigation links to point to main domain
        // This prevents SPA navigation on the subdomain from going to wrong paths
        // Match href="/tags/...", href="/posts/...", href="/wiki/...", etc.
        html = html.replace(
          /href=["']\/(tags|posts|wiki|About|index)([^"']*)["']/g,
          'href="https://brinedew.bio/$1$2"',
        )

        // Keep share/debug metadata consistent with the subdomain host.
        if (url.pathname === "/") {
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/gi,
            `<meta property="og:url" content="https://${GENEGUESSR_HOST}/">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/gi,
            `<meta name="twitter:url" content="https://${GENEGUESSR_HOST}/">`,
          )
          // Use GeneGuessr-specific og:image for Discord/social embeds
          const geneGuessrOgImage = "https://brinedew.bio/static/geneguessr/og-image.png"
          html = html.replace(
            /<meta\b[^>]*\b(?:property)=["']og:image["'][^>]*>/gi,
            `<meta property="og:image" content="${geneGuessrOgImage}">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:property)=["']og:image:url["'][^>]*>/gi,
            `<meta property="og:image:url" content="${geneGuessrOgImage}">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:name)=["']twitter:image["'][^>]*>/gi,
            `<meta name="twitter:image" content="${geneGuessrOgImage}">`,
          )
        }
        html = html.replace(
          /<meta\b[^>]*\b(?:property|name)=["']twitter:domain["'][^>]*>/gi,
          `<meta name="twitter:domain" content="${GENEGUESSR_HOST}">`,
        )
        if (url.pathname === "/privacy") {
          html = rewritePrivacyCanonicalMetadata(html, GENEGUESSR_HOST)
        }

        // Hard-path rationale:
        // Upstream static deploys can lag behind worker deploys. When stale HTML still references
        // jsDelivr KaTeX assets, strict CSP blocks them and math rendering regresses.
        // We normalize legacy CDN URLs to self-hosted vendored assets at the edge so behavior
        // stays stable without globally loosening CSP.
        html = html.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"']+\/dist\/katex\.min\.css/gi,
          `/static/vendor/katex/katex.min.css?v=${KATEX_VENDOR_VERSION}`,
        )
        html = html.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"']+\/dist\/contrib\/copy-tex\.min\.js/gi,
          `/static/vendor/katex/contrib/copy-tex.min.js?v=${KATEX_VENDOR_VERSION}`,
        )
        html = html.replace(
          /<link\b[^>]*rel=["']preconnect["'][^>]*href=["']https:\/\/cdn\.jsdelivr\.net["'][^>]*>/gi,
          "",
        )
        html = injectAnalyticsConsentBootstrap(html, request)
        return new Response(html, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }

      return response
    }

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      })
    }

    // Health check endpoint
    if (url.pathname === "/api/health") {
      if (!isHealthCheckAuthorized(request, env, url)) {
        return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders })
      }
      return Response.json(
        {
          status: "ok",
          timestamp: Date.now(),
          database: await checkD1Health(env.DB),
          kv: await checkKVHealth(env.KV),
          durableObjects: "configured",
        },
        {
          headers: corsHeaders,
        },
      )
    }

    // Normalize directory-style app path to include trailing slash.
    // This avoids edge/origin mismatches where a non-trailing-slash request
    // could resolve to an upstream origin that serves a 503/GitHub outage page.
    if (url.pathname === "/apps/geneguessr" && request.method === "GET") {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `${url.origin}/apps/geneguessr/`,
        },
      })
    }

    // Discord bot endpoints
    if (url.pathname === "/api/discord/daily-summary" && request.method === "GET") {
      return handleDailySummary(request, env)
    }

    if (url.pathname === "/api/discord/interactions" && request.method === "POST") {
      return handleInteractions(request, env)
    }

    if (url.pathname === "/api/discord/mark-posted" && request.method === "POST") {
      return handleMarkPosted(request, env)
    }

    if (url.pathname === "/api/discord/post-recap" && request.method === "POST") {
      return handlePostRecap(request, env)
    }

    if (url.pathname === "/api/discord/post-feed" && request.method === "POST") {
      return handlePostFeed(request, env)
    }

    // Stats endpoints
    if (url.pathname === "/api/migrate-stats" && request.method === "POST") {
      const response = await handleMigrateStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const response = await handleGetStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats/leaderboard" && request.method === "GET") {
      const response = await handleGetLeaderboard(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats/leaderboard-visibility" && request.method === "POST") {
      const response = await handleSetLeaderboardVisibility(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats/update" && request.method === "POST") {
      const response = await handleUpdateStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    // Admin panel UI (restricted to admin Discord session)
    if (url.pathname === "/admin" && request.method === "GET") {
      if (!(await isAdmin(request, env))) {
        return new Response("Unauthorized", { status: 403 })
      }
      return new Response(ADMIN_HTML, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
        },
      })
    }

    // Keep Iconoplasm operations on an apex-hosted admin route so the real GUI
    // uses the same working site-admin session and does not depend on subdomain
    // cookie quirks. This is intentionally separate from the general admin page:
    // cost graphs and image triage should not be entangled with unrelated controls.
    if (
      (url.pathname === "/admin/iconoplasm" || url.pathname === "/admin/iconoplasm/") &&
      request.method === "GET"
    ) {
      if (!(await isAdmin(request, env))) {
        return new Response("Unauthorized", { status: 403 })
      }
      return new Response(ICONOPLASM_ADMIN_HTML, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "no-store",
        },
      })
    }

    // Admin panel v2 - auto-generated controls from Mol* runtime
    if (url.pathname === "/admin-v2" && request.method === "GET") {
      if (!(await isAdmin(request, env))) {
        return new Response("Unauthorized", { status: 403 })
      }
      return new Response(ADMIN_V2_HTML, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
        },
      })
    }

    // Admin endpoints (protected by Cloudflare Access)
    if (url.pathname === "/api/admin/override-protein" && request.method === "POST") {
      const response = await handleOverrideProtein(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/override-protein" && request.method === "DELETE") {
      const response = await handleDeleteOverride(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/discord-recap-image" && request.method === "POST") {
      const response = await handleAdminDiscordRecapImageUpload(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/discord-recap-image" && request.method === "GET") {
      const response = await handleAdminDiscordRecapImageStatus(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/discord-recap-images" && request.method === "GET") {
      const response = await handleAdminDiscordRecapImageStatuses(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/feature-flags" && request.method === "POST") {
      const response = await handleFeatureFlags(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/graphics-settings" && request.method === "POST") {
      const response = await handleGraphicsSettings(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    // Graphics profiles for v2 admin panel - full Mol* props snapshots
    if (url.pathname === "/api/admin/graphics-profiles" && request.method === "GET") {
      if (!(await isAdmin(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 403, headers: corsHeaders })
      }
      const stored = await env.KV.get("graphics_profiles_v2")
      const profiles = stored ? JSON.parse(stored) : {}
      return Response.json({ profiles }, { headers: corsHeaders })
    }

    if (url.pathname === "/api/admin/graphics-profiles" && request.method === "POST") {
      if (!(await isAdmin(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 403, headers: corsHeaders })
      }
      try {
        const body = await request.json()
        await env.KV.put("graphics_profiles_v2", JSON.stringify(body.profiles || {}))
        return Response.json({ success: true }, { headers: corsHeaders })
      } catch (err) {
        return Response.json({ error: err.message }, { status: 400, headers: corsHeaders })
      }
    }

    if (url.pathname === "/api/admin/similarity" && request.method === "GET") {
      const response = await handleAdminSimilarity(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    // Public graphics settings endpoint (no auth required)
    if (url.pathname === "/api/graphics-settings" && request.method === "GET") {
      // When the prod frontend is pointed at the staging API via `?gg_api=...`, we want the same
      // render characteristics as prod (otherwise we can get occlusion-heavy settings that freeze
      // Mol* mid-render and make the viewer unresponsive).
      //
      // Staging pages/admin can still use staging KV by default; we only mirror prod settings when
      // the request clearly originates from the prod site.
      const requestOrigin = request.headers.get("Origin") || ""
      const requestReferer = request.headers.get("Referer") || ""
      const wantsProdGraphicsSettings =
        Boolean(env.PROD_KV?.get) &&
        (requestOrigin === "https://geneguessr.brinedew.bio" ||
          requestOrigin === "https://brinedew.bio" ||
          requestReferer.startsWith("https://geneguessr.brinedew.bio/") ||
          requestReferer.startsWith("https://brinedew.bio/"))

      let storedSettings = await env.KV.get("graphics_settings")
      if (wantsProdGraphicsSettings) {
        const prodSettings = await env.PROD_KV.get("graphics_settings")
        if (prodSettings) {
          storedSettings = prodSettings
        }
      }
      let graphicsPayload = JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS))
      if (storedSettings) {
        try {
          graphicsPayload = normalizeGraphicsSettings(JSON.parse(storedSettings))
        } catch (err) {
          console.error("Failed to parse stored graphics settings, serving defaults", err)
          graphicsPayload = JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS))
        }
      }
      return Response.json(graphicsPayload, {
        headers: corsHeaders,
      })
    }

    if (url.pathname === "/api/admin/status" && request.method === "GET") {
      const response = await handleAdminStatus(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/schedule" && request.method === "GET") {
      const response = await handleAdminSchedule(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/cards" && request.method === "GET") {
      const response = await handleAdminCards(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/guess-stats" && request.method === "GET") {
      const response = await handleAdminGuessStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/guess-analytics" && request.method === "GET") {
      const response = await handleAdminGuessAnalytics(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    // Maintenance: purge orphaned structure objects from R2.
    // Orphan = object exists in R2 but KV has no structure_meta:<key> record.
    // Cursor-based so it can be run repeatedly without timing out.
    if (url.pathname === "/api/admin/purge-orphan-structures" && request.method === "POST") {
      return handleAdminPurgeOrphanStructures(request, env, corsHeaders)
    }

    // Maintenance: delete a specific structure object from R2 by key.
    // This is for removing large or problematic cached blobs even when they are not orphans.
    if (url.pathname === "/api/admin/delete-structure" && request.method === "POST") {
      return handleAdminDeleteStructure(request, env, corsHeaders)
    }

    // Maintenance: purge any structure objects that are no longer referenced by the current DB.
    // This cleans up blobs that became obsolete after reseeding/rebuilding structure columns.
    if (url.pathname === "/api/admin/purge-unreferenced-structures" && request.method === "POST") {
      return handleAdminPurgeUnreferencedStructures(request, env, corsHeaders)
    }

    // Debug endpoint for cache stats (no sensitive data)
    if (url.pathname === "/api/debug/cache-stats" && request.method === "GET") {
      if (!(await isAdmin(request, env))) {
        return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders })
      }
      const usage = await getStructureBucketUsage(env)
      return Response.json(
        {
          structures: usage.objects,
          bytes: usage.bytes,
          megabytes: Math.round(usage.bytes / 1024 / 1024),
          capMegabytes: Math.round(STRUCTURE_BUCKET_CAP_BYTES / 1024 / 1024),
          percentFull: Math.round((usage.bytes / STRUCTURE_BUCKET_CAP_BYTES) * 100),
        },
        { headers: corsHeaders },
      )
    }

    if (url.pathname === "/api/structure-token" && request.method === "GET") {
      return handleStructureToken(request, env, corsHeaders)
    }

    // Direct structure access by cacheKey - stable URLs for client-side caching
    // Safe because cacheKey (e.g., "pdb/8J07.bcif") doesn't reveal protein identity
    // Support both GET (fetch) and HEAD (validation) requests
    if (
      url.pathname === "/api/structure-cached" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return handleCachedStructureFetch(request, env, ctx, corsHeaders)
    }

    if (url.pathname === "/api/game/bootstrap" && request.method === "GET") {
      return handleGameBootstrap(request, env, ctx, corsHeaders)
    }

    // Practice mode helpers: bulk HGNC validation + start from a user-provided pool.
    if (url.pathname === "/api/game/practice/resolve" && request.method === "POST") {
      return handlePracticeResolve(request, env, corsHeaders)
    }

    if (url.pathname === "/api/game/practice/start" && request.method === "POST") {
      return handlePracticeStart(request, env, ctx, corsHeaders)
    }

    if (url.pathname === "/api/game/guess" && request.method === "POST") {
      return handleGuessSubmission(request, env, corsHeaders)
    }

    if (url.pathname === "/api/game/reveal-hint" && request.method === "POST") {
      return handleHintReveal(request, env, corsHeaders)
    }

    // Lazy similarity calculation - called after guess card is shown
    if (url.pathname === "/api/game/guess-similarity" && request.method === "POST") {
      return handleGuessSimilarity(request, env, corsHeaders)
    }

    // Public proteins endpoint for autocomplete
    if (url.pathname === "/api/protein" && request.method === "GET") {
      try {
        const uniprot = (url.searchParams.get("uniprot") || "").toUpperCase()
        if (!uniprot) {
          return Response.json(
            { error: "Missing uniprot parameter" },
            { status: 400, headers: corsHeaders },
          )
        }
        const protein = await fetchProteinByUniprot(env.DB, uniprot)
        if (!protein) {
          return Response.json(
            { error: "Protein not found" },
            { status: 404, headers: corsHeaders },
          )
        }
        return Response.json(sanitizeTargetProtein(protein, { revealIdentity: true }), {
          headers: corsHeaders,
        })
      } catch (error) {
        console.error("Failed to load protein details", error)
        return Response.json(
          { error: "Failed to load protein" },
          {
            status: 500,
            headers: corsHeaders,
          },
        )
      }
    }

    if (url.pathname === "/api/proteins" && request.method === "GET") {
      try {
        const query = (url.searchParams.get("query") || "").trim()
        if (!query) {
          return Response.json([], { headers: corsHeaders })
        }
        const limit = Math.min(parseInt(url.searchParams.get("limit")) || 20, 100)
        const excludeRaw = url.searchParams.get("exclude") || ""
        const exclude = excludeRaw
          ? excludeRaw
              .split(",")
              .map((id) => id.trim().toUpperCase())
              .filter(Boolean)
          : []
        const matches = await searchProteins(env.DB, query, limit, exclude)
        return Response.json(matches, { headers: corsHeaders })
      } catch (error) {
        console.error("Failed to load protein search results", error)
        return Response.json(
          { error: "Failed to load protein database" },
          {
            status: 500,
            headers: corsHeaders,
          },
        )
      }
    }

    return Response.json(
      { error: "Not found" },
      {
        status: 404,
        headers: corsHeaders,
      },
    )
  }
  const response = await routeRequest()
  return applySecurityHeaders(response, request)
}

export default {
  async fetch(request, env, ctx) {
    return handleRequestAtTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(request, env, ctx)
  },

  async queue(batch, env, ctx) {
    return handleIconoplasmQueue(batch, env, ctx)
  },

  /**
   * Scheduled handler:
   * - 23:55 UTC: pre-warm next day's target structure/bootstrap cache
   * - 00:03 UTC: post Discord recap for yesterday using pre-rendered day image from R2 cache
   */
  async scheduled(event, env, ctx) {
    const cronExprRaw = event?.cron || ""
    const cronExpr = cronExprRaw
      .trim()
      .split(/\s+/)
      .map((part, idx) => {
        if ((idx === 0 || idx === 1) && /^\d+$/.test(part)) {
          return String(Number(part))
        }
        return part
      })
      .join(" ")
    console.log(
      `[CRON] Triggered at ${new Date().toISOString()} via "${cronExprRaw}" -> "${cronExpr}"`,
    )

    if (ICONOPLASM_SCHEDULED_MAINTENANCE_CRONS.has(cronExpr)) {
      await runScheduledIconoplasmMaintenance(env, ctx)
    }

    if (cronExpr === "*/15 * * * *") {
      // Cheap gallery-only freshness tick — NOT the heavy maintenance.
      await runScheduledIconoplasmGalleryRefresh(env, ctx)
      return
    }

    if (cronExpr === "17 * * * *") {
      return
    }

    if (cronExpr === "3 0 * * *") {
      try {
        const result = await handlePostDailyRecap(env)
        console.log("[CRON] Recap post result:", result)
      } catch (err) {
        console.error("[CRON] Recap posting failed:", err)
      }
      return
    }

    if (cronExpr === "6 12 * * *") {
      try {
        const result = await handlePostDailyFeed(env)
        console.log("[CRON] Feed post result:", result)
      } catch (err) {
        console.error("[CRON] Feed posting failed:", err)
      }
      return
    }

    if (cronExpr && cronExpr !== "55 23 * * *") {
      console.warn(
        `[CRON] No handler for cron expression "${cronExprRaw}" (normalized: "${cronExpr}")`,
      )
      return
    }

    console.log("[CRON] Daily pre-warm triggered at", new Date().toISOString())

    try {
      // Get tomorrow's date
      const tomorrow = new Date()
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const tomorrowStr = tomorrow.toISOString().slice(0, 10)

      // 1. Check for admin override first
      const overrideKey = `puzzle_override:${tomorrowStr}`
      let overrideId = await env.KV.get(overrideKey)
      if (!overrideId && env.PROD_KV?.get) {
        overrideId = await env.PROD_KV.get(overrideKey)
      }
      let targetProtein
      let source

      if (overrideId) {
        targetProtein = await fetchProteinByUniprot(env.DB, overrideId)
        source = "admin_override"
        console.log(`[CRON] Using admin override for ${tomorrowStr}: ${overrideId}`)
      } else {
        // 2. Use deterministic selection
        const eligibleIds = await getEligibleProteinIds(env.DB)
        const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT
        const selection = await pickDailyTarget(env.DB, eligibleIds, salt, tomorrowStr)
        targetProtein = selection?.protein
        source = "computed"
        console.log(`[CRON] Computed target for ${tomorrowStr}: ${targetProtein?.uniprot}`)
      }

      if (!targetProtein) {
        console.error("[CRON] No target protein found for", tomorrowStr)
        return
      }

      // 3. Get structure metadata
      const structureMeta = await getCanonicalStructureMeta(targetProtein, env)
      if (!structureMeta?.r2Key) {
        console.error("[CRON] No structure meta for", targetProtein.uniprot)
        return
      }

      // 4. Pre-cache structure in R2 with pinning metadata
      const cached = await ensureStructureCachedWithPin(env, structureMeta, tomorrowStr)
      if (cached) {
        console.log(`[CRON] Structure cached: ${structureMeta.r2Key}, pinned until ${tomorrowStr}`)
      } else {
        console.warn(`[CRON] Failed to cache structure for ${targetProtein.uniprot}`)
      }

      // 5. Pre-warm bootstrap KV cache for tomorrow (for both origins)
      const origins = [
        "https://brinedew.bio",
        "https://geneguessr.brinedew.bio",
        "https://iconoplasm.brinedew.bio",
      ]
      const cronAudit = {
        date: tomorrowStr,
        source: source === "admin_override" ? "override" : "computed",
        override_id: overrideId || null,
        rejected: [],
      }
      for (const origin of origins) {
        const structureSelection = await buildTargetStructureSelection(targetProtein, env, {
          practiceMode: false,
          origin,
        })
        const structureToken = structureSelection?.token || null
        if (!structureToken) continue
        await setDailyBootstrapCache(
          env,
          tomorrowStr,
          origin,
          targetProtein,
          structureToken,
          structureSelection.meta,
          cronAudit,
        )
      }
      console.log(`[CRON] Bootstrap cache warmed for ${tomorrowStr} (${origins.length} origins)`)

      // Write puzzle_actual so the recap handler always has data,
      // even if nobody plays tomorrow.
      await recordDailyPickOnce(env, tomorrowStr, targetProtein.uniprot, cronAudit)
      console.log(`[CRON] puzzle_actual:${tomorrowStr} written`)

      console.log(`[CRON] Pre-warm complete: ${targetProtein.uniprot} (${source})`)
    } catch (err) {
      console.error("[CRON] Pre-warm failed:", err)
    }
  },
}

function parseCookies(cookieHeader) {
  const cookies = {}
  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=")
    if (name) {
      cookies[name] = rest.join("=")
    }
  })
  return cookies
}

async function getAuthenticatedUserIdFromRequest(request, env) {
  const cookieHeader = request.headers.get("Cookie") || ""
  const cookies = parseCookies(cookieHeader)
  const authSession = cookies.session
  if (!authSession) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(authSession)) return null

  try {
    const id = env.GAME_SESSIONS.idFromName(`session:${authSession}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    if (!resp.ok) return null
    const session = await resp.json()
    return session?.user_id || null
  } catch {
    return null
  }
}

/**
 * Check if request has a session cookie, if not generate one
 * Returns { sessionToken, isNew } where isNew indicates we need to set the cookie
 */
function resolveSessionCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || ""
  const sessionMatch = cookieHeader.match(/geneguessr_session=([a-zA-Z0-9_-]+)/)

  if (sessionMatch) {
    return { sessionToken: sessionMatch[1], isNew: false }
  }

  // Generate a new random session token (URL-safe base64-ish)
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const sessionToken = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32)

  return { sessionToken, isNew: true }
}

function resolveSessionContext(request) {
  const url = new URL(request.url)
  const practiceMode = url.searchParams.get("practice") === "1"
  const practiceRestart = practiceMode && url.searchParams.get("restart") === "1"

  const { sessionToken, isNew } = resolveSessionCookie(request)
  const baseSessionId = `guest_${sessionToken}`

  return {
    practiceMode,
    practiceRestart,
    sessionId: practiceMode ? `practice_${baseSessionId}` : baseSessionId,
    sessionToken,
    needsSessionCookie: isNew,
  }
}

async function resolveSessionContextAsync(request, env, options = {}) {
  const url = new URL(request.url)
  const practiceMode = url.searchParams.get("practice") === "1"
  const practiceRestart = practiceMode && url.searchParams.get("restart") === "1"
  const { sessionToken, isNew } = resolveSessionCookie(request)
  const guestBaseSessionId = `guest_${sessionToken}`

  const authenticatedUserId = await getAuthenticatedUserIdFromRequest(request, env)
  const baseSessionId = authenticatedUserId ? `user_${authenticatedUserId}` : guestBaseSessionId

  // Optional migration: if the user just logged in, keep their current same-day progress.
  // Only do this on bootstrap to avoid extra DO reads on every guess/hint.
  if (options.migrateGuestState && authenticatedUserId) {
    const today = new Date().toISOString().slice(0, 10)
    const userSessionId = practiceMode
      ? `practice_user_${authenticatedUserId}`
      : `user_${authenticatedUserId}`
    const guestSessionId = practiceMode ? `practice_${guestBaseSessionId}` : guestBaseSessionId
    try {
      const [userState, guestState] = await Promise.all([
        getGameState(env, userSessionId).catch(() => null),
        getGameState(env, guestSessionId).catch(() => null),
      ])

      const userGuesses = Array.isArray(userState?.guesses) ? userState.guesses.length : 0
      const guestGuesses = Array.isArray(guestState?.guesses) ? guestState.guesses.length : 0
      const shouldMigrate =
        guestState?.date === today &&
        (userState?.date !== today || userGuesses === 0) &&
        guestGuesses > 0

      if (shouldMigrate) {
        await saveGameState(env, userSessionId, guestState, {
          operation: "bootstrap_guest_state_migration",
          requestPath: "/api/game/bootstrap",
        })
      }
    } catch {
      // Non-fatal: fallback is a fresh user session.
    }
  }

  return {
    practiceMode,
    practiceRestart,
    sessionId: practiceMode ? `practice_${baseSessionId}` : baseSessionId,
    sessionToken,
    needsSessionCookie: isNew,
    authenticatedUserId,
  }
}

/**
 * Build response headers, optionally adding Set-Cookie for new sessions
 * Cookie is HttpOnly, SameSite=Lax by default, 1 year expiry - "strictly necessary" for game function.
 *
 * Note: For localhost dev against a `*.workers.dev` API (cross-origin), SameSite=Lax cookies will not
 * be sent by the browser, which breaks session continuity (every request looks like a fresh session).
 * For those allowed dev origins, we switch to SameSite=None so local playtests behave like prod.
 */
function shouldUseSameSiteNoneCookie(origin, requestHost = "") {
  const lowerHost = String(requestHost || "").toLowerCase()
  const lowerOrigin = String(origin || "").toLowerCase()
  const isWorkersDev = lowerHost.endsWith(".workers.dev")
  const isLocalOrigin =
    lowerOrigin.startsWith("http://localhost") ||
    lowerOrigin.startsWith("http://127.0.0.1") ||
    lowerOrigin.startsWith("http://0.0.0.0")
  return isWorkersDev && isLocalOrigin
}

function buildResponseHeaders(corsHeaders, sessionContext, request) {
  if (!sessionContext?.needsSessionCookie) {
    return corsHeaders
  }

  let requestHost = ""
  try {
    requestHost = new URL(request?.url || "").hostname || ""
  } catch {
    requestHost = ""
  }
  const origin = request?.headers?.get?.("Origin") || ""
  const sameSite = shouldUseSameSiteNoneCookie(origin, requestHost) ? "None" : "Lax"

  const maxAge = 365 * 24 * 60 * 60 // 1 year in seconds
  const cookie = `geneguessr_session=${sessionContext.sessionToken}; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}; HttpOnly; Secure`

  return {
    ...corsHeaders,
    "Set-Cookie": cookie,
  }
}

/**
 * Hash IP address for guest session identification
 */
async function getGameState(env, sessionId) {
  const id = env.GAME_SESSIONS.idFromName(sessionId)
  const stub = env.GAME_SESSIONS.get(id)
  const response = await stub.fetch("https://sessions/game/state", { method: "GET" })
  if (!response.ok) {
    throw new Error("Failed to load session state")
  }
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function saveGameState(env, sessionId, state, observation = {}) {
  // Keep the evidence path off the Durable Object itself. If GameSession writes are
  // what is failing, recording that failure through another GameSession write would
  // be a pretty spectacular own goal.
  return withObservedGameSessionWrite(
    env,
    {
      operation: observation?.operation || "game_session_state_write",
      requestPath: observation?.requestPath || null,
      sessionId,
    },
    async () => {
      const id = env.GAME_SESSIONS.idFromName(sessionId)
      const stub = env.GAME_SESSIONS.get(id)
      const response = await stub.fetch("https://sessions/game/state", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(state || null),
      })
      if (!response.ok) {
        throw new Error("Failed to persist session state")
      }
    },
  )
}

async function checkD1Health(db) {
  try {
    const result = await db.prepare("SELECT 1 as test").first()
    return result?.test === 1 ? "connected" : "error"
  } catch (e) {
    return "error"
  }
}

async function checkKVHealth(kv) {
  // Read-only probe. A GET exercises the binding + KV read path and is enough to
  // confirm connectivity. We deliberately do NOT write here: KV writes are the
  // scarce free-tier resource (1k/day), and a health endpoint that writes per hit
  // is a latent budget sink the moment any uptime monitor points at it. A missing
  // key returns null without throwing, which still proves the binding works.
  try {
    await kv.get("health_check")
    return "connected"
  } catch (e) {
    return "error"
  }
}

/**
 * GameSession Durable Object
 * Manages per-user game sessions and guest rate limiting
 */
export class GameSession {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // Route requests
    if (path === "/game/state" && request.method === "GET") {
      return this.getGameState()
    } else if (path === "/game/state" && request.method === "POST") {
      return this.setGameState(request)
    } else if (path === "/store" && request.method === "POST") {
      // Internal route for OAuth session storage
      return this.storeData(request)
    } else if (path === "/get" && request.method === "GET") {
      // Internal route for OAuth session retrieval
      return this.getData()
    } else if (path === "/reset" && request.method === "POST") {
      // Internal route for clearing OAuth session
      return this.clearData()
    } else {
      return new Response("Not found", { status: 404 })
    }
  }

  async getGameState() {
    const state = await this.state.storage.get("game_state")
    return new Response(JSON.stringify(state || null), {
      headers: JSON_HEADERS,
    })
  }

  async setGameState(request) {
    const payload = await request.json()
    await this.state.storage.put("game_state", payload)
    return new Response(JSON.stringify({ success: true }), {
      headers: JSON_HEADERS,
    })
  }

  /**
   * Store arbitrary data (for OAuth sessions)
   * Internal route only
   */
  async storeData(request) {
    const data = await request.json()
    await this.state.storage.put("data", data)
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })
  }

  /**
   * Get stored data (for OAuth sessions)
   * Internal route only
   */
  async getData() {
    const data = await this.state.storage.get("data")
    return new Response(JSON.stringify(data || {}), {
      headers: { "Content-Type": "application/json" },
    })
  }

  /**
   * Clear stored data (for logout)
   * Internal route only
   */
  async clearData() {
    await this.state.storage.deleteAll()
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })
  }
}

/**
 * Build structure token payload for a target protein.
 * Shared by bootstrap (embedded) and structure-token endpoint (fallback).
 * Returns null if structure unavailable.
 *
 * IMPORTANT: target tokens deliberately point at `type=target`, not at a
 * concrete `key=pdb/...` or `key=swissmodel/...` URL. That is both a gameplay
 * rule and a correctness rule:
 *
 * - Gameplay: putting `pdb/1B64.bcif` directly in the browser-visible URL leaks
 *   the answer path for some targets.
 * - Correctness: the token format and the bytes served by `type=target` must be
 *   derived from the same server-owned `structureMeta`. If bootstrap says
 *   `format: "bcif"` while `/api/structure-cached?type=target` independently
 *   falls back to a `.pdb` SWISS-MODEL file, Mol* receives PDB text through a
 *   BCIF parser and throws opaque internal errors like
 *   `Cannot read properties of undefined (reading 'transform')`.
 *
 * Do not "simplify" this by rebuilding the target URL from whatever cache key
 * is convenient. The URL is intentionally opaque; the selected bytes are pinned
 * in session state and resolved server-side.
 */
function buildTargetStructureTokenFromMeta(meta, { practiceMode, origin }) {
  if (!meta) return null

  const practiceParam = practiceMode ? "&practice=1" : ""
  const structureUrl = `${origin}/api/structure-cached?type=target${practiceParam}`

  return {
    sourceLabel: meta.shortLabel,
    displayLabel: `Source: ${meta.shortLabel}`,
    format: meta.format || "cif",
    url: structureUrl,
    sizeBytes: 0,
    targetChainHints: null,
    totalChainCount: 0,
  }
}

function sameStructureMeta(a, b) {
  if (!a || !b) return false
  return (
    a.source === b.source &&
    a.r2Key === b.r2Key &&
    a.upstreamUrl === b.upstreamUrl &&
    a.format === b.format &&
    a.shortLabel === b.shortLabel
  )
}

function getExplicitStoredStructureMeta(protein) {
  const explicitSource = String(protein?.structure_source || "")
    .trim()
    .toLowerCase()
  if (!explicitSource) {
    return null
  }
  return (
    buildStoredStructureCandidates(protein).find(
      (candidate) => candidate.source === explicitSource,
    ) || null
  )
}

function isSessionTargetStructureMetaStillValid(protein, meta) {
  // General stale-state rule, learned the hard way on 2026-05-19:
  // a browser reload is not a state reset.
  //
  // Ctrl+Shift+R / "hard reload" can bypass the HTTP cache, but it does not
  // delete:
  //
  // - Durable Object session state
  // - KV entries
  // - D1 rows
  // - R2 objects
  // - IndexedDB / localStorage / sessionStorage in every browser profile
  //
  // The Edge recurrence of the Mol* `transform` crash happened because Edge had
  // a still-valid session cookie pointing at a Durable Object state record that
  // was written during the broken deployment. Chrome looked fixed because its
  // session happened to be clean; Edge was still faithfully replaying old
  // server-side state. Any future migration that changes the meaning of a stored
  // field must validate that field against the current source of truth, not just
  // assume the latest code will overwrite it.
  //
  // For target structures, the current explicit DB structure source is the
  // compatibility boundary. A session pin is allowed to win only while it still
  // matches that DB-backed decision.
  if (!meta?.r2Key || !meta?.upstreamUrl) {
    return false
  }

  const explicitMeta = getExplicitStoredStructureMeta(protein)
  if (!explicitMeta) {
    return true
  }

  return sameStructureMeta(meta, explicitMeta)
}

async function buildTargetStructureSelection(protein, env, { practiceMode, origin }) {
  if (!protein) return null

  const meta = await getCanonicalStructureMeta(protein, env)
  if (!meta) {
    console.warn("GeneGuessr: buildTargetStructureToken - no structure meta for", protein.uniprot)
    return null
  }

  // This function is the single place that pairs target structure metadata with
  // the browser token that describes it. Keep `meta` and `token` together.
  //
  // Historical failure, 2026-05-19:
  // - Bootstrap chose the DB-backed RCSB PDB structure for P24534 and emitted a
  //   BCIF token.
  // - `/api/structure-cached?type=target` later re-ran source selection and hit a
  //   stale KV entry for the same UniProt that pointed at SWISS-MODEL PDB text.
  // - The browser had no way to detect the disagreement before Mol* tried to
  //   parse the wrong format and crashed.
  //
  // The permanent invariant is: if a player is shown a token, the session must
  // store the exact metadata that the target endpoint will use for bytes.

  // ⚠️ LAZY LOADING: Don't pre-cache structure on bootstrap.
  // Structure bytes are fetched and cached on first /api/structure-cached request.
  // This avoids adding a multi-second upstream fetch to every bootstrap, but it
  // does NOT mean bootstrap and structure fetch may make separate source choices.

  // Get file size if already cached (fast R2 head operation)
  let sizeBytes = 0
  try {
    const head = await env.STRUCTURES_BUCKET.head(meta.r2Key)
    sizeBytes = head?.size || 0
  } catch {
    /* ignore - not cached yet */
  }

  // Parse chain labels to create redacted hints for the target. These hints must
  // describe the same source as `meta`; mixing PDB hints with SWISS-MODEL bytes
  // would be another form of the same split-brain bug.
  let targetChainHints = null
  let totalChainCount = 0
  const chainLabelsRaw =
    meta.source === "alphafold"
      ? null
      : meta.source === "swissmodel"
        ? protein.swissmodel_chain_labels
        : protein.pdb_chain_labels
  if (chainLabelsRaw) {
    try {
      const chainLabels =
        typeof chainLabelsRaw === "string" ? JSON.parse(chainLabelsRaw) : chainLabelsRaw
      totalChainCount = chainLabels?.reduce((sum, l) => sum + (l.chains?.length || 0), 0) || 0
      targetChainHints = chainLabels?.filter((l) => l.is_target)?.map((l) => ({ chains: l.chains }))
      if (targetChainHints?.length === 0) targetChainHints = null
    } catch (e) {
      console.warn("Failed to parse chain_labels for target hints", e)
    }
  }

  return {
    meta,
    token: {
      ...buildTargetStructureTokenFromMeta(meta, { practiceMode, origin }),
      sizeBytes,
      targetChainHints,
      totalChainCount,
    },
  }
}

async function buildTargetStructureToken(protein, env, options) {
  const selection = await buildTargetStructureSelection(protein, env, options)
  return selection?.token || null
}

/**
 * Build structure token for a guess protein.
 * Returns data suitable for client-side IndexedDB caching.
 * Returns null if structure unavailable.
 */
async function buildGuessStructureToken(protein, env, { origin }) {
  if (!protein) return null

  const meta = await getCanonicalStructureMeta(protein, env)
  if (!meta) {
    console.warn("GeneGuessr: buildGuessStructureToken - no structure meta for", protein.uniprot)
    return null
  }

  // ⚡ LAZY STRUCTURE: Don't block on structure caching during guess submission
  // Just check if it exists in R2 - if not, client will trigger caching via /api/structure-cached
  // This saves 2-4 seconds when structure isn't cached yet
  let sizeBytes = 0
  let cached = false
  try {
    const head = await env.STRUCTURES_BUCKET.head(meta.r2Key)
    if (head) {
      cached = true
      sizeBytes = head.size || 0
    }
  } catch {
    /* ignore */
  }

  let structureUrl = `${origin}/api/structure-cached?key=${encodeURIComponent(meta.r2Key)}`
  // CRITICAL: For SWISS-MODEL and AlphaFold, we MUST include the upstream URL in the request.
  // SWISS-MODEL URLs are custom per-protein (e.g., with template/range params).
  // AlphaFold URLs include isoform numbers (e.g., AF-P11532-3-F1 not AF-P11532-F1).
  // The worker cannot derive these from the r2Key pattern alone.
  // Without this, guess cards for multi-isoform proteins return 404/502.
  // Only needed when not cached - if already in R2, worker serves directly.
  if (
    !cached &&
    (meta.source === "swissmodel" || meta.source === "alphafold") &&
    meta.upstreamUrl
  ) {
    structureUrl += `&upstream=${encodeURIComponent(meta.upstreamUrl)}`
  }

  // Parse chain labels if present
  let chainLabels = null
  const chainLabelsRaw =
    meta.source === "alphafold"
      ? null
      : meta.source === "swissmodel"
        ? protein.swissmodel_chain_labels
        : protein.pdb_chain_labels
  if (chainLabelsRaw) {
    try {
      chainLabels = typeof chainLabelsRaw === "string" ? JSON.parse(chainLabelsRaw) : chainLabelsRaw
    } catch (e) {
      console.warn("Failed to parse chain_labels for guess", e)
    }
  }

  return {
    sourceLabel: meta.shortLabel,
    displayLabel: meta.displayLabel,
    format: meta.format || "cif",
    url: structureUrl,
    cacheKey: meta.r2Key,
    sizeBytes,
    cached, // Tell client whether it needs to trigger caching
    // ALWAYS send upstreamUrl so client can store it in IndexedDB.
    // The client needs this if local blob is evicted and R2 cache expires later.
    // Only matters for SWISS-MODEL and AlphaFold - PDB has predictable URLs.
    upstreamUrl: meta.upstreamUrl || undefined,
    chainLabels,
    linkUrl: meta.linkUrl,
  }
}

async function handleStructureToken(request, env, corsHeaders) {
  try {
    const url = new URL(request.url)
    const type = url.searchParams.get("type")
    if (type === "target") {
      // Fallback endpoint for clients without embedded bootstrap token.
      // Most calls should be eliminated by embedding token in bootstrap payload.
      const { sessionId, practiceMode } = await resolveSessionContextAsync(request, env)
      let protein = null

      try {
        const state = await getGameState(env, sessionId)
        console.log(`[B-206] structure-token: sessionId=${sessionId}, targetId=${state?.targetId}`)
        if (state?.targetId) {
          protein = await fetchProteinByUniprot(env.DB, state.targetId)
        }
      } catch (err) {
        console.warn("GeneGuessr: failed to get target from session, falling back to daily", err)
      }

      if (!protein) {
        protein = await getDailyTargetProtein(env, { practice: practiceMode })
      }

      if (!protein) {
        console.error("GeneGuessr: handleStructureToken - no target protein found")
        return Response.json({ error: "Target unavailable" }, { status: 500, headers: corsHeaders })
      }

      console.log(
        "GeneGuessr: handleStructureToken (fallback) - building token for",
        protein.uniprot,
      )
      const token = await buildTargetStructureToken(protein, env, {
        practiceMode,
        origin: url.origin,
      })

      if (!token) {
        return Response.json(
          { error: "Structure unavailable" },
          { status: 404, headers: corsHeaders },
        )
      }

      return Response.json(token, { headers: corsHeaders })
    }

    const uniprot = (url.searchParams.get("uniprot") || "").toUpperCase()
    if (!uniprot) {
      return Response.json(
        { error: "Missing uniprot parameter" },
        { status: 400, headers: corsHeaders },
      )
    }
    // Try to fetch full protein from database first (has pre-seeded structure metadata)
    // Falls back to minimal object for API discovery if not in database
    let protein = await fetchProteinByUniprot(env.DB, uniprot)
    if (!protein) {
      protein = { uniprot } // Minimal object - will trigger slow API discovery path
    }
    const meta = await getCanonicalStructureMeta(protein, env)
    if (!meta) {
      return Response.json(
        { error: "Structure unavailable" },
        { status: 404, headers: corsHeaders },
      )
    }
    const cached = await ensureStructureCached(env, meta, { proteinId: uniprot })
    if (!cached) {
      return Response.json(
        { error: "Structure unavailable" },
        { status: 404, headers: corsHeaders },
      )
    }

    // Get file size for client-side cache decisions
    let sizeBytes = 0
    try {
      const head = await env.STRUCTURES_BUCKET.head(meta.r2Key)
      sizeBytes = head?.size || 0
    } catch {
      /* ignore */
    }

    const structureUrl = `${url.origin}/api/structure-cached?key=${encodeURIComponent(meta.r2Key)}`
    // Parse chain labels if present (stored as JSON string in D1)
    // Use the right chain labels based on structure source
    // AlphaFold structures are single-chain predictions, so no chain labels needed
    let chainLabels = null
    const chainLabelsRaw =
      meta.source === "alphafold"
        ? null
        : meta.source === "swissmodel"
          ? protein.swissmodel_chain_labels
          : protein.pdb_chain_labels
    if (chainLabelsRaw) {
      try {
        chainLabels =
          typeof chainLabelsRaw === "string" ? JSON.parse(chainLabelsRaw) : chainLabelsRaw
      } catch (e) {
        console.warn("Failed to parse chain_labels", e)
      }
    }
    return Response.json(
      {
        sourceLabel: meta.shortLabel,
        displayLabel: meta.displayLabel,
        format: meta.format || "cif",
        url: structureUrl,
        cacheKey: meta.r2Key,
        sizeBytes,
        chainLabels,
        linkUrl: meta.linkUrl,
      },
      { headers: corsHeaders },
    )
  } catch (err) {
    console.error("GeneGuessr: handleStructureToken unhandled error", err)
    return Response.json(
      { error: "Internal server error", details: String(err) },
      { status: 500, headers: corsHeaders },
    )
  }
}

/**
 * Direct structure fetch by cacheKey (r2Key).
 * Returns structure with long cache headers since the URL is stable.
 */
/**
 * Serves structure files from R2 cache with lazy upstream fetching.
 *
 * CRITICAL ARCHITECTURE DECISIONS (do not revert without understanding):
 *
 * 1. Function signature must include `ctx` (execution context) - NOT just `env`.
 *    The `ctx.waitUntil()` API is on the execution context, not environment bindings.
 *    Using `env.waitUntil()` causes "waitUntil is not a function" crashes.
 *    See: https://developers.cloudflare.com/workers/runtime-apis/context/
 *
 * 2. The `upstream` query parameter is only a hint, not a hard dependency.
 *    The worker should recover upstream URLs server-side from stored metadata
 *    whenever possible, because old clients, cached URLs, or damaged R2 access
 *    should not turn "file not in cache" into "structure permanently broken".
 *
 * 3. Lazy caching via ctx.waitUntil() is intentional for performance.
 *    Structure files are cached to R2 in the background AFTER the response is sent.
 *    This saves 2-4 seconds on first load vs blocking on R2 write.
 *
 * 4. `type=target` must prefer the session-pinned `targetStructureMeta`.
 *    The target structure endpoint is not a general "pick the best structure
 *    again" endpoint. Bootstrap already picked the structure and told the
 *    browser its format. If this endpoint reconsiders the source from DB/KV/R2
 *    independently, it can serve bytes that disagree with the token. That exact
 *    split caused the live P24534 incident on 2026-05-19: bootstrap advertised
 *    RCSB BCIF while a stale KV structure-source entry routed bytes to a
 *    SWISS-MODEL PDB file. Mol* then failed deep inside its transform pipeline.
 *
 *    The order below is therefore deliberate:
 *    a. Load the game session.
 *    b. Use `state.targetStructureMeta` only if it is still compatible with the
 *       current DB-backed source decision.
 *    c. Backfill from canonical metadata if old state lacks the pin or carries
 *       a stale pre-migration pin.
 *    d. Save the backfill so subsequent requests stop re-deciding.
 *
 *    Do not move KV ahead of the session pin. Do not make `type=target` depend
 *    on a browser-provided upstream hint. Do not silently fall back to a
 *    different source after the token has already reached the player.
 *
 * 5. Treat Durable Object state as persistent migration data.
 *    If one browser keeps failing while another works, do not stop at "clear
 *    cache" advice. Browsers can share the same deployment and different server
 *    sessions. A hard reload bypasses static assets; it does not erase the DO
 *    record selected by that browser's cookie. Any stored session field that can
 *    outlive a deploy needs a compatibility check before it is trusted.
 */
async function handleCachedStructureFetch(request, env, ctx, corsHeaders) {
  const fetchStart = Date.now()
  const url = new URL(request.url)
  let cacheKey = url.searchParams.get("key")
  let protein = null // Hoist to function scope for lazy loading
  let targetStructureMeta = null

  // SECURITY + CORRECTNESS: `type=target` fetches the current target without
  // exposing the storage key, and it keeps the response bytes aligned with the
  // already-issued target token. The old bug was not that Mol* was fragile; it
  // was that this endpoint could choose a different source than bootstrap.
  const type = url.searchParams.get("type")
  if (type === "target") {
    const { sessionId, practiceMode } = await resolveSessionContextAsync(request, env)
    let state = null

    try {
      state = await getGameState(env, sessionId)
      console.log("GeneGuessr: structure-cached targetId from session:", state?.targetId)
      if (state?.targetId) {
        protein = await fetchProteinByUniprot(env.DB, state.targetId)
        console.log(
          "GeneGuessr: structure-cached protein from DB:",
          protein?.uniprot,
          protein?.gene,
          protein?.structure_source,
        )
      }
    } catch (err) {
      console.warn("GeneGuessr: structure-cached target lookup failed", err)
    }

    if (!protein) {
      protein = await getDailyTargetProtein(env, { practice: practiceMode })
      console.log(
        "GeneGuessr: structure-cached fallback to daily:",
        protein?.uniprot,
        protein?.gene,
      )
    }

    if (!protein) {
      return Response.json({ error: "Target unavailable" }, { status: 404, headers: corsHeaders })
    }

    // First-class invariant: a valid session-pinned metadata value wins. This
    // field is the server's memory of "what structure did we tell this player
    // they are looking at?" Valid pins are deliberately stronger than KV.
    //
    // Compatibility check matters for old Edge/Chrome profiles that loaded the
    // game during the 2026-05-19 incident. Those sessions may already contain a
    // bad pin such as `swissmodel/P24534_5dqs.pdb` while the current DB row says
    // `structure_source='pdb', pdb_id='1B64'`. If we blindly trust that old pin,
    // Ctrl+Shift+R cannot fix the browser because the stale value lives in the
    // Durable Object session, not in the HTTP cache. A pin is authoritative only
    // while it still matches the current explicit stored source for the target.
    targetStructureMeta = state?.targetStructureMeta || null
    if (!isSessionTargetStructureMetaStillValid(protein, targetStructureMeta)) {
      // Old or corrupted sessions created before the pin invariant was correct
      // have only `targetId`, or have a pin that contradicts today's DB-backed
      // source. Backfill once from the canonical source and persist it. This is
      // not a convenience fallback; it is a migration path that moves stale
      // browser sessions onto the same invariant as new sessions.
      targetStructureMeta = await getCanonicalStructureMeta(protein, env)
      if (
        targetStructureMeta?.r2Key &&
        state?.targetId &&
        !sameStructureMeta(state.targetStructureMeta, targetStructureMeta)
      ) {
        state.targetStructureMeta = targetStructureMeta
        try {
          await saveGameState(env, sessionId, state, {
            operation: "structure_cached_target_selection_backfill",
            requestPath: "/api/structure-cached",
          })
        } catch (err) {
          console.warn(
            "GeneGuessr: failed to backfill target structure selection",
            err?.message || err,
          )
        }
      }
    }
    console.log(
      "GeneGuessr: structure-cached meta:",
      targetStructureMeta?.source,
      targetStructureMeta?.r2Key,
    )
    if (!targetStructureMeta?.r2Key) {
      return Response.json(
        { error: "Structure unavailable" },
        { status: 404, headers: corsHeaders },
      )
    }
    cacheKey = targetStructureMeta.r2Key
  }

  if (!cacheKey) {
    return Response.json({ error: "Missing key parameter" }, { status: 400, headers: corsHeaders })
  }

  // Validate cacheKey format to prevent path traversal
  // Valid formats: "pdb/XXXX.bcif", "alphafold/XXXXX.cif", "swissmodel/XXXXX.pdb"
  const validKeyPattern = /^(pdb|alphafold|swissmodel)\/[A-Za-z0-9_-]+\.(bcif|cif|pdb)$/
  if (!validKeyPattern.test(cacheKey)) {
    return Response.json({ error: "Invalid key format" }, { status: 400, headers: corsHeaders })
  }

  const derivePdbUpstreamUrl = (id, format) => {
    if (format === "bcif") {
      return `https://models.rcsb.org/v1/${id}/full?encoding=bcif&copy_all_categories=false`
    }
    return `https://models.rcsb.org/${id}.${format}`
  }

  const resolveMetaFromCacheKey = async () => {
    const [source, filename] = cacheKey.split("/")
    const format = filename.endsWith(".bcif") ? "bcif" : filename.endsWith(".pdb") ? "pdb" : "cif"
    const id = filename.replace(/\.(bcif|cif|pdb)$/, "")
    const hintedUpstreamUrl = url.searchParams.get("upstream")

    if (hintedUpstreamUrl) {
      return { r2Key: cacheKey, upstreamUrl: hintedUpstreamUrl, format, source }
    }

    if (source === "pdb") {
      return {
        r2Key: cacheKey,
        upstreamUrl: derivePdbUpstreamUrl(id, format),
        format,
        source,
      }
    }

    let row = null
    const structureRowSql = `SELECT uniprot, structure_source, pdb_id, alphafold_url, swissmodel_url, swissmodel_template
      FROM proteins
      WHERE upper(uniprot) = ?`
    try {
      if (source === "alphafold" && env?.DB?.prepare) {
        row = await env.DB.prepare(structureRowSql).bind(id.toUpperCase()).first()
      } else if (source === "swissmodel" && env?.DB?.prepare) {
        const uniprotFromKey = id.includes("_") ? id.slice(0, id.indexOf("_")) : ""
        if (uniprotFromKey) {
          row = await env.DB.prepare(structureRowSql).bind(uniprotFromKey.toUpperCase()).first()
        }
      }
    } catch (err) {
      console.warn(
        "GeneGuessr: failed to recover structure metadata from DB for",
        cacheKey,
        err?.message || err,
      )
    }

    if (row) {
      const exactStoredMeta = buildStoredStructureCandidates(row).find(
        (candidate) => candidate?.r2Key === cacheKey,
      )
      if (exactStoredMeta?.upstreamUrl) {
        return exactStoredMeta
      }
    }

    if (source === "alphafold") {
      return {
        r2Key: cacheKey,
        upstreamUrl: `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v6.cif`,
        format,
        source,
      }
    }

    return null
  }

  let object = null
  try {
    object = (await env?.STRUCTURES_BUCKET?.get?.(cacheKey)) || null
  } catch (err) {
    console.warn(
      "GeneGuessr: structure cache read failed, falling back to upstream",
      cacheKey,
      err?.message || err,
    )
  }

  // ⚠️ LAZY CACHING: If not in R2, fetch from upstream and cache
  // This happens on first request after bootstrap (which no longer pre-caches)
  if (!object) {
    // We need the protein to get upstream URL - for type=target we already have it
    // For key-based requests, derive source from the key prefix
    let meta = null
    if (type === "target" && protein) {
      meta = targetStructureMeta || (await getCanonicalStructureMeta(protein, env))
    } else {
      meta = await resolveMetaFromCacheKey()
    }

    if (!meta?.upstreamUrl) {
      return Response.json(
        { error: "Structure not cached and no upstream available" },
        { status: 404, headers: corsHeaders },
      )
    }

    // Fetch from upstream and stream to client while caching in background
    console.log(`[LAZY-CACHE] Fetching ${cacheKey} from ${meta.upstreamUrl}`)
    const upstreamResp = await fetch(meta.upstreamUrl, {
      method: "GET",
      headers: { "User-Agent": "GeneGuessr-Worker/1.0" },
    })

    if (!upstreamResp.ok || !upstreamResp.body) {
      console.warn(
        "GeneGuessr: upstream structure fetch failed",
        meta.upstreamUrl,
        upstreamResp.status,
      )
      return Response.json(
        { error: "Upstream structure unavailable" },
        { status: 502, headers: corsHeaders },
      )
    }

    const contentLengthHeader = upstreamResp.headers.get("Content-Length")
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN
    if (Number.isFinite(contentLength) && contentLength > MAX_STRUCTURE_FILE_BYTES) {
      console.warn(
        "GeneGuessr: upstream structure too large",
        meta.upstreamUrl,
        `${contentLength} bytes`,
      )
      return Response.json(
        { error: "Structure too large", sizeBytes: contentLength },
        { status: 413, headers: corsHeaders },
      )
    }

    // Clone the response - one for client, one for R2 cache
    const [clientStream, cacheStream] = upstreamResp.body.tee()

    // Fire-and-forget: cache to R2 in background
    const contentType =
      meta.format === "bcif"
        ? "application/octet-stream"
        : upstreamResp.headers.get("Content-Type") || "chemical/x-cif"

    // CRITICAL: Must use ctx.waitUntil(), NOT env.waitUntil()
    // `ctx` = execution context (has waitUntil), `env` = environment bindings (does not)
    // Using env.waitUntil() causes \"waitUntil is not a function\" error and 500 response
    if (env?.STRUCTURES_BUCKET?.put) {
      ctx.waitUntil(
        (async () => {
          try {
            const arrayBuffer = await new Response(cacheStream).arrayBuffer()
            await env.STRUCTURES_BUCKET.put(cacheKey, arrayBuffer, {
              httpMetadata: { contentType },
            })
            // FIFO eviction uses R2's built-in uploaded timestamp - no KV tracking needed
            console.log(
              `[LAZY-CACHE] Cached ${cacheKey} (${Math.round(arrayBuffer.byteLength / 1024)}KB)`,
            )
          } catch (e) {
            console.warn("[LAZY-CACHE] Background cache failed:", e)
          }
        })(),
      )
    } else {
      cacheStream.cancel().catch(() => {})
    }

    // Stream to client immediately (don't wait for cache)
    const isSwissModelPdb = cacheKey.startsWith("swissmodel/") && cacheKey.endsWith(".pdb")
    // Note: SwissModel PDB header fix won't work here since we're streaming
    // But SwissModel should always be pre-cached anyway (fallback above)

    // Only add timing headers for non-target requests (target headers could leak puzzle info)
    const responseHeaders = {
      ...corsHeaders,
      "Content-Type": contentType,
      "Cache-Control":
        type === "target"
          ? "private, no-store, must-revalidate"
          : "public, max-age=604800, immutable",
    }
    if (type !== "target") {
      const [upstreamSource] = cacheKey.split("/")
      responseHeaders["X-Cache"] = "UPSTREAM"
      responseHeaders["X-Source"] = upstreamSource
      responseHeaders["X-Fetch-Ms"] = String(Date.now() - fetchStart)
    }
    return new Response(clientStream, { headers: responseHeaders })
  }

  // REMOVED: touchStructureCacheEntry - no longer tracking lastAccess in KV
  // Using FIFO eviction based on R2's uploaded timestamp instead of LRU

  // For type=target, don't cache at edge - the "target" changes daily but URL is static
  // For key-based requests, cache 7 days - the key includes the structure ID so it's stable
  const cacheControl =
    type === "target" ? "private, no-store, must-revalidate" : "public, max-age=604800, immutable"

  // Timing headers for monitoring (only for non-target requests - target headers could leak puzzle info)
  const timingHeaders = {}
  if (type !== "target") {
    const [r2Source] = cacheKey.split("/")
    timingHeaders["X-Cache"] = "R2"
    timingHeaders["X-Source"] = r2Source
    timingHeaders["X-Fetch-Ms"] = String(Date.now() - fetchStart)
    timingHeaders["X-Size"] = String(object.size)
  }

  // SWISS-MODEL PDB files lack the HEADER record that Mol* requires for parsing.
  // Mol*'s PDB parser needs a HEADER to create an "entry" object; without it,
  // we get "Cannot read properties of undefined (reading 'entry')" errors.
  // We prepend a minimal anonymous HEADER that doesn't leak protein identity.
  const isSwissModelPdb = cacheKey.startsWith("swissmodel/") && cacheKey.endsWith(".pdb")
  if (isSwissModelPdb) {
    // PDB HEADER format: cols 11-50=classification, 51-59=date, 63-66=id_code
    // Using completely anonymous values that satisfy Mol* without revealing protein identity
    const syntheticHeader = "HEADER    MODEL                                   01-JAN-00   0000\n"
    const originalData = await object.arrayBuffer()
    const headerBytes = new TextEncoder().encode(syntheticHeader)
    const combinedBuffer = new Uint8Array(headerBytes.length + originalData.byteLength)
    combinedBuffer.set(headerBytes, 0)
    combinedBuffer.set(new Uint8Array(originalData), headerBytes.length)

    const swissHeaders = {
      ...corsHeaders,
      ...timingHeaders,
      "Content-Type": "chemical/x-pdb",
      "Cache-Control": cacheControl,
    }
    if (type !== "target") {
      swissHeaders["X-Size"] = String(combinedBuffer.byteLength) // Override with actual size after header prepend
    }
    return new Response(combinedBuffer, { headers: swissHeaders })
  }

  return new Response(object.body, {
    headers: {
      ...corsHeaders,
      ...timingHeaders,
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": cacheControl,
    },
  })
}

/**
 * ⚠️ DAILY BOOTSTRAP CACHE ⚠️
 *
 * Caches the expensive-to-compute parts of daily mode bootstrap:
 * - Target protein metadata
 * - Structure token (source, URL, chain hints, etc.)
 *
 * This eliminates D1 queries + R2 head calls for repeat visitors on the same day.
 * KV lookup: ~1-5ms vs full computation: ~500-2000ms
 */
async function getDailyBootstrapCache(env, date, origin) {
  const cacheKey = buildDailyBootstrapCacheKey(date, origin)
  try {
    const cached = await env.KV.get(cacheKey, { type: "json" })
    if (cached) {
      console.log(`[PERF] Daily bootstrap cache HIT for ${date}`)
      return cached
    }
  } catch (e) {
    console.warn("Daily bootstrap cache read failed:", e)
  }
  return null
}

async function setDailyBootstrapCache(
  env,
  date,
  origin,
  targetProtein,
  structureToken,
  structureMeta,
  audit,
) {
  const cacheKey = buildDailyBootstrapCacheKey(date, origin)
  const payload = {
    origin,
    targetProtein,
    structureToken,
    structureMeta,
    audit: audit || null,
    cachedAt: Date.now(),
  }
  try {
    // Calculate TTL to expire at end of day (UTC)
    const now = new Date()
    const endOfDay = new Date(date + "T23:59:59.999Z")
    const ttlSeconds = Math.max(60, Math.floor((endOfDay - now) / 1000))
    await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttlSeconds })
    console.log(`[PERF] Daily bootstrap cache SET for ${date} (TTL: ${ttlSeconds}s)`)
  } catch (e) {
    console.warn("Daily bootstrap cache write failed:", e)
  }
}

function buildDailyBootstrapCacheKey(date, origin) {
  const safeDate = String(date || "").trim()
  let hostKey = "unknown"
  try {
    hostKey = new URL(String(origin || "")).host.toLowerCase() || hostKey
  } catch {
    hostKey =
      String(origin || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "") || hostKey
  }
  return `${DAILY_BOOTSTRAP_CACHE_PREFIX}${safeDate}:${hostKey}`
}

async function getProdDailyBootstrapCache(env, date) {
  if (!env?.PROD_KV?.get) {
    return null
  }

  const candidateOrigins = [
    `https://${GENEGUESSR_HOST}`,
    "https://brinedew.bio",
    "https://www.brinedew.bio",
  ]
  for (const origin of candidateOrigins) {
    const keyed = await env.PROD_KV.get(buildDailyBootstrapCacheKey(date, origin), {
      type: "json",
    })
    if (keyed) {
      return keyed
    }
  }

  // Legacy single-origin key fallback (pre origin-scoped cache keys).
  return env.PROD_KV.get(`${DAILY_BOOTSTRAP_CACHE_PREFIX}${date}`, {
    type: "json",
  })
}

/**
 * ⚠️ PERFORMANCE CRITICAL - BOOTSTRAP LATENCY DIRECTLY AFFECTS TTFP ⚠️
 *
 * This handler is the main bottleneck for initial page load.
 * Every millisecond here = millisecond of blank screen for users.
 *
 * OPTIMIZATIONS APPLIED:
 * 1. DAILY CACHE: KV lookup for target + structure token (~1-5ms vs ~500-2000ms)
 * 2. Parallel fetch: getDailyTargetProtein runs concurrently with session load
 * 3. Batched hydration: hydrateGuessProteins uses Promise.all, not sequential loop
 * 4. Skip redundant work: similarity scores not recalculated if already stored
 *
 * DO NOT add sequential awaits here without measuring impact.
 * DO NOT call hydrateGuessProteins with sequential DB calls.
 */
async function handleGameBootstrap(request, env, ctx, corsHeaders) {
  console.log("[BOOTSTRAP] Handler started")
  try {
    const sessionContext = await resolveSessionContextAsync(request, env, {
      migrateGuestState: true,
    })
    const { sessionId, practiceMode, practiceRestart } = sessionContext
    console.log(`[BOOTSTRAP] Session resolved: practiceMode=${practiceMode}`)
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)
    const url = new URL(request.url)
    const today = new Date().toISOString().slice(0, 10)

    // ⚠️ DAILY MODE: CHECK KV CACHE FIRST ⚠️
    // Eliminates D1 + R2 queries for repeat visitors (~500-2000ms savings)
    let cachedDaily = null
    if (!practiceMode) {
      cachedDaily = await getDailyBootstrapCache(env, today, url.origin)
    }

    // Staging-only: If prod has already recorded today's actual pick, ensure our daily bootstrap cache
    // matches it. This prevents a stale staging cache from masking the mirrored prod target.
    if (!practiceMode && cachedDaily && env.PROD_KV?.get) {
      try {
        let prodUniprot = ""
        const prodActualRaw = await env.PROD_KV.get(`puzzle_actual:${today}`)
        if (prodActualRaw) {
          const prodActual = JSON.parse(prodActualRaw)
          prodUniprot = (prodActual?.uniprot_id || "").toString().trim().toUpperCase()
        }
        if (!prodUniprot) {
          const prodDailyCache = await getProdDailyBootstrapCache(env, today)
          prodUniprot = (prodDailyCache?.targetProtein?.uniprot || "")
            .toString()
            .trim()
            .toUpperCase()
        }

        const cachedUniprot = (cachedDaily?.targetProtein?.uniprot || "")
          .toString()
          .trim()
          .toUpperCase()
        if (prodUniprot && cachedUniprot && prodUniprot !== cachedUniprot) {
          console.log(
            `[BOOTSTRAP] Staging cache mismatch with prod; ignoring cache (${cachedUniprot} != ${prodUniprot})`,
          )
          cachedDaily = null
        }
      } catch (err) {
        console.warn(
          "GeneGuessr: failed to validate staging bootstrap cache against prod",
          err?.message || err,
        )
      }
    }
    console.log(`[BOOTSTRAP] Cache checked: ${cachedDaily ? "HIT" : "MISS"}`)

    // ⚠️ PARALLEL FETCH - DO NOT SERIALIZE ⚠️
    // Target protein lookup and session state load are independent
    // Running in parallel saves 50-150ms per request
    console.log("[BOOTSTRAP] Starting parallel fetch: targetSeed + existingState")
    const [targetSeedRaw, existingState] = await Promise.all([
      cachedDaily?.targetProtein
        ? Promise.resolve(cachedDaily.targetProtein) // Use cached target
        : getDailyTargetProtein(env, { practice: practiceMode, returnAudit: !practiceMode }),
      getGameState(env, sessionId).catch(() => null), // Graceful fallback if session doesn't exist
    ])
    let targetSeed = targetSeedRaw?.protein ? targetSeedRaw.protein : targetSeedRaw
    // Prefer audit from the API response, but fall back to cached audit from bootstrap cache
    const targetAudit = targetSeedRaw?.audit ? targetSeedRaw.audit : cachedDaily?.audit || null
    console.log(`[BOOTSTRAP] Parallel fetch complete: targetSeed=${targetSeed?.uniprot || "null"}`)

    // When set, `date` should override any existing practice session for today.
    let dateOverrideUniprot = null
    let dateOverrideProtein = null

    // Practice-list overrides:
    // - `date=YYYY-MM-DD` loads a historical daily puzzle for sharing with friends.
    // - `same_target=1&target_id=...` replays the same (already revealed) practice target.
    // - If `existingState.practicePool` exists, restarts pick from that pool instead of global practice picking.
    if (practiceMode) {
      // Historical puzzle sharing: ?practice=1&date=YYYY-MM-DD
      // Check PROD_KV first (for staging), fall back to local KV
      const dateParam = url.searchParams.get("date")
      console.log(
        `[BOOTSTRAP] Practice mode: dateParam=${dateParam}, hasProdKV=${!!env.PROD_KV?.get}`,
      )
      if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        let puzzleActual = null
        if (env.PROD_KV?.get) {
          puzzleActual = await env.PROD_KV.get(`puzzle_actual:${dateParam}`, { type: "json" })
          console.log(
            `[BOOTSTRAP] PROD_KV lookup: key=puzzle_actual:${dateParam}, found=${!!puzzleActual}`,
          )
        }
        if (!puzzleActual) {
          puzzleActual = await env.KV.get(`puzzle_actual:${dateParam}`, { type: "json" })
          console.log(
            `[BOOTSTRAP] Local KV lookup: key=puzzle_actual:${dateParam}, found=${!!puzzleActual}`,
          )
        }
        if (puzzleActual?.uniprot_id) {
          console.log(`[BOOTSTRAP] Found puzzle_actual with uniprot_id=${puzzleActual.uniprot_id}`)
          const historicalProtein = await fetchProteinByUniprot(env.DB, puzzleActual.uniprot_id)
          if (historicalProtein) {
            dateOverrideUniprot = historicalProtein.uniprot
            dateOverrideProtein = historicalProtein
            targetSeed = historicalProtein
            console.log(`[BOOTSTRAP] Practice mode: loaded historical puzzle from ${dateParam}`)
          } else {
            console.log(
              `[BOOTSTRAP] Failed to fetch protein for uniprot_id=${puzzleActual.uniprot_id}`,
            )
          }
        } else {
          console.log(`[BOOTSTRAP] No puzzle_actual found for date=${dateParam}`)
        }
      }

      const sameTargetRequested = url.searchParams.get("same_target") === "1"
      const requestedTargetId = sameTargetRequested
        ? (url.searchParams.get("target_id") || "").trim().toUpperCase() || null
        : null

      const pool = Array.isArray(existingState?.practicePool)
        ? existingState.practicePool.filter(Boolean)
        : []
      let desiredUniprot = null
      if (dateOverrideUniprot) {
        desiredUniprot = dateOverrideUniprot
      } else if (sameTargetRequested && requestedTargetId) {
        desiredUniprot = requestedTargetId
      } else if (!practiceRestart && existingState?.targetId && existingState?.date === today) {
        desiredUniprot = existingState.targetId
      } else if (pool.length) {
        desiredUniprot = pool[Math.floor(Math.random() * pool.length)]
      }

      if (desiredUniprot) {
        const overrideProtein =
          dateOverrideProtein && desiredUniprot === dateOverrideUniprot
            ? dateOverrideProtein
            : await fetchProteinByUniprot(env.DB, desiredUniprot)
        if (overrideProtein) {
          targetSeed = overrideProtein
          console.log(
            `[BOOTSTRAP] Practice override target: ${overrideProtein.uniprot} (poolSize=${pool.length})`,
          )
        }
      }
    }

    if (!targetSeed && !practiceMode) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    // Determine if session needs reset (uses pre-fetched existingState)
    // When the daily schedule gives a different target than the session's pin,
    // the daily schedule wins — this handles admin overrides after users already
    // have sessions, without any separate session-cleanup step.
    const forceReset =
      practiceRestart ||
      (practiceMode && dateOverrideUniprot && existingState?.targetId !== dateOverrideUniprot) ||
      (!practiceMode &&
        targetSeed &&
        existingState?.targetId &&
        existingState.targetId !== targetSeed.uniprot)

    const state = await ensureSessionForTodayWithState(env, sessionId, targetSeed, existingState, {
      practiceMode,
      forceReset,
      preservePracticePool: true,
      writeObservation: {
        operation: "bootstrap_session_ensure",
        requestPath: "/api/game/bootstrap",
      },
    })
    console.log(
      `[B-206] bootstrap: sessionId=${sessionId}, forceReset=${forceReset}, targetId=${state.targetId}, seedId=${targetSeed?.uniprot}`,
    )
    const targetProtein =
      targetSeed && state.targetId === targetSeed.uniprot
        ? targetSeed
        : await fetchProteinByUniprot(env.DB, state.targetId)
    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    // ⚠️ PARALLEL EXECUTION - structure token + guess hydration run concurrently.
    // This eliminates a client-side /api/structure-token round-trip, but the
    // structure selection still has to be treated as durable state, not just as
    // an optimization artifact. The token describes what Mol* will parse. The
    // matching `structureMeta` describes what `/api/structure-cached?type=target`
    // will serve. Persist them together so the player path is:
    //
    //   bootstrap token.format
    //     == session.targetStructureMeta.format
    //     == structure endpoint response bytes
    //
    // If a future refactor keeps the token but drops the `structureMeta` save,
    // it reopens the exact 2026-05-19 failure: RCSB/BCIF token with SWISS-MODEL
    // PDB bytes because another resolver path found stale cache state.
    let structureToken = cachedDaily?.structureToken || null
    let structureMeta = isSessionTargetStructureMetaStillValid(
      targetProtein,
      state?.targetStructureMeta,
    )
      ? state.targetStructureMeta
      : cachedDaily?.structureMeta || null
    if (
      state?.targetStructureMeta &&
      !isSessionTargetStructureMetaStillValid(targetProtein, state.targetStructureMeta)
    ) {
      // Existing sessions from before the source-of-truth fix can carry a bad
      // pin. Force a fresh selection even if daily bootstrap cache has a token,
      // otherwise the bootstrap response and the target endpoint can remain
      // split for that one browser forever.
      //
      // This is the "works in Chrome, fails in Edge after Ctrl+Shift+R" class of
      // failure. The browser reloads the page, but the Worker still loads the
      // same Durable Object state through the same cookie. Do not remove this
      // compatibility gate unless there is a stronger migration for every
      // existing GameSession object.
      structureToken = null
      structureMeta = null
    }
    // Older cached tokens used a relative `url` (e.g. `/api/structure-cached?key=...`) which breaks
    // when the client page is not on the same origin as the API host (e.g. brinedew.bio → geneguessr.brinedew.bio).
    // They can also contain extra fields we no longer want to expose. Treat those as invalid and rebuild.
    const cachedTokenUrl = typeof structureToken?.url === "string" ? structureToken.url : ""
    const cachedTokenLooksLegacy = cachedTokenUrl.includes("/api/structure-cached?key=")
    if (cachedTokenLooksLegacy) {
      structureToken = null
    }
    const needsStructureToken = !structureToken

    const [_, freshStructureSelection] = await Promise.all([
      hydrateGuessProteins(env, sessionId, state, targetProtein),
      needsStructureToken
        ? buildTargetStructureSelection(targetProtein, env, {
            practiceMode,
            origin: url.origin,
          }).catch((err) => {
            console.warn("GeneGuessr: bootstrap structure token failed (non-fatal)", err)
            return null // Client falls back to /api/structure-token if null
          })
        : Promise.resolve(null), // Already have cached token
    ])

    // Use fresh token if we computed one. Keep the returned metadata with it;
    // separating these two values is the unsafe state.
    if (freshStructureSelection?.token) {
      structureToken = freshStructureSelection.token
      structureMeta = freshStructureSelection.meta || structureMeta
    }

    if (
      structureToken &&
      structureMeta &&
      !sameStructureMeta(state.targetStructureMeta, structureMeta)
    ) {
      // This write is intentional and budget-conscious: `sameStructureMeta`
      // prevents repeated Durable Object writes for equivalent metadata, while
      // still ensuring a newly selected target gets pinned before the browser
      // asks for bytes. Do not replace the value comparison with object identity;
      // cached JSON and freshly computed objects are different references even
      // when they describe the same structure.
      state.targetStructureMeta = structureMeta
      await saveGameState(env, sessionId, state, {
        operation: "bootstrap_target_structure_selection",
        requestPath: "/api/game/bootstrap",
      })
    }

    // Record what was actually shown to players (daily mode only).
    // Uses waitUntil so we don't add latency to bootstrap.
    if (!practiceMode && targetProtein?.uniprot) {
      const audit =
        targetAudit && targetAudit.date === today
          ? targetAudit
          : { date: today, source: "unknown", rejected: [] }
      ctx.waitUntil(recordDailyPickOnce(env, today, targetProtein.uniprot, audit))

      // ⚠️ POPULATE CACHE FOR NEXT REQUEST (daily mode only) ⚠️
      // Include audit so future cache hits preserve override source info.
      if (!cachedDaily && targetProtein && structureToken) {
        ctx.waitUntil(
          setDailyBootstrapCache(
            env,
            today,
            url.origin,
            targetProtein,
            structureToken,
            structureMeta,
            audit,
          ).catch((e) => console.warn("Cache population failed:", e)),
        )
      }
    }

    // If a completed daily game never got recorded (retry/crash), backfill aggregates in the background.
    // This stores only per-day guess counts (no user ids, no IPs).
    const guessStatsThrough = Number(state?.guessStatsRecordedThrough || 0)
    if (!practiceMode && (!Number.isFinite(guessStatsThrough) || guessStatsThrough === 0)) {
      ctx.waitUntil(
        (async () => {
          try {
            const latest = await getGameState(env, sessionId).catch(() => null)
            if (!latest) return
            const didUpdate = await maybeRecordDailyGuessAggregatesDelta(env, latest, {
              practiceMode,
            })
            if (didUpdate) {
              await saveGameState(env, sessionId, latest, {
                operation: "bootstrap_guess_aggregate_backfill",
                requestPath: "/api/game/bootstrap",
              })
            }
          } catch (err) {
            console.warn("Guess aggregate backfill failed (non-fatal):", err?.message || err)
          }
        })(),
      )
    }

    const payload = buildGamePayload(state, targetProtein)
    // Embed structure token in bootstrap response - client uses this instead of separate API call
    if (structureToken) {
      try {
        if (typeof structureToken.url === "string" && structureToken.url.startsWith("/")) {
          structureToken = { ...structureToken, url: `${url.origin}${structureToken.url}` }
        }
      } catch {
        // ignore; client will fall back if needed
      }
      payload.targetStructureToken = structureToken
    }
    return Response.json(payload, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: bootstrap failed", err)
    return Response.json(
      { error: "Failed to load game state" },
      { status: 500, headers: corsHeaders },
    )
  }
}

async function recordDailyPickOnce(env, date, uniprotId, audit) {
  try {
    const key = `puzzle_actual:${date}`
    const existing = await env.KV.get(key)
    if (existing) {
      return
    }
    const record = {
      date,
      uniprot_id: uniprotId,
      source: audit?.source || "unknown",
      override_id: audit?.override_id || null,
      rejected: Array.isArray(audit?.rejected) ? audit.rejected : [],
      skipped_alpha_fold: Number.isFinite(audit?.skipped_alpha_fold)
        ? audit.skipped_alpha_fold
        : null,
      recorded_at: Date.now(),
    }
    const rejectedCount = Array.isArray(record.rejected) ? record.rejected.length : 0
    await env.KV.put(key, JSON.stringify(record), {
      metadata: {
        uniprot_id: record.uniprot_id,
        source: record.source,
        override_id: record.override_id,
        rejected_count: rejectedCount,
        recorded_at: record.recorded_at,
      },
    })
  } catch (err) {
    console.warn("Daily pick record write failed:", err)
  }
}

async function handleGuessSubmission(request, env, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId, practiceMode } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)

    const body = await safeJson(request)
    const uniprot = (body?.uniprot || "").toUpperCase()
    if (!uniprot) {
      return Response.json({ error: "Missing uniprot" }, { status: 400, headers: responseHeaders })
    }

    // ⚡ PERFORMANCE: Get state FIRST - it already contains the targetId
    // Avoids slow getDailyTargetProtein call on every guess (was ~2-3s for practice mode)
    let state = null
    try {
      state = await getGameState(env, sessionId)
    } catch (err) {
      console.warn("GeneGuessr: failed to load session for guess", err)
    }

    if (!state?.targetId) {
      // No session or missing target - this shouldn't happen in normal flow
      // Fall back to daily target lookup (slow path)
      const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode })
      if (!targetSeed && !practiceMode) {
        return Response.json(
          { error: "Target unavailable" },
          { status: 500, headers: responseHeaders },
        )
      }
      state = await ensureSessionForToday(env, sessionId, targetSeed, {
        practiceMode,
        writeObservation: {
          operation: "guess_session_ensure",
          requestPath: "/api/game/guess",
        },
      })
    }

    // ⚡ PERFORMANCE: Fetch target and guess proteins in parallel
    const [targetProtein, guessProtein] = await Promise.all([
      fetchProteinByUniprot(env.DB, state.targetId),
      fetchProteinByUniprot(env.DB, uniprot),
    ])

    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }
    if (!guessProtein) {
      return Response.json(
        { error: "Protein not found" },
        { status: 404, headers: responseHeaders },
      )
    }
    if (state.won || (state.guesses?.length || 0) >= MAX_GUESSES) {
      return Response.json(
        { error: "Round already completed" },
        { status: 409, headers: responseHeaders },
      )
    }
    if ((state.guesses || []).some((entry) => entry.uniprot === uniprot)) {
      return Response.json(
        { error: "Protein already guessed" },
        { status: 409, headers: responseHeaders },
      )
    }

    // ⚡ LAZY SIMILARITY: Skip slow similarity calculation here
    // Return immediately with score: null, client will fetch via /api/game/guess-similarity
    // This saves ~1-2 seconds on guess submission
    const correct = guessProtein.uniprot === targetProtein.uniprot
    const guessEntry = {
      guessId: crypto.randomUUID(),
      uniprot,
      correct,
      // scoreGuess() returns a structured score object expected by the client.
      // Using a raw number here causes the UI to display N/A for correct guesses.
      score: correct ? scoreGuess(guessProtein, targetProtein, { similarity: 100 }) : null,
      similarityPending: !correct, // Client should fetch similarity
      createdAt: Date.now(),
      protein: {
        ...guessProtein,
        gene_summary: cleanGeneSummary(guessProtein.gene_summary),
      },
    }
    state.guesses = [...(state.guesses || []), guessEntry]
    if (correct) {
      state.won = true
    } else {
      state.hintBalance = (state.hintBalance || 0) + HINT_REWARD_ON_INCORRECT
    }

    // Record aggregate guess stats for daily mode as the player guesses.
    // Stores only per-day counts (no user ids, no IPs) and is safe to retry.
    try {
      await maybeRecordDailyGuessAggregatesDelta(env, state, { practiceMode })
    } catch (err) {
      console.warn("Guess aggregate recording failed (non-fatal):", err?.message || err)
    }

    // ⚡ PERFORMANCE: Build guess structure token in parallel with saveGameState
    // This eliminates ~3s API round-trip on client after guess submission
    const url = new URL(request.url)
    const [, guessStructureToken] = await Promise.all([
      saveGameState(env, sessionId, state, {
        operation: "guess_submission",
        requestPath: "/api/game/guess",
      }),
      buildGuessStructureToken(guessProtein, env, { origin: url.origin }),
    ])

    const payload = buildGamePayload(state, targetProtein, { includeProteins: true })
    // Embed structure token so client can cache it immediately
    if (guessStructureToken) {
      payload.guessStructureToken = guessStructureToken
    }
    return Response.json(payload, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: guess submission failed", err)
    return Response.json(
      { error: "Guess submission failed" },
      { status: 500, headers: corsHeaders },
    )
  }
}

/**
 * ⚠️ PERFORMANCE CRITICAL - HINT REVEAL MUST BE FAST ⚠️
 *
 * This endpoint reveals a single hint. It should be INSTANT.
 *
 * BEFORE (slow - 2-3 seconds):
 *   - getDailyTargetProtein (2-3 DB queries)
 *   - ensureSessionForToday (DO read)
 *   - hydrateGuessProteins (N × 2-3 DB queries for ALL guesses)
 *   - buildGamePayload (CPU work to build full payload)
 *
 * AFTER (fast - <200ms):
 *   - Parallel: session state + target lookup
 *   - NO hydrateGuessProteins (client already has guess data!)
 *   - Minimal payload: just the hint text + updated status
 *
 * The client already has all guess proteins from bootstrap.
 * Hint reveal only needs to return the revealed text and updated hint balance.
 *
 * DO NOT add hydrateGuessProteins back. It's not needed here.
 * See Linear issue B-205 for full context.
 */
async function handleHintReveal(request, env, corsHeaders) {
  const t0 = Date.now()
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId, practiceMode } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)

    const body = await safeJson(request)
    const hintId = body?.hintId || body?.id
    if (!hintId) {
      return Response.json({ error: "Missing hintId" }, { status: 400, headers: responseHeaders })
    }
    const t1 = Date.now()

    // ⚠️ PERFORMANCE FIX: DON'T call getDailyTargetProtein here! ⚠️
    // getDailyTargetProtein validates structure availability with HTTP requests to upstream,
    // which takes 500-800ms. For hint reveals, we already HAVE a session with targetId.
    // Just load the existing state and fetch the protein directly from D1.
    const existingState = await getGameState(env, sessionId).catch(() => null)
    const t2 = Date.now()

    // For hint reveal, we MUST have an existing session (you can't reveal hints without playing)
    if (!existingState || !existingState.targetId) {
      return Response.json(
        { error: "No active game session" },
        { status: 400, headers: responseHeaders },
      )
    }

    // Use existing state directly - no need for ensureSessionForTodayWithState
    const state = existingState
    const t3 = Date.now()
    const targetProtein = await fetchProteinByUniprot(env.DB, state.targetId)
    const t4 = Date.now()
    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    const clueSections = buildClueSections(targetProtein)
    const hintData = extractHintData(clueSections, hintId)
    if (!hintData || !hintData.text) {
      return Response.json({ error: "Hint not found" }, { status: 404, headers: responseHeaders })
    }

    // B-222: Locked hints are visible as spoiler bars but cannot be revealed early.
    // Clicking them should not spend credits.
    if (hintData.locked) {
      return Response.json(
        {
          lockedHint: { id: hintId, locked: true },
          status: {
            hintBalance: state.hintBalance,
            revealedHints: state.revealedHints || [],
          },
        },
        { headers: responseHeaders },
      )
    }

    // ⚠️ DO NOT CALL hydrateGuessProteins HERE ⚠️
    // Client already has guess data from bootstrap. We just need to reveal the hint.
    // Adding guess hydration here caused 3+ second delays (B-205).

    let t5 = t4
    if (!(state.revealedHints || []).includes(hintId)) {
      if ((state.hintBalance || 0) < DEFAULT_HINT_COST) {
        return Response.json(
          { error: "Insufficient hints" },
          { status: 402, headers: responseHeaders },
        )
      }
      state.revealedHints = [...(state.revealedHints || []), hintId]
      state.hintBalance = Math.max(0, (state.hintBalance || 0) - DEFAULT_HINT_COST)
      await saveGameState(env, sessionId, state, {
        operation: "hint_reveal",
        requestPath: "/api/game/reveal-hint",
      })
      t5 = Date.now()
    }
    console.log(
      `[HINT REVEAL TIMING] parse:${t1 - t0}ms parallel:${t2 - t1}ms session:${t3 - t2}ms protein:${t4 - t3}ms save:${t5 - t4}ms total:${t5 - t0}ms`,
    )

    // ⚠️ CRITICAL PERFORMANCE - MINIMAL PAYLOAD ONLY ⚠️
    // DO NOT add guesses, clue, target, or ANY other data here!
    // The client does a surgical DOM update (just swaps the redaction span).
    // Adding more data triggers full re-render + 3D viewer reload = 3+ second delay.
    // See B-205 for the full horror story. This exact format is REQUIRED:
    return Response.json(
      {
        revealedHint: { id: hintId, text: hintData.text },
        status: {
          hintBalance: state.hintBalance,
          revealedHints: state.revealedHints,
        },
      },
      { headers: responseHeaders },
    )
  } catch (err) {
    console.error("GeneGuessr: hint reveal failed", err)
    return Response.json({ error: "Hint reveal failed" }, { status: 500, headers: corsHeaders })
  }
}

/**
 * ⚡ LAZY SIMILARITY CALCULATION
 *
 * Called after guess card is displayed to calculate and return similarity score.
 * This allows the guess card to appear instantly (~200ms) while similarity
 * calculation happens in the background (~1-2s).
 *
 * Client shows a spinner for the score, then updates when this returns.
 */
async function handleGuessSimilarity(request, env, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)

    const body = await safeJson(request)
    const guessId = body?.guessId
    if (!guessId) {
      return Response.json({ error: "Missing guessId" }, { status: 400, headers: responseHeaders })
    }

    // Get current game state
    const state = await getGameState(env, sessionId)
    if (!state) {
      return Response.json(
        { error: "Session not found" },
        { status: 404, headers: responseHeaders },
      )
    }

    // Find the guess entry
    const guessIndex = (state.guesses || []).findIndex((g) => g.guessId === guessId)
    if (guessIndex === -1) {
      return Response.json({ error: "Guess not found" }, { status: 404, headers: responseHeaders })
    }

    const guessEntry = state.guesses[guessIndex]

    // If similarity already calculated, return it immediately
    if (guessEntry.score !== null && !guessEntry.similarityPending) {
      return Response.json({ guessId, score: guessEntry.score }, { headers: responseHeaders })
    }

    // Fetch proteins for similarity calculation
    const [guessProtein, targetProtein] = await Promise.all([
      fetchProteinByUniprot(env.DB, guessEntry.uniprot),
      fetchProteinByUniprot(env.DB, state.targetId),
    ])

    if (!guessProtein || !targetProtein) {
      return Response.json(
        { error: "Protein data unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    // Calculate similarity
    let similarity
    let isLadder = false
    let ladderRank = null
    if (SIMILARITY_MODE === "blended") {
      const simResult = await getBlendedSimilarity(env.DB, guessProtein.gene, targetProtein.gene, {
        esm2Weight: ESM2_WEIGHT,
        targetNeighbors: targetProtein.neighbors,
      })
      similarity = simResult.blended
      isLadder = simResult.isLadder
      ladderRank = simResult.ladderRank
    } else {
      similarity = await getHig2vecSimilarity(env.DB, guessProtein.gene, targetProtein.gene)
    }

    const score = scoreGuess(guessProtein, targetProtein, { similarity, isLadder, ladderRank })

    // Update session state with calculated score
    state.guesses[guessIndex].score = score
    state.guesses[guessIndex].similarityPending = false
    await saveGameState(env, sessionId, state, {
      operation: "guess_similarity",
      requestPath: "/api/game/guess-similarity",
    })

    return Response.json({ guessId, score }, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: similarity calculation failed", err)
    return Response.json(
      { error: "Similarity calculation failed" },
      { status: 500, headers: corsHeaders },
    )
  }
}

async function getDailyTargetProtein(env, options = {}) {
  const eligibleIds = await getEligibleProteinIds(env.DB)
  if (!eligibleIds.length) {
    return null
  }

  let protein = null
  let startIdx = 0
  let balancedPick = null // Track surname info for practice mode

  const wantsAudit = Boolean(options.returnAudit)
  const audit = wantsAudit
    ? {
        date: null,
        source: options.practice ? "practice" : "computed",
        override_id: null,
        rejected: [],
        skipped_alpha_fold: null,
      }
    : null

  if (options.practice) {
    // Practice mode: Use surname-based balanced picking
    // This prevents over-representation of large gene families like ZNF, OR, KRTAP
    balancedPick = await pickRandomProteinBalanced(env.DB)

    if (balancedPick?.protein) {
      protein = balancedPick.protein
      startIdx = eligibleIds.indexOf(protein.uniprot)
      if (startIdx < 0) startIdx = 0
      console.log(
        `[PRACTICE] Balanced pick: ${protein.gene} from ${balancedPick.surname} family (${balancedPick.familySize} members)`,
      )
    } else {
      // Fallback to unbalanced random if surname-based fails
      console.warn("[PRACTICE] Balanced pick failed, using unbalanced random")
      startIdx = Math.floor(Math.random() * eligibleIds.length)
      const randomId = eligibleIds[startIdx]
      protein = await fetchProteinByUniprot(env.DB, randomId)
    }
  } else {
    // Daily mode: check for manual override first
    const today = new Date().toISOString().slice(0, 10)
    if (audit) {
      audit.date = today
    }
    const overrideKey = `puzzle_override:${today}`
    let overrideId = await env.KV.get(overrideKey)
    if (!overrideId && env.PROD_KV?.get) {
      overrideId = await env.PROD_KV.get(overrideKey)
    }
    if (overrideId) {
      const overrideProtein = await fetchProteinByUniprot(env.DB, overrideId)
      if (overrideProtein) {
        protein = overrideProtein
        startIdx = eligibleIds.indexOf(protein.uniprot)
        if (startIdx < 0) startIdx = 0
        if (audit) {
          audit.source = "override"
          audit.override_id = overrideId
          audit.skipped_alpha_fold = 0
        }
      }
    }

    // If prod has already served today's puzzle (no override needed), mirror that pick in staging.
    // This keeps `?gg_api=...staging...` usable for comparing visuals without changing live behavior.
    if (!protein && env.PROD_KV?.get) {
      try {
        const prodActualRaw = await env.PROD_KV.get(`puzzle_actual:${today}`)
        if (prodActualRaw) {
          const prodActual = JSON.parse(prodActualRaw)
          const prodUniprot = (prodActual?.uniprot_id || "").toString().trim().toUpperCase()
          if (prodUniprot) {
            const prodProtein = await fetchProteinByUniprot(env.DB, prodUniprot)
            if (prodProtein) {
              protein = prodProtein
              startIdx = eligibleIds.indexOf(protein.uniprot)
              if (startIdx < 0) startIdx = 0
              if (audit) {
                audit.source = "prod_actual"
                audit.override_id = null
                audit.skipped_alpha_fold = 0
              }
            }
          }
        }

        // Fallback: mirror prod's daily bootstrap cache if it exists (often available even when
        // puzzle_actual hasn't been recorded yet).
        if (!protein) {
          const prodDailyCache = await getProdDailyBootstrapCache(env, today)
          const prodDailyUniprot = (prodDailyCache?.targetProtein?.uniprot || "")
            .toString()
            .trim()
            .toUpperCase()
          if (prodDailyUniprot) {
            const prodProtein = await fetchProteinByUniprot(env.DB, prodDailyUniprot)
            if (prodProtein) {
              protein = prodProtein
              startIdx = eligibleIds.indexOf(protein.uniprot)
              if (startIdx < 0) startIdx = 0
              if (audit) {
                audit.source = "prod_daily_cache"
                audit.override_id = null
                audit.skipped_alpha_fold = 0
              }
            }
          }
        }
      } catch (err) {
        console.warn("GeneGuessr: failed to mirror prod daily pick", err?.message || err)
      }
    }

    if (!protein) {
      const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT
      const selection = await pickDailyTarget(env.DB, eligibleIds, salt)
      protein = selection?.protein || null
      if (audit) {
        audit.source = "computed"
        audit.skipped_alpha_fold = Number.isFinite(selection?.skippedAlphaFold)
          ? selection.skippedAlphaFold
          : null
      }
      startIdx = eligibleIds.indexOf(protein?.uniprot)
      if (startIdx < 0) startIdx = 0
    }
  }

  // Validate structure availability before committing to this pick.
  // If upstream (SWISS-MODEL/AlphaFold/PDB) is down or URL is broken, try next candidate.
  // This prevents serving a game with a broken structure viewer.
  if (protein && env) {
    const MAX_ATTEMPTS = 10
    let attempts = 0
    let currentIdx = startIdx

    while (attempts < MAX_ATTEMPTS) {
      const structureMeta = await getCanonicalStructureMeta(protein, env)
      if (structureMeta?.r2Key) {
        console.log(
          `[TARGET-PICK] ${protein.uniprot} validated with ${structureMeta.source} (${structureMeta.r2Key})`,
        )
        break
      }

      console.warn(`[TARGET-PICK] ${protein.uniprot} has no working structure, trying next`)
      if (audit) {
        audit.rejected.push({ uniprot_id: protein.uniprot, reason: "no_working_structure" })
      }

      // This protein's structure is unavailable - try next candidate
      attempts++
      currentIdx = (currentIdx + 1) % eligibleIds.length
      const nextId = eligibleIds[currentIdx]
      const nextProtein = await fetchProteinByUniprot(env.DB, nextId)
      if (nextProtein && !isAlphaFoldOnlyProtein(nextProtein)) {
        protein = nextProtein
      }
    }

    if (attempts >= MAX_ATTEMPTS) {
      console.error(
        `[TARGET-PICK] Failed to find protein with working structure after ${attempts} attempts`,
      )
    } else if (attempts > 0) {
      console.log(`[TARGET-PICK] Skipped ${attempts} proteins with unavailable structures`)
    }
  }

  return audit ? { protein, audit } : protein
}

function createInitialGameState(date, targetId, options = {}) {
  return {
    version: 2,
    date,
    targetId,
    guesses: [],
    hintBalance: DEFAULT_HINT_COST,
    revealedHints: [],
    won: false,
    statsRecorded: false,
    guessStatsRecordedThrough: 0,
    practiceMode: Boolean(options.practiceMode),
    practicePool: Array.isArray(options.practicePool) ? options.practicePool.slice() : null,
    createdAt: Date.now(),
  }
}

async function maybeRecordDailyGuessAggregatesDelta(env, state, { practiceMode }) {
  const isPractice = Boolean(practiceMode) || Boolean(state?.practiceMode)
  if (isPractice) return false
  if (!state?.date || !state?.targetId) return false

  const guesses = Array.isArray(state.guesses) ? state.guesses : []
  let recordedThrough = Number(state.guessStatsRecordedThrough)
  if (!Number.isFinite(recordedThrough) || recordedThrough < 0) recordedThrough = 0

  // Backwards-compat: if an older session already marked aggregates as recorded, don't double-count.
  if (state.guessStatsRecorded === true && state.guessStatsRecordedThrough == null) {
    state.guessStatsRecordedThrough = guesses.length
    return false
  }

  if (guesses.length <= recordedThrough) return false

  const delta = guesses.slice(recordedThrough)
  const result = await recordDailyGuessAggregates(env.DB, {
    day: state.date,
    targetUniprot: state.targetId,
    guesses: delta,
  })

  if (!result.ok) return false
  state.guessStatsRecordedThrough = guesses.length
  return true
}

async function ensureSessionForToday(env, sessionId, targetProtein, options = {}) {
  const practiceMode = Boolean(options.practiceMode)
  const forceReset = Boolean(options.forceReset)
  const today = new Date().toISOString().slice(0, 10)
  let state = null
  try {
    state = await getGameState(env, sessionId)
  } catch (err) {
    console.warn("GeneGuessr: failed to load session, resetting", err)
    state = null
  }
  return ensureSessionForTodayWithState(env, sessionId, targetProtein, state, options)
}

/**
 * ⚠️ PERFORMANCE OPTIMIZATION - ACCEPTS PRE-FETCHED STATE ⚠️
 *
 * This variant accepts an already-fetched state to avoid redundant DO calls.
 * Used by handleGameBootstrap which fetches state in parallel with target protein.
 *
 * DO NOT remove this function or inline it - the parallel fetch optimization depends on it.
 */
async function ensureSessionForTodayWithState(
  env,
  sessionId,
  targetProtein,
  existingState,
  options = {},
) {
  const practiceMode = Boolean(options.practiceMode)
  const forceReset = Boolean(options.forceReset)
  const preservePracticePool = Boolean(options.preservePracticePool)
  const writeObservation = options.writeObservation || null
  const today = new Date().toISOString().slice(0, 10)
  let state = existingState
  const applyDesiredTarget = forceReset || !state
  const desiredTargetId = applyDesiredTarget && targetProtein ? targetProtein.uniprot : null
  const needsReset =
    forceReset ||
    !state ||
    state.date !== today ||
    (desiredTargetId && state.targetId !== desiredTargetId)
  if (needsReset) {
    if (!targetProtein?.uniprot) {
      throw new Error("Target protein required to initialize session")
    }
    const practicePool =
      practiceMode && preservePracticePool && Array.isArray(existingState?.practicePool)
        ? existingState.practicePool
        : null
    state = createInitialGameState(today, targetProtein.uniprot, { practiceMode, practicePool })
    await saveGameState(env, sessionId, state, writeObservation)
  } else if (state.practiceMode !== practiceMode) {
    state.practiceMode = practiceMode
    await saveGameState(env, sessionId, state, writeObservation)
  }
  return state
}

/**
 * ⚠️ PERFORMANCE CRITICAL - BATCHED HYDRATION ⚠️
 *
 * This function hydrates protein data and similarity scores for all guesses.
 *
 * BEFORE (slow): Sequential for-loop, N guesses × 2-3 DB calls each = 15+ serial queries
 * AFTER (fast): Promise.all for protein fetches, skip similarity if already stored
 *
 * For a returning player with 5 guesses, this saves 500-1500ms.
 *
 * DO NOT change this back to a sequential for-loop.
 * DO NOT recalculate similarity if entry.score already exists.
 */
async function hydrateGuessProteins(env, sessionId, state, targetProtein) {
  if (!Array.isArray(state?.guesses) || state.guesses.length === 0) {
    return
  }

  let dirty = false
  const validEntries = state.guesses.filter((e) => e != null)

  // ⚠️ BATCH PROTEIN FETCHES - DO NOT SERIALIZE ⚠️
  // Fetch all missing proteins in parallel
  const proteinFetchPromises = validEntries.map(async (entry) => {
    if (!entry.protein) {
      const protein = await fetchProteinByUniprot(env.DB, entry.uniprot)
      if (protein) {
        entry.protein = {
          ...protein,
          gene_summary: cleanGeneSummary(protein.gene_summary),
        }
        return true // indicates dirty
      }
    }
    return false
  })

  const proteinResults = await Promise.all(proteinFetchPromises)
  if (proteinResults.some((r) => r)) {
    dirty = true
  }

  // ⚠️ SKIP SIMILARITY RECALC IF SCORE EXISTS OR PENDING ⚠️
  // Scores are stored in session state and only need calculation on first guess.
  // Recalculating every bootstrap wastes 100-300ms per guess.
  // ⚡ LAZY SIMILARITY: Skip entries with similarityPending - client will fetch via /api/game/guess-similarity
  const entriesNeedingScore = validEntries.filter(
    (entry) =>
      entry.protein && targetProtein && !entry.score?.similarity && !entry.similarityPending,
  )

  if (entriesNeedingScore.length > 0) {
    // Batch similarity calculations for entries that need them
    const similarityPromises = entriesNeedingScore.map(async (entry) => {
      let similarity
      let isLadder = false
      let ladderRank = null
      if (SIMILARITY_MODE === "blended") {
        const simResult = await getBlendedSimilarity(
          env.DB,
          entry.protein.gene || entry.protein.hgnc,
          targetProtein.gene,
          { esm2Weight: ESM2_WEIGHT, targetNeighbors: targetProtein.neighbors },
        )
        similarity = simResult.blended
        isLadder = simResult.isLadder
        ladderRank = simResult.ladderRank
      } else {
        similarity = await getHig2vecSimilarity(
          env.DB,
          entry.protein.gene || entry.protein.hgnc,
          targetProtein.gene,
        )
      }
      const nextScore = scoreGuess(entry.protein, targetProtein, {
        similarity,
        isLadder,
        ladderRank,
      })
      entry.score = nextScore
      return true // dirty
    })

    await Promise.all(similarityPromises)
    dirty = true
  }

  if (dirty && sessionId) {
    await saveGameState(env, sessionId, state, {
      operation: "hydrate_guess_proteins",
      requestPath: null,
    })
  }
}

function buildGamePayload(state, targetProtein, options = {}) {
  const revealedHints = new Set(state.revealedHints || [])
  const domainSpoilerTokens = getDomainSpoilerTokensFromFullName(targetProtein?.full_name)
  const clueSections = options.clueSections || buildClueSections(targetProtein)
  const maskedSections = maskClueSections(clueSections, revealedHints)
  const clueTarget = sanitizeTargetProtein(targetProtein, {
    revealIdentity: state.won || (state.guesses?.length || 0) >= MAX_GUESSES,
  })
  const guessEntries = []
  const aggregatedMatches = {}
  let latestMatches = {}
  ;(state.guesses || []).forEach((entry, index) => {
    const guessProtein = entry.protein || null
    if (!guessProtein) {
      return
    }
    const guessProteinCleaned = {
      ...guessProtein,
      gene_summary: cleanGeneSummary(guessProtein.gene_summary),
    }
    // ⚡ LAZY SIMILARITY: If similarity is pending, don't call scoreGuess - preserve null score
    const resolvedScore = entry.similarityPending
      ? null // Keep null, client will fetch via /api/game/guess-similarity
      : entry.score ||
        scoreGuess(guessProtein, targetProtein, {
          similarity: entry.score?.similarity,
        })
    const matches = collectMatchedHintTexts(targetProtein, guessProtein, resolvedScore, {
      domainSpoilerTokens,
    })
    aggregateMatches(aggregatedMatches, matches)
    const isLatest = index === state.guesses.length - 1
    if (isLatest) {
      latestMatches = matches
    }
    guessEntries.push({
      guessId: entry.guessId,
      uniprot: entry.uniprot,
      correct: Boolean(entry.correct),
      createdAt: entry.createdAt,
      score: resolvedScore,
      similarityPending: Boolean(entry.similarityPending), // ⚡ Pass through to client
      matchedHints: matches,
      sections: buildFeedbackSections(guessProteinCleaned, { domainSpoilerTokens }),
      headerLabel: guessProtein.hgnc || guessProtein.uniprot,
      fullName: guessProtein.full_name || "",
      isLatest,
    })
  })
  const lost = !state.won && guessEntries.length >= MAX_GUESSES
  const targetReveal =
    state.won || lost ? sanitizeTargetProtein(targetProtein, { revealIdentity: true }) : null
  const targetRevealSections = targetReveal ? buildFeedbackSections(targetProtein) : null
  const shareText = targetReveal ? buildShareText(state, guessEntries) : null
  applyMatchReveals(maskedSections, aggregatedMatches)

  // B-217: Some clue-domain items may be filtered out server-side.
  // Ensure clue highlight metadata only refers to items that actually exist in clue sections.
  const latestMatchesForClue = filterMatchesToExistingSectionItems(maskedSections, latestMatches)
  applyLatestHighlights(maskedSections, latestMatchesForClue)
  // Only reveal targetId after game ends (won or lost) to prevent cheating
  const gameOver = Boolean(state.won) || lost
  return {
    status: {
      date: state.date,
      won: Boolean(state.won),
      lost,
      guessCount: guessEntries.length,
      maxGuesses: MAX_GUESSES,
      hintBalance: state.hintBalance,
      revealedHints: state.revealedHints || [],
      practiceMode: Boolean(state.practiceMode),
      ...(gameOver && { targetId: state.targetId }),
    },
    clueTarget,
    clue: {
      sections: maskedSections,
      allMatches: aggregatedMatches,
      latestMatches: latestMatchesForClue,
    },
    guesses: guessEntries,
    targetReveal,
    targetRevealSections,
    shareText,
  }
}

function filterMatchesToExistingSectionItems(sections, matches) {
  if (!matches || typeof matches !== "object" || !Array.isArray(sections)) {
    return matches || {}
  }
  const filtered = {}
  for (const section of sections) {
    if (!section?.id || !Array.isArray(section.items)) {
      continue
    }
    const values = matches?.[section.id]
    if (!Array.isArray(values) || values.length === 0) {
      continue
    }
    const allowed = new Set(
      section.items
        .map((item) =>
          item?.fullText ? String(item.fullText) : item?.text ? String(item.text) : "",
        )
        .filter(Boolean),
    )
    const kept = values.filter((value) => allowed.has(value))
    if (kept.length) {
      filtered[section.id] = kept
    }
  }
  return filtered
}

function aggregateMatches(destination, matches) {
  Object.entries(matches || {}).forEach(([sectionId, values]) => {
    if (!destination[sectionId]) {
      destination[sectionId] = []
    }
    values.forEach((value) => {
      if (!destination[sectionId].includes(value)) {
        destination[sectionId].push(value)
      }
    })
  })
}

function buildShareText(state, guesses) {
  const emoji = state.won ? "You Win!" : "Game Over"
  const guessCount = guesses.length
  const today = state.date || new Date().toISOString().slice(0, 10)
  const grid = guesses
    .map((entry) => {
      if (entry.correct) {
        return "??"
      }
      const simScore = typeof entry.score?.similarity === "number" ? entry.score.similarity : 0
      return simScore >= 0.35 ? "??" : "?"
    })
    .join("")
  return `Geneguessr ${today}
${emoji} ${guessCount}/${MAX_GUESSES}

${grid}

https://geneguessr.brinedew.bio/`
}

function applyMatchReveals(sections, matches) {
  if (!Array.isArray(sections)) {
    return
  }
  sections.forEach((section) => {
    const matchedValues = matches?.[section.id]
    if (!Array.isArray(matchedValues) || matchedValues.length === 0) {
      return
    }
    const set = new Set(matchedValues)
    section.items.forEach((item) => {
      if (!item || !item.fullText) {
        return
      }
      // Don't reveal locked hints through matching
      if (item.locked) {
        return
      }
      if (set.has(item.fullText)) {
        item.revealed = true
        item.text = item.fullText
      }
    })
  })
}

function applyLatestHighlights(sections, latestMatches) {
  if (!Array.isArray(sections) || !latestMatches) {
    return
  }
  sections.forEach((section) => {
    const values = latestMatches?.[section.id]
    if (!Array.isArray(values) || !values.length) {
      section.items.forEach((item) => {
        if (item) {
          item.highlighted = false
        }
      })
      return
    }
    const set = new Set(values)
    section.items.forEach((item) => {
      if (!item || !item.fullText) {
        item && (item.highlighted = false)
        return
      }
      item.highlighted = set.has(item.fullText)
    })
  })
}

function normalizeGeneToken(raw) {
  const trimmed = String(raw || "").trim()
  if (!trimmed) return null
  const cleaned = trimmed.replace(/^[^A-Za-z0-9-]+|[^A-Za-z0-9-]+$/g, "")
  if (!cleaned) return null
  return cleaned.toUpperCase()
}

function parseGeneInputs(body) {
  if (Array.isArray(body?.genes)) {
    return body.genes
  }
  if (typeof body?.text === "string") {
    return body.text.split(/[,\s;]+/g)
  }
  return []
}

async function resolveGenesExact(db, genesUpper) {
  const found = new Map()
  if (!db || !Array.isArray(genesUpper) || genesUpper.length === 0) {
    return found
  }

  for (let offset = 0; offset < genesUpper.length; offset += PRACTICE_RESOLVE_SQL_CHUNK) {
    const chunk = genesUpper.slice(offset, offset + PRACTICE_RESOLVE_SQL_CHUNK)
    if (chunk.length === 0) continue
    const placeholders = chunk.map(() => "?").join(",")
    const statement = `
      SELECT gene, uniprot, structure_source, alphafold_url, pdb_id, swissmodel_url
      FROM proteins
      WHERE upper(gene) IN (${placeholders})
    `
    const resp = await db
      .prepare(statement)
      .bind(...chunk)
      .all()
    for (const row of resp?.results || []) {
      const key = normalizeGeneToken(row?.gene)
      if (!key) continue
      if (!found.has(key)) {
        found.set(key, row)
      }
    }
  }

  return found
}

async function handlePracticeResolve(request, env, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)
    const body = await safeJson(request)

    const rawInputs = parseGeneInputs(body)
    const normalizedInputs = []
    const seen = new Set()
    for (const value of rawInputs) {
      const gene = normalizeGeneToken(value)
      if (!gene) continue
      if (seen.has(gene)) continue
      seen.add(gene)
      normalizedInputs.push(gene)
      if (normalizedInputs.length >= PRACTICE_RESOLVE_MAX_INPUTS) break
    }

    if (normalizedInputs.length === 0) {
      return Response.json(
        {
          inputCount: rawInputs.length,
          uniqueCount: 0,
          recognizedCount: 0,
          playableCount: 0,
          playable: [],
          unrecognized: [],
          recognizedUnplayable: [],
        },
        { headers: responseHeaders },
      )
    }

    const found = await resolveGenesExact(env.DB, normalizedInputs)
    const playable = []
    const recognizedUnplayable = []
    const unrecognized = []

    for (const gene of normalizedInputs) {
      const row = found.get(gene)
      if (!row) {
        unrecognized.push(gene)
        continue
      }
      const hasStructure =
        Boolean(row?.structure_source) ||
        Boolean(row?.alphafold_url) ||
        Boolean(row?.pdb_id) ||
        Boolean(row?.swissmodel_url)
      if (hasStructure) {
        playable.push({ gene: row.gene || gene, uniprot: String(row.uniprot || "").toUpperCase() })
      } else {
        recognizedUnplayable.push(row.gene || gene)
      }
    }

    return Response.json(
      {
        inputCount: rawInputs.length,
        uniqueCount: normalizedInputs.length,
        recognizedCount: normalizedInputs.length - unrecognized.length,
        playableCount: playable.length,
        playable,
        unrecognized,
        recognizedUnplayable,
        truncated: normalizedInputs.length >= PRACTICE_RESOLVE_MAX_INPUTS,
      },
      { headers: responseHeaders },
    )
  } catch (err) {
    console.error("GeneGuessr: practice resolve failed", err)
    return Response.json(
      { error: "Practice resolve failed" },
      { status: 500, headers: corsHeaders },
    )
  }
}

async function handlePracticeStart(request, env, ctx, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)
    const url = new URL(request.url)
    const practiceMode = url.searchParams.get("practice") === "1"
    if (!practiceMode) {
      return Response.json(
        { error: "Practice mode required" },
        { status: 400, headers: responseHeaders },
      )
    }

    const body = await safeJson(request)
    const raw = Array.isArray(body?.uniprots) ? body.uniprots : []
    const pool = []
    const seen = new Set()
    for (const value of raw) {
      const id = String(value || "")
        .trim()
        .toUpperCase()
      if (!id) continue
      if (seen.has(id)) continue
      seen.add(id)
      pool.push(id)
    }

    if (pool.length === 0) {
      return Response.json(
        { error: "Empty practice pool" },
        { status: 400, headers: responseHeaders },
      )
    }

    const today = new Date().toISOString().slice(0, 10)
    const targetId = pool[Math.floor(Math.random() * pool.length)]
    const targetProtein = await fetchProteinByUniprot(env.DB, targetId)
    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    const state = createInitialGameState(today, targetProtein.uniprot, {
      practiceMode: true,
      practicePool: pool,
    })

    let structureToken = null
    try {
      const structureSelection = await buildTargetStructureSelection(targetProtein, env, {
        practiceMode: true,
        origin: url.origin,
      })
      structureToken = structureSelection?.token || null
      if (structureSelection?.meta) {
        state.targetStructureMeta = structureSelection.meta
      }
    } catch (err) {
      console.warn("GeneGuessr: practice start structure token failed (non-fatal)", err)
      structureToken = null
    }

    await saveGameState(env, sessionId, state, {
      operation: "practice_start",
      requestPath: "/api/game/practice/start",
    })

    const payload = buildGamePayload(state, targetProtein)
    if (structureToken) {
      payload.targetStructureToken = structureToken
    }

    return Response.json(payload, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: practice start failed", err)
    return Response.json({ error: "Practice start failed" }, { status: 500, headers: corsHeaders })
  }
}

async function safeJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function parseBoolParam(raw, fallback = false) {
  if (raw === null || raw === undefined) {
    return fallback
  }
  const value = String(raw).trim().toLowerCase()
  if (value === "1" || value === "true" || value === "yes" || value === "y") return true
  if (value === "0" || value === "false" || value === "no" || value === "n") return false
  return fallback
}

function clampInt(value, min, max, fallback) {
  const numeric = Number.parseInt(String(value), 10)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

async function handleAdminPurgeOrphanStructures(request, env, corsHeaders) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403, headers: corsHeaders })
  }
  if (!env?.STRUCTURES_BUCKET || !env?.KV) {
    return Response.json(
      { error: "Missing STRUCTURES_BUCKET or KV binding" },
      { status: 500, headers: corsHeaders },
    )
  }

  const url = new URL(request.url)
  const cursorIn = url.searchParams.get("cursor") || undefined
  const prefixRaw = (url.searchParams.get("prefix") || "").trim()
  const prefix = prefixRaw === "" ? undefined : prefixRaw
  const dryRun = parseBoolParam(url.searchParams.get("dryRun"), true)
  const limit = clampInt(url.searchParams.get("limit"), 1, 1000, 250)

  // Safety: only allow the known structure prefixes.
  const allowedPrefixes = new Set(["pdb/", "alphafold/", "swissmodel/"])
  if (prefix && !allowedPrefixes.has(prefix)) {
    return Response.json(
      {
        error: "Invalid prefix. Allowed: pdb/, alphafold/, swissmodel/",
        prefix,
      },
      { status: 400, headers: corsHeaders },
    )
  }

  const listResp = await env.STRUCTURES_BUCKET.list({ cursor: cursorIn, limit, prefix })
  const objects = listResp?.objects || []

  let scanned = 0
  let orphaned = 0
  let deleted = 0
  let errors = 0
  const sampleOrphans = []

  for (const obj of objects) {
    const key = obj?.key || obj?.name
    if (!key) {
      continue
    }
    scanned += 1
    let metaRaw = null
    try {
      metaRaw = await env.KV.get(`${STRUCTURE_CACHE_META_PREFIX}${key}`)
    } catch {
      // If KV read fails, don't delete blindly.
      errors += 1
      continue
    }

    if (metaRaw) {
      continue
    }

    orphaned += 1
    if (sampleOrphans.length < 25) {
      sampleOrphans.push({ key, size: obj?.size || 0, uploaded: obj?.uploaded || null })
    }

    if (dryRun) {
      continue
    }

    try {
      await env.STRUCTURES_BUCKET.delete(key)
      deleted += 1
    } catch {
      errors += 1
    }
  }

  const nextCursor = listResp?.truncated ? listResp?.cursor || null : null

  return Response.json(
    {
      dryRun,
      limit,
      prefix: prefix || null,
      cursorIn: cursorIn || null,
      nextCursor,
      scanned,
      orphaned,
      deleted,
      errors,
      sampleOrphans,
    },
    { headers: corsHeaders },
  )
}

async function handleAdminDeleteStructure(request, env, corsHeaders) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403, headers: corsHeaders })
  }
  if (!env?.STRUCTURES_BUCKET || !env?.KV) {
    return Response.json(
      { error: "Missing STRUCTURES_BUCKET or KV binding" },
      { status: 500, headers: corsHeaders },
    )
  }

  const url = new URL(request.url)
  const key = (url.searchParams.get("key") || "").trim()
  const dryRun = parseBoolParam(url.searchParams.get("dryRun"), true)
  const deleteMeta = parseBoolParam(url.searchParams.get("deleteMeta"), true)

  if (!key) {
    return Response.json({ error: "Missing key" }, { status: 400, headers: corsHeaders })
  }
  if (key.startsWith("/") || key.includes("..")) {
    return Response.json({ error: "Invalid key" }, { status: 400, headers: corsHeaders })
  }

  const allowedPrefixes = new Set(["pdb/", "alphafold/", "swissmodel/"])
  const keyPrefix = [...allowedPrefixes].find((p) => key.startsWith(p)) || null
  if (!keyPrefix) {
    return Response.json(
      {
        error: "Invalid key prefix. Allowed: pdb/, alphafold/, swissmodel/",
        key,
      },
      { status: 400, headers: corsHeaders },
    )
  }

  let exists = false
  let size = null
  try {
    const head = await env.STRUCTURES_BUCKET.head(key)
    exists = Boolean(head)
    size = head?.size ?? null
  } catch {
    // If head fails, don't delete blindly.
    return Response.json(
      { error: "Failed to read object metadata", key },
      { status: 500, headers: corsHeaders },
    )
  }

  let deletedObject = false
  let deletedMeta = false

  if (!dryRun && exists) {
    try {
      await env.STRUCTURES_BUCKET.delete(key)
      deletedObject = true
    } catch {
      return Response.json(
        { error: "Failed to delete object", key },
        { status: 500, headers: corsHeaders },
      )
    }
  }

  if (!dryRun && deleteMeta) {
    try {
      await env.KV.delete(`${STRUCTURE_CACHE_META_PREFIX}${key}`)
      deletedMeta = true
    } catch {
      // Non-fatal. Meta is best-effort.
      deletedMeta = false
    }
  }

  return Response.json(
    {
      dryRun,
      key,
      keyPrefix,
      exists,
      size,
      deleteMeta,
      deletedObject,
      deletedMeta,
    },
    { headers: corsHeaders },
  )
}

async function listReferencedStructureKeys(env) {
  const keys = new Set()
  const stats = {
    rows: 0,
    referenced: 0,
    referencedBySource: {
      pdb: 0,
      alphafold: 0,
      swissmodel: 0,
      other: 0,
    },
    nullMetaRows: 0,
  }

  if (!env?.DB) {
    return { keys, stats }
  }

  const PAGE = 1000
  let offset = 0
  while (true) {
    const resp = await env.DB.prepare(
      `SELECT uniprot, structure_source, pdb_id, alphafold_url, swissmodel_url, swissmodel_template
         FROM proteins
         WHERE structure_source IS NOT NULL
         LIMIT ? OFFSET ?`,
    )
      .bind(PAGE, offset)
      .all()

    const rows = resp?.results || []
    stats.rows += rows.length
    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      const meta = buildMetaFromStoredStructure(row)
      if (!meta?.r2Key) {
        stats.nullMetaRows += 1
        continue
      }
      keys.add(meta.r2Key)
      stats.referenced += 1
      const source = meta.source || row.structure_source
      if (source === "pdb") stats.referencedBySource.pdb += 1
      else if (source === "alphafold") stats.referencedBySource.alphafold += 1
      else if (source === "swissmodel") stats.referencedBySource.swissmodel += 1
      else stats.referencedBySource.other += 1
    }

    if (rows.length < PAGE) {
      break
    }
    offset += PAGE
  }

  return { keys, stats }
}

async function handleAdminPurgeUnreferencedStructures(request, env, corsHeaders) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 403, headers: corsHeaders })
  }
  if (!env?.STRUCTURES_BUCKET || !env?.KV || !env?.DB) {
    return Response.json(
      { error: "Missing STRUCTURES_BUCKET, KV, or DB binding" },
      { status: 500, headers: corsHeaders },
    )
  }

  const url = new URL(request.url)
  const cursorIn = url.searchParams.get("cursor") || undefined
  const prefixRaw = (url.searchParams.get("prefix") || "").trim()
  const prefix = prefixRaw === "" ? undefined : prefixRaw
  const dryRun = parseBoolParam(url.searchParams.get("dryRun"), true)
  const limit = clampInt(url.searchParams.get("limit"), 1, 1000, 250)
  const deleteMeta = parseBoolParam(url.searchParams.get("deleteMeta"), true)

  const allowedPrefixes = new Set(["pdb/", "alphafold/", "swissmodel/"])
  if (prefix && !allowedPrefixes.has(prefix)) {
    return Response.json(
      {
        error: "Invalid prefix. Allowed: pdb/, alphafold/, swissmodel/",
        prefix,
      },
      { status: 400, headers: corsHeaders },
    )
  }

  // Build the referenced set from the current DB.
  const { keys: referencedKeys, stats: referenceStats } = await listReferencedStructureKeys(env)

  const listResp = await env.STRUCTURES_BUCKET.list({ cursor: cursorIn, limit, prefix })
  const objects = listResp?.objects || []

  let scanned = 0
  let unreferenced = 0
  let deleted = 0
  let deletedBytes = 0
  let errors = 0
  const sampleUnreferenced = []

  for (const obj of objects) {
    const key = obj?.key || obj?.name
    if (!key) {
      continue
    }
    scanned += 1
    if (referencedKeys.has(key)) {
      continue
    }

    unreferenced += 1
    if (sampleUnreferenced.length < 25) {
      sampleUnreferenced.push({ key, size: obj?.size || 0, uploaded: obj?.uploaded || null })
    }

    if (dryRun) {
      continue
    }

    try {
      await env.STRUCTURES_BUCKET.delete(key)
      deleted += 1
      deletedBytes += obj?.size || 0
    } catch {
      errors += 1
      continue
    }

    if (deleteMeta) {
      try {
        await env.KV.delete(`${STRUCTURE_CACHE_META_PREFIX}${key}`)
      } catch {
        // Best-effort.
      }
    }
  }

  const nextCursor = listResp?.truncated ? listResp?.cursor || null : null

  return Response.json(
    {
      dryRun,
      limit,
      prefix: prefix || null,
      cursorIn: cursorIn || null,
      nextCursor,
      deleteMeta,
      scanned,
      unreferenced,
      deleted,
      deletedBytes,
      errors,
      sampleUnreferenced,
      referenceStats,
      referencedKeyCount: referencedKeys.size,
    },
    { headers: corsHeaders },
  )
}

/**
 * Build structure metadata from flat protein columns.
 * Returns null if structure data is missing or incomplete.
 */
function buildMetaFromStoredStructure(protein) {
  return buildStructureMetaFromStoredSource(protein)
}

const STRUCTURE_SOURCE_CACHE_PREFIX = "structure_source:"
const STRUCTURE_SOURCE_CACHE_TTL = 60 * 60 * 24 // 24 hours

function hasStoredStructureSource(protein, source) {
  if (!protein || !source) {
    return false
  }
  if (source === "pdb") {
    return Boolean(protein.pdb_id)
  }
  if (source === "swissmodel") {
    return Boolean(protein.swissmodel_url)
  }
  if (source === "alphafold") {
    return Boolean(protein.alphafold_url)
  }
  return false
}

function buildStoredStructureCandidates(protein) {
  if (!protein) {
    return []
  }

  const candidates = []
  const seenKeys = new Set()
  const explicitSource = String(protein.structure_source || "")
    .trim()
    .toLowerCase()

  const pushCandidate = (source) => {
    if (!hasStoredStructureSource(protein, source)) {
      return
    }
    const meta = buildStructureMetaFromStoredSource({ ...protein, structure_source: source })
    if (!meta?.r2Key || seenKeys.has(meta.r2Key)) {
      return
    }
    seenKeys.add(meta.r2Key)
    candidates.push(meta)
  }

  pushCandidate(explicitSource)
  pushCandidate("pdb")
  pushCandidate("swissmodel")
  pushCandidate("alphafold")

  return candidates
}

// Cache index metadata (KV).
//
// We keep an index of R2 objects in KV (size + lastAccess) so we can evict old
// structures when the bucket hits a cap.
//
// These entries have NO TTL - they persist until explicitly deleted by evictStructureCache().
// This prevents orphaning: if KV expired but R2 didn't, eviction couldn't find/delete the R2 object.

async function isStructureMetaAvailable(env, meta) {
  if (!meta?.r2Key) {
    return false
  }
  if (!env) {
    return true
  }
  if (await structureObjectExists(env, meta.r2Key)) {
    return true
  }
  if (!meta.upstreamUrl) {
    return false
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const upstreamResp = await fetch(meta.upstreamUrl, {
      method: "GET",
      headers: {
        "User-Agent": "GeneGuessr-Worker/1.0",
        Range: "bytes=0-0",
      },
      signal: controller.signal,
    })
    return upstreamResp.ok || upstreamResp.status === 206
  } catch (err) {
    console.warn(`GeneGuessr: structure probe failed for ${meta.r2Key}`, err?.message || err)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveStoredStructureMeta(protein, env) {
  const candidates = buildStoredStructureCandidates(protein)
  if (!candidates.length) {
    return null
  }

  // The explicit `proteins.structure_source` value is the curated database
  // decision. Return it without probing and without trying "better-looking"
  // alternatives first.
  //
  // This looks counterintuitive because `isStructureMetaAvailable()` exists just
  // below. The important distinction is whether the database made an explicit
  // choice:
  //
  // - Explicit source present: respect it. A short network probe is not allowed
  //   to overrule the row. On 2026-05-19 Cloudflare-to-RCSB aborted a 5-second
  //   availability probe for `pdb/1B64.bcif`, and the old code treated that
  //   transient probe failure as permission to fall back to SWISS-MODEL. That
  //   made bootstrap and structure bytes disagree.
  // - No explicit source: probe candidates, because there is no curated source
  //   to protect and a reachable fallback is better than no structure.
  //
  // Do not move the probe above this block. Availability probes are advisory for
  // fallback discovery; they are not a source-of-truth mechanism.
  const explicitSource = String(protein.structure_source || "")
    .trim()
    .toLowerCase()
  const explicitMeta = candidates.find((candidate) => candidate.source === explicitSource)
  if (explicitMeta) {
    return explicitMeta
  }

  if (!env) {
    return candidates[0]
  }

  for (const candidate of candidates) {
    if (await isStructureMetaAvailable(env, candidate)) {
      if (candidate.source !== protein.structure_source) {
        console.warn(
          `GeneGuessr: falling back from stored ${protein.structure_source || "unknown"} to ${candidate.source} for ${protein.uniprot}`,
        )
      }
      return candidate
    }
  }

  return null
}

async function getCanonicalStructureMeta(protein, env) {
  if (!protein) {
    return null
  }

  const cacheKey = `${STRUCTURE_SOURCE_CACHE_PREFIX}${protein.uniprot}`

  // The database row is the canonical structure decision. KV is only a cache of
  // that decision or a fallback for proteins whose stored source is missing.
  //
  // This ordering is a regression guard, not a style preference. A stale
  // `structure_source:P24534` KV value once pointed to:
  //
  //   swissmodel/P24534_5dqs.pdb
  //
  // while the current DB row correctly said:
  //
  //   structure_source = "pdb", pdb_id = "1B64"
  //
  // Bootstrap used the DB-backed RCSB metadata and emitted `format: "bcif"`.
  // The target structure endpoint separately trusted the stale KV value and
  // streamed PDB `ATOM...` text. Mol* then crashed with a misleading
  // `Cannot read properties of undefined (reading 'transform')` error because
  // the real bug was a server-side format/source mismatch.
  //
  // Future rule: never read KV before current stored DB metadata for proteins
  // that have a stored source. KV is a performance cache; it is not allowed to
  // contradict the curated row.
  const storedMeta = await resolveStoredStructureMeta(protein, env)
  if (storedMeta) {
    console.log(
      `GeneGuessr: using stored structure metadata for ${protein.uniprot} (${storedMeta.source})`,
    )
    try {
      await env.KV?.put(cacheKey, JSON.stringify(storedMeta), {
        expirationTtl: STRUCTURE_SOURCE_CACHE_TTL,
      })
    } catch (err) {
      console.warn("GeneGuessr: failed to cache stored structure source", err)
    }
    return storedMeta
  }

  // Check KV after stored metadata so stale cache entries cannot override the
  // current database source selection. This branch is for proteins without a
  // usable stored source or for discovered external metadata, not for replacing
  // curated rows.
  try {
    const cached = await env.KV?.get(cacheKey, { type: "json" })
    if (cached) {
      if (await isStructureMetaAvailable(env, cached)) {
        console.log(`GeneGuessr: structure source cache hit for ${protein.uniprot}`)
        return cached
      }
      console.warn(`GeneGuessr: cached structure source stale for ${protein.uniprot}, refreshing`)
      await env.KV?.delete(cacheKey)
    }
  } catch (err) {
    console.warn("GeneGuessr: failed to read structure source cache", err)
  }

  // SLOW PATH: Discover structure from external APIs (for proteins not in our database)
  console.log(
    `GeneGuessr: structure source cache miss for ${protein.uniprot}, discovering from APIs...`,
  )

  // Selection thresholds (match seeder)
  const COVERAGE_THRESHOLD = 0.6
  const PDB_RESOLUTION_MAX = 4.0
  const AF_PLDDT_MIN = 50

  // Source preference order: PDB -> SWISS-MODEL -> AlphaFold
  const SOURCE_PREFERENCE = ["pdb", "swissmodel", "alphafold"]

  // Discover candidates
  const candidates = []

  // PDB candidates
  try {
    const pdbUrl = `https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/${protein.uniprot}`
    const pdbResp = await fetch(pdbUrl, { timeout: 20000 })
    if (pdbResp.ok) {
      const pdbData = await pdbResp.json()
      const pdbMappings = pdbData[protein.uniprot] || []
      for (const m of pdbMappings) {
        const pdbId = (m.pdb_id || "").toUpperCase()
        if (!pdbId) continue
        const coverage = m.coverage || 0.0
        const resolution = m.resolution
        const chainCount = m.chain_id ? m.chain_id.split(",").length : 1 // Count chains in structure
        // Only include X-ray diffraction structures with reasonable resolution
        if (
          m.experimental_method === "X-ray diffraction" &&
          resolution &&
          resolution <= PDB_RESOLUTION_MAX
        ) {
          candidates.push({
            source: "pdb",
            id: pdbId,
            // Use RCSB ModelServer with BCIF encoding - much smaller than raw CIF
            upstreamUrl: `https://models.rcsb.org/v1/${pdbId}/full?encoding=bcif&copy_all_categories=false`,
            format: "bcif",
            coverage,
            chainCount, // Number of chains (prefer fewer for simpler structures)
            raw: m,
          })
        }
      }
    }
  } catch (err) {
    console.warn("GeneGuessr: failed to fetch PDB mappings for", protein.uniprot, err)
  }

  // AlphaFold candidate
  try {
    const afUrl = `https://alphafold.ebi.ac.uk/api/prediction/${protein.uniprot}`
    const afResp = await fetch(afUrl, { timeout: 10000 })
    let afAdded = false
    if (afResp.ok) {
      const afData = await afResp.json()
      if (Array.isArray(afData) && afData.length > 0) {
        // Pick the best model (highest globalMetricValue)
        const best = afData.reduce((a, b) => (a.globalMetricValue > b.globalMetricValue ? a : b))
        if (best.cifUrl) {
          candidates.push({
            source: "alphafold",
            id: protein.uniprot,
            upstreamUrl: best.cifUrl,
            coverage: 1.0,
            quality: best.globalMetricValue,
          })
          afAdded = true
        }
      }
    }
    // Fallback: if API returned empty/invalid, construct v6 URL directly
    // AlphaFold has predictions for virtually all human proteins, so worth trying
    if (!afAdded) {
      const fallbackCifUrl = `https://alphafold.ebi.ac.uk/files/AF-${protein.uniprot}-F1-model_v6.cif`
      candidates.push({
        source: "alphafold",
        id: protein.uniprot,
        upstreamUrl: fallbackCifUrl,
        coverage: 1.0,
        quality: 70, // Default reasonable pLDDT assumption
      })
    }
  } catch (err) {
    console.warn("GeneGuessr: failed to fetch AlphaFold for", protein.uniprot, err)
    // Fallback on error: try constructed v6 URL anyway
    const fallbackCifUrl = `https://alphafold.ebi.ac.uk/files/AF-${protein.uniprot}-F1-model_v6.cif`
    candidates.push({
      source: "alphafold",
      id: protein.uniprot,
      upstreamUrl: fallbackCifUrl,
      coverage: 1.0,
      quality: 70,
    })
  }

  // SWISS-MODEL candidates
  try {
    const swissUrl = `https://swissmodel.expasy.org/repository/uniprot/${protein.uniprot}.json`
    const swissResp = await fetch(swissUrl, { timeout: 20000 })
    if (swissResp.ok) {
      const swissData = await swissResp.json()
      const structures = swissData.result?.structures || []
      for (const s of structures) {
        if (s.provider === "SWISSMODEL" && s.method === "HOMOLOGY MODELLING") {
          const coverage = s.coverage || 0.0
          const gmqe = s.gmqe
          const cifUrl = s.modelcif
          if (cifUrl && coverage >= COVERAGE_THRESHOLD && gmqe && gmqe >= 0.6) {
            candidates.push({
              source: "swissmodel",
              id: `${protein.uniprot}_swissmodel_${s.template || "unknown"}`,
              upstreamUrl: cifUrl,
              coverage,
              quality: gmqe,
              raw: s,
            })
          }
        }
      }
    }
  } catch (err) {
    console.warn("GeneGuessr: failed to fetch SWISS-MODEL for", protein.uniprot, err)
  }

  // Select best candidate following SOURCE_PREFERENCE
  let selected = null
  for (const source of SOURCE_PREFERENCE) {
    if (source === "pdb") {
      const pdbs = candidates.filter((c) => c.source === "pdb" && c.coverage >= COVERAGE_THRESHOLD)
      if (pdbs.length > 0) {
        pdbs.sort(
          (a, b) =>
            b.coverage - a.coverage || (a.chainCount || Infinity) - (b.chainCount || Infinity),
        ) // Higher coverage, fewer chains better
        selected = pdbs[0]
        break
      }
    } else if (source === "swissmodel") {
      const swiss = candidates.filter(
        (c) =>
          c.source === "swissmodel" && c.coverage >= COVERAGE_THRESHOLD && (c.quality || 0) >= 0.6,
      )
      if (swiss.length > 0) {
        swiss.sort((a, b) => b.coverage - a.coverage || b.quality - a.quality) // Higher coverage, higher GMQE better
        selected = swiss[0]
        break
      }
    } else if (source === "alphafold") {
      const af = candidates.filter((c) => c.source === "alphafold")
      if (af.length > 0) {
        af.sort((a, b) => (b.quality || 0) - (a.quality || 0)) // Higher pLDDT better
        selected = af[0]
        break
      }
    }
  }

  if (!selected) {
    if (env?.DB && protein?.uniprot) {
      await markStructureFailure(env.DB, protein.uniprot)
    }
    return null
  }

  // Build meta for selected candidate
  let meta = null
  if (selected.source === "pdb") {
    // Use BCIF format from ModelServer
    const ext = selected.format === "bcif" ? "bcif" : "cif"
    meta = {
      source: "pdb",
      r2Key: `pdb/${selected.id}.${ext}`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: "RCSB PDB",
      displayLabel: `RCSB PDB (${selected.id})`,
      format: ext,
      linkUrl: `https://www.rcsb.org/structure/${selected.id}`,
    }
  } else if (selected.source === "swissmodel") {
    const ext = getFileExtensionFromUrl(selected.upstreamUrl)
    const normalizedFormat = ext === "pdb" ? "pdb" : ext === "bcif" ? "bcif" : "cif"
    meta = {
      source: "swissmodel",
      r2Key: `swissmodel/${sanitizeKeySegment(selected.id)}.${ext}`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: "SWISS-MODEL",
      displayLabel: `SWISS-MODEL (${selected.id})`,
      format: normalizedFormat,
      linkUrl: null, // SWISS-MODEL URLs are direct downloads, not webpages
    }
  } else if (selected.source === "alphafold") {
    meta = {
      source: "alphafold",
      r2Key: `alphafold/${sanitizeKeySegment(selected.id)}.cif`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: "AlphaFold",
      displayLabel: `AlphaFold (${selected.id})`,
      format: "cif",
    }
  }

  if (!meta) {
    if (env?.DB && protein?.uniprot) {
      await markStructureFailure(env.DB, protein.uniprot)
    }
    return null
  }
  if (env?.DB && protein?.uniprot) {
    await clearStructureFailure(env.DB, protein.uniprot)
  }

  // Cache the discovered structure source
  try {
    await env.KV?.put(cacheKey, JSON.stringify(meta), { expirationTtl: STRUCTURE_SOURCE_CACHE_TTL })
    console.log(`GeneGuessr: cached structure source for ${protein.uniprot}`)
  } catch (err) {
    console.warn("GeneGuessr: failed to cache structure source", err)
  }

  return meta
}

async function structureObjectExists(env, key) {
  if (!env?.STRUCTURES_BUCKET || !key) {
    return false
  }
  try {
    if (typeof env.STRUCTURES_BUCKET.head === "function") {
      const head = await env.STRUCTURES_BUCKET.head(key)
      return Boolean(head)
    }
    const existing = await env.STRUCTURES_BUCKET.get(key)
    if (existing?.body && typeof existing.body.cancel === "function") {
      try {
        await existing.body.cancel()
      } catch {
        // ignore
      }
    }
    return Boolean(existing)
  } catch {
    return false
  }
}

// Threshold for switching to multipart upload (10MB)
// Worker memory limit is 128MB, multipart keeps memory bounded to ~8MB chunks
const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024
const MULTIPART_PART_SIZE = 8 * 1024 * 1024 // 8MB parts (minimum is 5MB)

async function ensureStructureCached(env, meta, options = {}) {
  if (!meta?.r2Key) {
    return false
  }
  if (!env?.STRUCTURES_BUCKET) {
    // Temporary no-R2 deploy mode: we still want structure tokens and
    // /api/structure-cached upstream fallback to work, we just cannot persist
    // anything into the disabled bucket right now.
    return Boolean(meta.upstreamUrl)
  }
  const exists = await structureObjectExists(env, meta.r2Key)
  if (exists) {
    return true
  }
  if (!meta.upstreamUrl) {
    if (options?.proteinId && env?.DB) {
      await markStructureFailure(env.DB, options.proteinId)
    }
    return false
  }
  let usage = await getStructureBucketUsage(env)
  if (usage.bytes >= STRUCTURE_BUCKET_CAP_BYTES) {
    const targetBytes = Math.floor(STRUCTURE_BUCKET_CAP_BYTES * STRUCTURE_CACHE_TARGET_RATIO)
    const eviction = await evictStructureCache(env, targetBytes)
    if (eviction.removed > 0) {
      console.warn("GeneGuessr: structure cache eviction", eviction)
    }
    usage = { bytes: eviction.afterBytes }
    if (usage.bytes >= STRUCTURE_BUCKET_CAP_BYTES) {
      console.error("GeneGuessr: structure cache still full after eviction")
      return false
    }
  }
  const upstreamResp = await fetch(meta.upstreamUrl, {
    method: "GET",
    headers: { "User-Agent": "GeneGuessr-Worker/1.0" },
  })
  if (!upstreamResp.ok || !upstreamResp.body) {
    console.warn(
      "GeneGuessr: upstream structure fetch failed",
      meta.upstreamUrl,
      upstreamResp.status,
    )
    return false
  }

  // Determine content type based on format
  const contentType =
    meta.format === "bcif"
      ? "application/octet-stream"
      : upstreamResp.headers.get("Content-Type") || "chemical/x-cif"

  // Check if we need multipart upload (Content-Length may be missing for chunked responses)
  const contentLength = upstreamResp.headers.get("Content-Length")
  const estimatedSize = contentLength ? parseInt(contentLength, 10) : MULTIPART_THRESHOLD_BYTES + 1

  if (estimatedSize <= MULTIPART_THRESHOLD_BYTES) {
    // Small file: simple put (streams directly, low memory)
    await env.STRUCTURES_BUCKET.put(meta.r2Key, upstreamResp.body, {
      httpMetadata: { contentType },
    })
  } else {
    // Large file: use multipart upload to keep memory bounded
    // This handles files up to 5TB in ~8MB chunks without exceeding Worker memory
    console.log(
      `GeneGuessr: using multipart upload for ${meta.r2Key} (estimated ${Math.round(estimatedSize / 1024 / 1024)}MB)`,
    )
    await multipartUploadFromStream(env, meta.r2Key, upstreamResp.body, contentType)
  }

  // FIFO eviction uses R2's built-in uploaded timestamp - no KV tracking needed
  if (options?.proteinId && env?.DB) {
    await clearStructureFailure(env.DB, options.proteinId)
  }
  return true
}

/**
 * Cache a structure with pinning metadata for daily target protection.
 * Pinned structures are skipped during FIFO eviction until pinnedUntil date passes.
 * @param {Object} env - Worker environment bindings
 * @param {Object} meta - Structure metadata with r2Key, upstreamUrl, format, source
 * @param {string} pinnedUntil - Date string (YYYY-MM-DD) until which the structure is protected
 * @returns {boolean} True if structure was cached successfully
 */
async function ensureStructureCachedWithPin(env, meta, pinnedUntil) {
  if (!meta?.r2Key) {
    return false
  }
  if (!env?.STRUCTURES_BUCKET) {
    // Temporary no-R2 deploy mode: skip prewarming/pinning entirely. The live
    // structure route can still fetch directly from upstream when needed.
    return Boolean(meta.upstreamUrl)
  }

  // Check if already cached
  const existing = await env.STRUCTURES_BUCKET.head(meta.r2Key)
  if (existing) {
    // Already cached - check if pin needs update
    const currentPin = existing.customMetadata?.pinnedUntil
    if (currentPin && currentPin >= pinnedUntil) {
      // Already pinned for same or later date
      console.log(`[PIN] ${meta.r2Key} already pinned until ${currentPin}`)
      return true
    }
    // Need to update pin - R2 doesn't support metadata-only updates,
    // so we'd need to re-upload. For now, just log and accept existing cache.
    console.log(`[PIN] ${meta.r2Key} cached but pin expired (${currentPin}), accepting anyway`)
    return true
  }

  if (!meta.upstreamUrl) {
    console.warn(`[PIN] ${meta.r2Key} has no upstream URL`)
    return false
  }

  // Check bucket capacity and evict if needed
  let usage = await getStructureBucketUsage(env)
  if (usage.bytes >= STRUCTURE_BUCKET_CAP_BYTES) {
    const targetBytes = Math.floor(STRUCTURE_BUCKET_CAP_BYTES * STRUCTURE_CACHE_TARGET_RATIO)
    const eviction = await evictStructureCache(env, targetBytes)
    if (eviction.removed > 0) {
      console.warn("[PIN] Structure cache eviction before caching daily target", eviction)
    }
  }

  // Fetch from upstream
  const upstreamResp = await fetch(meta.upstreamUrl, {
    method: "GET",
    headers: { "User-Agent": "GeneGuessr-Worker/1.0" },
  })

  if (!upstreamResp.ok || !upstreamResp.body) {
    console.warn(`[PIN] Upstream fetch failed for ${meta.r2Key}:`, upstreamResp.status)
    return false
  }

  const contentType =
    meta.format === "bcif"
      ? "application/octet-stream"
      : upstreamResp.headers.get("Content-Type") || "chemical/x-cif"

  // Read entire body for simple put (daily targets are usually small)
  const data = await upstreamResp.arrayBuffer()

  // Store with pinning metadata
  await env.STRUCTURES_BUCKET.put(meta.r2Key, data, {
    httpMetadata: { contentType },
    customMetadata: {
      pinnedUntil, // "2025-12-27" - protects from eviction until this date
      source: meta.source || "unknown",
    },
  })

  console.log(
    `[PIN] Cached ${meta.r2Key} (${Math.round(data.byteLength / 1024)}KB) pinned until ${pinnedUntil}`,
  )
  return true
}

/**
 * Upload a stream to R2 using multipart upload.
 * Keeps memory bounded by processing in MULTIPART_PART_SIZE chunks.
 * See: https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
 */
async function multipartUploadFromStream(env, r2Key, stream, contentType) {
  const mpu = await env.STRUCTURES_BUCKET.createMultipartUpload(r2Key, {
    httpMetadata: { contentType },
  })

  const reader = stream.getReader()
  const uploadedParts = []
  let partNumber = 1
  let buffer = new Uint8Array(MULTIPART_PART_SIZE)
  let filled = 0

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) {
        // Upload remaining data as final part
        if (filled > 0) {
          const chunk = buffer.subarray(0, filled)
          const part = await mpu.uploadPart(partNumber, chunk)
          uploadedParts.push(part)
        }
        break
      }

      // Copy incoming data into buffer, uploading when full
      let offset = 0
      while (offset < value.length) {
        const toCopy = Math.min(MULTIPART_PART_SIZE - filled, value.length - offset)
        buffer.set(value.subarray(offset, offset + toCopy), filled)
        filled += toCopy
        offset += toCopy

        if (filled === MULTIPART_PART_SIZE) {
          const part = await mpu.uploadPart(partNumber, buffer)
          uploadedParts.push(part)
          partNumber++
          buffer = new Uint8Array(MULTIPART_PART_SIZE)
          filled = 0
        }
      }
    }

    // Complete the multipart upload
    await mpu.complete(uploadedParts)
    console.log(`GeneGuessr: multipart upload complete for ${r2Key}, ${uploadedParts.length} parts`)
  } catch (err) {
    // Abort on failure to clean up partial upload
    console.error(`GeneGuessr: multipart upload failed for ${r2Key}`, err)
    try {
      await mpu.abort()
    } catch (abortErr) {
      console.warn("GeneGuessr: failed to abort multipart upload", abortErr)
    }
    throw err
  }
}

async function getStructureBucketUsage(env) {
  if (!env?.STRUCTURES_BUCKET) {
    return { bytes: 0, objects: 0 }
  }
  let cursor = undefined
  let bytes = 0
  let objects = 0
  do {
    const listResp = await env.STRUCTURES_BUCKET.list({ cursor, limit: 1000 })
    const currentObjects = listResp?.objects || []
    currentObjects.forEach((obj) => {
      bytes += obj.size || 0
      objects += 1
    })
    cursor = listResp?.truncated ? listResp?.cursor : undefined
  } while (cursor)
  return { bytes, objects }
}

/**
 * List all R2 objects in the structure cache bucket.
 * Returns objects with key, size, uploaded timestamp, and customMetadata for FIFO eviction.
 * customMetadata includes pinnedUntil for daily target protection.
 */
async function listStructureCacheObjects(env) {
  if (!env?.STRUCTURES_BUCKET) {
    return []
  }
  const objects = []
  let cursor = undefined
  do {
    const resp = await env.STRUCTURES_BUCKET.list({ cursor, include: ["customMetadata"] })
    for (const obj of resp.objects || []) {
      objects.push({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded, // Date object from R2
        customMetadata: obj.customMetadata || {},
      })
    }
    cursor = resp.truncated ? resp.cursor : undefined
  } while (cursor)
  return objects
}

/**
 * FIFO eviction: delete oldest objects (by R2 uploaded timestamp) until under target.
 * No KV tracking needed - R2 provides the uploaded timestamp natively.
 * Skips objects with pinnedUntil metadata that haven't expired (protects daily targets).
 */
async function evictStructureCache(env, targetBytes) {
  const usage = await getStructureBucketUsage(env)
  if (usage.bytes <= targetBytes) {
    return { beforeBytes: usage.bytes, afterBytes: usage.bytes, removed: 0, skippedPinned: 0 }
  }
  const objects = await listStructureCacheObjects(env)
  // FIFO: sort by uploaded timestamp, oldest first
  objects.sort((a, b) => (a.uploaded?.getTime() || 0) - (b.uploaded?.getTime() || 0))

  const today = new Date().toISOString().slice(0, 10)
  let currentBytes = usage.bytes
  let removed = 0
  let skippedPinned = 0

  for (const obj of objects) {
    if (!obj?.key) {
      continue
    }

    // Skip pinned objects that haven't expired (daily target protection)
    const pinnedUntil = obj.customMetadata?.pinnedUntil
    if (pinnedUntil && pinnedUntil >= today) {
      console.log(`[EVICT] Skipping pinned: ${obj.key} (until ${pinnedUntil})`)
      skippedPinned += 1
      continue
    }

    try {
      await env.STRUCTURES_BUCKET.delete(obj.key)
    } catch (err) {
      console.warn("GeneGuessr: failed to delete R2 object during eviction", obj.key, err)
    }
    currentBytes -= Number(obj.size) || 0
    removed += 1
    if (currentBytes <= targetBytes) {
      break
    }
  }
  return { beforeBytes: usage.bytes, afterBytes: currentBytes, removed, skippedPinned }
}

function sanitizeKeySegment(value) {
  return (value || "unknown").toString().replace(/[^A-Za-z0-9_\-]/g, "_")
}

function getFileExtensionFromUrl(url) {
  const lower = url.toLowerCase()
  if (lower.includes(".bcif")) return "bcif"
  if (lower.includes(".pdb")) return "pdb"
  return "cif"
}

function isAlphaFoldOnlyProtein(protein) {
  if (!protein) {
    return false
  }
  // With flat schema, just check if structure_source is alphafold
  return protein.structure_source === "alphafold"
}
