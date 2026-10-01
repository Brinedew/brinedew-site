#!/usr/bin/env node
// B-898 stage 1: the one test that decides whether the extension's hover card
// stopped costing metered Worker requests.
//
// It loads the unpacked extension into a real Chromium, opens an article that
// mentions TP53 and BRCA1, hovers TP53, and asserts:
//   (a) at least one request to https://iconoplasmportraits.b-cdn.net/genes/v3/TP53.json
//   (b) zero requests to the retired /api/public/v1/card-snapshots/ and /card-content/ routes
//   (c) the tooltip shows TP53's full name as published in that stable object
//
// Network evidence comes from two independent instruments: Playwright's
// context-level request events (which include the extension service worker's
// requests when PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1) and a fetch
// wrapper installed inside the service worker itself.
//
// Output: artifacts/b-898-extension-e2e/<timestamp>.json, exit 1 on failure.

import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1"
const { chromium } = await import("playwright")

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const extensionPath = path.resolve(repoRoot, "iconoplasm-extension")
const artifactDir = path.resolve(repoRoot, "artifacts", "b-898-extension-e2e")
const STABLE_TP53 = "https://iconoplasmportraits.b-cdn.net/genes/v3/TP53.json"
const RETIRED =
  /https:\/\/iconoplasm\.brinedew\.bio\/api\/public\/v1\/(card-snapshots\/|card-content\/)/
const ARTICLE_ORIGIN = "https://b898-e2e.iconoplasm.test"
const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>B-898 extension E2E</title></head>
<body style="font: 18px/1.6 Georgia, serif; padding: 48px; max-width: 640px">
<h1>Tumour suppressors</h1>
<p id="sentence">TP53 and BRCA1 are tumour suppressors.</p>
<p>Loss of either gene is common in human cancers.</p>
</body></html>`

const result = {
  issue: "B-898",
  startedAt: new Date().toISOString(),
  extensionPath,
  launch: null,
  expectedFullName: null,
  tooltipFullName: null,
  stableObjectRequests: { contextEvents: [], serviceWorkerFetches: [] },
  retiredRouteRequests: { contextEvents: [], serviceWorkerFetches: [] },
  allRequestHosts: {},
  checks: {},
  passed: false,
  error: null,
}

function recordUrl(bucket, url) {
  if (url.startsWith("https://iconoplasmportraits.b-cdn.net/genes/v3/")) {
    result.stableObjectRequests[bucket].push(url)
  }
  if (RETIRED.test(url)) result.retiredRouteRequests[bucket].push(url)
  try {
    const host = new URL(url).host
    result.allRequestHosts[host] = (result.allRequestHosts[host] || 0) + 1
  } catch {
    // data:, blob: and chrome-extension: URLs are not interesting here.
  }
}

async function launch(userDataDir) {
  const args = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]
  // Playwright's own full Chromium (not the headless shell, which cannot load
  // extensions) if one is installed, then the system Chrome, then headed.
  const localChromium = ["chromium-1228", "chromium-1208", "chromium-1194"]
    .flatMap((dir) =>
      ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"].map((exe) => path.join(dir, exe)),
    )
    .map((rel) => path.join(process.env.LOCALAPPDATA || "", "ms-playwright", rel))
    .find((candidate) => existsSync(candidate))
  const attempts = [
    ...(localChromium
      ? [
          {
            label: `playwright chromium headless=new (${localChromium})`,
            options: { executablePath: localChromium, headless: true, args },
          },
        ]
      : []),
    { label: "channel=chrome headless=new", options: { channel: "chrome", headless: true, args } },
    { label: "channel=chrome headed", options: { channel: "chrome", headless: false, args } },
    { label: "default chromium headed", options: { headless: false, args } },
  ]
  const failures = []
  for (const attempt of attempts) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...attempt.options,
        viewport: { width: 1280, height: 900 },
      })
      let worker = context.serviceWorkers()[0]
      if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30000 })
      result.launch = { mode: attempt.label, failures, serviceWorkerUrl: worker.url() }
      return { context, worker }
    } catch (error) {
      failures.push({ mode: attempt.label, error: String(error?.message || error).split("\n")[0] })
    }
  }
  throw new Error(`Could not launch Chromium with the extension: ${JSON.stringify(failures)}`)
}

async function expectedFullName() {
  const response = await fetch(STABLE_TP53, { headers: { "Cache-Control": "no-cache" } })
  if (!response.ok)
    throw new Error(`Node fetch of TP53 stable object failed: HTTP ${response.status}`)
  const value = await response.json()
  if (value?.stable_object_version !== 3 || value?.symbol !== "TP53") {
    throw new Error("Live TP53 stable object does not look like a version 3 object")
  }
  return String(value.full_name || "").trim()
}

async function main() {
  await mkdir(artifactDir, { recursive: true })
  const userDataDir = await mkdtemp(path.join(tmpdir(), "iconoplasm-b898-e2e-"))
  let context
  try {
    result.expectedFullName = await expectedFullName()
    const launched = await launch(userDataDir)
    context = launched.context
    const { worker } = launched
    context.on("request", (request) => recordUrl("contextEvents", request.url()))

    // Second instrument: wrap fetch inside the service worker.
    await worker.evaluate(() => {
      if (globalThis.__b898FetchLog) return
      globalThis.__b898FetchLog = []
      const original = globalThis.fetch
      globalThis.fetch = (...fetchArgs) => {
        globalThis.__b898FetchLog.push(String(fetchArgs[0]?.url || fetchArgs[0]))
        return original(...fetchArgs)
      }
    })
    const extensionId = new URL(worker.url()).host

    // Use the simple (native DOM) card so the full name is readable from the page.
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.evaluate(() => chrome.storage.local.set({ iconoplasm_card_variant: "simple" }))
    // Wait for the scanner index (recognition) to be installed from the live manifest.
    await popup.waitForFunction(
      async () => {
        const stored = await chrome.storage.local.get(["iconoplasm_gene_count"])
        return Number(stored.iconoplasm_gene_count || 0) > 0
      },
      null,
      { timeout: 90000, polling: 500 },
    )
    await popup.close()

    await context.route(`${ARTICLE_ORIGIN}/**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: ARTICLE_HTML }),
    )
    const page = await context.newPage()
    await page.goto(`${ARTICLE_ORIGIN}/article`, { waitUntil: "load" })
    // Recognition paints range highlights (no anchor elements) and the content
    // script hit-tests document mousemove against the painted ranges. Hover by
    // moving the pointer onto the client rect of the "TP53" text and retry until
    // the cooperative scan has painted it.
    const tp53Rect = await page.evaluate(() => {
      const text = document.getElementById("sentence").firstChild
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 4)
      const box = range.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    const name = page.locator(
      ".iconoplasm-tooltip.iconoplasm-tooltip-visible .iconoplasm-tooltip-name",
    )
    const hoverDeadline = Date.now() + 60000
    for (;;) {
      await page.mouse.move(tp53Rect.x - 40, tp53Rect.y + 60)
      await page.mouse.move(tp53Rect.x, tp53Rect.y, { steps: 4 })
      if (await name.isVisible().catch(() => false)) break
      if (Date.now() > hoverDeadline) throw new Error("TP53 hover card never appeared")
      await page.waitForTimeout(1000)
    }
    const expected = result.expectedFullName
    await page
      .waitForFunction(
        (wanted) =>
          document
            .querySelector(
              ".iconoplasm-tooltip.iconoplasm-tooltip-visible .iconoplasm-tooltip-name",
            )
            ?.textContent?.trim() === wanted,
        expected,
        { timeout: 20000 },
      )
      .catch(() => null)
    result.tooltipFullName = (await name.textContent())?.trim() || null
    // Let any straggling requests land before reading the instruments.
    await page.waitForTimeout(1500)
    for (const url of await worker.evaluate(() => globalThis.__b898FetchLog || [])) {
      recordUrl("serviceWorkerFetches", url)
    }
    await page.screenshot({ path: path.join(artifactDir, "last-hover.png") }).catch(() => null)

    const stableSeen =
      result.stableObjectRequests.contextEvents.filter((url) => url === STABLE_TP53).length +
      result.stableObjectRequests.serviceWorkerFetches.filter((url) => url === STABLE_TP53).length
    const retiredSeen =
      result.retiredRouteRequests.contextEvents.length +
      result.retiredRouteRequests.serviceWorkerFetches.length
    result.checks = {
      a_stable_object_fetched: stableSeen >= 1,
      b_no_retired_route_requests: retiredSeen === 0,
      c_tooltip_shows_full_name:
        Boolean(result.tooltipFullName) && result.tooltipFullName === result.expectedFullName,
    }
    result.passed = Object.values(result.checks).every(Boolean)
  } catch (error) {
    result.error = String(error?.stack || error)
  } finally {
    await context?.close().catch(() => null)
    await rm(userDataDir, { recursive: true, force: true }).catch(() => null)
  }
  result.finishedAt = new Date().toISOString()
  const stamp = result.startedAt.replace(/[:.]/g, "-")
  const artifactPath = path.join(artifactDir, `${stamp}.json`)
  await writeFile(artifactPath, JSON.stringify(result, null, 2) + "\n", "utf8")
  console.log(
    JSON.stringify(
      {
        artifact: artifactPath,
        passed: result.passed,
        checks: result.checks,
        launch: result.launch?.mode,
        tooltipFullName: result.tooltipFullName,
        expectedFullName: result.expectedFullName,
        error: result.error ? result.error.split("\n")[0] : null,
      },
      null,
      2,
    ),
  )
  process.exit(result.passed ? 0 : 1)
}

await main()
