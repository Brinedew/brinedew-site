import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

interface ProteinGalleryOptions {
  showDrafts?: boolean
}

export default ((userOpts?: ProteinGalleryOptions) => {
  const ProteinGallery: QuartzComponent = ({ allFiles, displayClass, cfg, fileData }: QuartzComponentProps) => {
    // Only render on the gallery page
    if (fileData.slug !== "apps/proteins/index") {
      return null
    }

    // Filter for protein pages (non-draft by default)
    const proteins = allFiles
      .filter(file => 
        file.slug?.startsWith("wiki/") && 
        file.frontmatter?.persona_image && 
        (userOpts?.showDrafts || !file.frontmatter?.draft)
      )
      .sort((a, b) => {
        const aName = a.frontmatter?.title ?? ""
        const bName = b.frontmatter?.title ?? ""
        return aName.localeCompare(bName)
      })

    if (proteins.length === 0) {
      return <p>No proteins found.</p>
    }

    return (
      <div class={classNames(displayClass, "protein-gallery")}>
        <div class="gallery-controls">
          <span>{proteins.length} proteins</span>
        </div>
        <div class="protein-gallery-grid">
          {proteins.map(protein => {
            const hexcode = protein.frontmatter?.persona_hexcode ?? "#cccccc"
            const geneSymbol = protein.frontmatter?.title ?? protein.frontmatter?.uniprot_id
            const age = protein.frontmatter?.persona_age
            const name = protein.frontmatter?.persona_name
            const imagePath = protein.frontmatter?.persona_image

            return (
              <a href={`/${protein.slug}`} class="protein-card">
                <div class="protein-card-image">
                  {imagePath && (
                    <img 
                      src={imagePath} 
                      alt={geneSymbol}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        e.currentTarget.nextElementSibling.style.display = 'flex'
                      }}
                    />
                  )}
                  <div 
                    class="protein-card-placeholder" 
                    style={`background-color: ${hexcode}; ${imagePath ? 'display: none;' : ''}`}
                  >
                    {geneSymbol}
                  </div>
                </div>
                <div class="protein-card-info">
                  <strong>{geneSymbol}</strong>
                  {name && <span class="protein-card-meta">{name}</span>}
                  {age && <span class="protein-card-age">Age {age}</span>}
                </div>
              </a>
            )
          })}
        </div>
      </div>
    )
  }

  ProteinGallery.displayName = "ProteinGallery"
  return ProteinGallery
}) satisfies QuartzComponentConstructor
