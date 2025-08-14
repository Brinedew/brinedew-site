// quartz/components/TagExplorer.tsx
import { QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
// @ts-ignore
import script from "./scripts/toc.inline"

type Options = {
  title?: string
  minCount?: number     // hide very rare tags if you like
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

let numTags = 0
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

    const id = `tag-explorer-${numTags++}`
    return (
      <div class={classNames(displayClass, "toc")}>
        <button
          type="button"
          class="toc-header"
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
        <ul id={id} class="toc-content overflow">
          {entries.map(([tag, info]) => (
            <li class="tag-group" data-tag={tag}>
              <div class="tag-header">
                <span class="tag-name">{tag === "untagged" ? "untagged" : tag}</span>
                <span class="tag-count">({info.count})</span>
              </div>
              <ul class="tag-pages">
                {info.pages
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((p) => (
                    <li class="depth-1"><a href={p.slug}>{p.title}</a></li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  TagExplorer.css = `
  .tag-group {
    margin: 0.5rem 0;
  }
  
  .tag-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    color: var(--dark);
    margin-bottom: 0.25rem;
    opacity: 0.8;
    font-size: 0.9rem;
  }
  
  .tag-name {
    flex-grow: 1;
  }
  
  .tag-count {
    opacity: 0.6;
    font-size: 0.8rem;
    font-weight: normal;
  }
  
  .tag-pages {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  
  .tag-pages .depth-1 {
    padding-left: 1rem;
  }
  
  .tag-pages .depth-1 a {
    color: var(--dark);
    opacity: 0.75;
    transition: opacity 0.3s ease;
  }
  
  .tag-pages .depth-1 a:hover {
    opacity: 1;
  }
  `

  TagExplorer.afterDOMLoaded = script

  return TagExplorer
}) satisfies QuartzComponentConstructor