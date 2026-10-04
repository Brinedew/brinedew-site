import { pathToFileURL } from "node:url"

// IPD-008: the page reads each gene's one stable object from the CDN, so the
// verifier reads the same object to learn which portrait the Worker must serve.
const STABLE_OBJECT_ORIGIN = "https://iconoplasmportraits.b-cdn.net"

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
  // Every /gene/{SYMBOL} is a static per-gene document the asset layer serves
  // before the Worker runs, in production and in the containment deploy, which
  // keeps those asset bytes. Its card comes from the CDN. The one thing this
  // containment Worker answers for a reader is the first-party portrait fallback.
  const canonicalLink = (symbol) =>
    `<link rel="canonical" href="https://iconoplasm.brinedew.bio/gene/${symbol}">`
  for (const symbol of ["TP53", "BRCA1"]) {
    const page = await probe(`/gene/${symbol}`)
    const html = await page.text()
    if (page.status !== 200 || !html.includes(canonicalLink(symbol)))
      throw new Error(`COST_READER_RECOVERY_PAGE_INVALID: ${symbol}`)
    const stable = await probe(`${STABLE_OBJECT_ORIGIN}/genes/v3/${symbol}.json`)
    const card = await stable.json()
    if (stable.status !== 200 || card.symbol !== symbol)
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
      portrait.headers.get("X-Iconoplasm-Reader-Recovery") !== "published-card-only" ||
      portrait.headers.get("Content-Type") !== "image/webp" ||
      (await portrait.text()) !== ""
    )
      throw new Error(`COST_READER_RECOVERY_PORTRAIT_UNAVAILABLE: ${symbol}`)
  }
  // The unknown gene's page is a 404 (or, from another topology, the app shell),
  // but never a per-gene document claiming that symbol.
  const unknownPage = await probe("/gene/NOT_A_REAL_GENE_B742")
  const unknownHtml = await unknownPage.text()
  if (
    (unknownPage.status !== 404 && unknownPage.status !== 200) ||
    unknownHtml.includes(canonicalLink("NOT_A_REAL_GENE_B742"))
  )
    throw new Error("COST_READER_RECOVERY_UNKNOWN_INVALID")
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
