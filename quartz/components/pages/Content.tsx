import { ComponentChildren } from "preact"
import { htmlToJsx } from "../../util/jsx"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"

const Content: QuartzComponent = ({ fileData, tree }: QuartzComponentProps) => {
  const content = htmlToJsx(fileData.filePath!, tree) as ComponentChildren
  const classes: string[] = fileData.frontmatter?.cssclasses ?? []
  const classString = ["popover-hint", ...classes].join(" ")
  const isDraft = fileData.frontmatter?.draft === true || fileData.frontmatter?.draft === "true"
  return (
    <article class={classString} data-draft={isDraft ? "true" : undefined}>
      {content}
    </article>
  )
}

export default (() => Content) satisfies QuartzComponentConstructor
