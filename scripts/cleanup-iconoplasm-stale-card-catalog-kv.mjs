import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import toml from "toml"

const CARD_CATALOG_PREFIX = "iconoplasm:card-catalog:"
const GALLERY_VERSION_KEY = "iconoplasm:gallery-version"

function argValue(name, fallback = "") {
  const prefix = `${name}=`
  const hit = process.argv.find((arg) => arg === name || arg.startsWith(prefix))
  if (!hit) return fallback
  if (hit === name) return "1"
  return hit.slice(prefix.length)
}

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw || ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function loadProductionKvNamespaceId(rootDir) {
  const configPath = path.join(
    rootDir,
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  )
  const config = toml.parse(await readFile(configPath, "utf8"))
  const kvNamespaces = Array.isArray(config.kv_namespaces) ? config.kv_namespaces : []
  const kv = kvNamespaces.find((namespace) => namespace?.binding === "KV")
  if (!kv?.id) throw new Error("Production KV namespace binding `KV` was not found")
  return String(kv.id)
}

async function cloudflareJson({ accountId, token, namespaceId, pathSuffix, init = {} }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}${pathSuffix}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    },
  )
  const payload = await response.json()
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare KV API failed (${response.status}): ${JSON.stringify(payload.errors || payload)}`,
    )
  }
  return payload
}

async function cloudflareText({ accountId, token, namespaceId, pathSuffix }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}${pathSuffix}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Cloudflare KV API failed (${response.status}): ${text.slice(0, 300)}`)
  }
  return text
}

function cardCatalogVersionFromKey(key) {
  return String(key || "")
    .slice(CARD_CATALOG_PREFIX.length)
    .split(":shard:")[0]
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required")
  }
  const namespaceId = argValue("--namespace-id", await loadProductionKvNamespaceId(rootDir))
  const maxDelete = positiveInt(argValue("--max-delete", "900"), 900)
  const execute = argValue("--execute", "") === "1"

  const barrier = JSON.parse(
    await cloudflareText({
      accountId,
      token,
      namespaceId,
      pathSuffix: `/values/${encodeURIComponent(GALLERY_VERSION_KEY)}`,
    }),
  )
  const keepVersions = new Set([barrier.current, barrier.previous].filter(Boolean).map(String))
  if (!keepVersions.size) throw new Error("Live gallery-version barrier did not name a version")

  let cursor = ""
  let total = 0
  let kept = 0
  let stale = 0
  const deleteKeys = []
  do {
    const qs = new URLSearchParams({ prefix: CARD_CATALOG_PREFIX, limit: "1000" })
    if (cursor) qs.set("cursor", cursor)
    const payload = await cloudflareJson({
      accountId,
      token,
      namespaceId,
      pathSuffix: `/keys?${qs.toString()}`,
    })
    for (const entry of Array.isArray(payload.result) ? payload.result : []) {
      const key = String(entry.name || "")
      if (!key.startsWith(CARD_CATALOG_PREFIX)) continue
      total += 1
      if (keepVersions.has(cardCatalogVersionFromKey(key))) {
        kept += 1
      } else {
        stale += 1
        if (deleteKeys.length < maxDelete) deleteKeys.push(key)
      }
    }
    cursor = String(payload.result_info?.cursor || "")
  } while (cursor)

  let deleted = 0
  if (execute && deleteKeys.length) {
    const payload = await cloudflareJson({
      accountId,
      token,
      namespaceId,
      pathSuffix: "/bulk/delete",
      init: { method: "POST", body: JSON.stringify(deleteKeys) },
    })
    deleted = Number(payload.result?.successful_key_count || 0)
    const unsuccessful = Array.isArray(payload.result?.unsuccessful_keys)
      ? payload.result.unsuccessful_keys.length
      : 0
    if (unsuccessful) throw new Error(`Bulk delete reported ${unsuccessful} unsuccessful keys`)
  }

  console.log(
    JSON.stringify(
      {
        execute,
        namespaceId,
        current: barrier.current,
        previous: barrier.previous || null,
        totalCardCatalogKeys: total,
        keptLiveOrPreviousKeys: kept,
        staleCardCatalogKeys: stale,
        selectedForDeletion: deleteKeys.length,
        deleted,
        deleteCap: maxDelete,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
