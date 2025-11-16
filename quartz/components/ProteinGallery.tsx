import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import ProteinInfobox from "./ProteinInfobox"

interface ProteinGalleryOptions {
  showDrafts?: boolean
}

// Sort options - MOLECULAR PROPERTIES ONLY
const SORT_OPTIONS = [
  { value: "name", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "mass", label: "Mass (Low-High)" },
  { value: "mass-desc", label: "Mass (High-Low)" },
  { value: "length", label: "Length (Short-Long)" },
  { value: "length-desc", label: "Length (Long-Short)" },
  { value: "percent_disordered", label: "Disorder % (Low-High)" },
  { value: "percent_disordered-desc", label: "Disorder % (High-Low)" },
  { value: "rvis_percentile", label: "RVIS Percentile (Low-High)" },
  { value: "rvis_percentile-desc", label: "RVIS Percentile (High-Low)" },
  { value: "tissue_tau", label: "Tissue Tau (Low-High)" },
  { value: "tissue_tau-desc", label: "Tissue Tau (High-Low)" },
]

const isString = (value: unknown): value is string => typeof value === "string"
const toStringValue = (value: unknown): string => (typeof value === "string" ? value : value != null ? String(value) : "")

export default ((userOpts?: ProteinGalleryOptions) => {
  const ProteinGallery: QuartzComponent = ({
    allFiles,
    displayClass,
    cfg,
    fileData,
    ctx,
    externalResources,
    tree,
  }: QuartzComponentProps) => {
    const slugValue = isString(fileData.slug) ? fileData.slug : ""
    if (slugValue !== "apps/proteins/index") {
      return null
    }

    // Get the ProteinInfobox component
    const InfoboxComponent = ProteinInfobox()

    // Filter for protein pages (non-draft by default)
    const proteins = allFiles
      .filter((file) => {
        const fileSlug = isString(file.slug) ? file.slug : ""
        if (!fileSlug.startsWith("wiki/")) {
          return false
        }
        const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter?.tags : []
        const hasProteinTag = tags.includes("protein")
        const isDraft = Boolean(file.frontmatter?.draft)
        return hasProteinTag && (userOpts?.showDrafts || !isDraft)
      })
      .sort((a, b) => {
        const resolveName = (entry: typeof a) =>
          toStringValue(entry.frontmatter?.gene_symbol) ||
          toStringValue(entry.frontmatter?.symbol) ||
          toStringValue(entry.frontmatter?.title)
        return resolveName(a).localeCompare(resolveName(b))
      })

    if (proteins.length === 0) {
      return <p>No proteins found.</p>
    }

    return (
      <div class={classNames(displayClass, "protein-gallery")}>
        <div class="gallery-header">
          <div class="gallery-header-content">
            <h2>{proteins.length} Protein Personas</h2>
            <div class="gallery-sort-controls">
              <label for="protein-sort">Sort by:</label>
              <select id="protein-sort" class="protein-sort-select">
                {SORT_OPTIONS.map(option => (
                  <option value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div class="protein-gallery-grid">
          {proteins.map((protein) => {
            // Add data attributes for sorting
            const fm = protein.frontmatter
            const sortAttrs = {
              "data-name":
                toStringValue(fm?.gene_symbol) || toStringValue(fm?.symbol) || toStringValue(fm?.title),
              "data-mass": toStringValue(fm?.mass),
              "data-length": toStringValue(fm?.length),
              "data-percent-disordered": toStringValue(fm?.percent_disordered),
              "data-rvis": toStringValue(fm?.rvis_percentile),
              "data-tissue-tau": toStringValue(fm?.tissue_tau),
            }
            
            return (
              <div class="gallery-item" {...sortAttrs}>
                <InfoboxComponent 
                  fileData={protein}
                  displayClass={undefined}
                  cfg={cfg}
                  ctx={ctx}
                  externalResources={externalResources}
                  allFiles={allFiles}
                  tree={tree}
                  children={[]}
                />
              </div>
            )
          })}
        </div>
        
        <script type="module" dangerouslySetInnerHTML={{__html: `
          const sortSelect = document.getElementById('protein-sort');
          const galleryGrid = document.querySelector('.protein-gallery-grid');
          
          if (sortSelect && galleryGrid) {
            sortSelect.addEventListener('change', (e) => {
              const sortBy = e.target.value;
              const items = Array.from(galleryGrid.children);
              
              items.sort((a, b) => {
                let aVal, bVal;
                const [field, order] = sortBy.includes('-desc') 
                  ? [sortBy.replace('-desc', ''), 'desc'] 
                  : [sortBy, 'asc'];
                
                switch(field) {
                  case 'name':
                    aVal = a.getAttribute('data-name') || '';
                    bVal = b.getAttribute('data-name') || '';
                    return order === 'asc' 
                      ? aVal.localeCompare(bVal)
                      : bVal.localeCompare(aVal);
                  
                  case 'mass':
                    aVal = parseFloat(a.getAttribute('data-mass')) || 0;
                    bVal = parseFloat(b.getAttribute('data-mass')) || 0;
                    return order === 'asc' ? aVal - bVal : bVal - aVal;
                  
                  case 'length':
                    aVal = parseFloat(a.getAttribute('data-length')) || 0;
                    bVal = parseFloat(b.getAttribute('data-length')) || 0;
                    return order === 'asc' ? aVal - bVal : bVal - aVal;
                  
                  case 'percent_disordered':
                    aVal = parseFloat(a.getAttribute('data-percent-disordered')) || 0;
                    bVal = parseFloat(b.getAttribute('data-percent-disordered')) || 0;
                    return order === 'asc' ? aVal - bVal : bVal - aVal;
                  
                  case 'rvis_percentile':
                    aVal = parseFloat(a.getAttribute('data-rvis')) || 0;
                    bVal = parseFloat(b.getAttribute('data-rvis')) || 0;
                    return order === 'asc' ? aVal - bVal : bVal - aVal;
                  
                  case 'tissue_tau':
                    aVal = parseFloat(a.getAttribute('data-tissue-tau')) || 0;
                    bVal = parseFloat(b.getAttribute('data-tissue-tau')) || 0;
                    return order === 'asc' ? aVal - bVal : bVal - aVal;
                  
                  default:
                    return 0;
                }
              });
              
              // Re-append in sorted order
              items.forEach(item => galleryGrid.appendChild(item));
            });
          }
        `}} />
      </div>
    )
  }

  ProteinGallery.displayName = "ProteinGallery"
  
  ProteinGallery.css = `
  .protein-gallery {
    margin: 2rem 0;
  }

  .gallery-header {
    margin-bottom: 1.5rem;
  }

  .gallery-header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .gallery-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .gallery-sort-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .gallery-sort-controls label {
    font-weight: 500;
    font-size: 0.9rem;
  }

  .protein-sort-select {
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--light);
    font-size: 0.9rem;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23333' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    background-size: 12px;
  }

  .protein-sort-select:hover {
    border-color: var(--secondary);
  }

  .protein-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 2rem;
  }

  .gallery-item {
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .gallery-item:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0,0,0,0.15);
  }
  
  @media (max-width: 800px) {
    .gallery-header-content {
      flex-direction: column;
      align-items: flex-start;
    }
    
    .protein-gallery-grid {
      grid-template-columns: 1fr;
    }
  }
  `
  
  return ProteinGallery
}) satisfies QuartzComponentConstructor
