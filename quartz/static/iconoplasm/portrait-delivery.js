// B-1087: every image a card shows loads from img.brinedew.bio, Cloudflare's
// free cache in front of the Bunny pull zone. Cards name an image by its canonical
// URL (iconoplasm.brinedew.bio) or, if published before the switch, by Bunny's own
// host; both move onto the image host. Anything else is left as it is.
//
// The tab-level probe, hedge and Worker fallback that used to live here existed
// because some ISP resolvers could not resolve *.b-cdn.net. The image host
// resolves through Cloudflare like the site itself, so there is nothing to fall
// back from, and a fallback would only have moved images onto metered Worker
// requests.
export const IMAGE_ORIGIN = "https://img.brinedew.bio"

const REWRITTEN_ORIGINS = new Set([
  "https://iconoplasm.brinedew.bio",
  "https://iconoplasmportraits.b-cdn.net",
  IMAGE_ORIGIN,
])
const DELIVERED_PATH_PREFIXES = ["/portraits/", "/gene-cards/"]

export function imageUrl(rawUrl) {
  const value = String(rawUrl || "").trim()
  if (!value) return ""
  try {
    const parsed = new URL(value, "https://iconoplasm.brinedew.bio")
    if (
      !REWRITTEN_ORIGINS.has(parsed.origin) ||
      !DELIVERED_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
    )
      return value
    return IMAGE_ORIGIN + parsed.pathname + parsed.search
  } catch (_error) {
    return value
  }
}

function bind(element, rawUrlOrAttributes) {
  if (!element?.setAttribute) return element
  const attributes =
    typeof rawUrlOrAttributes === "string" ? { src: rawUrlOrAttributes } : rawUrlOrAttributes || {}
  for (const [name, rawUrl] of Object.entries(attributes)) {
    const url = imageUrl(rawUrl)
    if (url) element.setAttribute(name, url)
    else element.removeAttribute(name)
  }
  return element
}

export const portraitDelivery = Object.freeze({
  bind,
  ensure: async (rawUrl) => imageUrl(rawUrl),
  install: () => () => {},
  resolve: imageUrl,
  unbind: () => {},
})
