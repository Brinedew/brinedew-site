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
        aria-label="Open menu"
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
          class="lucide-menu"
        >
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
        <span class="menu-text">Menu</span>
      </button>
    )
  }

  MobileMenu.beforeDOMLoaded = script
  MobileMenu.css = style
  return MobileMenu
}) satisfies QuartzComponentConstructor