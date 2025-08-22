import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const ProteinInfobox: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const fm = fileData.frontmatter
  
  // Only render if we have protein tag
  if (!fm?.tags?.includes("protein")) {
    return null
  }

  return (
    <div class={classNames(displayClass, "protein-infobox")}>
      <div class="infobox-header">
        <h3>{fm?.title}</h3>
        {fm?.symbol && <div class="protein-symbol">({fm.symbol})</div>}
      </div>
      
      <div class="infobox-content">
        {fm?.aliases && (
          <div class="infobox-row">
            <span class="label">Alternative names</span>
            <span class="value">{Array.isArray(fm.aliases) ? fm.aliases.join(", ") : fm.aliases}</span>
          </div>
        )}
        
        {fm?.mass && (
          <div class="infobox-row">
            <span class="label">Mass</span>
            <span class="value">{fm.mass} kDa</span>
          </div>
        )}
        
        {fm?.["length (aa)"] && (
          <div class="infobox-row">
            <span class="label">Length</span>
            <span class="value">{fm["length (aa)"]} aa</span>
          </div>
        )}
        
        {fm?.protein_type && (
          <div class="infobox-row">
            <span class="label">Type</span>
            <span class="value">{fm.protein_type}</span>
          </div>
        )}
        
        {fm?.["Domains"] && (
          <div class="infobox-row">
            <span class="label">Domains</span>
            <span class="value">{fm["Domains"]}</span>
          </div>
        )}
        
        {fm?.pathways && (
          <div class="infobox-row">
            <span class="label">Key pathways</span>
            <span class="value">{Array.isArray(fm.pathways) ? fm.pathways.join(", ") : fm.pathways}</span>
          </div>
        )}
        
        {fm?.uniprot_id && (
          <div class="infobox-row">
            <span class="label">UniProt</span>
            <span class="value">
              <a href={`https://www.uniprot.org/uniprotkb/${fm.uniprot_id}`} target="_blank" rel="noopener">
                {fm.uniprot_id}
              </a>
            </span>
          </div>
        )}
        
        {fm?.["Image link"] && (
          <div class="infobox-image">
            <img src={fm["Image link"]} alt={`${fm?.title} structure`} />
          </div>
        )}
      </div>
    </div>
  )
}

ProteinInfobox.css = `
.protein-infobox {
  float: right;
  width: 300px;
  margin: 0 0 1rem 1rem;
  border: 1px solid var(--border);
  background: var(--light);
  padding: 0;
  font-size: 0.9rem;
  clear: right;
}

.infobox-header {
  background: var(--highlight);
  padding: 0.75rem 1rem;
  text-align: center;
  border-bottom: 1px solid var(--border);
}

.infobox-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: bold;
}

.protein-symbol {
  font-style: italic;
  color: var(--gray);
  margin-top: 0.25rem;
}

.infobox-content {
  padding: 0.75rem;
}

.infobox-row {
  display: flex;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 0.5rem;
}

.infobox-row:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.infobox-row .label {
  font-weight: bold;
  min-width: 90px;
  flex-shrink: 0;
  margin-right: 0.5rem;
}

.infobox-row .value {
  flex: 1;
}

.infobox-row a {
  color: var(--secondary);
  text-decoration: none;
}

.infobox-row a:hover {
  text-decoration: underline;
}

.infobox-image {
  margin-top: 1rem;
  text-align: center;
}

.infobox-image img {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--lightgray);
}

/* Mobile responsive */
@media (max-width: 800px) {
  .protein-infobox {
    float: none;
    width: 100%;
    margin: 1rem 0;
  }
}
`

export default (() => ProteinInfobox) satisfies QuartzComponentConstructor