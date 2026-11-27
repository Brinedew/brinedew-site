import assert from "node:assert/strict"
import test from "node:test"
import { INDEXNOW_KEY, chunkUrls, parseSitemapUrls, submitIndexNowHost } from "./lib/indexnow.mjs"
import { isCanonicalBrinedewUrl, selectIconoplasmIndexNowUrls } from "./submit-indexnow.mjs"

test("parseSitemapUrls extracts, unescapes, and deduplicates <loc> entries", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset>
    <url><loc>https://brinedew.bio/</loc></url>
    <url><loc> https://brinedew.bio/posts/a?x=1&amp;y=2 </loc></url>
    <url><loc>https://brinedew.bio/</loc></url>
  </urlset>`
  assert.deepEqual(parseSitemapUrls(xml), [
    "https://brinedew.bio/",
    "https://brinedew.bio/posts/a?x=1&y=2",
  ])
})

test("chunkUrls splits large sitemaps at 10,000 URLs per batch", () => {
  const urls = Array.from({ length: 19_424 }, (_, i) => `https://iconoplasm.brinedew.bio/g/${i}`)
  const chunks = chunkUrls(urls)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].length, 10_000)
  assert.equal(chunks[1].length, 9_424)
})

test("isCanonicalBrinedewUrl keeps only high-signal editorial pages", () => {
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/"), true)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/about"), true)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/posts/clonal-governance"), true)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/wiki/cell-competition"), true)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/tags/draft"), false)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/attachments/drawing.excalidraw"), false)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/settings/"), false)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/apps/iconoplasm/"), false)
  assert.equal(isCanonicalBrinedewUrl("https://brinedew.bio/apps/geneguessr/privacy"), false)
  assert.equal(isCanonicalBrinedewUrl("https://iconoplasm.brinedew.bio/"), false)
})

test("selectIconoplasmIndexNowUrls omits legal pages and non-flagship genes by default", () => {
  const sample = [
    "https://iconoplasm.brinedew.bio/",
    "https://iconoplasm.brinedew.bio/developers",
    "https://iconoplasm.brinedew.bio/docs",
    "https://iconoplasm.brinedew.bio/docs/faq",
    "https://iconoplasm.brinedew.bio/privacy",
    "https://iconoplasm.brinedew.bio/license",
    "https://iconoplasm.brinedew.bio/caretaker-terms",
    "https://iconoplasm.brinedew.bio/genes/A",
    "https://iconoplasm.brinedew.bio/gene/TP53",
    "https://iconoplasm.brinedew.bio/gene/A1BG",
  ]
  assert.deepEqual(selectIconoplasmIndexNowUrls(sample), [
    "https://iconoplasm.brinedew.bio/",
    "https://iconoplasm.brinedew.bio/developers",
    "https://iconoplasm.brinedew.bio/docs",
    "https://iconoplasm.brinedew.bio/docs/faq",
    "https://iconoplasm.brinedew.bio/gene/TP53",
  ])
  assert.deepEqual(selectIconoplasmIndexNowUrls(sample, { includeAllGenes: true }), [
    "https://iconoplasm.brinedew.bio/",
    "https://iconoplasm.brinedew.bio/developers",
    "https://iconoplasm.brinedew.bio/docs",
    "https://iconoplasm.brinedew.bio/docs/faq",
    "https://iconoplasm.brinedew.bio/genes/A",
    "https://iconoplasm.brinedew.bio/gene/TP53",
    "https://iconoplasm.brinedew.bio/gene/A1BG",
  ])
})

test("submitIndexNowHost verifies key and submits batches on 200/202", async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (!init) {
      return new Response(`${INDEXNOW_KEY}\n`, { status: 200 })
    }
    return new Response("", { status: 202 })
  }

  const result = await submitIndexNowHost({
    host: "brinedew.bio",
    urlList: [
      "https://brinedew.bio/",
      "https://brinedew.bio/about",
      "https://other.example/ignored",
    ],
    fetchImpl,
  })

  assert.equal(result.keyLive, true)
  assert.equal(result.totalUrls, 2)
  assert.equal(result.batches, 1)
  assert.equal(result.submitted, true)
  assert.deepEqual(result.statuses, [202])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `https://brinedew.bio/${INDEXNOW_KEY}.txt`)
  const posted = JSON.parse(calls[1].init.body)
  assert.equal(posted.host, "brinedew.bio")
  assert.equal(posted.key, INDEXNOW_KEY)
  assert.equal(posted.keyLocation, `https://brinedew.bio/${INDEXNOW_KEY}.txt`)
  assert.deepEqual(posted.urlList, ["https://brinedew.bio/", "https://brinedew.bio/about"])
})

test("submitIndexNowHost fails when key file is missing and skips POST in dryRun", async () => {
  const fetchMissing = async () => new Response("Not found", { status: 404 })

  const dry = await submitIndexNowHost({
    host: "brinedew.bio",
    urlList: ["https://brinedew.bio/"],
    fetchImpl: fetchMissing,
    dryRun: true,
  })
  assert.equal(dry.keyLive, false)
  assert.equal(dry.keyStatus, 404)
  assert.equal(dry.submitted, false)

  await assert.rejects(
    () =>
      submitIndexNowHost({
        host: "brinedew.bio",
        urlList: ["https://brinedew.bio/"],
        fetchImpl: fetchMissing,
        dryRun: false,
      }),
    /not live/,
  )
})
