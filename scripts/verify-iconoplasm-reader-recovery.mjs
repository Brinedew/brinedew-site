import { pathToFileURL } from "node:url"

export async function verifyIconoplasmReaderRecovery({
  fetcher = fetch,
  version = Date.now(),
} = {}) {
  const evidence = []
  async function probe(path, method = "GET") {
    const url = new URL(path, "https://iconoplasm.brinedew.bio")
    url.searchParams.set("release_probe", String(version))
    const response = await fetcher(url, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
    evidence.push({ path, method, status: response.status })
    return response
  }
  for (const symbol of ["TP53", "BRCA1"]) {
    const page = await probe(`/gene/${symbol}`)
    const html = await page.text()
    if (
      page.status !== 200 ||
      page.headers.get("X-Iconoplasm-Reader-Recovery") !== "published-card-only" ||
      !html.includes(`data-icono-gene-symbol="${symbol}"`) ||
      !html.includes('class="icono-card-semantic-profile"') ||
      !html.includes('id="iconoplasm-card-bootstrap"')
    )
      throw new Error(`COST_READER_RECOVERY_PAGE_INVALID: ${symbol}`)
    const api = await probe(`/api/iconoplasm/site/genes/${symbol}`)
    const card = await api.json()
    if (
      api.status !== 200 ||
      card.symbol !== symbol ||
      card.detail_availability?.source !== "published_card_catalog" ||
      !Array.isArray(card.portrait_candidates) ||
      card.portrait_candidates.length !== 0
    )
      throw new Error(`COST_READER_RECOVERY_CARD_INVALID: ${symbol}`)
    const head = await probe(`/gene/${symbol}`, "HEAD")
    if (head.status !== 200 || (await head.text()) !== "")
      throw new Error(`COST_READER_RECOVERY_HEAD_INVALID: ${symbol}`)
    const sha = card.portrait?.asset_sha256
    if (!/^[a-f0-9]{64}$/.test(sha || ""))
      throw new Error(`COST_READER_RECOVERY_PORTRAIT_INVALID: ${symbol}`)
    const portrait = await probe(`/portraits/v1/${sha.slice(0, 2)}/${sha}/full.webp`, "HEAD")
    if (
      portrait.status !== 200 ||
      portrait.headers.get("Content-Type") !== "image/webp" ||
      (await portrait.text()) !== ""
    )
      throw new Error(`COST_READER_RECOVERY_PORTRAIT_UNAVAILABLE: ${symbol}`)
  }
  for (const path of [
    "/gene/NOT_A_REAL_GENE_B742",
    "/api/iconoplasm/site/genes/NOT_A_REAL_GENE_B742",
  ]) {
    if ((await probe(path)).status !== 404) throw new Error("COST_READER_RECOVERY_UNKNOWN_INVALID")
  }
  const protectedResponse = await probe("/api/iconoplasm/authority/events")
  if (
    protectedResponse.status !== 503 ||
    (await protectedResponse.json()).code !== "ICONOPLASM_SCHEMA_TRANSITION"
  )
    throw new Error("COST_READER_RECOVERY_FENCE_INVALID")
  return { reader_recovered: true, application_active: false, evidence }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyIconoplasmReaderRecovery({ version: process.env.GITHUB_SHA }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message)
      process.exitCode = 1
    },
  )
}
