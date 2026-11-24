// Bunny Storage acknowledged writes can take several seconds to become
// readable through the authenticated storage endpoint. Production measurement
// on 2026-08-04 observed the recap object between the 7.0s and 15.0s probes.
// Keep one retry envelope for every pipeline that verifies a Bunny PUT so a
// short local assumption cannot diverge between GeneGuessr and Iconoplasm. A
// 2026-08-04 RHOC and PYROXD1 uploads proved that documented success responses
// can remain unreadable indefinitely; PYROXD1 required the fourth identical
// PUT. Repeating the same immutable key and bytes is safe, while repeating
// Browser Rendering is wasteful and can change pixels.
export const BUNNY_READ_AFTER_WRITE_DELAYS_MS = Object.freeze([0, 1000, 2000, 4000, 8000])

export const BUNNY_IDEMPOTENT_PUT_ATTEMPTS = 6

export const PUBLIC_BUNNY_PULL_ZONE_BASE = "https://iconoplasmportraits.b-cdn.net"

export async function putBunnyObjectUntilVerified({ put, verify }) {
  for (let attempt = 1; attempt <= BUNNY_IDEMPOTENT_PUT_ATTEMPTS; attempt += 1) {
    await put()
    const verified = await verify()
    if (verified) return verified
  }
  return null
}

function toUint8Array(body) {
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  return new TextEncoder().encode(String(body ?? ""))
}

async function sha256UpperHex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function putBunnyObjectVerified({
  storageUrl,
  publicUrl = "",
  accessKey,
  body,
  contentType = "application/octet-stream",
  cacheControl = "",
  fetchImpl = fetch,
  sleep = defaultSleep,
  verifyDelaysMs = BUNNY_READ_AFTER_WRITE_DELAYS_MS,
  maxPutAttempts = BUNNY_IDEMPOTENT_PUT_ATTEMPTS,
}) {
  const payload = toUint8Array(body)
  const checksum = await sha256UpperHex(payload)
  const putHeaders = {
    AccessKey: accessKey,
    "Content-Type": contentType,
    Checksum: checksum,
    ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
  }
  const verifyUrl = String(publicUrl || "").trim() || storageUrl
  const verifyHeaders = verifyUrl === storageUrl ? { AccessKey: accessKey } : undefined

  for (let attempt = 1; attempt <= maxPutAttempts; attempt += 1) {
    let putResponse
    try {
      putResponse = await fetchImpl(storageUrl, {
        method: "PUT",
        headers: putHeaders,
        body: payload,
      })
    } catch (error) {
      if (attempt < maxPutAttempts) {
        await sleep(1000)
        continue
      }
      throw error
    }
    await putResponse.body?.cancel?.().catch(() => null)
    if (!putResponse.ok) {
      const retryable =
        putResponse.status >= 500 ||
        putResponse.status === 429 ||
        putResponse.status === 408 ||
        putResponse.status === 400
      if (attempt < maxPutAttempts && retryable) {
        await sleep(1000)
        continue
      }
      throw new Error(`Bunny Storage PUT failed (${putResponse.status}) for ${storageUrl}`)
    }
    for (const delayMs of verifyDelaysMs) {
      if (delayMs > 0) await sleep(delayMs)
      try {
        const headResponse = await fetchImpl(verifyUrl, {
          method: "HEAD",
          ...(verifyHeaders ? { headers: verifyHeaders } : {}),
        })
        await headResponse.body?.cancel?.().catch(() => null)
        if (headResponse.status === 200) {
          return { ok: true, checksum, verifiedUrl: verifyUrl }
        }
      } catch (_error) {
        // Retry verification inside the read-after-write envelope.
      }
    }
  }
  throw new Error(
    `Bunny Storage PUT was not readable after ${maxPutAttempts} attempts for ${verifyUrl}`,
  )
}
