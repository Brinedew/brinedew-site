import { QuartzComponent, QuartzComponentConstructor } from "./types"
// @ts-ignore
import script from "./scripts/viewTransitions.inline"

export default (() => {
  const ViewTransitions: QuartzComponent = () => {
    return <></>
  }

  ViewTransitions.afterDOMLoaded = script

  return ViewTransitions
}) satisfies QuartzComponentConstructor