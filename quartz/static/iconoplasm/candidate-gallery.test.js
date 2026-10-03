import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const generatedSharedCardRuntimePath = new URL(
  "./generated/shared-card-runtime.js",
  import.meta.url,
)

test("shared candidate renderer emits a complete, escaped public snapshot", async () => {
  const vm = await import("node:vm")
  const runtime = await readFile(generatedSharedCardRuntimePath, "utf8")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtime, sandbox)
  const shared = sandbox.IconoplasmCardShared
  assert.equal(typeof shared?.renderCandidateGalleryHtml, "function")

  const html = shared.renderCandidateGalleryHtml({
    symbol: "CD4",
    portrait_candidates: [
      {
        is_current: true,
        asset_sha256: "current",
        medium_url: "https://example.test/current.webp",
      },
      {
        asset_sha256: "candidate-a",
        candidate_image_id: 18,
        vision_id: "vision-a",
        medium_url: "https://example.test/a.webp",
        full_url: "https://example.test/a.png",
        sample_label: "A1-18",
        emulsion_id: "emulsion-1",
        width: 800,
        height: 1000,
      },
      {
        asset_sha256: "candidate-b",
        medium_url: "https://example.test/b.webp",
        sample_label: "<unsafe>",
      },
      { asset_sha256: "missing-media" },
    ],
  })

  assert.match(html, /data-icono-public-candidates/)
  assert.equal((html.match(/class="icono-candidate-card"/g) || []).length, 2)
  assert.match(html, /data-icono-candidate-vote-box="candidate-a"/)
  assert.match(html, /data-icono-candidate-image-id="18"/)
  assert.match(html, /data-icono-vision-id="vision-a"/)
  assert.match(html, /data-icono-candidate-actions-island="candidate-a"/)
  assert.match(html, /data-iconoplasm-role="candidate-blot" data-gene-symbol="CD4"/)
  assert.match(html, /loading="lazy" decoding="async" fetchpriority="low"/)
  assert.match(html, /&lt;unsafe&gt;/)
  assert.doesNotMatch(html, /current\.webp|missing-media/)
})

test("candidate galleries distinguish unavailable data from a genuinely empty collection", async () => {
  const vm = await import("node:vm")
  const runtime = await readFile(generatedSharedCardRuntimePath, "utf8")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtime, sandbox)
  const render = sandbox.IconoplasmCardShared.renderCandidateGalleryHtml
  const unavailable = render({
    symbol: "TRIM28",
    portrait_candidates: [],
    detail_availability: { live_candidates: "temporarily_unavailable" },
  })
  assert.match(unavailable, /Other candidate images/)
  assert.match(unavailable, /temporarily unavailable/)
  assert.match(unavailable, /data-icono-candidates-retry/)
  assert.doesNotMatch(unavailable, /No other candidate images yet|AUTHENTICATION|Sign in/)
  const empty = render({ symbol: "TRIM28", portrait_candidates: [] })
  assert.match(empty, /No other candidate images yet/)
  assert.doesNotMatch(empty, /data-icono-candidates-retry|unavailable/)
  const missingMedia = render({
    symbol: "TRIM28",
    portrait_candidates: [{ asset_sha256: "missing" }],
  })
  assert.match(missingMedia, /temporarily unavailable/)
  assert.doesNotMatch(missingMedia, /No other candidate images yet/)
})
