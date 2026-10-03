// ARCHITECTURE FENCE [IPD-004]
// One concern, one owner: how many distinct emulsion codes one vision may carry.
//
// A vision rebuild writes rows in proportion to the codes the vision carries (one
// registered pair and one option rollup for each code, and the same again for
// every code it just stopped carrying). The reservation for that rebuild
// (VISION_ROLLUP_ROWS in workers/lib/iconoplasm-mutation-write-bounds.js) is
// measured at MAX_EMULSION_CODES_PER_VISION, so the rebuild refuses a vision
// above the bound before it writes anything.

import { MAX_EMULSION_CODES_PER_VISION } from "../lib/iconoplasm-mutation-write-bounds.js"

export class IconoplasmVisionEmulsionCodeBoundError extends Error {
  constructor({ visionId, codes }) {
    super(
      `Vision ${visionId} carries ${codes} emulsion codes; the limit is ${MAX_EMULSION_CODES_PER_VISION}. ` +
        "No vision, registered pair or option rollup row was written. Remove or re-code the extra assets, or raise MAX_EMULSION_CODES_PER_VISION " +
        "together with a new measurement of VISION_ROLLUP_ROWS.",
    )
    this.name = "IconoplasmVisionEmulsionCodeBoundError"
    this.code = "VISION_EMULSION_CODE_BOUND_EXCEEDED"
    this.status = 409
    this.visionId = visionId
    this.codes = codes
  }
}

// `pairs` are the (code, vision, from_assets) rows the rebuild reads once:
// from_assets = 1 for a code an asset of the vision carries now, 0 for a pair the
// registry still holds from an earlier rebuild. Only the first count as carried;
// the stale ones are what the rebuild is about to remove.
export function assertVisionEmulsionCodeBound(pairs) {
  const carried = new Map()
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (!Number(pair?.from_assets)) continue
    const visionId = String(pair?.vision_id || "")
    if (!visionId) continue
    if (!carried.has(visionId)) carried.set(visionId, new Set())
    carried.get(visionId).add(String(pair?.public_emulsion_code || ""))
  }
  for (const [visionId, codes] of carried) {
    if (codes.size > MAX_EMULSION_CODES_PER_VISION) {
      throw new IconoplasmVisionEmulsionCodeBoundError({ visionId, codes: codes.size })
    }
  }
}
