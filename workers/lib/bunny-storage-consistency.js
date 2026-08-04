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

export async function putBunnyObjectUntilVerified({ put, verify }) {
  for (let attempt = 1; attempt <= BUNNY_IDEMPOTENT_PUT_ATTEMPTS; attempt += 1) {
    await put()
    const verified = await verify()
    if (verified) return verified
  }
  return null
}
