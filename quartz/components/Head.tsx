import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"
import { CustomOgImagesEmitterName } from "../../.quartz/plugins"
import { getPublicUrlForSlug, isNoIndexFile } from "../util/crawlability"
import { buildAiSearchJsonLd, serializeJsonLd } from "../util/aiSearchMetadata"

// Build-time cache buster - always include a fresh timestamp so production HTML
// points at the latest static assets even when environment-level cache vars linger.
const CACHE_BUST = `${Date.now()}-${
  (typeof process !== "undefined" && process.env?.CACHE_BUST) ||
  (typeof process !== "undefined" && process.env?.VERCEL_GIT_COMMIT_SHA) ||
  "build"
}`

export default (() => {
  const Head: QuartzComponent = ({
    cfg,
    fileData,
    externalResources,
    ctx,
  }: QuartzComponentProps) => {
    const titleSuffix = cfg.pageTitleSuffix ?? ""
    const title =
      (fileData.frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title) + titleSuffix
    const description =
      fileData.frontmatter?.socialDescription ??
      fileData.frontmatter?.description ??
      unescapeHTML(fileData.description?.trim() ?? i18n(cfg.locale).propertyDefaults.description)

    const { css, js, additionalHead } = externalResources
    const slugValue = typeof fileData.slug === "string" ? fileData.slug : undefined
    const normalizedSlug = slugValue?.replace(/\/index(?:\.html)?$/, "")
    const isIconoplasm =
      normalizedSlug === "apps/iconoplasm" ||
      fileData.frontmatter?.title === "Iconoplasm - Visual Mnemonics for Molecular Cell Biology"
    const usesIconoplasmLabelFonts =
      isIconoplasm || normalizedSlug === "settings" || fileData.frontmatter?.title === "Settings"
    const iconoplasmBootstrapScript = isIconoplasm
      ? `(() => {
  if (typeof window === "undefined" || window.__iconoplasmBootstrap) return
  if (window.history && "scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual"
  }
  var iconoplasmStartupPath = window.location && window.location.pathname ? window.location.pathname : "/"
  if ((iconoplasmStartupPath === "/" || iconoplasmStartupPath === "") && window.history) {
    var iconoplasmFreshState =
      window.history.state && typeof window.history.state === "object"
        ? Object.assign({}, window.history.state)
        : {}
    iconoplasmFreshState.iconoplasmHome = null
    window.history.replaceState(iconoplasmFreshState, "", window.location.href)
    try {
      window.scrollTo({ left: 0, top: 0, behavior: "instant" })
    } catch (_iconoFreshScrollError) {
      window.scrollTo(0, 0)
    }
    document.documentElement.scrollTop = 0
    if (document.body) document.body.scrollTop = 0
  }
  window.__iconoSiteOwnsSharedRuntime = true
  if (
    window.IconoplasmCardShared &&
    (!window.IconoplasmCardShared.__meta || window.IconoplasmCardShared.__meta.owner !== "site")
  ) {
    try {
      if (typeof window.IconoplasmCardShared.__dispose === "function") {
        window.IconoplasmCardShared.__dispose()
      }
    } catch (_iconoDisposeError) {}
    try {
      delete window.IconoplasmCardShared
    } catch (_iconoDeleteError) {
      window.IconoplasmCardShared = null
    }
  }
  var host = String(window.location.hostname || "").toLowerCase()
  var origin = window.location.origin
  if (host !== "iconoplasm.brinedew.bio" && host !== "staging.brinedew.bio") {
    origin = "https://iconoplasm.brinedew.bio"
  }
  var bootstrap = {
    authPromise: null,
    authUsed: false,
    homeGalleryData: null,
    homeGalleryUsed: false,
    homeGalleryPromise: null,
    accountGalleryWindowData: null,
    accountGalleryWindowPromise: null,
    accountGalleryWindowUsed: false,
    geneDetailSymbol: "",
    geneDetailSnapshotVersion: "",
    geneDetailData: null,
    geneDetailPromise: null,
    geneCardData: null,
    geneCardPromise: null,
    portraitSourcePromise: null,
  }
  var geneMatch = /^\\/gene\\/([^/?#]+)/.exec(iconoplasmStartupPath)
  if (geneMatch && window.fetch) {
    bootstrap.geneDetailSymbol = decodeURIComponent(geneMatch[1] || "").trim().toUpperCase()
    if (bootstrap.geneDetailSymbol) {
      var isCompleteGeneDetail = function (data) {
        return !!(
          data &&
          typeof data === "object" &&
          data.symbol === bootstrap.geneDetailSymbol &&
          data.essence &&
          typeof data.essence === "object" &&
          Array.isArray(data.portrait_candidates)
        )
      }
      var startGeneDetailFetch = function () {
        if (bootstrap.geneDetailPromise) return bootstrap.geneDetailPromise
        if (isCompleteGeneDetail(embeddedGeneCard)) {
          bootstrap.geneDetailData = embeddedGeneCard
          bootstrap.geneDetailPromise = Promise.resolve(embeddedGeneCard)
        } else {
          bootstrap.geneDetailPromise = fetch(
            origin +
              "/api/iconoplasm/site/genes/" +
              encodeURIComponent(bootstrap.geneDetailSymbol),
          )
            .then(function (response) {
              if (!response.ok) return null
              return response.json().catch(function () {
                return null
              })
            })
            .then(function (data) {
              var completeData = isCompleteGeneDetail(data) ? data : null
              bootstrap.geneDetailData = completeData
              return completeData
            })
            .catch(function () {
              return null
            })
        }
        // Use the embedded page payload as the earliest safe portrait source.
        // Older cached HTML may still provide only a card projection, so retain
        // the complete endpoint as the fallback without conflating the contracts.
        var portraitSeedPromise = embeddedGeneCard
          ? Promise.resolve(embeddedGeneCard)
          : bootstrap.geneDetailPromise
        bootstrap.portraitSourcePromise = portraitSeedPromise.then(function (data) {
          try {
            var storedDecision = JSON.parse(
              window.sessionStorage.getItem("iconoplasm.portrait-source.v1") || "null",
            )
            if (
              storedDecision &&
              (storedDecision.source === "primary" || storedDecision.source === "fallback")
            ) {
              return storedDecision.source
            }
          } catch (_iconoPortraitDecisionReadError) {}
          var portrait =
            data &&
            data.portrait &&
            data.portrait.urls &&
            (data.portrait.urls.medium || data.portrait.urls.full || data.portrait.urls.thumb)
          if (!portrait) return ""
          var primaryPortrait = portrait
          try {
            var parsedPortrait = new URL(portrait, origin)
            if (parsedPortrait.pathname.indexOf("/portraits/") === 0) {
              primaryPortrait =
                "https://iconoplasmportraits.b-cdn.net" +
                parsedPortrait.pathname +
                parsedPortrait.search
            }
          } catch (_iconoPortraitUrlError) {}
          return new Promise(function (resolvePortraitSource) {
            var img = new Image()
            var settled = false
            var timer = 0
            var settle = function (source) {
              if (settled) return
              settled = true
              window.clearTimeout(timer)
              img.onload = null
              img.onerror = null
              resolvePortraitSource(source)
            }
            img.decoding = "async"
            img.fetchPriority = "high"
            img.onload = function () {
              settle("primary")
            }
            img.onerror = function () {
              settle("fallback")
            }
            timer = window.setTimeout(function () {
              settle("fallback")
              try {
                img.src = ""
              } catch (_iconoPortraitAbortError) {}
            }, 2500)
            img.src = primaryPortrait
          })
        })
        return bootstrap.geneDetailPromise
      }
      var embeddedGeneCard = null
      try {
        // ICONOPLASM CANONICAL PORTRAIT PUBLISH CONTRACT.
        // Search terms: PRL split-brain, gene page bootstrap, canonical blot,
        // public card artifact, KV_GALLERY_VERSION.
        //
        // The worker may embed a first-paint card payload into gene pages. That
        // payload is trusted only because it came from the same
        // /api/iconoplasm/site/genes/:symbol canonical detail endpoint that the
        // hydrated gene page uses. The public card artifact remains a coarse
        // browse snapshot, not the freshness layer for individual gene pages.
        var embeddedGeneCardNode = document.getElementById("iconoplasm-card-bootstrap")
        var embeddedGeneCardPayload =
          embeddedGeneCardNode && embeddedGeneCardNode.textContent
            ? JSON.parse(embeddedGeneCardNode.textContent)
            : null
        if (
          embeddedGeneCardPayload &&
          embeddedGeneCardPayload.symbol === bootstrap.geneDetailSymbol
        ) {
          embeddedGeneCard = embeddedGeneCardPayload.payload || null
          bootstrap.geneDetailSnapshotVersion = String(
            embeddedGeneCardPayload.snapshot_version || "",
          )
        }
      } catch (_iconoEmbeddedGeneCardError) {}
      if (embeddedGeneCard) {
        bootstrap.geneCardData = embeddedGeneCard
        bootstrap.geneCardPromise = Promise.resolve(embeddedGeneCard)
      } else {
          bootstrap.geneCardPromise = fetch(
            origin + "/api/iconoplasm/cards/" + encodeURIComponent(bootstrap.geneDetailSymbol),
        )
          .then(function (response) {
            if (!response.ok) return null
            return response.json().catch(function () {
              return null
            })
          })
          .then(function (payload) {
            var card = payload && (payload.card || (payload.cards && payload.cards[0]))
            var data = (card && card.payload) || payload?.payload || null
            bootstrap.geneCardData = data || null
            return data || null
          })
          .catch(function () {
            return null
          })
      }
      startGeneDetailFetch()
    }
  }
  if ((iconoplasmStartupPath === "/" || iconoplasmStartupPath === "") && window.fetch) {
    bootstrap.accountGalleryWindowLimit = 4
    bootstrap.authPromise = fetch("https://brinedew.bio/api/auth/me", {
      credentials: "include",
    })
      .then(function (response) {
        if (!response.ok) return null
        return response.json().catch(function () {
          return null
        })
      })
      .catch(function () {
        return null
      })
    bootstrap.accountGalleryWindowPromise = bootstrap.authPromise
      .then(function (payload) {
        if (!payload || !payload.authenticated || !payload.user) return null
        return fetch(
          origin +
            "/api/iconoplasm/account-gallery-window?order=newest&limit=" +
            encodeURIComponent(String(bootstrap.accountGalleryWindowLimit || 48)) +
            "&view=image-only",
          {
            credentials: "include",
            cache: "no-store",
            headers: {
              "Cache-Control": "no-store",
            },
          },
        )
          .then(function (response) {
            if (!response.ok) return null
            return response.json().catch(function () {
              return null
            })
          })
          .then(function (data) {
            bootstrap.accountGalleryWindowData = data || null
            return data || null
          })
          .catch(function () {
            return null
          })
      })
      .catch(function () {
        return null
      })
  }
  window.__iconoplasmBootstrap = bootstrap
})()`
      : null
    const pageCss = isIconoplasm
      ? css.filter((resource) => !resource.content.includes("/static/vendor/katex/"))
      : css
    const pageJs = isIconoplasm
      ? js.filter(
          (resource) =>
            !(
              resource.contentType === "external" && resource.src.includes("/static/vendor/katex/")
            ),
        )
      : js

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)

    // Url of current page
    const socialUrl =
      fileData.slug === "404"
        ? url.toString()
        : getPublicUrlForSlug(cfg.baseUrl ?? "example.com", fileData.slug!)
    const canonicalUrl =
      typeof fileData.frontmatter?.canonicalUrl === "string"
        ? fileData.frontmatter.canonicalUrl
        : socialUrl
    const robotsDirective = isNoIndexFile(fileData) ? "noindex,nofollow,noarchive" : "index,follow"
    const aiSearchJsonLd = !isNoIndexFile(fileData)
      ? serializeJsonLd(
          buildAiSearchJsonLd({
            baseUrl: cfg.baseUrl ?? "example.com",
            pageTitle: cfg.pageTitle,
            locale: cfg.locale,
            fileData,
          }),
        )
      : null

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some(
      (e) => e.name === CustomOgImagesEmitterName,
    )
    const ogImageDefaultPath = `https://${cfg.baseUrl}/static/og-image.png?v=${CACHE_BUST}`
    const ogImageDefaultExtension = getFileExtension(ogImageDefaultPath)?.slice(1) ?? "png"

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
            {cfg.theme.typography.title && (
              <link rel="stylesheet" href={googleFontSubsetHref(cfg.theme, cfg.pageTitle)} />
            )}
          </>
        )}
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <meta name="og:site_name" content={cfg.pageTitle}></meta>
        <meta property="og:title" content={title} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image:alt" content={description} />

        {!usesCustomOgImage && (
          <>
            <meta property="og:image" content={ogImageDefaultPath} />
            <meta property="og:image:url" content={ogImageDefaultPath} />
            <meta name="twitter:image" content={ogImageDefaultPath} />
            <meta property="og:image:type" content={`image/${ogImageDefaultExtension}`} />
          </>
        )}

        {cfg.baseUrl && (
          <>
            <meta property="twitter:domain" content={cfg.baseUrl}></meta>
            <meta property="og:url" content={socialUrl}></meta>
            <meta property="twitter:url" content={socialUrl}></meta>
            <link rel="canonical" href={canonicalUrl} />
          </>
        )}

        <link rel="shortcut icon" href={joinSegments(baseDir, "favicon.ico")} />
        {isIconoplasm && (
          <>
            <link rel="preconnect" href="https://brinedew.bio" />
            <link rel="preconnect" href="https://iconoplasmportraits.b-cdn.net" />
          </>
        )}
        <link
          rel="icon"
          type="image/png"
          sizes="48x48"
          href={joinSegments(baseDir, "static/icon-48.png")}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href={joinSegments(baseDir, "static/icon.png")}
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href={joinSegments(baseDir, "static/apple-touch-icon.png")}
        />
        <meta name="description" content={description} />
        <meta name="robots" content={robotsDirective} />
        {isIconoplasm && (
          <style
            dangerouslySetInnerHTML={{
              __html: `
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/static/iconoplasm/fonts/IBMPlexMono-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/static/iconoplasm/fonts/IBMPlexMono-Medium.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "League Spartan";
  src: url("/static/iconoplasm/fonts/LeagueSpartan-800.woff2") format("woff2");
  font-weight: 800;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "Special Elite";
  src: url("/static/iconoplasm/fonts/SpecialElite-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Caveat";
  src: url("/static/iconoplasm/fonts/Caveat-400.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
.icono-card--variant-lab-label,
.iconoplasm-tooltip--variant-lab-label {
  --icono-label-paper: color-mix(in srgb, var(--light, #f4ede5) 92%, #d4cab8 8%);
  --icono-label-paper-2: color-mix(in srgb, var(--light, #f4ede5) 88%, #d7cfbf 12%);
  --icono-label-ink: color-mix(in srgb, var(--dark, #20120b) 94%, #3b2a20 6%);
  --icono-label-muted: color-mix(in srgb, var(--icono-label-ink) 42%, transparent);
  --icono-label-rule: color-mix(in srgb, var(--icono-label-ink) 16%, transparent);
  --icono-label-rule-strong: color-mix(in srgb, var(--icono-label-ink) 26%, transparent);
  --icono-label-stamp: #a24834;
  --icono-label-pen: var(--accent, #1b7269);
  --icono-label-type: "IBM Plex Mono";
  --icono-label-hand: "Caveat";
  --icono-label-portrait-fr: 29.1%;
  --icono-label-form-fr: 70.9%;
  --icono-label-header-title-fr: 56.2%;
  --icono-label-header-meta-fr: 29.8%;
  --icono-label-header-qc-fr: 14%;
  --icono-label-row-label-fr: clamp(3.15rem, 9.2%, 7rem);
  --icono-label-row-body-fr: minmax(0, 1fr);
  --icono-label-band-category-fr: 50%;
  --icono-label-band-noted-fr: 21%;
  --icono-label-band-mass-fr: 29%;
  --icono-label-footer-main-fr: 54.568528%;
  --icono-label-footer-side-fr: 45.431472%;
  --icono-label-specimen-metric-col: calc(110 / 1220 * 100cqw);
  --icono-label-specimen-value-col: calc(52 / 1220 * 100cqw);
  --icono-label-specimen-column-gap: calc(8 / 1220 * 100cqw);
  --icono-label-specimen-row-gap: calc(3 / 1220 * 100cqw);
  --icono-label-hand-size: calc(36 / 1220 * 100cqw);
  font-family: var(--icono-label-type), monospace;
}
.icono-gene-lead-card.icono-card--variant-lab-label.icono-card--brick,
.icono-gene-lead--static-shell .icono-gene-lead-card {
  width: min(100%, 800px);
  container-type: inline-size;
  inline-size: min(100%, 1220px);
  max-inline-size: 100%;
  aspect-ratio: 1220 / 634;
  display: grid;
  grid-template-columns: var(--icono-label-portrait-fr) var(--icono-label-form-fr);
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--icono-label-rule-strong) 92%, transparent);
  border-radius: 0;
  background: var(--icono-label-paper);
  color: var(--icono-label-ink);
  overflow: hidden;
  box-shadow: 0 10px 24px rgba(53, 38, 27, 0.1);
}
.icono-gene-lead-card.icono-card--variant-lab-label.icono-card--brick .iconoplasm-tooltip-portrait,
.icono-gene-lead-card.icono-card--variant-lab-label.icono-card--brick .iconoplasm-tooltip-body,
.icono-gene-lead--static-shell .iconoplasm-tooltip-portrait,
.icono-gene-lead--static-shell .iconoplasm-tooltip-body {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}
body[data-slug^="apps/iconoplasm"] #iconoplasm-root {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 1rem 2rem;
}
.icono-gene-lead,
.icono-gene-lead--static-shell {
  width: min(100%, 800px);
  margin: 0 auto 1.75rem;
}
.icono-gene-lead--static-shell .iconoplasm-tooltip-portrait {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: calc(12 / 1220 * 100cqw);
  padding: calc(18 / 1220 * 100cqw) calc(18 / 1220 * 100cqw) calc(16 / 1220 * 100cqw);
  background: linear-gradient(
    180deg,
    var(--icono-label-paper-2) 0%,
    color-mix(in srgb, var(--icono-label-paper-2) 94%, #c8bcaa 6%) 100%
  );
}
.icono-gene-lead--static-shell .iconoplasm-tooltip-body {
  padding: 0;
  border-left: 1px solid var(--icono-label-rule);
  background: var(--icono-label-paper);
  color: var(--icono-label-ink);
}
.icono-gene-lead--static-shell .iconoplasm-tooltip-portrait-status,
.icono-gene-lead--static-shell .icono-label-caption,
.icono-gene-lead--static-shell .icono-label-row-label,
.icono-gene-lead--static-shell .icono-label-footer-line {
  font-family: "IBM Plex Mono";
}
.icono-gene-lead--static-shell .icono-label-symbol {
  font-family: "League Spartan", "Bahnschrift", "Arial Narrow", sans-serif;
  font-size: calc(60 / 1220 * 100cqw);
  line-height: 0.9;
  font-weight: 800;
  letter-spacing: -0.05em;
}
.icono-gene-lead--static-shell .icono-label-name,
.icono-gene-lead--static-shell .icono-label-serial,
.icono-gene-lead--static-shell .icono-label-family,
.icono-gene-lead--static-shell .icono-label-option-copy,
.icono-gene-lead--static-shell .icono-label-typed-value,
.icono-gene-lead--static-shell .icono-label-specimen-metric-value {
  font-family: "Special Elite";
}
.icono-gene-lead--static-shell .icono-label-specimen-note,
.icono-gene-lead--static-shell .icono-label-specimen-hand-analysis,
.icono-gene-lead--static-shell .icono-label-hand-note,
.icono-gene-lead--static-shell .icono-label-qc-note {
  font-family: "Caveat";
}
.icono-gene-lead--static-shell .icono-label-sheet-body {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: 29.97% 10.09% 43.85% 8.2% 7.89%;
}
@media (max-width: 760px) {
  .icono-gene-lead-card.icono-card--variant-lab-label.icono-card--brick,
  .icono-gene-lead--static-shell .icono-gene-lead-card {
    width: min(100%, 390px);
    grid-template-columns: 1fr;
  }
}
`,
            }}
          />
        )}
        {aiSearchJsonLd && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: aiSearchJsonLd }} />
        )}

        {/* Early theme attribute to avoid flash: apply saved theme before CSS */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var c=function(n){var s=document.cookie||'';var p=s.split(/;\\s*/);for(var i=0;i<p.length;i++){var x=p[i];var k=x.indexOf('=');if(k<0)continue;if(x.slice(0,k)===n)return decodeURIComponent(x.slice(k+1))}return''};var t=c('brinedew_theme')||localStorage.getItem('theme');var h=(location.hostname||'').toLowerCase();var ip=h==='iconoplasm.brinedew.bio'||h==='localhost'||h==='127.0.0.1'?document.querySelector('meta[name="twitter:domain"][content="iconoplasm.brinedew.bio"]'):null;var e=t||(ip?'light':(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));document.documentElement.setAttribute('data-theme',e);document.documentElement.setAttribute('saved-theme',e);var r=c('brinedew_reader_mode')||(localStorage.getItem('readerMode')==='on'?'on':'off');document.documentElement.setAttribute('reader-mode',r==='on'?'on':'off')}catch(e){}`,
          }}
        />

        {/* Load Quartz CSS first */}
        {pageCss.map((resource) => CSSResourceToStyleElement(resource, true))}

        {/* Preload critical assets to reduce flash (fonts, logo mask) */}
        {!isIconoplasm && (
          <link
            rel="preload"
            as="font"
            type="font/woff2"
            href="/static/fonts/CrimsonPro-VariableFont_wght.woff2"
            crossOrigin="anonymous"
          />
        )}
        {!isIconoplasm && (
          <link
            rel="preload"
            as="font"
            type="font/woff2"
            href="/static/fonts/xenon/MonaspaceXenon-Var.woff2"
            crossOrigin="anonymous"
          />
        )}
        {usesIconoplasmLabelFonts && (
          <>
            <link
              rel="preload"
              as="font"
              type="font/woff2"
              href="/static/iconoplasm/fonts/IBMPlexMono-Regular.woff2"
              crossOrigin="anonymous"
            />
            <link
              rel="preload"
              as="font"
              type="font/woff2"
              href="/static/iconoplasm/fonts/IBMPlexMono-Medium.woff2"
              crossOrigin="anonymous"
            />
            <link
              rel="preload"
              as="font"
              type="font/woff2"
              href="/static/iconoplasm/fonts/LeagueSpartan-800.woff2"
              crossOrigin="anonymous"
            />
            <link
              rel="preload"
              as="font"
              type="font/woff2"
              href="/static/iconoplasm/fonts/SpecialElite-Regular.woff2"
              crossOrigin="anonymous"
            />
            <link
              rel="preload"
              as="font"
              type="font/woff2"
              href="/static/iconoplasm/fonts/Caveat-400.woff2"
              crossOrigin="anonymous"
            />
          </>
        )}
        {!isIconoplasm && (
          <link rel="preload" as="image" href="/static/logo-mask.png" fetchpriority="high" />
        )}

        {/* Custom CSS last. Use the build cache key; a hand-bumped version left
            browsers running old sidebar CSS after the request inbox shipped. */}
        <link href={`/static/custom.css?v=${CACHE_BUST}`} rel="stylesheet" type="text/css" />
        {iconoplasmBootstrapScript && (
          <script dangerouslySetInnerHTML={{ __html: iconoplasmBootstrapScript }} />
        )}

        {/* Fix logo link to always point to main site (page-title plugin uses relative paths) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.addEventListener('DOMContentLoaded',function(){var l=document.querySelector('h2.page-title a');if(l)l.href='https://brinedew.bio'})`,
          }}
        />

        {/* Auth sidebar: loads on all pages, self-mounts the account panel into .right.sidebar */}
        <script>{`document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('script');s.type='module';s.src='/static/shared/auth-sidebar.mjs?v=20260617b';document.body.appendChild(s)})`}</script>

        {/* Conditional app assets - computed outside JSX for SSR reliability */}
        {(() => {
          if (!slugValue) {
            return null
          }

          const root = pathToRoot(slugValue as FullSlug)
          const isGeneguessr =
            normalizedSlug === "apps/geneguessr" || fileData.frontmatter?.title === "Geneguessr"
          const isIconoplasm =
            normalizedSlug === "apps/iconoplasm" ||
            fileData.frontmatter?.title ===
              "Iconoplasm - Visual Mnemonics for Molecular Cell Biology"
          const isSettings =
            normalizedSlug === "settings" || fileData.frontmatter?.title === "Settings"

          if (!isGeneguessr && !isIconoplasm && !isSettings) {
            return null
          }

          return (
            <>
              {isGeneguessr && (
                <>
                  <link
                    rel="stylesheet"
                    href={joinSegments(root, "static", `geneguessr/styles.css?v=${CACHE_BUST}`)}
                  />
                  <script
                    defer
                    src={joinSegments(root, "static", `geneguessr/credits.js?v=${CACHE_BUST}`)}
                  ></script>
                  <script
                    src={joinSegments(root, "static", `geneguessr/tutorial.js?v=${CACHE_BUST}`)}
                  ></script>
                  <script
                    defer
                    src={joinSegments(
                      root,
                      "static",
                      `geneguessr/molstar-shared.js?v=${CACHE_BUST}`,
                    )}
                  ></script>
                  <script>{`document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('script');s.type='module';s.src='${joinSegments(root, "static", `geneguessr/app.js?v=${CACHE_BUST}`)}';document.body.appendChild(s)})`}</script>
                </>
              )}
              {isIconoplasm && (
                <>
                  <link
                    rel="stylesheet"
                    href={joinSegments(
                      root,
                      "static",
                      `iconoplasm/generated/shared-card-vote.css?v=${CACHE_BUST}`,
                    )}
                  />
                  <link
                    rel="stylesheet"
                    href={joinSegments(
                      root,
                      "static",
                      `iconoplasm/generated/shared-card-label.css?v=${CACHE_BUST}`,
                    )}
                  />
                  <script
                    defer
                    src={joinSegments(
                      root,
                      "static",
                      `iconoplasm/generated/rough.js?v=${CACHE_BUST}`,
                    )}
                  ></script>
                  <script
                    defer
                    src={joinSegments(
                      root,
                      "static",
                      `iconoplasm/generated/shared-card-runtime.js?v=${CACHE_BUST}`,
                    )}
                  ></script>
                  <link
                    rel="stylesheet"
                    media="print"
                    href={joinSegments(
                      root,
                      "static",
                      `iconoplasm/vendor/shoelace/cdn/themes/light.css?v=${CACHE_BUST}`,
                    )}
                    data-icono-async-style="true"
                  />
                  <noscript>
                    <link
                      rel="stylesheet"
                      href={joinSegments(
                        root,
                        "static",
                        `iconoplasm/vendor/shoelace/cdn/themes/light.css?v=${CACHE_BUST}`,
                      )}
                    />
                  </noscript>
                  <link
                    rel="stylesheet"
                    href={joinSegments(root, "static", `iconoplasm/styles.css?v=${CACHE_BUST}`)}
                  />
                  <script
                    dangerouslySetInnerHTML={{
                      __html: `document.querySelectorAll('link[data-icono-async-style]').forEach(function(l){function a(){l.media='all';l.removeAttribute('data-icono-async-style')}if(l.sheet){a()}else{l.addEventListener('load',a,{once:true})}})`,
                    }}
                  />
                  <script>{`document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('script');s.type='module';s.src='${joinSegments(root, "static", `iconoplasm/app.js?v=${CACHE_BUST}`)}';document.body.appendChild(s)})`}</script>
                  <script>{`var ss=document.createElement('script');ss.type='module';ss.setAttribute('data-shoelace','/static/iconoplasm/vendor/shoelace/cdn');ss.src='${joinSegments(root, "static", `iconoplasm/vendor/shoelace/cdn/shoelace-autoloader.js?v=${CACHE_BUST}`)}';document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(ss)})`}</script>
                </>
              )}
              {isSettings && (
                <>
                  <link
                    rel="stylesheet"
                    href={joinSegments(root, "static", `site-settings/styles.css?v=${CACHE_BUST}`)}
                  />
                  <script>{`document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('script');s.type='module';s.src='${joinSegments(root, "static", `site-settings/app.js?v=${CACHE_BUST}`)}';document.body.appendChild(s)})`}</script>
                </>
              )}
            </>
          )
        })()}

        {/* Performance optimizations */}
        <link rel="prefetch" href="/posts" as="document" />
        {pageJs
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(res, true))}
        <style
          dangerouslySetInnerHTML={{
            __html: `.brinedew-analytics-consent{position:fixed;z-index:2147483000;right:1rem;bottom:1rem;max-width:min(28rem,calc(100vw - 2rem));padding:.85rem .95rem;border:1px solid var(--lightgray);background:var(--light);color:var(--dark);box-shadow:0 .5rem 1.75rem rgba(0,0,0,.16);font-family:var(--bodyFont);font-size:.92rem;line-height:1.35}.brinedew-analytics-consent p{margin:0 0 .65rem}.brinedew-analytics-consent a{color:var(--secondary)}.brinedew-analytics-consent__actions{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap}.brinedew-analytics-consent button{appearance:none;border:1px solid var(--darkgray);border-radius:.25rem;padding:.45rem .75rem;background:transparent;color:var(--dark);font:inherit;cursor:pointer}.brinedew-analytics-consent button[data-analytics-consent-accept]{background:var(--dark);color:var(--light);border-color:var(--dark)}`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const COOKIE = "brinedew_analytics_consent"
  const hosts = new Set(["brinedew.bio", "www.brinedew.bio", "iconoplasm.brinedew.bio", "geneguessr.brinedew.bio"])
  const host = String(location.hostname || "").toLowerCase()
  if (!hosts.has(host)) return
  if (window.__brinedewAnalyticsConsentRequired !== true) return
  const readCookie = (name) => {
    const parts = (document.cookie || "").split(/;\\s*/)
    for (const part of parts) {
      const eq = part.indexOf("=")
      if (eq > -1 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
    }
    return ""
  }
  if (readCookie(COOKIE)) return
  const writeCookie = (value) => {
    const attrs = ["Path=/", "Max-Age=31536000", "SameSite=Lax"]
    if (location.protocol === "https:") attrs.push("Secure")
    attrs.push("Domain=.brinedew.bio")
    document.cookie = COOKIE + "=" + encodeURIComponent(value) + "; " + attrs.join("; ")
  }
  const show = () => {
    if (document.querySelector(".brinedew-analytics-consent")) return
    const privacyHref = host === "iconoplasm.brinedew.bio" ? "/privacy" : host === "geneguessr.brinedew.bio" ? "/privacy" : "/apps/iconoplasm/privacy"
    const box = document.createElement("aside")
    box.className = "brinedew-analytics-consent"
    box.setAttribute("role", "dialog")
    box.setAttribute("aria-label", "Analytics consent")
    box.innerHTML = '<p>Allow cookieless Cloudflare Web Analytics so we can count visits from your region? It is aggregate traffic data only.</p><div class="brinedew-analytics-consent__actions"><a href="' + privacyHref + '">Privacy</a><button type="button" data-analytics-consent-decline>No thanks</button><button type="button" data-analytics-consent-accept>Allow analytics</button></div>'
    box.querySelector("[data-analytics-consent-accept]").addEventListener("click", () => {
      writeCookie("accepted")
      location.reload()
    })
    box.querySelector("[data-analytics-consent-decline]").addEventListener("click", () => {
      writeCookie("declined")
      box.remove()
    })
    document.body.appendChild(box)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show, { once: true })
  else show()
})()`,
          }}
        />
        {additionalHead.map((resource) => {
          if (typeof resource === "function") {
            return resource(fileData)
          } else {
            return resource
          }
        })}
      </head>
    )
  }

  return Head
}) satisfies QuartzComponentConstructor
