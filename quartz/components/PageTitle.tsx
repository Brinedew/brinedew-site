import { pathToRoot } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { i18n } from "../i18n"

const PageTitle: QuartzComponent = ({ fileData, cfg, displayClass }: QuartzComponentProps) => {
  const title = cfg?.pageTitle ?? i18n(cfg.locale).propertyDefaults.title
  const baseDir = pathToRoot(fileData.slug!)
  return (
    <h2 class={classNames(displayClass, "page-title")}>
      <a href={baseDir} class="site-brand" aria-label={title} title={title}>
        <span class="site-logo" aria-hidden="true"></span>
      </a>
    </h2>
  )
}

PageTitle.css = `
.page-title {
  font-size: 1.75rem;
  margin: 0;
  font-family: var(--titleFont);
}

.page-title .site-brand {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.page-title .site-logo {
  display: inline-block;
  width: 28px;
  height: 28px;
  /* Paint the glyph in the current text color */
  background-color: currentColor;
  /* Use the rotated B PNG as a mask to keep transparent background */
  -webkit-mask-image: url('/static/logo-mask.png');
  mask-image: url('/static/logo-mask.png');
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
}
`

export default (() => PageTitle) satisfies QuartzComponentConstructor
