import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

interface Mapping {
  source: string
  target: string
}

// Hardcoded mappings - these are stable and UI-only
const MAPPINGS: Mapping[] = [
  { source: "mass", target: "height" },
  { source: "Has transmembrane domains", target: "Sex" },
  { source: "membrane_depth", target: "background_setting" },
  { source: "alignment", target: "Politics" },
  { source: "first_letter", target: "Skintone Hue " },
  { source: "rvis_percentile", target: "Skintone Lightness" },
  { source: "tissue_tau", target: "Skintone Saturation" },
  { source: "kegg_families", target: "Aesthetics" },
  { source: "percent_disordered", target: "Age" },
]

const ProteinInfobox: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const fm = fileData.frontmatter
  
  if (!fm?.tags?.includes("protein")) {
    return null
  }

  // Build mappings from hardcoded list
  const mappings: Mapping[] = MAPPINGS
  
  // Filter to only show pairs where both values exist in frontmatter
  const visibleMappings = mappings.filter(m => {
    const molecularValue = fm?.[m.source]
    // Handle field name normalization for persona fields
    const targetNormalized = m.target.toLowerCase().replace(/\s+/g, '_').replace(/_+$/, '')
    const personaKey = `persona_${targetNormalized}`
    const personaValue = fm?.[personaKey]
    
    // Filter out null, undefined, empty strings, and "nan"
    const hasMolecular = molecularValue !== undefined && 
                         molecularValue !== null && 
                         molecularValue !== '' && 
                         String(molecularValue).toLowerCase() !== 'nan'
    const hasPersona = personaValue !== undefined && 
                       personaValue !== null && 
                       personaValue !== '' && 
                       String(personaValue).toLowerCase() !== 'nan'
    
    return hasMolecular && hasPersona
  })

  // Get persona image
  const personaImage = fm?.persona_image || `/static/proteins/${fm?.uniprot_id}.png`
  
  // Compute hexcode from HSL if not provided
  const hslToHex = (h: number, s: number, l: number): string => {
    l /= 100
    const a = s * Math.min(l, 1 - l) / 100
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      return Math.round(255 * color).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }
  
  let hexcode = fm?.persona_hexcode
  if (!hexcode || hexcode === 'null') {
    const hue = fm?.persona_skintone_hue || 0
    const sat = fm?.persona_skintone_saturation || 50
    const light = fm?.persona_skintone_lightness || 50
    hexcode = hslToHex(hue, sat, light)
  }
  
  const geneSymbol = fm?.symbol || fm?.gene_symbol || fm?.title || 'Protein'

  // Helper to prettify field names and format values with units
  const prettifyLabel = (fieldName: string): string => {
    const labelMap: Record<string, string> = {
      'mass': 'Mass',
      'length': 'Length',
      'percent_disordered': 'Disorder',
      'rvis_percentile': 'RVIS',
      'alignment': 'Classification',
      'first_letter': 'First Letter',
      'Has transmembrane domains': 'Transmembrane',
      'membrane_depth': 'Membrane Depth',
      'tissue_tau': 'Tissue Specificity',
      'height': 'Height',
      'Sex': 'Gender',
      'Politics': 'Politics',
      'Skintone Hue ': 'Skin Hue',
      'Skintone Saturation': 'Skin Saturation',
      'Skintone Lightness': 'Skin Lightness',
      'Aesthetics': 'Aesthetics',
      'background_setting': 'Setting',
      'Age': 'Age'
    }
    return labelMap[fieldName] || fieldName
  }

  const formatValue = (fieldName: string, value: any): string => {
    const unitMap: Record<string, string> = {
      'mass': ' kDa',
      'length': ' aa',
      'percent_disordered': '%',
      'rvis_percentile': '',
      'height': ' cm',
      'Age': '',
      'Skintone Hue ': '°',
      'Skintone Saturation': '%',
      'Skintone Lightness': '%'
    }
    const unit = unitMap[fieldName] || ''
    return `${value}${unit}`
  }

  return (
    <div class={classNames(displayClass, "protein-infobox")}>
      {/* Persona Image */}
      <div class="infobox-image-container">
        <div class="infobox-image" style={`background-color: ${hexcode}`}>
          <img 
            src={personaImage} 
            alt={`${geneSymbol} persona portrait`}
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              const placeholder = target.nextElementSibling as HTMLElement
              if (placeholder) placeholder.style.display = 'flex'
            }}
          />
          <div class="infobox-image-placeholder" style={`background-color: ${hexcode}; display: none;`}>
            {geneSymbol}
          </div>
        </div>
      </div>

      {/* Gene Symbol Title */}
      <div class="infobox-title">
        <h3>{geneSymbol}</h3>
      </div>

      {/* Mapped Properties */}
      {visibleMappings.length > 0 && (
        <div class="infobox-mappings">
          <div class="mapping-header">
            <span class="mapping-col-title">Molecular</span>
            <span class="mapping-arrow">→</span>
            <span class="mapping-col-title">Persona</span>
          </div>
          
          {visibleMappings.map(m => {
            const targetNormalized = m.target.toLowerCase().replace(/\s+/g, '_').replace(/_+$/, '')
            const personaKey = `persona_${targetNormalized}`
            return (
              <div class="mapping-row">
                <div class="mapping-molecular">
                  <span class="mapping-label">{prettifyLabel(m.source)}</span>
                  <span class="mapping-value">{formatValue(m.source, fm[m.source])}</span>
                </div>
                <span class="mapping-arrow">→</span>
                <div class="mapping-persona">
                  <span class="mapping-label">{prettifyLabel(m.target)}</span>
                  <span class="mapping-value">{formatValue(m.target, fm[personaKey])}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* UniProt Link */}
      {fm?.uniprot_id && (
        <div class="infobox-footer">
          <a href={`https://www.uniprot.org/uniprotkb/${fm.uniprot_id}`} target="_blank" rel="noopener">
            UniProt: {fm.uniprot_id}
          </a>
        </div>
      )}
    </div>
  )
}


ProteinInfobox.css = `
.protein-infobox {
  float: right;
  width: 320px;
  margin: 0 0 1.5rem 1.5rem;
  border: 1px solid var(--border);
  background: var(--light);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.9rem;
  clear: right;
}

/* Gallery context override - force grid behavior */
.protein-infobox.in-gallery {
  float: none !important;
  width: 100% !important;
  margin: 0 !important;
  clear: none !important;
}

.infobox-image-container {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  overflow: hidden;
}

.infobox-image {
  width: 100%;
  height: 100%;
  position: relative;
}

.infobox-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.infobox-image-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 600;
  color: var(--light);
  text-align: center;
  padding: 1rem;
}

.infobox-title {
  padding: 1rem;
  text-align: center;
  border-bottom: 1px solid var(--border);
  background: var(--lightgray);
}

.infobox-title h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--dark);
}

.infobox-mappings {
  padding: 1rem;
}

.mapping-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--border);
}

.mapping-col-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--darkgray);
  text-align: center;
}

.mapping-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--lightgray);
}

.mapping-row:last-child {
  border-bottom: none;
}

.mapping-molecular,
.mapping-persona {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: center;
  align-items: center;
}

.mapping-label {
  font-size: 0.7rem;
  color: var(--darkgray);
  font-weight: 500;
  text-align: center;
}

.mapping-value {
  font-size: 0.85rem;
  color: var(--dark);
  font-weight: 600;
  text-align: center;
}

.mapping-arrow {
  color: var(--accent);
  font-weight: bold;
  font-size: 1rem;
  text-align: center;
}

.infobox-footer {
  padding: 0.75rem 1rem;
  background: var(--highlight);
  border-top: 1px solid var(--border);
  text-align: center;
}

.infobox-footer a {
  color: var(--secondary);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
}

.infobox-footer a:hover {
  text-decoration: underline;
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
