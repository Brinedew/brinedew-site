import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"
import { CustomOgImagesEmitterName } from "../plugins/emitters/ogImage"

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
  var host = String(window.location.hostname || "").toLowerCase()
  var origin = window.location.origin
  if (host !== "iconoplasm.brinedew.bio" && host !== "staging.brinedew.bio") {
    origin = "https://iconoplasm.brinedew.bio"
  }
  var endpoint = origin + "/api/gallery?order=votes&limit=4&offset=0"
  var bootstrap = {
    homeGalleryData: null,
    homeGalleryUsed: false,
    homeGalleryPromise: null,
  }
  window.__iconoplasmBootstrap = bootstrap
  function pickPortraitUrl(item) {
    if (!item || typeof item !== "object") return ""
    var portrait = item.portrait && typeof item.portrait === "object" ? item.portrait : null
    return String(
      item.pt ||
        item.medium_url ||
        item.thumb_url ||
        (portrait && (portrait.medium_url || portrait.thumb_url || portrait.hero_url)) ||
        "",
    ).trim()
  }
  function preloadImage(url, priority) {
    if (!url || document.querySelector('link[data-icono-preload="' + url + '"]')) return
    var link = document.createElement("link")
    link.rel = "preload"
    link.as = "image"
    link.href = url
    link.setAttribute("data-icono-preload", url)
    if (priority) link.setAttribute("fetchpriority", priority)
    document.head.appendChild(link)
  }
  bootstrap.homeGalleryPromise = fetch(endpoint, { credentials: "same-origin" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status)
      return response.json()
    })
    .then(function (data) {
      bootstrap.homeGalleryData = data
      var items = Array.isArray(data && data.items) ? data.items : []
      for (var i = 0; i < items.length && i < 2; i++) {
        var imageUrl = pickPortraitUrl(items[i])
        if (imageUrl) preloadImage(imageUrl, i === 0 ? "high" : "auto")
      }
      return data
    })
    .catch(function () {
      bootstrap.homeGalleryData = null
      return null
    })
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
      fileData.slug === "404" ? url.toString() : joinSegments(url.toString(), fileData.slug!)
    const canonicalUrl =
      typeof fileData.frontmatter?.canonicalUrl === "string"
        ? fileData.frontmatter.canonicalUrl
        : socialUrl

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

        {/* Early theme attribute to avoid flash: apply saved theme before CSS */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var c=function(n){var s=document.cookie||'';var p=s.split(/;\\s*/);for(var i=0;i<p.length;i++){var x=p[i];var k=x.indexOf('=');if(k<0)continue;if(x.slice(0,k)===n)return decodeURIComponent(x.slice(k+1))}return''};var t=c('brinedew_theme')||localStorage.getItem('theme');var e=t||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',e);document.documentElement.setAttribute('saved-theme',e);var r=c('brinedew_reader_mode')||(localStorage.getItem('readerMode')==='on'?'on':'off');document.documentElement.setAttribute('reader-mode',r==='on'?'on':'off')}catch(e){}`,
          }}
        />

        {/* Load Quartz CSS first */}
        {pageCss.map((resource) => CSSResourceToStyleElement(resource, true))}

        {/* Preload critical assets to reduce flash (fonts, logo mask) */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/static/fonts/CrimsonPro-VariableFont_wght.woff2"
          crossOrigin="anonymous"
        />
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

        {/* Custom CSS last with self-hosted fonts (bumped version to refresh caches) */}
        <link href="/static/custom.css?v=bio4" rel="stylesheet" type="text/css" />
        {iconoplasmBootstrapScript && (
          <script dangerouslySetInnerHTML={{ __html: iconoplasmBootstrapScript }} />
        )}

        {/* Conditional app assets - computed outside JSX for SSR reliability */}
        {(() => {
          if (!slugValue) {
            return null
          }

          const root = pathToRoot(slugValue as FullSlug)
          const isScriptotic =
            normalizedSlug === "apps/scriptotic" ||
            fileData.frontmatter?.title === "Scriptotic — YouTube Transcript Generator"
          const isGeneguessr =
            normalizedSlug === "apps/geneguessr" || fileData.frontmatter?.title === "Geneguessr"
          const isIconoplasm =
            normalizedSlug === "apps/iconoplasm" ||
            fileData.frontmatter?.title ===
              "Iconoplasm - Visual Mnemonics for Molecular Cell Biology"
          const isSettings =
            normalizedSlug === "settings" || fileData.frontmatter?.title === "Settings"

          if (!isScriptotic && !isGeneguessr && !isIconoplasm && !isSettings) {
            return null
          }

          return (
            <>
              {isScriptotic && (
                <>
                  <link
                    rel="stylesheet"
                    href={joinSegments(root, "static", `apps/scriptotic/app.css?v=${CACHE_BUST}`)}
                  />
                  <script
                    defer
                    src={joinSegments(root, "static", `apps/scriptotic/app.js?v=${CACHE_BUST}`)}
                  ></script>
                </>
              )}
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
                  <script
                    type="module"
                    src={joinSegments(root, "static", `geneguessr/app.js?v=${CACHE_BUST}`)}
                  ></script>
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
                    src={joinSegments(
                      root,
                      "static",
                      `iconoplasm/generated/shared-card-runtime.js?v=${CACHE_BUST}`,
                    )}
                  ></script>
                  <link
                    rel="stylesheet"
                    href={joinSegments(root, "static", `iconoplasm/styles.css?v=${CACHE_BUST}`)}
                  />
                  <script
                    type="module"
                    src={joinSegments(root, "static", `iconoplasm/app.js?v=${CACHE_BUST}`)}
                  ></script>
                </>
              )}
              {isSettings && (
                <>
                  <link
                    rel="stylesheet"
                    href={joinSegments(root, "static", `site-settings/styles.css?v=${CACHE_BUST}`)}
                  />
                  <script
                    type="module"
                    src={joinSegments(root, "static", `site-settings/app.js?v=${CACHE_BUST}`)}
                  ></script>
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
