;async (page) => {
  const CFG = __WIKI_COURT_CONFIG__
  const AI_STUDIO_NEW_CHAT_URL = "https://aistudio.google.com/prompts/new_chat"
  const context = page.context()

  const ts = () => new Date().toISOString().slice(11, 19)

  if (!context.__wikiCourtJobs) {
    context.__wikiCourtJobs = new Map()
  }

  async function installClipboardHook(tab) {
    await tab.addInitScript(() => {
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
                // ignore
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
        // fallback to copy listener
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

  async function ensureToolsExpanded(tab) {
    const codeSwitch = tab.getByRole("switch", { name: /Code execution/i }).first()
    if (await codeSwitch.isVisible({ timeout: 1000 }).catch(() => false)) return
    const expandBtn = tab.getByRole("button", { name: /Expand or collapse tools/i }).first()
    if (await expandBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await expandBtn.click()
      await tab.waitForTimeout(400)
    }
  }

  async function ensureSwitchOn(tab, role, regexes, label) {
    for (const re of regexes) {
      const sw = tab.getByRole("switch", { name: re }).first()
      if (await sw.isVisible({ timeout: 2500 }).catch(() => false)) {
        const checked =
          (await sw.getAttribute("aria-checked")) === "true" ||
          (await sw.isChecked().catch(() => false))
        if (!checked) {
          await sw.click()
          await tab.waitForTimeout(350)
        }
        const after =
          (await sw.getAttribute("aria-checked")) === "true" ||
          (await sw.isChecked().catch(() => false))
        if (!after) {
          throw new Error(`[${role}] Failed to toggle switch '${label}' ON`)
        }
        return true
      }
    }
    throw new Error(`[${role}] Could not find Run Settings switch for '${label}'`)
  }

  async function configureAndSubmit(tab, role, promptText, { model, thinking }) {
    await tab.goto(AI_STUDIO_NEW_CHAT_URL, { waitUntil: "domcontentloaded", timeout: 45000 })
    await tab.waitForTimeout(2000)

    if (/accounts\.google\.com/i.test(tab.url())) {
      throw new Error(
        `NOT_SIGNED_IN: Playwright MCP browser is not signed into Google AI Studio (${tab.url()}).`,
      )
    }

    const promptBox = tab
      .locator(
        'textarea[aria-label*="prompt" i], textarea[placeholder*="prompt" i], textarea[placeholder*="Start typing" i], [role="textbox"][aria-label*="prompt" i]',
      )
      .first()
    await promptBox.waitFor({ state: "visible", timeout: 25000 })

    // 1. Model verification / selection
    let selectedModel = model
    const modelControl = tab
      .locator(
        'ms-model-selector button, [aria-label*="model" i][role="button"], button:has-text("Gemini")',
      )
      .first()
    if (await modelControl.isVisible({ timeout: 2500 }).catch(() => false)) {
      const currentText = (await modelControl.innerText().catch(() => "")).trim()
      selectedModel = currentText.split("\n")[0] || model
      if (!currentText.toLowerCase().includes(model.toLowerCase())) {
        await modelControl.click()
        await tab.waitForTimeout(500)
        const option = tab
          .getByText(new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
          .first()
        await option.waitFor({ state: "visible", timeout: 5000 })
        await option.click()
        await tab.waitForTimeout(500)
        selectedModel = model
      }
    }

    // 2. Thinking Level selection
    const thinkingCombo = tab.getByRole("combobox", { name: /Thinking Level/i }).first()
    await thinkingCombo.waitFor({ state: "visible", timeout: 10000 })
    const currentThinking = (await thinkingCombo.innerText().catch(() => "")).trim()
    if (currentThinking.toLowerCase() !== thinking.toLowerCase()) {
      await thinkingCombo.click()
      await tab.waitForTimeout(350)
      const targetOption = tab
        .getByRole("option", {
          name: new RegExp(`^${thinking.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        })
        .first()
      await targetOption.waitFor({ state: "visible", timeout: 5000 })
      await targetOption.click()
      await tab.waitForTimeout(350)
    }
    const verifiedThinking = (await thinkingCombo.innerText().catch(() => "")).trim()

    // 3. Tools: Code execution, Grounding with Google Search, AND URL context
    await ensureToolsExpanded(tab)
    await ensureSwitchOn(tab, role, [/Code execution/i], "Code execution")
    await ensureSwitchOn(
      tab,
      role,
      [/Grounding with Google Search/i, /Google Search/i],
      "Grounding with Google Search",
    )
    await ensureSwitchOn(tab, role, [/Browse the url context/i, /URL context/i], "URL context")

    // 4. Fill full untruncated prompt and submit
    await promptBox.click()
    await promptBox.fill(promptText)
    await tab.waitForTimeout(400)

    const filledLen = await promptBox
      .inputValue()
      .then((v) => v.length)
      .catch(async () => (await promptBox.innerText()).length)
    if (filledLen < Math.floor(promptText.length * 0.95)) {
      throw new Error(
        `[${role}] Prompt fill verification failed: expected ~${promptText.length}, got ${filledLen}`,
      )
    }

    const runBtn = tab.getByRole("button", { name: /^Run\b/i }).first()
    if (await runBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await runBtn.click()
    } else {
      await tab.keyboard.press("Control+Enter")
    }

    return {
      model: selectedModel,
      thinking: verifiedThinking,
      tools: ["Code execution", "Grounding with Google Search", "URL context"],
      promptChars: filledLen,
    }
  }

  async function launchRoleTab(st, thinking) {
    const tab = await context.newPage()
    await installClipboardHook(tab)
    const meta = await configureAndSubmit(tab, st.role, st.promptText, {
      model: st.model,
      thinking,
    })
    st.page = tab
    st.thinking = thinking
    st.attempt += 1
    st.startMs = Date.now()
    st.lastProgressMs = Date.now()
    st.lastTextLen = 0
    st.lastFullLen = 0
    st.sawRunning = false
    st.stableIdlePolls = 0
    st.status = "running"
    st.meta = meta
    st._notedUnavailable = false
    st.notes.push(
      `[${ts()}] Launched attempt ${st.attempt} (${meta.model}, thinking=${meta.thinking}, tools=${meta.tools.join("+")})`,
    )
  }

  async function readStreamSnapshot(tab) {
    return await tab.evaluate(() => {
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

      const bodyText = document.body?.innerText || ""
      const hasUnavailableBanner = /model isn['’]t available right now/i.test(bodyText)
      const hasFatalError =
        /(?:quota exceeded|resource exhausted|an internal error|failed to generate)/i.test(bodyText)
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
        hasFatalError,
        url: location.href,
      }
    })
  }

  async function extractMarkdownViaCopyMenu(tab, role) {
    await tab.bringToFront()
    await tab.keyboard.press("Escape").catch(() => {})
    await tab.waitForTimeout(400)

    await tab.evaluate(() => {
      window.__aistudioCapturedMarkdown = null
      window.__aistudioCaptureTimestamp = 0
    })

    const modelTurns = tab.locator(
      "ms-chat-turn:has(.chat-turn-container.model), ms-chat-turn:has(.model-prompt-container)",
    )
    const count = await modelTurns.count()
    const turn = count > 0 ? modelTurns.last() : tab.locator("ms-chat-turn").last()

    // Hover directly over the response body to reveal the floating triple-dots menu
    const responseBody = turn.locator("ms-text-chunk").last()
    if (await responseBody.count()) {
      await responseBody.scrollIntoViewIfNeeded()
      await tab.waitForTimeout(300)
      await responseBody.hover({ position: { x: 80, y: 40 }, force: true })
    } else {
      await turn.scrollIntoViewIfNeeded()
      await turn.hover()
    }
    await tab.waitForTimeout(450)

    let optionsBtn = turn
      .locator(
        'button[aria-label="Open options"], button[aria-label*="More options" i], button[mattooltip*="More options" i], button:has-text("more_vert")',
      )
      .first()

    if (!(await optionsBtn.isVisible({ timeout: 2500 }).catch(() => false))) {
      const box = await responseBody.boundingBox().catch(() => null)
      if (box) {
        await tab.mouse.move(box.x + box.width * 0.5, box.y + Math.min(80, box.height * 0.2))
        await tab.waitForTimeout(400)
      }
      optionsBtn = turn
        .locator(
          'button[aria-label="Open options"], button[aria-label*="More options" i], button[mattooltip*="More options" i]',
        )
        .first()
    }

    await optionsBtn.waitFor({ state: "visible", timeout: 6000 })
    await optionsBtn.click()
    await tab.waitForTimeout(400)

    const copyMdItem = tab
      .locator(
        '[role="menuitem"]:has-text("Copy as markdown"), button:has-text("Copy as markdown"), [role="menuitem"]:has-text("Copy markdown")',
      )
      .first()
    await copyMdItem.waitFor({ state: "visible", timeout: 5000 })
    await copyMdItem.click()
    await tab.waitForTimeout(600)

    let markdown = await tab.evaluate(() => window.__aistudioCapturedMarkdown || "")
    if (!markdown || markdown.length < 300) {
      markdown = await tab.evaluate(async () => {
        try {
          return await navigator.clipboard.readText()
        } catch {
          return ""
        }
      })
    }

    if (!markdown || markdown.length < 300) {
      throw new Error(
        `[${role}] Copy as markdown clicked, but captured text was too short (${markdown?.length || 0} chars).`,
      )
    }
    return markdown.trim() + "\n"
  }

  if (CFG.action === "start") {
    await context
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: "https://aistudio.google.com",
      })
      .catch(() => {})

    const roleStates = [
      { role: "advocate", promptText: CFG.advocatePrompt },
      { role: "alex", promptText: CFG.alexPrompt },
    ].map((item) => ({
      role: item.role,
      promptText: item.promptText,
      model: CFG.model || "Gemini 4 Neon",
      initialThinking: CFG.thinking || "Extra High",
      fallbackThinking: CFG.fallbackThinking || "High",
      thinking: CFG.thinking || "Extra High",
      attempt: 0,
      maxAttempts: 2,
      page: null,
      status: "pending",
      startMs: 0,
      lastProgressMs: 0,
      lastTextLen: 0,
      lastFullLen: 0,
      sawRunning: false,
      stableIdlePolls: 0,
      markdown: "",
      chars: 0,
      chatUrl: null,
      error: null,
      notes: [],
    }))

    // Launch both isolated tabs IN PARALLEL
    await Promise.all(roleStates.map((st) => launchRoleTab(st, st.initialThinking)))

    context.__wikiCourtJobs.set(CFG.slug, {
      slug: CFG.slug,
      createdAt: new Date().toISOString(),
      roles: roleStates,
    })

    return {
      status: "started",
      slug: CFG.slug,
      parallelTabs: roleStates.length,
      roles: roleStates.map((st) => ({
        role: st.role,
        status: st.status,
        thinking: st.thinking,
        meta: st.meta,
        notes: st.notes,
      })),
    }
  }

  // action === "poll"
  const job = context.__wikiCourtJobs.get(CFG.slug)
  if (!job) {
    throw new Error(
      `No active AI Studio job found for slug '${CFG.slug}'. Run aistudio_start.js first.`,
    )
  }

  const waitSeconds = CFG.waitSeconds ?? 45
  const extraHighRiskMs = (CFG.extraHighRiskMin ?? 11) * 60_000
  const stallMs = (CFG.stallMin ?? 5) * 60_000
  const timeoutMs = (CFG.timeoutMin ?? 18) * 60_000
  const sliceDeadline = Date.now() + waitSeconds * 1000

  while (true) {
    for (const st of job.roles) {
      if (st.status === "done" || st.status === "failed") continue

      const snap = await readStreamSnapshot(st.page)
      const now = Date.now()
      const elapsedSec = Math.round((now - st.startMs) / 1000)
      st.chatUrl = snap.url

      if (snap.isRunning) st.sawRunning = true
      if (snap.textLen > st.lastTextLen || snap.fullTurnLen > st.lastFullLen) {
        st.lastTextLen = Math.max(st.lastTextLen, snap.textLen)
        st.lastFullLen = Math.max(st.lastFullLen, snap.fullTurnLen)
        st.lastProgressMs = now
        st.stableIdlePolls = 0
      }

      if (snap.hasUnavailableBanner && !st._notedUnavailable) {
        st._notedUnavailable = true
        st.notes.push(
          `[${ts()}] Transient "Model isn't available right now" at ${elapsedSec}s — keeping stream alive (textLen=${snap.textLen}, stopVisible=${snap.stopVisible}).`,
        )
      }

      let failedReason = null
      if (!snap.isRunning && (st.sawRunning || (elapsedSec > 30 && snap.textLen >= 500))) {
        st.stableIdlePolls += 1
        if (st.stableIdlePolls >= 3) {
          if (snap.textLen >= 500) {
            try {
              const md = await extractMarkdownViaCopyMenu(st.page, st.role)
              st.markdown = md
              st.chars = md.length
              st.chatUrl = st.page.url()
              st.status = "done"
              st.notes.push(`[${ts()}] Completed cleanly in ${elapsedSec}s (${md.length} chars).`)
              continue
            } catch (err) {
              failedReason = `Copy extraction error: ${err.message || err}`
            }
          } else {
            failedReason = `Ended with insufficient output (${snap.textLen} chars, unavailable=${snap.hasUnavailableBanner}, fatalErr=${snap.hasFatalError})`
          }
        }
      } else {
        st.stableIdlePolls = 0
      }

      const idleMs = now - st.lastProgressMs
      if (
        !failedReason &&
        st.thinking.toLowerCase() === "extra high" &&
        now - st.startMs > extraHighRiskMs &&
        snap.textLen < 200 &&
        idleMs > 180_000
      ) {
        failedReason = `Extra High thinking exceeded ${CFG.extraHighRiskMin ?? 11}m without streaming`
      } else if (!failedReason && idleMs > stallMs && snap.textLen < 500 && !snap.stopVisible) {
        failedReason = `Stalled ${Math.round(idleMs / 1000)}s with no Stop button (textLen=${snap.textLen})`
      } else if (!failedReason && now - st.startMs > timeoutMs) {
        failedReason = `Exceeded ${CFG.timeoutMin ?? 18}m hard timeout (textLen=${snap.textLen})`
      }

      if (failedReason) {
        st.notes.push(`[${ts()}] Attempt ${st.attempt} failed: ${failedReason}`)
        if (st.attempt < st.maxAttempts && st.fallbackThinking) {
          st.notes.push(
            `[${ts()}] Rescuing ${st.role} in fresh tab downgraded '${st.thinking}' -> '${st.fallbackThinking}'.`,
          )
          await st.page.close().catch(() => {})
          await launchRoleTab(st, st.fallbackThinking)
        } else {
          st.status = "failed"
          st.error = failedReason
        }
      }
    }

    const allFinished = job.roles.every((st) => st.status === "done" || st.status === "failed")
    if (allFinished) {
      const adv = job.roles.find((r) => r.role === "advocate")
      const alex = job.roles.find((r) => r.role === "alex")
      return {
        status: job.roles.every((st) => st.status === "done") ? "done" : "partial_failure",
        slug: CFG.slug,
        roles: job.roles.map((st) => ({
          role: st.role,
          status: st.status,
          thinking: st.thinking,
          attempt: st.attempt,
          elapsedSec: Math.round((Date.now() - st.startMs) / 1000),
          chars: st.chars,
          chatUrl: st.chatUrl,
          error: st.error,
          notes: st.notes,
        })),
        advocate_markdown: adv?.markdown || "",
        alex_markdown: alex?.markdown || "",
      }
    }

    if (Date.now() >= sliceDeadline) {
      return {
        status: "running",
        slug: CFG.slug,
        roles: job.roles.map((st) => ({
          role: st.role,
          status: st.status,
          thinking: st.thinking,
          attempt: st.attempt,
          elapsedSec: Math.round((Date.now() - st.startMs) / 1000),
          lastTextLen: st.lastTextLen,
          lastFullLen: st.lastFullLen,
          sawRunning: st.sawRunning,
          chars: st.chars,
          chatUrl: st.chatUrl,
          notes: st.notes.slice(-4),
        })),
      }
    }

    await page.waitForTimeout(5000)
  }
}
