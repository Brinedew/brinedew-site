import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import { classNames } from "../../util/lang"
import { useEffect, useState } from "preact/hooks"

interface CitationData {
  doi?: string
  zoteroKey?: string
  title?: string
  authors?: string[]
  year?: string
}

type CitationProps = QuartzComponentProps & { cite: CitationData }

const CitationComponent = ({ displayClass, cite }: CitationProps) => {
  const [showPopover, setShowPopover] = useState(false)
  const [metadata, setMetadata] = useState<CitationData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchMetadata() {
      try {
        if (cite.doi) {
          const resp = await fetch(`https://api.crossref.org/works/${cite.doi}`)
          if (!resp.ok) return
          const data = await resp.json()
          if (cancelled) return
          setMetadata({
            title: data.message?.title?.[0],
            authors: Array.isArray(data.message?.author)
              ? data.message.author.map((a: { given: string; family: string }) => `${a.given} ${a.family}`)
              : undefined,
            year: data.message?.published?.["date-parts"]?.[0]?.[0],
          })
        } else if (cite.zoteroKey) {
          const resp = await fetch(
            `https://api.zotero.org/users/biokozlov/items/${cite.zoteroKey}?format=json`,
          )
          if (!resp.ok) return
          const data = await resp.json()
          if (cancelled) return
          setMetadata({
            title: data?.data?.title,
            authors: Array.isArray(data?.data?.creators)
              ? data.data.creators.map((c: { firstName?: string; lastName?: string }) =>
                  [c.firstName, c.lastName].filter(Boolean).join(" "),
                )
              : undefined,
            year: typeof data?.data?.date === "string" ? data.data.date : undefined,
          })
        }
      } catch (err) {
        console.warn("Failed to load citation data", err)
      }
    }
    fetchMetadata()
    return () => {
      cancelled = true
    }
  }, [cite.doi, cite.zoteroKey])
  
  return (
    <span
      class={classNames(displayClass, "citation")}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <sup>[{metadata?.year || cite.year || '...'}]</sup>
      {showPopover && metadata && (
        <div class="citation-popover">
          <h4>{metadata.title}</h4>
          <p>{metadata.authors?.join(', ')}</p>
          <div className="citation-actions">
            <button onClick={() => navigator.clipboard.writeText(
              `@article{${cite.doi || cite.zoteroKey},\n  title={${metadata.title}},\n  author={${metadata.authors?.join(' and ')}},\n  year={${metadata.year}}\n}`
            )}>Copy BibTeX</button>
          </div>
        </div>
      )}
    </span>
  )
}

export const Citation = CitationComponent as QuartzComponent

Citation.css = `
.citation {
  position: relative;
  cursor: help;
  color: var(--secondary);
}

.citation-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 4px;
  padding: 0.75rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  width: 300px;
  z-index: 1000;
  margin-bottom: 0.25rem;
}

.citation-popover h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
}

.citation-popover p {
  margin: 0 0 0.5rem 0;
  font-size: 0.8rem;
  color: var(--gray);
}

.citation-actions button {
  background: var(--lightgray);
  border: none;
  padding: 0.25rem 0.5rem;
  border-radius: 2px;
  font-size: 0.75rem;
  cursor: pointer;
}

.citation-actions button:hover {
  background: var(--gray);
}
`

export default (() => Citation) satisfies QuartzComponentConstructor
