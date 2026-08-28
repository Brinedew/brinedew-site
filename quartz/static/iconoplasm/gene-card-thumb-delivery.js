import { portraitDelivery } from "./portrait-delivery.js?v=0d14e5a87d1914bf"

const GENE_CARD_THUMBNAIL_SELECTOR = "img.gene-card-thumb[data-iconoplasm-canonical-image-src]"

export async function installGeneCardThumbnailDelivery({
  documentRef = globalThis.document,
  delivery = portraitDelivery,
} = {}) {
  if (!documentRef?.querySelectorAll) return []
  delivery.install(documentRef)
  const images = Array.from(documentRef.querySelectorAll(GENE_CARD_THUMBNAIL_SELECTOR))
  const pending = images.map(async (image) => {
    const canonicalUrl = image.getAttribute("data-iconoplasm-canonical-image-src") || ""
    if (!canonicalUrl) return image
    delivery.bind(image, canonicalUrl)
    await delivery.ensure(canonicalUrl)
    delivery.bind(image, canonicalUrl)
    return image
  })
  return Promise.allSettled(pending)
}

void installGeneCardThumbnailDelivery()
