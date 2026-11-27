export const INDEXNOW_KEY = "95ff5294ec1383b090e7c062042f6952"
export const INDEXNOW_KEY_FILENAME = `${INDEXNOW_KEY}.txt`
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
export const INDEXNOW_MAX_URLS_PER_BATCH = 10_000

const XML_ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
])

function decodeXmlEntities(value) {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (match) => XML_ENTITIES.get(match) ?? match)
}

/** Extract deduplicated `<loc>` URLs from a sitemap XML string. */
export function parseSitemapUrls(xml) {
  const urls = []
  const seen = new Set()
  const locPattern = /<loc>([\s\S]*?)<\/loc>/gi
  let match
  while ((match = locPattern.exec(String(xml))) !== null) {
    const url = decodeXmlEntities(match[1]).trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

/** Split a URL list into batches no larger than `size`. */
export function chunkUrls(urls, size = INDEXNOW_MAX_URLS_PER_BATCH) {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Batch size must be a positive integer, got ${size}`)
  }
  const chunks = []
  for (let i = 0; i < urls.length; i += size) {
    chunks.push(urls.slice(i, i + size))
  }
  return chunks
}

/** Check whether `https://<host>/<key>.txt` returns HTTP 200 with the exact key. */
export async function verifyIndexNowKey({ host, key = INDEXNOW_KEY, fetchImpl = fetch } = {}) {
  const keyLocation = `https://${host}/${key}.txt`
  try {
    const response = await fetchImpl(keyLocation)
    if (!response.ok) {
      return { ok: false, status: response.status, keyLocation }
    }
    const body = (await response.text()).trim()
    return { ok: body === key, status: response.status, keyLocation }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      keyLocation,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Submit a host's URLs to IndexNow in batches of at most 10,000.
 * Verifies the public `/<key>.txt` location first unless running in `dryRun`.
 */
export async function submitIndexNowHost({
  host,
  key = INDEXNOW_KEY,
  urlList,
  endpoint = INDEXNOW_ENDPOINT,
  fetchImpl = fetch,
  dryRun = false,
}) {
  const keyCheck = await verifyIndexNowKey({ host, key, fetchImpl })
  const seen = new Set()
  const hostUrls = []
  for (const rawUrl of urlList) {
    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      continue
    }
    if (parsed.hostname !== host) continue
    const normalized = parsed.toString()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    hostUrls.push(normalized)
  }

  const batches = chunkUrls(hostUrls)
  if (dryRun) {
    return {
      host,
      totalUrls: hostUrls.length,
      batches: batches.length,
      keyLive: keyCheck.ok,
      keyStatus: keyCheck.status,
      submitted: false,
      statuses: [],
    }
  }

  if (!keyCheck.ok) {
    throw new Error(
      `IndexNow key file ${keyCheck.keyLocation} is not live (status ${keyCheck.status})`,
    )
  }

  const statuses = []
  for (const batch of batches) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: keyCheck.keyLocation,
        urlList: batch,
      }),
    })
    statuses.push(response.status)
    if (response.status !== 200 && response.status !== 202) {
      const detail = await response.text().catch(() => "")
      throw new Error(
        `IndexNow submission failed for ${host}: HTTP ${response.status}${detail ? ` (${detail.slice(0, 200)})` : ""}`,
      )
    }
  }

  return {
    host,
    totalUrls: hostUrls.length,
    batches: batches.length,
    keyLive: true,
    keyStatus: keyCheck.status,
    submitted: batches.length > 0,
    statuses,
  }
}
