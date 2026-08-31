import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"

export function advanceManifestationSnapshotChain(previous, ordinal, payloadSha256) {
  return sha256Hex(`${previous}\n${ordinal}\n${payloadSha256}`)
}
