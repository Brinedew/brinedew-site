import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import ProteinInfobox from "./ProteinInfobox"

interface ProteinGalleryOptions {
  showDrafts?: boolean
}

export default ((userOpts?: ProteinGalleryOptions) => {
  const ProteinGallery: QuartzComponent = ({ allFiles, displayClass, cfg, fileData }: QuartzComponentProps) => {
    // Only render on the gallery page
    if (fileData.slug !== "apps/proteins/index") {
      return null
    }

    // Get the ProteinInfobox component
    const InfoboxComponent = ProteinInfobox()

    // Filter for protein pages (non-draft by default)
    const proteins = allFiles
      .filter(file => 
        file.slug?.startsWith("wiki/") && 
        file.frontmatter?.tags?.includes("protein") &&
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
        <div class="gallery-header">
          <h2>{proteins.length} Protein Personas</h2>
        </div>
        <div class="protein-gallery-grid">
          {proteins.map(protein => {
            // Render each protein using the actual ProteinInfobox component
            return (
              <InfoboxComponent 
                fileData={protein}
                displayClass="in-gallery"
                cfg={cfg}
                allFiles={allFiles}
                tree={null as any}
              />
            )
          })}
        </div>
      </div>
    )
  }

  ProteinGallery.displayName = "ProteinGallery"
  
  ProteinGallery.css = `
  .protein-gallery {
    margin: 2rem 0;
  }

  .gallery-header h2 {
    margin-bottom: 1.5rem;
    font-size: 1.5rem;
  }

  .protein-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 2rem;
  }

  .gallery-item-link {
    text-decoration: none;
    color: inherit;
    display: block;
    transition: transform 0.2s, box-shadow 0.2s;
    /* Ensure link matches infobox size exactly */
    width: 100%;
    height: 100%;
  }
  
  .gallery-item-link > .protein-infobox {
    /* Remove any margins that might cause size mismatch */
    margin: 0 !important;
  }

  .gallery-item-link:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0,0,0,0.15);
  }
  
  @media (max-width: 800px) {
    .protein-gallery-grid {
      grid-template-columns: 1fr;
    }
  }
  `
  
  return ProteinGallery
}) satisfies QuartzComponentConstructor
