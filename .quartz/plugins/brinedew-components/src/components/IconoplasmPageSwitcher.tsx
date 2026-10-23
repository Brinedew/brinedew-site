import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

// B-1164: the Iconoplasm docs. A note joins this list with three frontmatter
// lines (docsSection, docsOrder, docsLabel), wherever it lives in the vault.
// Notes under apps/iconoplasm/ are served on iconoplasm.brinedew.bio at the path
// after that prefix; anything else (the essay post) stays on brinedew.bio.
const DOCS_SECTIONS = ["Start here", "Guides", "Reference", "Background"]

type DocsEntry = { slug: string; label: string; section: string; order: number }

function docsHref(slug: string) {
  if (!slug.startsWith("apps/iconoplasm/")) return `https://brinedew.bio/${slug}`
  return `/${slug.slice("apps/iconoplasm/".length).replace(/(?:^|\/)index$/, "")}`
}

function docsEntries(allFiles: QuartzComponentProps["allFiles"]): DocsEntry[] {
  const entries: DocsEntry[] = []
  for (const file of allFiles) {
    const frontmatter = (file.frontmatter ?? {}) as Record<string, unknown>
    const section = typeof frontmatter.docsSection === "string" ? frontmatter.docsSection : ""
    if (!section || !file.slug) continue
    entries.push({
      slug: file.slug,
      label: String(frontmatter.docsLabel ?? frontmatter.title ?? file.slug),
      section,
      order: Number(frontmatter.docsOrder ?? 99),
    })
  }
  const rank = (section: string) => {
    const index = DOCS_SECTIONS.indexOf(section)
    return index === -1 ? DOCS_SECTIONS.length : index
  }
  return entries.sort(
    (a, b) =>
      rank(a.section) - rank(b.section) ||
      a.section.localeCompare(b.section) ||
      a.order - b.order ||
      a.label.localeCompare(b.label),
  )
}

function DocsGroups({ docs, slug }: { docs: DocsEntry[]; slug: string }) {
  const sections = [...new Set(docs.map((doc) => doc.section))]
  return (
    <>
      {sections.map((section) => (
        <div class="icono-docs-group">
          <span class="icono-docs-section">{section}</span>
          <ul>
            {docs
              .filter((doc) => doc.section === section)
              .map((doc) => (
                <li>
                  <a
                    href={docsHref(doc.slug)}
                    class={classNames("icono-docs-link", doc.slug === slug && "is-active")}
                    aria-current={doc.slug === slug ? "page" : undefined}
                  >
                    {doc.label}
                  </a>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  )
}

const IconoplasmPageSwitcher: QuartzComponent = ({
  fileData,
  allFiles,
  displayClass,
}: QuartzComponentProps) => {
  const slug = fileData.slug ?? ""
  const isIconoplasmPage = slug.startsWith("apps/iconoplasm")
  if (!isIconoplasmPage) return null
  const docs = docsEntries(allFiles)
  const onDocsPage =
    slug.startsWith("apps/iconoplasm/docs/") || docs.some((doc) => doc.slug === slug)

  // app.js marks Archive, Genes or Studio active on the app's own routes, and
  // draws the same tab row there on phones (ensureMobilePageSwitcher).
  return (
    <nav
      class={classNames(displayClass, "icono-page-switcher")}
      aria-label="Iconoplasm sections"
      data-icono-page-switcher
    >
      <div class="icono-page-tabs">
        <a href="/" class="icono-page-tab" data-icono-nav data-icono-switch="archive">
          Archive
        </a>
        <a href="/genes" class="icono-page-tab" data-icono-nav data-icono-switch="genes">
          Genes
        </a>
        <a href="/studio" class="icono-page-tab" data-icono-nav data-icono-switch="studio">
          Studio
        </a>
        <a
          href="/docs"
          class={classNames("icono-page-tab", onDocsPage && "is-active")}
          data-icono-switch="docs"
          aria-current={slug === "apps/iconoplasm/docs/index" ? "page" : undefined}
        >
          Docs
        </a>
      </div>
      {onDocsPage && (
        <>
          <div class="icono-docs-groups">
            <DocsGroups docs={docs} slug={slug} />
          </div>
          <button
            type="button"
            class="icono-docs-menu-button"
            aria-label="Docs menu"
            aria-haspopup="dialog"
            aria-controls="icono-docs-drawer"
            data-icono-docs-open
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <dialog id="icono-docs-drawer" class="icono-docs-drawer" aria-label="Docs">
            <div class="icono-docs-drawer-head">
              <a href="/docs">Docs</a>
              <form method="dialog">
                <button type="submit" aria-label="Close">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </form>
            </div>
            <DocsGroups docs={docs} slug={slug} />
          </dialog>
        </>
      )}
    </nav>
  )
}

// The drawer is a modal <dialog>: the browser gives it Esc, a focus trap and the
// return of focus to the button. This script opens it, closes it on a tap outside
// the panel, and closes it when a link inside is followed, so Quartz's page swap
// doesn't leave it open over the next page.
IconoplasmPageSwitcher.afterDOMLoaded = `
(function () {
  function init() {
    var button = document.querySelector("[data-icono-docs-open]");
    var drawer = document.getElementById("icono-docs-drawer");
    if (!button || !drawer || button.dataset.iconoDocsBound === "true") return;
    button.dataset.iconoDocsBound = "true";
    button.addEventListener("click", function () {
      if (!drawer.open) drawer.showModal();
    });
    drawer.addEventListener("click", function (event) {
      if (event.target === drawer || event.target.closest("a")) drawer.close();
    });
  }
  document.addEventListener("nav", init);
})();
`

IconoplasmPageSwitcher.css = `
.icono-page-switcher {
  margin: 0.25rem 0 0.85rem;
}

.icono-page-switcher .icono-page-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.icono-page-switcher .icono-page-tab {
  display: block;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  background: transparent;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.85rem;
  color: var(--secondary, var(--darkgray));
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.icono-page-switcher .icono-page-tab::before {
  content: none;
}

.icono-page-switcher .icono-page-tab:hover {
  background: color-mix(in srgb, var(--ui-border) 22%, transparent);
  color: var(--dark);
}

.icono-page-switcher .icono-page-tab.is-active,
.icono-page-switcher .icono-page-tab[aria-current="page"] {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.icono-page-switcher .icono-docs-group {
  margin: 0.55rem 0 0 0.6rem;
}

.icono-docs-section {
  display: block;
  padding: 0 0.6rem 0.2rem;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--gray);
}

.icono-docs-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.icono-docs-link {
  display: block;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  font-size: 0.95rem;
  line-height: 1.3;
  color: var(--darkgray);
  text-decoration: none;
}

.icono-docs-link:hover {
  background: color-mix(in srgb, var(--ui-border) 22%, transparent);
  color: var(--dark);
}

.icono-docs-link.is-active {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.icono-page-switcher .icono-docs-menu-button {
  display: none;
}

/* Phones: the tabs become the row app.js draws on the app's own pages, at the top
   of the page, and the docs list moves into a drawer behind a menu button that
   sits first in the header row. The nav's own box steps aside (display: contents)
   so its parts join the sidebar's flex row and can be ordered there. */
@media (max-width: 800px) {
  /* #quartz-body: Quartz's own phone rule (padding-top: 2rem, gap: 0) is scoped
     under that id and would outrank a class-only selector. No top padding, so the
     tabs sit at the very top, where app.js draws them on the app's own pages. */
  #quartz-body .sidebar.left:has(> .icono-page-switcher) {
    flex-wrap: wrap;
    row-gap: 0.5rem;
    padding-top: 0;
    padding-bottom: 0.75rem;
  }

  /* The logo, search and toggles row fills what the menu button leaves; the
     search box is the part that stretches. Quartz's phone spacer (flex: 2)
     would otherwise take two thirds of the row. */
  .sidebar.left:has(> .icono-page-switcher) > .flex-component {
    flex: 1 1 0;
    min-width: 0;
  }

  .sidebar.left:has(> .icono-page-switcher) .spacer {
    display: none;
  }

  .icono-page-switcher {
    display: contents;
  }

  .icono-page-switcher .icono-page-tabs {
    order: -2;
    flex: 0 0 100%;
    flex-direction: row;
    gap: 0;
    border-bottom: 1px solid var(--ui-border, var(--lightgray));
  }

  /* Same box as app.js's row on the app pages (line height included), so the
     tabs don't jump when you switch between Studio and Docs. */
  .icono-page-switcher .icono-page-tab {
    flex: 1;
    text-align: center;
    padding: 0.6rem 0.4rem;
    line-height: 1.85rem;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    /* !important: Quartz puts component CSS in the quartz-base layer, and the
       blog layer's plain link rule (custom.css, colour and weight 400) outranks
       any selector there. app.js's row is unlayered, so it never meets that. */
    color: var(--secondary, var(--darkgray)) !important;
  }

  .icono-page-switcher .icono-page-tab:hover {
    background: transparent;
  }

  .icono-page-switcher .icono-page-tab.is-active,
  .icono-page-switcher .icono-page-tab[aria-current="page"] {
    background: transparent;
    color: var(--accent) !important;
    font-weight: 600 !important;
    border-bottom-color: var(--accent);
  }

  .icono-page-switcher .icono-docs-groups {
    display: none;
  }

  .icono-page-switcher .icono-docs-menu-button {
    order: -1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin: 0 2px 0 -8px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--darkgray);
    cursor: pointer;
  }
}

.icono-docs-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: min(82vw, 320px);
  height: 100dvh;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0.4rem 0.9rem 2rem;
  border: 0;
  overflow-y: auto;
  background: var(--light);
  color: var(--darkgray);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
  transition:
    transform 0.2s ease,
    overlay 0.2s allow-discrete,
    display 0.2s allow-discrete;
}

.icono-docs-drawer:not([open]) {
  transform: translateX(-100%);
}

@starting-style {
  .icono-docs-drawer[open] {
    transform: translateX(-100%);
  }
}

.icono-docs-drawer::backdrop {
  background: rgba(20, 14, 10, 0.4);
}

@media (prefers-reduced-motion: reduce) {
  .icono-docs-drawer {
    transition: none;
  }
}

html:has(.icono-docs-drawer[open]) {
  overflow: hidden;
}

.icono-docs-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  margin-bottom: 0.3rem;
  border-bottom: 1px solid var(--ui-border, var(--lightgray));
}

.icono-docs-drawer-head a {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--dark);
  text-decoration: none;
}

.icono-docs-drawer-head form {
  margin: 0;
}

.icono-docs-drawer-head button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-right: -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--darkgray);
  cursor: pointer;
}

.icono-docs-drawer .icono-docs-group {
  margin: 0.7rem 0 0;
}

.icono-docs-drawer .icono-docs-link {
  padding: 0.55rem 0.6rem;
  font-size: 1.05rem;
}
`

export default (() => IconoplasmPageSwitcher) satisfies QuartzComponentConstructor
