import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import style from "./styles/tagExplorer.scss"
// @ts-ignore
import script from "./scripts/tagExplorer.inline"

type Options = {
  title?: string
  minCount?: number
  sort?: "alpha" | "count"
}

const defaultOpts: Required<Options> = {
  title: "Tags", 
  minCount: 1,
  sort: "count",
}

function normalizeTag(t: unknown): string | null {
  if (typeof t !== "string") return null
  const s = t.trim()
  return s.length ? s : null
}

let numTagExplorers = 0
export default ((user?: Options) => {
  const opts = { ...defaultOpts, ...user }

  function TagExplorer({ allFiles, displayClass, cfg }: QuartzComponentProps) {
    // Build: tag -> array of pages
    const map = new Map<string, { count: number; pages: { title: string; slug: string }[] }>()
    for (const f of allFiles) {
      const tagsRaw = (f.frontmatter?.tags ?? []) as unknown[]
      const tags = (Array.isArray(tagsRaw) ? tagsRaw : [tagsRaw]).map(normalizeTag).filter(Boolean) as string[]
      
      // Handle untagged files
      if (!tags.length) {
        const untaggedBucket = map.get("untagged") ?? { count: 0, pages: [] }
        untaggedBucket.count++
        untaggedBucket.pages.push({ title: f.frontmatter?.title ?? f.slug, slug: "/" + f.slug })
        map.set("untagged", untaggedBucket)
        continue
      }
      
      for (const tag of tags) {
        const bucket = map.get(tag) ?? { count: 0, pages: [] }
        bucket.count++
        bucket.pages.push({ title: f.frontmatter?.title ?? f.slug, slug: "/" + f.slug })
        map.set(tag, bucket)
      }
    }

    // Apply count filter and sort
    let entries = [...map.entries()].filter(([, v]) => v.count >= opts.minCount)
    entries.sort((a, b) => {
      // Always put "untagged" at the bottom
      if (a[0] === "untagged") return 1
      if (b[0] === "untagged") return -1
      
      if (opts.sort === "alpha") return a[0].localeCompare(b[0])
      return b[1].count - a[1].count || a[0].localeCompare(b[0])
    })

    if (entries.length === 0) {
      return null
    }

    const id = `tag-explorer-${numTagExplorers++}`
    return (
      <div class={classNames(displayClass, "tag-explorer")}>
        <button
          type="button"
          class="tag-explorer-header"
          aria-controls={id}
          aria-expanded="true"
        >
          <h3>{opts.title}</h3>
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
            class="fold"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <div id={id} class="tag-explorer-content" role="group">
          <ul>
            {entries.map(([tag, info]) => (
              <li class="tag-group">
                <div class="tag-container" data-tag={tag}>
                  <span class="tag-name">{tag === "untagged" ? "untagged" : tag}</span>
                  <span class="tag-count">({info.count})</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="tag-icon"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
                <div class="tag-pages-outer">
                  <ul>
                    {info.pages
                      .sort((a, b) => a.title.localeCompare(b.title))
                      .map((p) => (
                        <li><a href={p.slug}>{p.title}</a></li>
                      ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  TagExplorer.css = style
  TagExplorer.afterDOMLoaded = script

  return TagExplorer
}) satisfies QuartzComponentConstructor