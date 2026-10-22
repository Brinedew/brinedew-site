import {
  BUNNY_READ_AFTER_WRITE_DELAYS_MS,
  putBunnyObjectUntilVerified,
} from "./bunny-storage-consistency.js"
import {
  externalPortraitStoragePassword,
  externalPortraitStorageUrl,
  fetchPortraitStorage,
} from "./iconoplasm-portrait-storage.js"
import { ICONOPLASM_MANIFESTATION_PROSE_MAX_BYTES } from "./iconoplasm-manifestation-prose.js"
import { sha256Hex } from "./iconoplasm-sha256.js"

// B-1156: the factory's prose for each gene lives on Bunny Storage, not in D1.
// It was 72 MiB of the 500 MB database and almost nobody reads it: portraits are
// drawn from the Tags, which stay in D1. Its readers are the caretaker panel
// ("Original" in History, and a new caretaker's first draft), a portrait
// request's lease material, and the gene page when a caretaker shows the factory
// text to readers. The workstation's prompts.db holds the same texts.
//
// One immutable object per text, named by its SHA-256: texts/v1/<SYMBOL>/<sha>.txt.
// A new text is a new object, so nothing is overwritten and no cache goes stale.
// The pull zone blocks texts/v1/ (bunny/the-only-iconoplasm-pull-zone-policy.json),
// because readers see a gene's prose only when its caretaker shows it, and the
// stable gene object publishes the hash that names the file.
export const FACTORY_PROSE_PREFIX = "texts/v1"
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
const SHA256 = /^[a-f0-9]{64}$/

export function factoryProseKey(symbol, textSha256) {
  const clean = String(symbol || "")
    .trim()
    .toUpperCase()
  const sha = String(textSha256 || "").toLowerCase()
  if (!SYMBOL.test(clean)) throw new Error("Invalid factory prose symbol")
  if (!SHA256.test(sha)) throw new Error("Invalid factory prose hash")
  return `${FACTORY_PROSE_PREFIX}/${clean}/${sha}.txt`
}

function storage(env, key) {
  const url = externalPortraitStorageUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!url || !password) throw new Error("Bunny Storage is not configured for factory prose")
  return { url, password }
}

// The prose, checked against the hash that names it, or null when the object
// isn't there.
export async function readFactoryProse(env, symbol, textSha256) {
  const key = factoryProseKey(symbol, textSha256)
  const { url, password } = storage(env, key)
  const response = await fetchPortraitStorage(
    env,
    url,
    { method: "GET", headers: { AccessKey: password, Accept: "text/plain" } },
    { operation: "GET", key },
  )
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Factory prose read failed (${response.status}) for ${key}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > ICONOPLASM_MANIFESTATION_PROSE_MAX_BYTES)
    throw new Error(`Factory prose too large: ${key}`)
  if ((await sha256Hex(bytes)) !== String(textSha256).toLowerCase()) {
    throw new Error(`Factory prose does not match its hash: ${key}`)
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

// Stores the prose under its hash and proves it by reading it back. Writing a
// text that is already there costs one read.
export async function writeFactoryProse(env, symbol, prose) {
  const bytes = new TextEncoder().encode(String(prose))
  const textSha256 = await sha256Hex(bytes)
  const key = factoryProseKey(symbol, textSha256)
  const { url, password } = storage(env, key)
  const stored = async () => (await readFactoryProse(env, symbol, textSha256)) !== null
  if (await stored().catch(() => false)) return { key, text_sha256: textSha256, written: false }
  // An acknowledged PUT can take seconds to become readable, so the read-back
  // waits through the shared delays before the PUT is tried again.
  const readable = async () => {
    for (const delay of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (await stored().catch(() => false)) return true
    }
    return false
  }
  const verified = await putBunnyObjectUntilVerified({
    put: async () => {
      const response = await fetchPortraitStorage(
        env,
        url,
        {
          method: "PUT",
          headers: { AccessKey: password, "Content-Type": "text/plain; charset=utf-8" },
          body: bytes,
        },
        { operation: "PUT", key },
      )
      await response.body?.cancel().catch(() => {})
      if (!response.ok)
        throw new Error(`Factory prose write failed (${response.status}) for ${key}`)
    },
    verify: readable,
  })
  if (!verified) throw new Error(`Factory prose did not become readable: ${key}`)
  return { key, text_sha256: textSha256, written: true }
}
