/**
 * Deterministic Playwright operator for Brinedew Wiki Promotion Court (Google AI Studio).
 *
 * Runs BOTH Advocate and Alex (Devil's Advocate) in parallel inside two isolated
 * `https://aistudio.google.com/prompts/new_chat` tabs using the system Chrome
 * binary with a persistent user profile (sign in once interactively; subsequent
 * runs reuse the authenticated session automatically).
 *
 * Usage:
 *   node run_aistudio_court.mjs --slug <slug> [--out <dir>] [--model "Gemini 4 Neon"]
 *                               [--thinking "Extra High"] [--fallback-thinking "High"]
 *                               [--profile <dir>] [--only advocate|alex] [--login-only]
 *
 * Key design choices:
 * - Launches system Chrome (`channel: "chrome"`, `chromiumSandbox: true`) to
 *   comply with the local Playwright browser fence (`Set-PlaywrightBrowserFence.ps1`).
 * - Enables ALL three required tools on every fresh chat:
 *     1. Code execution
 *     2. Grounding with Google Search
 *     3. URL context ("Browse the url context")
 * - Runs Advocate and Alex concurrently in separate tabs (`Promise.all`).
 * - Tolerates transient "Model isn't available right now" mid-stream banners as
 *   long as the Stop button remains active or output length is still growing.
 * - If a conversation hits a hard error or stalls past the Extra High thinking
 *   window (~11 min), retries ONLY that conversation in a fresh tab downgraded
 *   from `Extra High` -> `High`.
 * - Extracts verbatim Markdown cleanly via hover over the model response body ->
 *   triple-dots ("Open options") -> "Copy as markdown", capturing the payload
 *   directly via a per-page `navigator.clipboard.writeText` hook (serialized with
 *   a mutex fallback to `clipboard.readText`)—zero textbox pasting, zero modal
 *   hacks, zero chunk-scraping.
 */

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const AI_STUDIO_NEW_CHAT_URL = "https://aistudio.google.com/prompts/new_chat"

function parseArgs(argv) {
  const opts = {
    model: "Gemini 4 Neon",
    thinking: "Extra High",
    fallbackThinking: "High",
    only: null,
    loginOnly: false,
    timeoutMin: 18,
    stallMin: 5,
    extraHighRiskMin: 11,
  }
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    const val = argv[i + 1]
    if (key === "--slug" && val) {
      opts.slug = val
      i += 1
    } else if (key === "--out" && val) {
      opts.outDir = path.resolve(val)
      i += 1
    } else if (key === "--profile" && val) {
      opts.profileDir = path.resolve(val)
      i += 1
    } else if (key === "--model" && val) {
      opts.model = val
      i += 1
    } else if (key === "--thinking" && val) {
      opts.thinking = val
      i += 1
    } else if (key === "--fallback-thinking" && val) {
      opts.fallbackThinking = val
      i += 1
    } else if (key === "--only" && val) {
      opts.only = val.toLowerCase()
      i += 1
    } else if (key === "--login-only") {
      opts.loginOnly = true
    } else if (key === "--timeout-min" && val) {
      opts.timeoutMin = Number(val)
      i += 1
    }
  }
  const websiteRoot = process.cwd()
  if (!opts.profileDir) {
    opts.profileDir = path.resolve(websiteRoot, ".quartz-cache", "aistudio-chrome-profile")
  }
  if (!opts.loginOnly) {
    if (!opts.slug && !opts.outDir) {
      throw new Error(
        "Usage: node run_aistudio_court.mjs --slug <slug> [--out <dir>] [--only advocate|alex] [--login-only]",
      )
    }
    if (!opts.outDir) {
      opts.outDir = path.resolve(websiteRoot, ".quartz-cache", "wiki-court", opts.slug)
    }
  }
  return opts
}

function log(role, msg) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] [${role}] ${msg}`)
}

class AsyncMutex {
  constructor() {
    this._tail = Promise.resolve()
  }
  async run(fn) {
    let release
    const next = new Promise((resolve) => {
      release = resolve
    })
    const prev = this._tail
    this._tail = prev.then(() => next)
    await prev
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

async function installClipboardHook(page) {
  await page.addInitScript(() => {
    window.__aistudioCapturedMarkdown = null
    window.__aistudioCaptureTimestamp = 0

    const record = (text) => {
      if (typeof text === "string" && text.length > 0) {
        window.__aistudioCapturedMarkdown = text
        window.__aistudioCaptureTimestamp = Date.now()
      }
    }

    try {
      const clip = navigator.clipboard
      if (clip && typeof clip.writeText === "function") {
        const origWriteText = clip.writeText.bind(clip)
        Object.defineProperty(clip, "writeText", {
          configurable: true,
          writable: true,
          value: async (text) => {
            record(text)
            try {
              return await origWriteText(text)
            } catch {
              return undefined
            }
          },
        })
      }
      if (clip && typeof clip.write === "function") {
        const origWrite = clip.write.bind(clip)
        Object.defineProperty(clip, "write", {
          configurable: true,
          writable: true,
          value: async (items) => {
            try {
              for (const item of items || []) {
                if (item && item.types && item.types.includes("text/plain")) {
                  const blob = await item.getType("text/plain")
                  record(await blob.text())
                }
              }
            } catch {
              // ignore hook inspection error
            }
            try {
              return await origWrite(items)
            } catch {
              return undefined
            }
          },
        })
      }
    } catch {
      // Fallback: copy event listener below
    }

    document.addEventListener(
      "copy",
      (ev) => {
        try {
          const data = ev.clipboardData?.getData("text/plain")
          if (data) record(data)
        } catch {
          // ignore
        }
      },
      true,
    )
  })
}

async function isSignedInPromptReady(page) {
  const url = page.url()
  if (/accounts\.google\.com/i.test(url)) return false
  const promptBox = page
    .locator(
      'textarea[aria-label*="prompt" i], textarea[placeholder*="prompt" i], textarea[placeholder*="Start typing" i], [role="textbox"][aria-label*="prompt" i]',
    )
    .first()
  return await promptBox.isVisible({ timeout: 1500 }).catch(() => false)
}

async function ensureSignedIn(page, waitMinutes = 5) {
  await page.goto(AI_STUDIO_NEW_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 45000 })
  await page.waitForTimeout(2500)
  if (await isSignedInPromptReady(page)) {
    log("auth", `Authenticated at ${page.url()}`)
    return
  }

  log(
    "auth",
    `Not signed into Google AI Studio yet (current URL: ${page.url()}). ` +
      `Please sign into your Google account in the open Chrome window within ${waitMinutes} minutes...`,
  )
  const deadline = Date.now() + waitMinutes * 60_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000)
    if (await isSignedInPromptReady(page)) {
      log("auth", "Sign-in detected! Prompt composer is ready.")
      return
    }
    if (
      /aistudio\.google\.com/i.test(page.url()) &&
      !/\/prompts\//i.test(page.url()) &&
      !/accounts\.google\.com/i.test(page.url())
    ) {
      await page.goto(AI_STUDIO_NEW_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 45000 })
    }
  }
  throw new Error(
    `Timed out waiting for Google AI Studio sign-in. Current URL: ${page.url()}. ` +
      "Run with --login-only to sign into the persistent profile interactively.",
  )
}

async function ensureSwitchOn(page, role, regexes, label) {
  for (const re of regexes) {
    const sw = page.getByRole("switch", { name: re }).first()
    if (await sw.isVisible({ timeout: 2000 }).catch(() => false)) {
      const checked =
        (await sw.getAttribute("aria-checked")) === "true" ||
        (await sw.isChecked().catch(() => false))
      if (!checked) {
        await sw.click()
        await page.waitForTimeout(350)
      }
      const after =
        (await sw.getAttribute("aria-checked")) === "true" ||
        (await sw.isChecked().catch(() => false))
      if (!after) {
        throw new Error(`[${role}] Failed to toggle switch '${label}' ON`)
      }
      log(role, `Switch '${label}' = ON`)
      return
    }
  }
  throw new Error(`[${role}] Could not find Run Settings switch for '${label}'`)
}

async function ensureToolsExpanded(page) {
  const codeSwitch = page.getByRole("switch", { name: /Code execution/i }).first()
  if (await codeSwitch.isVisible({ timeout: 1000 }).catch(() => false)) return

  const expandBtn = page.getByRole("button", { name: /Expand or collapse tools/i }).first()
  if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expandBtn.click()
    await page.waitForTimeout(400)
  }
}

async function configureRunSettings(page, role, { model, thinking }) {
  // 1. Verify or select Model
  const modelControl = page
    .locator(
      'ms-model-selector button, [aria-label*="model" i][role="button"], button:has-text("Gemini")',
    )
    .first()
  if (await modelControl.isVisible({ timeout: 3000 }).catch(() => false)) {
    const currentText = (await modelControl.innerText().catch(() => "")).trim()
    if (!currentText.toLowerCase().includes(model.toLowerCase())) {
      log(role, `Switching model from '${currentText}' to '${model}'...`)
      await modelControl.click()
      await page.waitForTimeout(600)
      const option = page
        .getByText(new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
        .first()
      await option.waitFor({ state: "visible", timeout: 5000 })
      await option.click()
      await page.waitForTimeout(600)
    } else {
      log(role, `Model already set: ${currentText.split("\n")[0]}`)
    }
  } else {
    log(role, `Warning: model selector not directly visible; continuing with default model.`)
  }

  // 2. Select Thinking Level
  const thinkingCombo = page.getByRole("combobox", { name: /Thinking Level/i }).first()
  await thinkingCombo.waitFor({ state: "visible", timeout: 10000 })
  const currentThinking = (await thinkingCombo.innerText().catch(() => "")).trim()
  if (currentThinking.toLowerCase() !== thinking.toLowerCase()) {
    await thinkingCombo.click()
    await page.waitForTimeout(400)
    const targetOption = page
      .getByRole("option", {
        name: new RegExp(`^${thinking.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      })
      .first()
    await targetOption.waitFor({ state: "visible", timeout: 5000 })
    await targetOption.click()
    await page.waitForTimeout(400)
  }
  const verifiedThinking = (await thinkingCombo.innerText().catch(() => "")).trim()
  log(role, `Thinking Level = ${verifiedThinking}`)

  // 3. Expand Tools panel and turn ON all three tools
  await ensureToolsExpanded(page)
  await ensureSwitchOn(page, role, [/Code execution/i], "Code execution")
  await ensureSwitchOn(
    page,
    role,
    [/Grounding with Google Search/i, /Google Search/i],
    "Grounding with Google Search",
  )
  await ensureSwitchOn(page, role, [/Browse the url context/i, /URL context/i], "URL context")
}

async function submitPrompt(page, role, promptText) {
  const promptBox = page
    .locator(
      'textarea[aria-label*="prompt" i], textarea[placeholder*="prompt" i], textarea[placeholder*="Start typing" i], [role="textbox"][aria-label*="prompt" i]',
    )
    .first()
  await promptBox.waitFor({ state: "visible", timeout: 15000 })
  await promptBox.click()
  await promptBox.fill(promptText)
  await page.waitForTimeout(500)

  const filledLen = await promptBox
    .inputValue()
    .then((v) => v.length)
    .catch(async () => (await promptBox.innerText()).length)
  if (filledLen < Math.floor(promptText.length * 0.95)) {
    throw new Error(
      `[${role}] Prompt fill verification failed: expected ~${promptText.length} chars, got ${filledLen}`,
    )
  }
  log(role, `Filled prompt (${filledLen} chars). Submitting...`)

  const runBtn = page.getByRole("button", { name: /^Run\b/i }).first()
  if (await runBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await runBtn.click()
  } else {
    await page.keyboard.press("Control+Enter")
  }
}

async function readStreamSnapshot(page) {
  return await page.evaluate(() => {
    const stopBtn = [...document.querySelectorAll("button")].find((b) => {
      const label = (b.getAttribute("aria-label") || b.textContent || "").trim()
      const rect = b.getBoundingClientRect()
      return /\bstop\b/i.test(label) && rect.width > 0 && rect.height > 0
    })

    const turns = [...document.querySelectorAll("ms-chat-turn")]
    const modelTurns = turns.filter((t) =>
      Boolean(
        t.querySelector(
          ".chat-turn-container.model, .model-prompt-container, [data-turn-role='Model']",
        ),
      ),
    )
    const lastModel = modelTurns.length > 0 ? modelTurns[modelTurns.length - 1] : null
    const textChunks = lastModel ? [...lastModel.querySelectorAll("ms-text-chunk")] : []
    const textLen = textChunks.reduce((sum, el) => sum + (el.innerText || "").length, 0)
    const fullTurnLen = lastModel ? (lastModel.innerText || "").length : 0

    // Look for genuine fatal error messages vs. transient mid-stream banners
    const bodyText = document.body?.innerText || ""
    const hasUnavailableBanner = /model isn['’]t available right now/i.test(bodyText)
    const hasRateOrQuotaError =
      /(?:quota exceeded|resource exhausted|internal error occurred|an internal error|failed to generate)/i.test(
        bodyText,
      )
    const hasThoughtSpinner = Boolean(
      lastModel?.querySelector("mat-progress-spinner, .thinking-progress, .loading-indicator"),
    )

    return {
      isRunning: Boolean(stopBtn) || hasThoughtSpinner,
      stopVisible: Boolean(stopBtn),
      modelTurnCount: modelTurns.length,
      textLen,
      fullTurnLen,
      hasUnavailableBanner,
      hasRateOrQuotaError,
      url: location.href,
    }
  })
}

async function waitForGeneration(page, role, { thinking, timeoutMin, stallMin, extraHighRiskMin }) {
  const startMs = Date.now()
  const maxMs = timeoutMin * 60_000
  const stallMs = stallMin * 60_000
  const extraHighRiskMs = extraHighRiskMin * 60_000

  let sawRunning = false
  let lastProgressMs = startMs
  let lastTextLen = 0
  let lastFullLen = 0
  let stableIdlePolls = 0
  let loggedBanner = false

  // Give AI Studio a moment to start the turn
  await page.waitForTimeout(3000)

  while (Date.now() - startMs < maxMs) {
    const snap = await readStreamSnapshot(page)
    const elapsedSec = Math.round((Date.now() - startMs) / 1000)

    if (snap.isRunning) sawRunning = true

    if (snap.textLen > lastTextLen || snap.fullTurnLen > lastFullLen) {
      lastTextLen = Math.max(lastTextLen, snap.textLen)
      lastFullLen = Math.max(lastFullLen, snap.fullTurnLen)
      lastProgressMs = Date.now()
      stableIdlePolls = 0
    }

    if (snap.hasUnavailableBanner && !loggedBanner) {
      loggedBanner = true
      log(
        role,
        `Saw transient "Model isn't available right now" banner at ${elapsedSec}s — NOT aborting; continuing to monitor stream (textLen=${snap.textLen}, stopVisible=${snap.stopVisible}).`,
      )
    }

    if (!snap.isRunning && sawRunning) {
      stableIdlePolls += 1
      // Require 3 consecutive idle polls (15s) so brief pauses between search/code/stream never trigger early stop
      if (stableIdlePolls >= 3) {
        if (snap.textLen >= 500) {
          log(
            role,
            `Generation completed cleanly in ${elapsedSec}s (textLen=${snap.textLen}, url=${snap.url}).`,
          )
          return { ok: true, elapsedSec, textLen: snap.textLen, url: snap.url }
        }
        return {
          ok: false,
          reason: `Generation ended with insufficient output (textLen=${snap.textLen}, unavailable=${snap.hasUnavailableBanner}, quotaErr=${snap.hasRateOrQuotaError})`,
          elapsedSec,
          url: snap.url,
        }
      }
    } else if (!snap.isRunning && !sawRunning && elapsedSec > 30 && snap.textLen >= 500) {
      stableIdlePolls += 1
      if (stableIdlePolls >= 3) {
        log(role, `Generation already finished at ${elapsedSec}s (textLen=${snap.textLen}).`)
        return { ok: true, elapsedSec, textLen: snap.textLen, url: snap.url }
      }
    } else {
      stableIdlePolls = 0
    }

    // Watch for >10-11 min Extra High thinking stall (no text output yet and no growth)
    const idleForMs = Date.now() - lastProgressMs
    if (
      thinking.toLowerCase() === "extra high" &&
      Date.now() - startMs > extraHighRiskMs &&
      snap.textLen < 200 &&
      idleForMs > 180_000
    ) {
      return {
        ok: false,
        reason: `Extra High thinking exceeded ${extraHighRiskMin}m without streaming output (stalled ${Math.round(idleForMs / 1000)}s)`,
        elapsedSec,
        url: snap.url,
      }
    }

    if (idleForMs > stallMs && snap.textLen < 500 && !snap.stopVisible) {
      return {
        ok: false,
        reason: `Stalled for ${Math.round(idleForMs / 1000)}s with no active Stop button (textLen=${snap.textLen})`,
        elapsedSec,
        url: snap.url,
      }
    }

    if (elapsedSec % 30 < 5) {
      log(
        role,
        `Waiting... ${elapsedSec}s elapsed | running=${snap.isRunning} | textLen=${snap.textLen} | fullTurnLen=${snap.fullTurnLen}`,
      )
    }
    await page.waitForTimeout(5000)
  }

  return {
    ok: false,
    reason: `Timed out after ${timeoutMin} minutes (textLen=${lastTextLen})`,
    elapsedSec: Math.round((Date.now() - startMs) / 1000),
    url: page.url(),
  }
}

async function extractMarkdownViaCopyMenu(page, role, copyMutex) {
  return await copyMutex.run(async () => {
    await page.bringToFront()
    await page.waitForTimeout(400)

    await page.evaluate(() => {
      window.__aistudioCapturedMarkdown = null
      window.__aistudioCaptureTimestamp = 0
    })

    // Locate the final model chat turn
    const modelTurns = page.locator(
      "ms-chat-turn:has(.chat-turn-container.model), ms-chat-turn:has(.model-prompt-container)",
    )
    const count = await modelTurns.count()
    const turn = count > 0 ? modelTurns.last() : page.locator("ms-chat-turn").last()

    // Scroll response body into view (not top of page — just hover over response body!)
    const responseBody = turn.locator("ms-text-chunk").last()
    if (await responseBody.count()) {
      await responseBody.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      await responseBody.hover({ position: { x: 80, y: 40 } })
    } else {
      await turn.scrollIntoViewIfNeeded()
      await turn.hover()
    }
    await page.waitForTimeout(450)

    // Click triple-dots ("Open options" / "More options") revealed on hover
    let optionsBtn = turn
      .locator(
        'button[aria-label="Open options"], button[aria-label*="More options" i], button[mattooltip*="More options" i], button:has-text("more_vert")',
      )
      .first()

    if (!(await optionsBtn.isVisible({ timeout: 2500 }).catch(() => false))) {
      // Hover near the turn header / top-right of the visible response body as fallback
      const box = await responseBody.boundingBox().catch(() => null)
      if (box) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + Math.min(80, box.height * 0.2))
        await page.waitForTimeout(400)
      }
      optionsBtn = turn
        .locator(
          'button[aria-label="Open options"], button[aria-label*="More options" i], button[mattooltip*="More options" i]',
        )
        .first()
    }

    await optionsBtn.waitFor({ state: "visible", timeout: 6000 })
    await optionsBtn.click()
    await page.waitForTimeout(400)

    // Click "Copy as markdown" menu item
    const copyMdItem = page
      .locator(
        '[role="menuitem"]:has-text("Copy as markdown"), button:has-text("Copy as markdown"), [role="menuitem"]:has-text("Copy markdown")',
      )
      .first()
    await copyMdItem.waitFor({ state: "visible", timeout: 5000 })
    await copyMdItem.click()
    await page.waitForTimeout(600)

    // Read captured text from our per-page hook first, then OS clipboard as backup
    let markdown = await page.evaluate(() => window.__aistudioCapturedMarkdown || "")
    if (!markdown || markdown.length < 300) {
      markdown = await page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText()
        } catch {
          return ""
        }
      })
    }

    if (!markdown || markdown.length < 300) {
      throw new Error(
        `[${role}] Copy as markdown succeeded visually but captured payload was too short (${markdown?.length || 0} chars).`,
      )
    }
    log(
      role,
      `Extracted verbatim Markdown cleanly via Copy as markdown (${markdown.length} chars).`,
    )
    return markdown.trim() + "\n"
  })
}

async function runSingleCounsel(context, copyMutex, { role, promptPath, outPath, opts }) {
  const promptText = fs.readFileSync(promptPath, "utf8")
  const thinkingPlan = [opts.thinking]
  if (
    opts.fallbackThinking &&
    opts.fallbackThinking.toLowerCase() !== opts.thinking.toLowerCase()
  ) {
    thinkingPlan.push(opts.fallbackThinking)
  }

  let lastErr = null
  for (let attempt = 0; attempt < thinkingPlan.length; attempt += 1) {
    const thinking = thinkingPlan[attempt]
    const page = await context.newPage()
    await installClipboardHook(page)
    try {
      log(
        role,
        `Attempt ${attempt + 1}/${thinkingPlan.length} (thinking=${thinking}): opening fresh chat...`,
      )
      await page.goto(AI_STUDIO_NEW_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 45000 })
      await page.waitForTimeout(2000)

      await configureRunSettings(page, role, { model: opts.model, thinking })
      await submitPrompt(page, role, promptText)

      const gen = await waitForGeneration(page, role, {
        thinking,
        timeoutMin: opts.timeoutMin,
        stallMin: opts.stallMin,
        extraHighRiskMin: opts.extraHighRiskMin,
      })

      if (!gen.ok) {
        lastErr = new Error(gen.reason)
        log(role, `Attempt ${attempt + 1} failed: ${gen.reason}`)
        if (attempt + 1 < thinkingPlan.length) {
          log(
            role,
            `Rescuing ${role} in a fresh chat by downgrading thinking from '${thinking}' -> '${thinkingPlan[attempt + 1]}'...`,
          )
        }
        await page.close().catch(() => {})
        continue
      }

      const markdown = await extractMarkdownViaCopyMenu(page, role, copyMutex)
      fs.writeFileSync(outPath, markdown, "utf8")
      const finalUrl = page.url()
      return {
        role,
        ok: true,
        thinkingUsed: thinking,
        attempt: attempt + 1,
        elapsedSec: gen.elapsedSec,
        chars: markdown.length,
        chatUrl: finalUrl,
        outputFile: outPath,
      }
    } catch (err) {
      lastErr = err
      log(role, `Attempt ${attempt + 1} threw error: ${err.message || err}`)
      await page.close().catch(() => {})
    }
  }
  throw lastErr || new Error(`[${role}] All attempts failed`)
}

async function main() {
  const opts = parseArgs(process.argv)
  fs.mkdirSync(opts.profileDir, { recursive: true })

  const playwrightEntry = path.resolve(
    process.cwd(),
    "node_modules",
    "playwright-core",
    "index.mjs",
  )
  const { chromium } = await import(pathToFileURL(playwrightEntry).href)

  const context = await chromium.launchPersistentContext(opts.profileDir, {
    channel: "chrome",
    chromiumSandbox: true,
    headless: false,
    viewport: { width: 1440, height: 960 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  })

  await context
    .grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://aistudio.google.com",
    })
    .catch(() => {})

  try {
    const authPage = context.pages()[0] || (await context.newPage())
    await ensureSignedIn(authPage, 5)

    if (opts.loginOnly) {
      log("auth", `Login verified and saved in persistent profile: ${opts.profileDir}`)
      return
    }

    const jobs = []
    if (!opts.only || opts.only === "advocate") {
      jobs.push({
        role: "advocate",
        promptPath: path.join(opts.outDir, "advocate_prompt_ready.md"),
        outPath: path.join(opts.outDir, "advocate_brief.md"),
        opts,
      })
    }
    if (!opts.only || opts.only === "alex") {
      jobs.push({
        role: "alex",
        promptPath: path.join(opts.outDir, "alex_prompt_ready.md"),
        outPath: path.join(opts.outDir, "alex_review.md"),
        opts,
      })
    }

    for (const job of jobs) {
      if (!fs.existsSync(job.promptPath)) {
        throw new Error(
          `Prepared prompt file missing: ${job.promptPath}. Run run_court.py mode="prepare" first.`,
        )
      }
    }

    // Close the auth-check bootstrap tab once parallel counsel tabs launch
    const copyMutex = new AsyncMutex()
    log(
      "court",
      `Launching ${jobs.length} isolated AI Studio counsel tab(s) IN PARALLEL (model="${opts.model}", thinking="${opts.thinking}", fallback="${opts.fallbackThinking}", tools=[Code execution, Google Search, URL context])...`,
    )

    const results = await Promise.all(jobs.map((job) => runSingleCounsel(context, copyMutex, job)))

    await authPage.close().catch(() => {})

    const metaPath = path.join(opts.outDir, "aistudio_run_meta.json")
    const summary = {
      status: "ok",
      timestamp: new Date().toISOString(),
      model: opts.model,
      requestedThinking: opts.thinking,
      fallbackThinking: opts.fallbackThinking,
      tools: ["Code execution", "Grounding with Google Search", "URL context"],
      runs: results,
    }
    fs.writeFileSync(metaPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await context.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
