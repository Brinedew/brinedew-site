// Regression coverage for B-1265: when requested candidate portraits arrive in
// the Request Inbox, the gene page must show them at once even while CDN
// (`img.brinedew.bio/genes/v3/<SYMBOL>.json`) still serves stale bytes.
//
// Proves all four requester journeys in Chrome:
// 1. Open gene page reconciles newly fulfilled candidates in place without reload
//    and without wiping typed comment draft text, and clicking the Ready notice
//    refreshes from origin and marks the receipt read.
// 2. F5 reload skips stale CDN prefetch via localStorage/sessionStorage and
//    reads canonical origin immediately.
// 3. Clicking the sidebar Ready receipt from `/` bypasses stale in-memory
//    portraitDetailCache and stale CDN, reading origin and marking read.
// 4. Opening `/gene/TP53` in a fresh context (Discord DM link, empty storage)
//    detects missing SHAs from `/api/iconoplasm/notifications`, reads origin,
//    renders the new candidate, and only then marks the receipt read.
// E2E scope: quartz/static/iconoplasm/app.js quartz/static/iconoplasm/request-inbox.js quartz/static/iconoplasm/publication-reader.js scripts/prepare-iconoplasm-edge-assets.mjs
import assert from "node:assert/strict"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

const LEAD_SHA = "a".repeat(64)
const EXISTING_CAND_SHA = "b".repeat(64)
const NEW_CAND_SHA = "c".repeat(64)

function portraitUrl(sha, size = "medium") {
  return `https://img.brinedew.bio/portraits/v1/${sha.slice(0, 2)}/${sha}/${size}.webp`
}

function candidateEntry(sha, { isCurrent = false, score = 1, emulsionId = "C9-21006" } = {}) {
  return {
    artist_id: "21006",
    asset_sha256: sha,
    autopick_eligible: true,
    candidate_image_id: isCurrent ? 101 : sha === EXISTING_CAND_SHA ? 102 : 103,
    caretaker_supervote: false,
    caretaker_supervote_direction: null,
    caretaker_supervote_weight: 0,
    created_at: "2026-11-19 01:00:00",
    emulsion_id: emulsionId,
    emulsion_label: emulsionId,
    full_url: portraitUrl(sha, "full"),
    height: 1024,
    image_downvotes: 0,
    image_score: score,
    image_upvotes: score,
    is_current: isCurrent,
    medium_url: portraitUrl(sha, "medium"),
    sample_label: null,
    sample_number: 0,
    sample_text_hash: null,
    small_url: portraitUrl(sha, "small"),
    status: "approved",
    vision_id: "anima-v1-21006",
    weighted_score: score,
    width: 768,
  }
}

function tp53GeneObject({ includeNewCandidate }) {
  const candidates = [
    candidateEntry(LEAD_SHA, { isCurrent: true, score: 5, emulsionId: "C9-21006" }),
    candidateEntry(EXISTING_CAND_SHA, { isCurrent: false, score: 2, emulsionId: "A1-10001" }),
  ]
  if (includeNewCandidate) {
    candidates.push(
      candidateEntry(NEW_CAND_SHA, { isCurrent: false, score: 0, emulsionId: "B4-20002" }),
    )
  }
  return {
    api_version: "v1",
    candidate_count: candidates.length,
    canonical_key: "symbol",
    canonical_manifestation: {
      body_sha256: "d".repeat(64),
      gene_id: "gene_tp53",
      manifestation_revision_id: "rev_1",
      prose: null,
      public_page_visible: false,
    },
    canonical_symbol: "TP53",
    caretaker: null,
    color: "#3b5b76",
    essence: {
      age: "48",
      age_years: 48,
      name: "tumor protein p53",
      sex: "Male",
      skin_hex: "#3b5b76",
      skin_name: "Slate Blue",
      weight_kg: 43.6,
    },
    first_publication_year: 1979,
    full_name: "tumor protein p53",
    molecular_weight_kda: 43.6,
    portrait: {
      artist_id: "21006",
      asset_sha256: LEAD_SHA,
      candidate_image_id: 101,
      emulsion_id: "C9-21006",
      emulsion_label: "C9-21006",
      height: 1024,
      hero_url: portraitUrl(LEAD_SHA, "full"),
      medium_url: portraitUrl(LEAD_SHA, "medium"),
      sample_label: null,
      sample_number: 0,
      sample_text_hash: null,
      small_url: portraitUrl(LEAD_SHA, "small"),
      status: "published",
      vision_id: "anima-v1-21006",
      width: 768,
    },
    portrait_candidates: candidates,
    published_at: includeNewCandidate ? "2026-11-19T01:15:00.000Z" : "2026-11-19T01:00:00.000Z",
    resolved_from: "published_card_catalog_bulk",
    schema_version: "v3",
    stable_object_version: 3,
    symbol: "TP53",
    vote_version: includeNewCandidate ? 2 : 1,
  }
}

function catalogFixture() {
  return {
    schema: 3,
    generated_at: "2026-11-19T01:00:00.000Z",
    watermark_event_id: 100,
    genes: [
      [
        "TP53",
        "tumor protein p53",
        LEAD_SHA,
        "#3b5b76",
        5,
        2.1,
        43.6,
        48,
        1979,
        "2026-11-19 01:00:00",
      ],
    ],
  }
}

function svgImageBody() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="512" viewBox="0 0 384 512"><rect width="384" height="512" fill="#d9cfc2"/></svg>'
}

test("new requested candidates appear immediately on gene page despite stale CDN (B-1265)", async (t) => {
  const { server, origin } = await startSite()
  t.after(() => server.close())
  const browser = await launchChrome(t)
  if (!browser) return
  t.after(() => browser.close())

  async function setupScenarioContext({ initialNotifPhase }) {
    let notifPhase = initialNotifPhase
    const timeline = []
    let cdnGeneFetches = 0
    let originGeneFetches = 0
    let markReadFetches = 0

    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    t.after(() => context.close())

    await context.route("https://img.brinedew.bio/**", async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === "/genes/v3/TP53.json") {
        cdnGeneFetches += 1
        timeline.push("cdn:TP53")
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tp53GeneObject({ includeNewCandidate: false })),
        })
      }
      if (url.pathname === "/catalog/v3/index.json") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(catalogFixture()),
        })
      }
      if (url.pathname === "/catalog/v3/shared-discoveries.json") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ schema: 1, symbols: ["TP53"] }),
        })
      }
      if (url.pathname.startsWith("/comments/v1/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ comments: [] }),
        })
      }
      if (url.pathname.startsWith("/portraits/")) {
        return route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: svgImageBody(),
        })
      }
      return route.fulfill({ status: 404, body: "" })
    })

    await routeProduction(context, origin, async (pathname) => {
      if (pathname === "/api/public/v1/stable-genes/TP53.json") {
        originGeneFetches += 1
        timeline.push("origin:TP53")
        return tp53GeneObject({ includeNewCandidate: true })
      }
      if (pathname === "/api/iconoplasm/caretaker/me") {
        return { ok: true, caretaker: null }
      }
      if (pathname === "/api/iconoplasm/genes/TP53/comments") {
        return { ok: true, comments: [] }
      }
      if (pathname === "/api/iconoplasm/notifications") {
        if (notifPhase === "ready") {
          return {
            ok: true,
            authenticated: true,
            unread_count: 1,
            ready_count: 1,
            open_count: 0,
            ready_requests: [
              {
                notification_id: 701,
                request_id: 7010,
                request_kind: "new_candidate",
                gene_symbol: "TP53",
                requested_emulsion_label: "B4-20002",
                fulfilled_asset_sha256: NEW_CAND_SHA,
                fulfilled_vision_id: "anima-v1-21006",
                fulfillment_publication_id: "order-701",
                fulfillment_group_size: 1,
                candidate_image_id: 103,
                unread: true,
                gene_url: "/gene/TP53",
                image_url: portraitUrl(NEW_CAND_SHA, "medium"),
                discord_status: "sent",
              },
            ],
            open_requests: [],
          }
        }
        if (notifPhase === "waiting") {
          return {
            ok: true,
            authenticated: true,
            unread_count: 0,
            ready_count: 0,
            open_count: 1,
            ready_requests: [],
            open_requests: [
              {
                request_id: 7010,
                request_kind: "new_candidate",
                gene_symbol: "TP53",
                requested_emulsion_label: "B4-20002",
                created_at: new Date().toISOString(),
                gene_url: "/gene/TP53",
              },
            ],
          }
        }
        return {
          ok: true,
          authenticated: true,
          unread_count: 0,
          ready_count: 0,
          open_count: 0,
          ready_requests: [],
          open_requests: [],
        }
      }
      if (pathname === "/api/iconoplasm/notifications/read") {
        markReadFetches += 1
        timeline.push("markRead")
        notifPhase = "read"
        return { ok: true }
      }
      return undefined
    })

    return {
      context,
      setPhase: (next) => {
        notifPhase = next
      },
      counts: () => ({
        cdnGeneFetches,
        originGeneFetches,
        markReadFetches,
        timeline: [...timeline],
      }),
    }
  }

  // Journeys 1 & 2: Live arrival on open gene page (draft preserved) + toast click + F5 reload
  {
    const scenario = await setupScenarioContext({ initialNotifPhase: "waiting" })
    const page = await scenario.context.newPage()
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector(`article[data-icono-candidate-asset="${EXISTING_CAND_SHA}"]`, {
      timeout: 30_000,
    })
    assert.equal(
      await page.locator(`article[data-icono-candidate-asset="${NEW_CAND_SHA}"]`).count(),
      0,
      "CDN fixture should start without the newly generated candidate",
    )

    // Type a comment draft to confirm live reconciliation does not blow away user input
    const commentBox = page.locator("[data-icono-suggest-input]")
    await commentBox.fill("Keep this unsent draft intact")

    await page.waitForTimeout(2100)
    scenario.setPhase("ready")
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))

    // Candidate appears in-place without reload, and draft survives
    await page.waitForSelector(`article[data-icono-candidate-asset="${NEW_CAND_SHA}"]`, {
      timeout: 15_000,
    })
    assert.equal(await commentBox.inputValue(), "Keep this unsent draft intact")

    // Floating notice appeared; clicking it re-renders from origin and marks read
    const readyNotice = page.locator("#icono-request-ready-notice")
    await readyNotice.waitFor({ state: "visible", timeout: 10_000 })
    await readyNotice.click()
    await page.waitForSelector(`article[data-icono-candidate-asset="${NEW_CAND_SHA}"]`, {
      timeout: 15_000,
    })
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[data-icono-request-receipt][data-icono-request-gene-symbol="TP53"]',
        ),
      null,
      { timeout: 10_000 },
    )
    assert.ok(scenario.counts().markReadFetches >= 1)

    // Journey 2: F5 reload while CDN is still stale must skip CDN prefetch and read origin directly
    const cdnBeforeReload = scenario.counts().cdnGeneFetches
    const originBeforeReload = scenario.counts().originGeneFetches
    await page.reload()
    await page.waitForSelector(`article[data-icono-candidate-asset="${NEW_CAND_SHA}"]`, {
      timeout: 30_000,
    })
    assert.equal(
      scenario.counts().cdnGeneFetches,
      cdnBeforeReload,
      "F5 reload must skip CDN prefetch when origin-fresh marker is active",
    )
    assert.ok(
      scenario.counts().originGeneFetches > originBeforeReload,
      "F5 reload must read canonical origin directly",
    )
  }

  // Journey 3: Visit TP53 (caches stale payload in RAM), go home, fulfill, click sidebar Ready receipt
  {
    const scenario = await setupScenarioContext({ initialNotifPhase: "waiting" })
    const page = await scenario.context.newPage()
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector(`article[data-icono-candidate-asset="${EXISTING_CAND_SHA}"]`, {
      timeout: 30_000,
    })

    // Navigate back to `/` via SPA link so portraitDetailCache["TP53"] stays warm with stale bytes
    await page.locator('.icono-nav a[href="/"][data-icono-nav]').first().click()
    await page.waitForFunction(
      () => window.location.pathname === "/" && !document.getElementById("icono-gene-content"),
      null,
      { timeout: 20_000 },
    )

    await page.waitForTimeout(2100)
    scenario.setPhase("ready")
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))

    const receiptLink = page.locator(
      '[data-icono-request-receipt][data-icono-request-gene-symbol="TP53"]',
    )
    await receiptLink.waitFor({ state: "visible", timeout: 15_000 })
    const originBeforeClick = scenario.counts().originGeneFetches
    await receiptLink.click()

    await page.waitForSelector(`article[data-icono-candidate-asset="${NEW_CAND_SHA}"]`, {
      timeout: 15_000,
    })
    assert.ok(
      scenario.counts().originGeneFetches > originBeforeClick,
      "Clicking sidebar Ready receipt must bypass RAM cache and read origin",
    )
    assert.ok(scenario.counts().markReadFetches >= 1)
  }

  // Journey 4: Fresh browser context (Discord DM link, empty storage) with stale CDN
  {
    const scenario = await setupScenarioContext({ initialNotifPhase: "ready" })
    const page = await scenario.context.newPage()
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector(`article[data-icono-candidate-asset="${NEW_CAND_SHA}"]`, {
      timeout: 30_000,
    })
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[data-icono-request-receipt][data-icono-request-gene-symbol="TP53"]',
        ),
      null,
      { timeout: 10_000 },
    )
    const { originGeneFetches, markReadFetches, timeline } = scenario.counts()
    assert.ok(
      originGeneFetches >= 1,
      "Discord DM link context must fetch origin when CDN misses new SHA",
    )
    assert.ok(markReadFetches >= 1, "Receipt should be marked read once new candidate rendered")
    const originIdx = timeline.indexOf("origin:TP53")
    const markReadIdx = timeline.indexOf("markRead")
    assert.ok(
      originIdx >= 0 && markReadIdx > originIdx,
      `markRead must happen after origin render, timeline=${JSON.stringify(timeline)}`,
    )
  }
})
