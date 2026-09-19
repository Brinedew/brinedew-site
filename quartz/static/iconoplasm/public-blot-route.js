import { immutableBlotByteUrl } from "./publication-reader.js?v=20260919-static-read-plane"

// ARCHITECTURE FENCE [IPD-011]: the stable first-party route resolves only the
// exact immutable blot selected by the coherent published gene artifact.
const BLOT_PATH = /^\/blot\/([A-Z0-9][A-Z0-9._-]{0,63})\.webp$/i
const PLACEHOLDER = "/static/iconoplasm/blot-placeholder.svg"

export function isPublicBlotRoutePath(pathname) {
  return BLOT_PATH.test(String(pathname || ""))
}

export async function resolvePublicBlotRoute({
  location = globalThis.location,
  reader = globalThis.IconoplasmPublicationReader,
} = {}) {
  const match = BLOT_PATH.exec(String(location?.pathname || ""))
  if (!match) return null
  const symbol = match[1].toUpperCase()
  let destination = PLACEHOLDER
  try {
    const gene = await reader?.gene?.(symbol)
    destination = immutableBlotByteUrl(gene?.blot)
  } catch {
    // The immutable reader owns coherent prior-head fallback. If neither the
    // current nor prior publication is readable, keep the route static.
  }
  location?.replace?.(destination)
  return destination
}
