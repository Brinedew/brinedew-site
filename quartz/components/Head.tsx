import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"
import { CustomOgImagesEmitterName } from "../plugins/emitters/ogImage"

// Build-time cache buster - prefer explicit env override, fall back to commit or timestamp
const CACHE_BUST =
  (typeof process !== "undefined" && process.env?.CACHE_BUST) ||
  (typeof process !== "undefined" && process.env?.VERCEL_GIT_COMMIT_SHA) ||
  `${Date.now()}`

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

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, "static/icon.png")

    // Url of current page
    const socialUrl =
      fileData.slug === "404" ? url.toString() : joinSegments(url.toString(), fileData.slug!)

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some(
      (e) => e.name === CustomOgImagesEmitterName,
    )
    const ogImageDefaultPath = `https://${cfg.baseUrl}/static/og-image.png`

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
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />
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
            <meta
              property="og:image:type"
              content={`image/${getFileExtension(ogImageDefaultPath) ?? "png"}`}
            />
          </>
        )}

        {cfg.baseUrl && (
          <>
            <meta property="twitter:domain" content={cfg.baseUrl}></meta>
            <meta property="og:url" content={socialUrl}></meta>
            <meta property="twitter:url" content={socialUrl}></meta>
          </>
        )}

        <link rel="icon" href={iconPath} />
        <meta name="description" content={description} />
        <meta name="generator" content="Quartz" />
        <meta name="geneguessr-build" content="head-tsx-patched" />

        {/* Early theme attribute to avoid flash: apply saved theme before CSS */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`,
          }}
        />

        {/* Load Quartz CSS first */}
        {css.map((resource) => CSSResourceToStyleElement(resource, true))}

        {/* Preload critical assets to reduce flash (fonts, logo mask) */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/static/fonts/CrimsonPro-VariableFont_wght.woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/static/fonts/IBMPlexMono-Regular.woff2"
          crossOrigin="anonymous"
        />
        <link rel="preload" as="image" href="/static/logo-mask.png" fetchpriority="high" />

        {/* Custom CSS last with self-hosted fonts (bumped version to refresh caches) */}
        <link href="/static/custom.css?v=bio3" rel="stylesheet" type="text/css" />
        
        {/* Conditional app assets - computed outside JSX for SSR reliability */}
        {(() => {
          const slugValue = typeof fileData.slug === "string" ? fileData.slug : undefined;

          if (!slugValue) {
            return null;
          }

          const normalizedSlug = slugValue.replace(/\/index(?:\.html)?$/, "");
          const root = pathToRoot(slugValue as FullSlug);
          const isScriptotic =
            normalizedSlug === "apps/scriptotic" ||
            fileData.frontmatter?.title === "Scriptotic — YouTube Transcript Generator";
          const isGeneguessr =
            normalizedSlug === "apps/geneguessr" || fileData.frontmatter?.title === "Geneguessr";

          if (!isScriptotic && !isGeneguessr) {
            return null;
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
                  <script defer src={joinSegments(root, "static", `geneguessr/app.js?v=${CACHE_BUST}`)}></script>
                </>
              )}
            </>
          )
        })()}
        
        {/* Performance optimizations */}
        <link rel="prefetch" href="/posts" as="document" />
        {js
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
