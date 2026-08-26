import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const IconoplasmPageSwitcher: QuartzComponent = ({
  fileData,
  displayClass,
}: QuartzComponentProps) => {
  const slug = fileData.slug ?? ""
  const isIconoplasmPage = slug.startsWith("apps/iconoplasm")
  if (!isIconoplasmPage) return null
  const activeTab =
    slug === "" || slug === "/"
      ? "archive"
      : slug.startsWith("clans")
        ? "clans"
        : slug.startsWith("studio")
          ? "studio"
          : slug.startsWith("wiki/Tutorial")
            ? "tutorial"
            : undefined

  return (
    <nav
      class={classNames(displayClass, "icono-page-switcher")}
      aria-label="Iconoplasm sections"
      data-icono-page-switcher
    >
      <a
        href="/"
        class={classNames("icono-page-tab", activeTab === "archive" && "is-active")}
        data-icono-nav
        data-icono-switch="archive"
        aria-current={activeTab === "archive" ? "page" : undefined}
      >
        Archive
      </a>
      <a
        href="/clans"
        class={classNames("icono-page-tab", activeTab === "clans" && "is-active")}
        data-icono-nav
        data-icono-switch="clans"
        aria-current={activeTab === "clans" ? "page" : undefined}
      >
        Clans
      </a>
      <a
        href="/studio"
        class={classNames("icono-page-tab", activeTab === "studio" && "is-active")}
        data-icono-nav
        data-icono-switch="studio"
        aria-current={activeTab === "studio" ? "page" : undefined}
      >
        Studio
      </a>
      <a
        href="/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm"
        class={classNames("icono-page-tab", activeTab === "tutorial" && "is-active")}
        data-icono-nav
        data-icono-switch="tutorial"
        aria-current={activeTab === "tutorial" ? "page" : undefined}
      >
        Tutorial
      </a>
    </nav>
  )
}

IconoplasmPageSwitcher.css = `
.icono-page-switcher {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0.25rem 0 0.85rem;
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
`

export default (() => IconoplasmPageSwitcher) satisfies QuartzComponentConstructor
