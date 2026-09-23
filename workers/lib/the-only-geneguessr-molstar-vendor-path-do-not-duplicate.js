// Both Worker entrypoints must resolve the same two pinned Mol* asset versions.
// Browsers can retain an old redirect that percent-encodes @ as %40; normalize
// only that separator so a valid script or stylesheet never falls into HTML routing.
const ALLOWED_PREFIXES = [
  "/static/vendor/pdbe-molstar@3.8.0/",
  "/static/vendor/pdbe-molstar@3.7.1/",
]

export function geneguessrMolstarVendorUpstreamUrl(pathname) {
  const path = String(pathname || "").replace(/%40/gi, "@")
  if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return null
  return `https://cdn.jsdelivr.net/npm${path.slice("/static/vendor".length)}`
}
