// B-846: the stable /blot/{SYMBOL}.webp link is served from a mutable Bunny
// alias so a hotlinked figure costs no Worker request. Ways the alias writer
// can go wrong, each asserted below:
// 1. it writes somewhere other than BLOT/{SYMBOL}.WEBP (the redirect upper-cases the whole path, so any casing of a link lands on one key), or with a non-image type;
// 2. it skips the CDN purge, so Bunny serves the old bytes for 30 days (the
//    24 Sep SOX11 failure);
// 3. it purges a URL other than the exact public one;
// 4. a failed PUT still purges, or throws and blocks the caller's publication;
// 5. a missing purge key is silent instead of reported;
// 6. a hostile symbol escapes the BLOT/ prefix.
import assert from "node:assert/strict"
import test from "node:test"

import { blotAliasPublicUrl, writeBlotAlias } from "./iconoplasm-blot-alias.js"

const ENV = {
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "zone",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "storage-secret",
  BUNNY_ACCOUNT_API_KEY: "account-secret",
}

function recorder(status = { put: 201, purge: 200 }) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers })
    const code = String(url).includes("api.bunny.net") ? status.purge : status.put
    return new Response(null, { status: code })
  }
  return { calls, fetchImpl }
}

test("writes the alias as webp, then purges its exact public URL", async () => {
  const { calls, fetchImpl } = recorder()
  const result = await writeBlotAlias(ENV, "tp53", new Uint8Array([1, 2]), { fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(calls[0].method, "PUT")
  assert.equal(calls[0].url, "https://storage.bunnycdn.com/zone/BLOT/TP53.WEBP")
  assert.equal(calls[0].headers["Content-Type"], "image/webp")
  assert.equal(calls[1].method, "POST")
  assert.equal(
    new URL(calls[1].url).searchParams.get("url"),
    "https://iconoplasmportraits.b-cdn.net/BLOT/TP53.WEBP",
  )
  assert.equal(calls[1].headers.AccessKey, "account-secret")
  assert.equal(blotAliasPublicUrl("tp53"), "https://iconoplasmportraits.b-cdn.net/BLOT/TP53.WEBP")
})

test("a failed PUT reports and never purges or throws", async () => {
  const { calls, fetchImpl } = recorder({ put: 500, purge: 200 })
  const result = await writeBlotAlias(ENV, "TP53", new Uint8Array([1]), { fetchImpl })
  assert.deepEqual(result, { ok: false, reason: "put_500" })
  assert.equal(calls.length, 1)
})

test("a missing purge key is reported, not silent", async () => {
  const { fetchImpl } = recorder()
  const env = { ...ENV, BUNNY_ACCOUNT_API_KEY: "" }
  const result = await writeBlotAlias(env, "TP53", new Uint8Array([1]), { fetchImpl })
  assert.deepEqual(result, { ok: false, reason: "purge_unconfigured" })
})

test("a hostile symbol cannot leave the BLOT/ prefix", async () => {
  const { calls, fetchImpl } = recorder()
  const result = await writeBlotAlias(ENV, "../portraits/x", new Uint8Array([1]), { fetchImpl })
  assert.deepEqual(result, { ok: false, reason: "invalid_symbol" })
  assert.equal(calls.length, 0)
})
