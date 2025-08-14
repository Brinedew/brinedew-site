// quartz/components/TagExplorer.tsx
import { QuartzComponentConstructor, QuartzComponentProps } from "./types"

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

export default ((user?: Options) => {
  const opts = { ...defaultOpts, ...user }

  function TagExplorer({ allFiles }: QuartzComponentProps) {
    // Build: tag -> array of pages
    const map = new Map<string, { count: number; pages: { title: string; slug: string }[] }>()
    for (const f of allFiles) {
      const tagsRaw = (f.frontmatter?.tags ?? []) as unknown[]
      const tags = (Array.isArray(tagsRaw) ? tagsRaw : [tagsRaw]).map(normalizeTag).filter(Boolean) as string[]
      if (!tags.length) continue
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
      if (opts.sort === "alpha") return a[0].localeCompare(b[0])
      return b[1].count - a[1].count || a[0].localeCompare(b[0])
    })

    return (
      <nav class="tag-explorer">
        <h3 class="tag-explorer-title">{opts.title}</h3>
        <ul class="tag-root">
          {entries.map(([tag, info]) => (
            <li class="tag-node" data-tag={tag}>
              <button class="tag-toggle" aria-expanded="false">
                <span class="tag-name">#{tag}</span>
                <span class="tag-count">({info.count})</span>
              </button>
              <ul class="tag-pages" hidden>
                {info.pages
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((p) => (
                    <li class="tag-page"><a href={p.slug}>{p.title}</a></li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  TagExplorer.css = `
  .tag-explorer { padding: 0.5rem 0; }
  .tag-explorer-title { margin: 0 0 0.5rem 0; font-size: 0.95rem; opacity: .85; }
  .tag-root, .tag-pages { list-style: none; padding-left: 0; margin: 0; }
  .tag-node { margin: 0.15rem 0; }
  .tag-toggle { all: unset; cursor: pointer; display: flex; justify-content: space-between; width: 100%; padding: .2rem .3rem; border-radius: .35rem; }
  .tag-toggle:hover { background: var(--lightgray); }
  .tag-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag-count { opacity: .7; }
  .tag-pages { margin-left: .6rem; padding-left: .6rem; border-left: 1px solid var(--lightgray);
               margin-top: .25rem; }
  .tag-page a { display: block; padding: .15rem .25rem; border-radius: .25rem; }
  .tag-page a:hover { background: var(--lightgray); }
  `

  TagExplorer.afterDOMLoaded = `
  // expand/collapse with localStorage
  const root = document.querySelector('.tag-explorer')
  if (root) {
    const key = 'TagExplorer.open'
    const open = new Set(JSON.parse(localStorage.getItem(key) || '[]'))
    const sync = () => localStorage.setItem(key, JSON.stringify([...open]))
    root.querySelectorAll('.tag-node').forEach((node) => {
      const tag = node.getAttribute('data-tag')
      const btn = node.querySelector('.tag-toggle')
      const list = node.querySelector('.tag-pages')
      const set = (expanded) => {
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
        if (expanded) { list.removeAttribute('hidden'); open.add(tag) }
        else { list.setAttribute('hidden', ''); open.delete(tag) }
        sync()
      }
      set(open.has(tag))
      btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'))
    })
  }
  `

  return TagExplorer
}) satisfies QuartzComponentConstructor