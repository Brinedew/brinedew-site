import baseRuntime, {
  IconoplasmVoteCoordinator,
  IconoplasmCardPublicationCoordinator,
  IconoplasmManifestationCutoverCoordinator,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  IconoplasmSyncGovernor,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

export {
  IconoplasmVoteCoordinator,
  IconoplasmCardPublicationCoordinator,
  IconoplasmManifestationCutoverCoordinator,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  IconoplasmSyncGovernor,
}

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const STATIC_SITE_ORIGIN = "https://brinedew-bio.pages.dev"

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function geneSymbolFromPath(pathname) {
  const match = /^\/gene\/([^/?#]+)\/?$/.exec(String(pathname || ""))
  if (!match) return ""
  try {
    return decodeURIComponent(match[1]).trim().toUpperCase()
  } catch {
    return String(match[1] || "").trim().toUpperCase()
  }
}

function quarantineGeneShell(symbol) {
  const safeSymbol = escapeHtml(symbol)
  const safeLetter = escapeHtml(symbol.charAt(0) || "G")
  return `
<!-- iconoplasm-static-gene-shell:start -->
<div class="icono-nav icono-static-shell-only"><a href="/" data-icono-nav>All genes</a></div>
<div id="icono-gene-content" class="icono-static-shell-only" data-b742-d1-free-gene-shell="${safeSymbol}">
  <section class="icono-gene-lead icono-gene-lead--static-shell">
    <article class="icono-card icono-card--brick icono-card--brick-static icono-gene-lead-card icono-card--variant-lab-label" style="--width:882;--height:1134;--icono-card-accent:#8a6f4d" data-icono-card-variant="lit-archival" data-icono-static-gene-shell="true">
      <div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing">
        <div class="icono-label-specimen-viewport">
          <div class="iconoplasm-tooltip-portrait-fallback">
            <div class="iconoplasm-tooltip-portrait-status" aria-hidden="true"></div>
            <div class="iconoplasm-tooltip-portrait-symbol" data-icono-static-symbol>${safeSymbol}</div>
          </div>
        </div>
        <div class="icono-label-specimen-footer">
          <div class="icono-label-specimen-notes"><div class="icono-label-specimen-note">emulsion note / glass plate spectral analysis</div></div>
          <div class="icono-label-specimen-micro"><div class="icono-label-specimen-decomposition"><span class="icono-label-specimen-cell icono-label-specimen-cell--metric icono-label-specimen-cell--row-1"><span class="icono-label-specimen-metric">letter</span></span><span class="icono-label-specimen-cell icono-label-specimen-cell--value icono-label-specimen-cell--row-1"><span class="icono-label-specimen-metric-value" data-icono-static-letter>${safeLetter}</span></span></div></div>
        </div>
        <div class="iconoplasm-tooltip-portrait-fade"></div>
      </div>
      <div class="iconoplasm-tooltip-body icono-label-mobile-info-card">
        <div class="icono-label-sheet-body">
          <div class="icono-label-header-row">
            <div class="icono-label-title-block">
              <div class="icono-label-caption">gene name</div>
              <div class="icono-label-symbol" data-icono-static-symbol>${safeSymbol}</div>
              <div class="icono-label-name"></div>
              <div class="icono-label-registry-line">ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03</div>
            </div>
          </div>
          <div class="icono-label-footer-row"><div class="icono-label-row-label">remarks</div><div class="icono-label-footer-copy"><div class="icono-label-footer-line icono-label-footer-line--typed">archive room b / bench 3 / human gene cabinet</div></div></div>
        </div>
      </div>
    </article>
  </section>
</div>
<!-- iconoplasm-static-gene-shell:end -->`
}

async function serveQuarantinedGenePage(request, url) {
  const symbol = geneSymbolFromPath(url.pathname)
  if (!symbol) return null

  const upstream = await fetch(`${STATIC_SITE_ORIGIN}/apps/iconoplasm/index`, {
    method: "GET",
    headers: { Accept: "text/html" },
  })
  if (!upstream.ok || !String(upstream.headers.get("content-type") || "").includes("text/html")) {
    return new Response(request.method === "HEAD" ? null : "Gene page temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  let html = await upstream.text()
  const shell = quarantineGeneShell(symbol)
  const rootPattern = /(<div\b[^>]*\bid=["']iconoplasm-root["'][^>]*)(>)/
  if (!rootPattern.test(html)) {
    return new Response(request.method === "HEAD" ? null : "Gene shell unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    })
  }
  html = html.replace(rootPattern, (_match, open, close) => {
    return `${open} data-icono-startup-route="gene"${close}${shell}`
  })

  const headers = new Headers(upstream.headers)
  headers.set("Content-Type", "text/html; charset=utf-8")
  headers.set("Cache-Control", "no-store")
  headers.set("X-Robots-Tag", "noindex, follow, noarchive")
  headers.set("X-B742-D1-Quarantine", "gene-shell")
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers,
  })
}

const runtime = {
  async fetch(request, env, ctx) {
    if (String(env?.ICONOPLASM_SCHEMA_TRANSITION || "") === "1") {
      const url = new URL(request.url)
      if (
        url.hostname === ICONOPLASM_HOST &&
        (request.method === "GET" || request.method === "HEAD") &&
        /^\/gene\/[^/]+\/?$/.test(url.pathname)
      ) {
        return serveQuarantinedGenePage(request, url)
      }
    }
    return baseRuntime.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    return baseRuntime.scheduled(event, env, ctx)
  },
  queue(batch, env, ctx) {
    return baseRuntime.queue(batch, env, ctx)
  },
}

export default runtime
