import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import style from "./styles/mobileMenu.scss"
// @ts-ignore
import script from "./scripts/mobileMenu.inline"

export default (() => {
  const MobileMenu: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    return (
      <button
        type="button"
        class={classNames(displayClass, "mobile-menu-toggle")}
        aria-expanded="false"
        aria-label="Open tags"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="lucide-tag"
        >
          <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/>
          <circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>
        </svg>
        <span class="menu-text">Tags</span>
      </button>
    )
  }

  MobileMenu.beforeDOMLoaded = script
  MobileMenu.css = style
  return MobileMenu
}) satisfies QuartzComponentConstructor