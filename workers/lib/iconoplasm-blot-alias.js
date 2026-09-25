import {
  externalPortraitStoragePassword,
  externalPortraitStorageUrl,
} from "./iconoplasm-portrait-storage.js"

// B-846: the stable /blot/{SYMBOL}.webp link is a mutable Bunny object at
// BLOT/{SYMBOL}.WEBP. A Cloudflare redirect (ref iconoplasm_blot_alias in
// cloudflare/the-only-brinedew-static-edge-policy.json) sends /blot/* to
// upper(path) on Bunny before any Worker runs, so every casing of a link lands
// on this one key (the Free plan has no regex). A hotlinked figure then costs
// Bunny bandwidth, not the Worker request budget that sign-in and saves share.
//
// The 19-24 Sep version of this alias was removed (#259, B-796) because Bunny
// cached it for 30 days with no purge, and its readback check blocked a real
// publication. Two rules keep that from recurring:
//   1. every write is followed by a purge of the exact public URL, with the
//      owner-created account key BUNNY_ACCOUNT_API_KEY (runbook: portrait
//      delivery); the Worker's storage key cannot purge;
//   2. this never throws: callers treat the alias as a projection and must
//      not block publication on it. A failure is reported and retried by the
//      next write or scripts/refresh-blot-aliases.mjs.
export const BLOT_ALIAS_CDN_ORIGIN = "https://iconoplasmportraits.b-cdn.net"
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/

function aliasKey(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  return SYMBOL.test(normalized) && !normalized.includes("..") ? `BLOT/${normalized}.WEBP` : null
}

export function blotAliasPublicUrl(symbol) {
  const key = aliasKey(symbol)
  return key ? `${BLOT_ALIAS_CDN_ORIGIN}/${key}` : null
}

export async function writeBlotAlias(env, symbol, bytes, { fetchImpl = fetch } = {}) {
  const key = aliasKey(symbol)
  if (!key) return { ok: false, reason: "invalid_symbol" }
  const url = externalPortraitStorageUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!url || !password) return { ok: false, reason: "storage_unconfigured" }
  try {
    const put = await fetchImpl(url, {
      method: "PUT",
      headers: { AccessKey: password, "Content-Type": "image/webp" },
      body: bytes,
    })
    await put.body?.cancel().catch(() => {})
    if (!put.ok) return { ok: false, reason: `put_${put.status}` }
    const apiKey = String(env?.BUNNY_ACCOUNT_API_KEY || "").trim()
    if (!apiKey) return { ok: false, reason: "purge_unconfigured" }
    const purgeUrl = `https://api.bunny.net/purge?url=${encodeURIComponent(`${BLOT_ALIAS_CDN_ORIGIN}/${key}`)}&async=false`
    const purge = await fetchImpl(purgeUrl, { method: "POST", headers: { AccessKey: apiKey } })
    await purge.body?.cancel().catch(() => {})
    return purge.ok ? { ok: true, key } : { ok: false, reason: `purge_${purge.status}` }
  } catch (error) {
    return { ok: false, reason: `error_${String(error?.message || error).slice(0, 80)}` }
  }
}
