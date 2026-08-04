// Bunny Storage acknowledged writes can take several seconds to become
// readable through the authenticated storage endpoint. Production measurement
// on 2026-08-04 observed the recap object between the 7.0s and 15.0s probes.
// Keep one retry envelope for every pipeline that verifies a Bunny PUT so a
// short local assumption cannot diverge between GeneGuessr and Iconoplasm.
export const BUNNY_READ_AFTER_WRITE_DELAYS_MS = Object.freeze([0, 1000, 2000, 4000, 8000])
