import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { formatDate, getDate } from "./Date"
import { QuartzPluginData } from "../plugins/vfile"

export default (() => {
  const PublicationDate: QuartzComponent = ({ cfg, fileData, displayClass }: QuartzComponentProps) => {
    const slug = String(fileData.slug ?? "")
    const fm = (fileData.frontmatter ?? {}) as Record<string, unknown>
    const hasAuthorDate =
      fm.date !== undefined || fm.published !== undefined || fm.created !== undefined

    if (
      !hasAuthorDate ||
      slug === "index" ||
      slug.startsWith("tags/") ||
      slug.startsWith("apps/") ||
      slug.startsWith("settings")
    ) {
      return null
    }

    let date: Date | undefined
    try {
      const defaultDateType =
        (fileData as QuartzPluginData).defaultDateType ??
        ((cfg as { defaultDateType?: QuartzPluginData["defaultDateType"] }).defaultDateType as
          | QuartzPluginData["defaultDateType"]
          | undefined)
      if (!defaultDateType) return null
      date = getDate({
        ...(fileData as QuartzPluginData),
        defaultDateType,
      })
    } catch {
      return null
    }

    if (!date) return null
    const locale = (cfg as { locale?: string }).locale ?? "en-US"

    return (
      <p class={`content-meta${displayClass ? ` ${displayClass}` : ""}`}>
        <time datetime={date.toISOString()}>{formatDate(date, locale as "en-US")}</time>
      </p>
    )
  }

  PublicationDate.css = `
.content-meta {
  margin: 0 0 1.1rem;
  color: var(--gray);
  font-size: 0.92rem;
  letter-spacing: 0.01em;
}
`

  return PublicationDate
}) satisfies QuartzComponentConstructor
