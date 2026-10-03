// Where a GeneGuessr structure may come from and how its bytes are bounded: the one owner,
// read by three consumers that must agree.
//
//   - the Worker (workers/lib/structure-upstream.js) fetches a structure for the target, for
//     the fallback and for the Discord recap only from these hosts, and cuts it off and
//     prefixes it the way this file says;
//   - the game document's Content Security Policy
//     (workers/lib/the-only-public-document-policy-do-not-duplicate.js) lets the page connect
//     to exactly these hosts;
//   - the page (app.js) loads a guess's structure from one of these hosts and bounds the bytes
//     with the same cap and the same HEADER line, so a file Mol* gets through the browser is
//     the file it gets through the Worker.
//
// The hosts are the ones the stored rows use (every stored AlphaFold URL starts
// https://alphafold.ebi.ac.uk/files/, every SWISS-MODEL URL starts
// https://swissmodel.expasy.org/, and PDB URLs are derived on models.rcsb.org; measured on
// production 2026-10-03). A fourth provider is one entry here: the Worker, the policy and the
// page all follow.
export const STRUCTURE_PROVIDER_HOSTS = Object.freeze([
  "models.rcsb.org",
  "alphafold.ebi.ac.uk",
  "swissmodel.expasy.org",
])

// True for an https URL with no userinfo and no port on one of the provider hosts, and for
// nothing else. A caller sends this a URL that came from the server's own stored row; the check
// is the second layer under that rule, and the CSP is the third.
export function isStructureProviderUrl(value) {
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
    STRUCTURE_PROVIDER_HOSTS.includes(url.hostname)
  )
}

// Refuse to deliver an extremely large structure file: Mol* chokes on multi-10 MB models, and a
// Worker isolate (128 MB) serves many requests at once. The cap counts the bytes that actually
// stream, after decompression, because no upstream header is a reliable size. Measured
// 2026-10-03 (curl asking for gzip and br, and a local workerd run): RCSB sends no
// Content-Length (chunked); AlphaFold's is the gzip size on the wire, and workerd drops it when
// it decompresses; SWISS-MODEL sent a chunked gzip body with no Content-Length to curl and a
// plain Content-Length to workerd.
export const MAX_STRUCTURE_FILE_BYTES = 20 * 1024 * 1024

// SWISS-MODEL PDB files commonly omit the HEADER record Mol* needs to create an "entry" object
// ("Cannot read properties of undefined (reading 'entry')"). This anonymous line does not leak
// the protein's identity. It is emitted ahead of the upstream body, so nothing is buffered to
// prepend it.
export const ANONYMOUS_PDB_HEADER = new TextEncoder().encode(
  "HEADER    MODEL                                   01-JAN-00   0000\n",
)

// A structure key (`swissmodel/Q5T9C2_9se5_1_A.pdb`) names a file that needs that line.
export function structureNeedsAnonymousHeader(cacheKey) {
  const key = String(cacheKey || "")
  return key.startsWith("swissmodel/") && key.endsWith(".pdb")
}

export class StructureTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Structure body is over ${maxBytes} bytes`)
    this.name = "StructureTooLargeError"
  }
}

// Streams `body` to the caller, at most `maxBytes` of it. The next chunk is read only when the
// caller asks for it, so a large file is never held in memory by this function. Past the cap
// the upstream is cancelled and the stream errors, so the caller never receives a complete
// oversize file and the upstream is not drained. `prefix` bytes come first and do not count
// against the cap. `onTooLarge` is called once, when the cap is hit.
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
