// The one door the Worker fetches structure bytes through.
//
// An upstream URL comes only from the server: RCSB's ModelServer for a PDB id, the
// stored `proteins` row for an AlphaFold or SWISS-MODEL key, or the AlphaFold file
// derived from the accession. Nothing a caller sends ever becomes an upstream. This
// file is the second layer under that rule: whatever URL a lookup resolves, the
// Worker fetches it only if it is https, has no userinfo and no port, and is on one
// of the three provider hosts, and it follows a redirect only to another URL that
// passes the same test, at most three times.
//
// The three hosts are the ones the stored rows use (every stored AlphaFold URL
// starts https://alphafold.ebi.ac.uk/files/, every SWISS-MODEL URL starts
// https://swissmodel.expasy.org/, and PDB URLs are derived on models.rcsb.org;
// measured on production 2026-10-03). A fourth provider is one entry here.
const STRUCTURE_UPSTREAM_HOSTS = Object.freeze([
  "models.rcsb.org",
  "alphafold.ebi.ac.uk",
  "swissmodel.expasy.org",
])
const MAX_STRUCTURE_UPSTREAM_REDIRECTS = 3

export class StructureUpstreamRefusedError extends Error {
  constructor(reason) {
    super(`Structure upstream refused: ${reason}`)
    this.name = "StructureUpstreamRefusedError"
  }
}

export function isAllowedStructureUpstreamUrl(value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    return false
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    STRUCTURE_UPSTREAM_HOSTS.includes(url.hostname)
  )
}

// The response's media type is ours: it follows the file format in the key, never
// the upstream's header, so a body is never served as HTML from our origin.
export function structureContentType(format) {
  const normalized = String(format || "").toLowerCase()
  if (normalized === "bcif") return "application/octet-stream"
  if (normalized === "pdb") return "chemical/x-pdb"
  return "chemical/x-cif"
}

export function structureFormatFromKey(cacheKey) {
  const key = String(cacheKey || "")
  if (key.endsWith(".bcif")) return "bcif"
  if (key.endsWith(".pdb")) return "pdb"
  return "cif"
}

// Refuse to deliver an extremely large structure file: Mol* chokes on multi-10 MB
// models, and a Worker isolate (128 MB) serves many requests at once. The cap counts
// the bytes that actually stream, after decompression, because no upstream header is
// a reliable size. Measured 2026-10-03 (curl asking for gzip and br, and a local
// workerd run): RCSB sends no Content-Length (chunked); AlphaFold's is the gzip size on
// the wire, and workerd drops it when it decompresses; SWISS-MODEL sent a chunked gzip
// body with no Content-Length to curl and a plain Content-Length to workerd.
export const MAX_STRUCTURE_FILE_BYTES = 20 * 1024 * 1024

// SWISS-MODEL PDB files commonly omit the HEADER record Mol* needs to create an
// "entry" object ("Cannot read properties of undefined (reading 'entry')"). This
// anonymous line does not leak the protein's identity. It is emitted ahead of the
// upstream body, so nothing is buffered to prepend it.
export const ANONYMOUS_PDB_HEADER = new TextEncoder().encode(
  "HEADER    MODEL                                   01-JAN-00   0000\n",
)

export class StructureTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Structure body is over ${maxBytes} bytes`)
    this.name = "StructureTooLargeError"
  }
}

// Streams `body` to the caller, at most `maxBytes` of it. The next chunk is read only
// when the caller asks for it, so a large file is never held in memory. Past the cap
// the upstream is cancelled and the stream errors, so the caller never receives a
// complete oversize file and the upstream is not drained. `prefix` bytes come first
// and do not count against the cap. `onTooLarge` is called once, when the cap is hit.
export function limitStructureBody(
  body,
  { maxBytes = MAX_STRUCTURE_FILE_BYTES, prefix = null, onTooLarge = null } = {},
) {
  const reader = body.getReader()
  let received = 0
  let prefixSent = !prefix
  return new ReadableStream({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true
        controller.enqueue(prefix)
        return
      }
      const { value, done } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      received += value.byteLength
      if (received > maxBytes) {
        onTooLarge?.(received)
        await reader.cancel().catch(() => {})
        controller.error(new StructureTooLargeError(maxBytes))
        return
      }
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

// Fetches `url` and follows redirects itself, so each hop is checked before it is
// requested. Throws StructureUpstreamRefusedError for a URL or redirect target that
// fails the check or a chain longer than three redirects; any other failure is the
// network's own and propagates unchanged.
export async function fetchStructureUpstream(url, init = {}) {
  let current = String(url)
  for (let redirects = 0; ; redirects += 1) {
    if (!isAllowedStructureUpstreamUrl(current)) {
      throw new StructureUpstreamRefusedError(redirects === 0 ? "url" : "redirect target")
    }
    const response = await fetch(current, { ...init, redirect: "manual" })
    const location = response.headers.get("Location")
    const isRedirect = response.status >= 300 && response.status < 400 && location
    if (!isRedirect) return response
    try {
      await response.body?.cancel()
    } catch {
      // The redirect's body is not needed.
    }
    if (redirects >= MAX_STRUCTURE_UPSTREAM_REDIRECTS) {
      throw new StructureUpstreamRefusedError("too many redirects")
    }
    try {
      current = new URL(location, current).toString()
    } catch {
      throw new StructureUpstreamRefusedError("redirect target")
    }
  }
}
