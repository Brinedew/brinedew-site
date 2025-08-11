import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import { classNames } from "../util/lang"

interface CitationData {
  doi?: string
  zoteroKey?: string
  title?: string
  authors?: string[]
  year?: string
}

export const Citation: QuartzComponent = ({ displayClass, cite }: QuartzComponentProps & { cite: CitationData }) => {
  const [showPopover, setShowPopover] = React.useState(false)
  const [metadata, setMetadata] = React.useState<CitationData | null>(null)
  
  React.useEffect(() => {
    if (cite.doi) {
      fetch(`https://api.crossref.org/works/${cite.doi}`)
        .then(r => r.json())
        .then(data => {
          setMetadata({
            title: data.message.title?.[0],
            authors: data.message.author?.map((a: any) => `${a.given} ${a.family}`),
            year: data.message.published?.['date-parts']?.[0]?.[0]
          })
        })
    } else if (cite.zoteroKey) {
      // Zotero integration - using public library
      fetch(`https://api.zotero.org/users/biokozlov/items/${cite.zoteroKey}?format=json`)
        .then(r => r.json())
        .then(data => {
          setMetadata({
            title: data.data.title,
            authors: data.data.creators?.map((c: any) => `${c.firstName} ${c.lastName}`),
            year: data.data.date
          })
        })
    }
  }, [cite])
  
  return (
    <span 
      className={classNames(displayClass, "citation")}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <sup>[{metadata?.year || cite.year || '...'}]</sup>
      {showPopover && metadata && (
        <div className="citation-popover">
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