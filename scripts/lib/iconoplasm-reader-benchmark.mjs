// ARCHITECTURE FENCE [IPD-008]: fixed reader deadlines, not wait-until-warm.
// Supply these exported functions to Playwright MCP with its existing Page. Never launch a second
// browser/profile or silently convert a failed browser journey into a skip.
export const READER_BUDGETS = Object.freeze({
  preparedPaintMs: 200,
  foregroundPaintMs: 1000,
  highlightAfterLoadMs: 1500,
  predictionLeadMs: 2000,
  sampleTimeoutMs: 8000,
  highlightTimeoutMs: 15000,
  minimumSamples: 20,
})

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const pick = (p) => (sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null)
  return { n: sorted.length, p50: pick(0.5), p95: pick(0.95), max: sorted.at(-1) ?? null }
}

export function assessReaderSamples(samples, budgets = READER_BUDGETS) {
  const groups = {}
  for (const sample of samples) {
    const key = `${sample.surface}/${sample.cacheState}/${sample.kind}`
    const group = (groups[key] ||= {
      samples: [],
      failures: 0,
      predictionMisses: 0,
      preparedSlow: 0,
      lateHighlights: 0,
      slowHovers: 0,
    })
    group.samples.push(sample)
    if (sample.error || !Number.isFinite(sample.imageMs)) group.failures++
    if (sample.predictionEligible && !sample.before?.portraitReady) group.predictionMisses++
    if (sample.before?.portraitReady && sample.imageMs > budgets.preparedPaintMs)
      group.preparedSlow++
    if (sample.highlightAfterLoadMs > budgets.highlightAfterLoadMs) group.lateHighlights++
    if (sample.imageMs > budgets.foregroundPaintMs) group.slowHovers++
  }
  return Object.fromEntries(
    Object.entries(groups).map(([key, group]) => [
      key,
      {
        attempts: group.samples.length,
        failures: group.failures,
        predictionMisses: group.predictionMisses,
        preparedSlow: group.preparedSlow,
        lateHighlights: group.lateHighlights,
        slowHovers: group.slowHovers,
        imageMs: distribution(group.samples.map((s) => s.imageMs)),
        detailsMs: distribution(group.samples.map((s) => s.detailsMs)),
        // Timeouts remain in the denominator; a fast survivor is not a passing run.
        verdict:
          group.failures ||
          group.predictionMisses ||
          group.preparedSlow ||
          group.lateHighlights ||
          group.slowHovers
            ? "fail"
            : group.samples.length < budgets.minimumSamples
              ? "insufficient-samples"
              : "pass",
      },
    ]),
  )
}

// Runs in every document, including the real extension frame. Bounded and local;
// deliberately no request interception, readiness waiting, or cache mutation.
export function installReaderProbe() {
  if (globalThis.__iconoplasmReaderProbe) return
  const epoch = () => performance.timeOrigin + performance.now()
  const highlights = {}
  const longTasks = []
  let firstHighlightAt = null
  let armed = null
  let result = null
  let raf = 0
  let lastFrame = 0
  let maxFrameGap = 0
  let active = true
  function visible(element) {
    if (!element || !element.getClientRects().length) return false
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)
        return false
    }
    return true
  }
  function register(node) {
    if (node.nodeType !== 1) return
    const anchors = node.matches?.("[data-gene]")
      ? [node]
      : node.querySelectorAll?.("[data-gene]") || []
    for (const anchor of anchors) {
      const symbol = anchor.dataset.gene
      if (!symbol || symbol.length > 64 || Object.keys(highlights).length >= 256) continue
      if (!(symbol in highlights)) highlights[symbol] = epoch()
      firstHighlightAt ??= epoch()
    }
  }
  const mutations = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) register(node)
  })
  mutations.observe(document, { childList: true, subtree: true })
  if (document.documentElement) register(document.documentElement)
  let tasks
  try {
    tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (longTasks.length < 200)
          longTasks.push({ at: performance.timeOrigin + entry.startTime, duration: entry.duration })
      }
    })
    tasks.observe({ type: "longtask", buffered: true })
  } catch {
    /* unsupported browser is reported, not counted as zero long tasks */
  }
  const pointer = () => {
    if (armed && !armed.pointerAt) armed.pointerAt = epoch()
  }
  document.addEventListener("pointermove", pointer, true)
  function frame(now) {
    if (!active) return
    if (lastFrame && document.visibilityState === "visible")
      maxFrameGap = Math.max(maxFrameGap, now - lastFrame)
    lastFrame = now
    if (armed && epoch() <= armed.deadline) {
      const shell = document.querySelector(".iconoplasm-tooltip-visible")
      // Child-frame visibility is gated by the parent shell in the aggregator.
      const root =
        shell || (location.protocol.endsWith("extension:") && document.querySelector(".icono-card"))
      if (root && visible(root)) {
        if (shell) result.shellAt ??= epoch()
        const image = [...root.querySelectorAll("img")].find(
          (img) =>
            img.alt?.includes(armed.symbol) &&
            (!armed.sha ||
              (img.currentSrc || img.src).includes(armed.sha) ||
              img.src.startsWith("data:image/")) &&
            img.complete &&
            img.naturalWidth > 0 &&
            visible(img),
        )
        const symbol = [
          ...root.querySelectorAll(
            ".iconoplasm-tooltip-symbol, .icono-label-symbol, [data-gene-symbol]",
          ),
        ].some((el) => el.textContent.trim() === armed.symbol)
        if (image || symbol) result.shellAt ??= epoch()
        if (image) {
          result.imageAt ??= epoch()
          result.image = {
            src: image.currentSrc || image.src,
            width: image.naturalWidth,
            height: image.naturalHeight,
          }
        }
        if (
          symbol &&
          root.querySelector(
            ".iconoplasm-tooltip-meta-row, .iconoplasm-tooltip-meta-pairs, .icono-label-properties",
          )
        )
          result.detailsAt ??= epoch()
      }
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  globalThis.__iconoplasmReaderProbe = {
    arm(value) {
      armed = { ...value, pointerAt: null }
      result = { shellAt: null, imageAt: null, detailsAt: null }
    },
    snapshot({ includeImageSource = false } = {}) {
      const navigation = performance.getEntriesByType("navigation")[0]
      return {
        now: epoch(),
        pointerAt: armed?.pointerAt,
        result: result && {
          ...result,
          image: result.image && {
            ...result.image,
            src:
              !includeImageSource && result.image.src.startsWith("data:")
                ? "data:image/[public bytes omitted]"
                : result.image.src,
          },
        },
        firstHighlightAt,
        highlights: { ...highlights },
        loadAt: navigation?.loadEventEnd ? performance.timeOrigin + navigation.loadEventEnd : null,
        domContentLoadedAt: navigation?.domContentLoadedEventEnd
          ? performance.timeOrigin + navigation.domContentLoadedEventEnd
          : null,
        firstContentfulPaintAt:
          performance.getEntriesByName("first-contentful-paint")[0]?.startTime +
            performance.timeOrigin || null,
        timeOrigin: performance.timeOrigin,
        visibility: document.visibilityState,
        maxFrameGap,
        longTasks: tasks ? [...longTasks] : null,
      }
    },
    stop() {
      active = false
      cancelAnimationFrame(raf)
      mutations.disconnect()
      tasks?.disconnect()
      document.removeEventListener("pointermove", pointer, true)
      delete globalThis.__iconoplasmReaderProbe
    },
  }
}

async function openDiagnostics(page) {
  const session = await page.context().newCDPSession(page)
  const contexts = new Map()
  session.on("Runtime.executionContextCreated", ({ context }) => contexts.set(context.id, context))
  session.on("Runtime.executionContextDestroyed", ({ executionContextId }) =>
    contexts.delete(executionContextId),
  )
  session.on("Runtime.executionContextsCleared", () => contexts.clear())
  await session.send("Runtime.enable")
  let probeScriptId
  return {
    async installProbe() {
      await session.send("Page.enable")
      const installed = await session.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(${installReaderProbe.toString()})()`,
      })
      probeScriptId = installed.identifier
    },
    async inspect(symbol) {
      for (const context of contexts.values()) {
        // Reading the hook in each world does not execute extension work.
        try {
          const response = await session.send("Runtime.evaluate", {
            contextId: context.id,
            expression: `globalThis.IconoplasmReaderDiagnostics?.inspect(${JSON.stringify(symbol)}) ?? null`,
            returnByValue: true,
          })
          if (response.result?.value) return response.result.value
        } catch {
          /* world replaced during a navigation; remaining worlds still inspected */
        }
      }
      return null
    },
    async matchesPortraitSource(symbol, source, revision) {
      for (const context of contexts.values()) {
        try {
          const response = await session.send("Runtime.evaluate", {
            contextId: context.id,
            expression: `globalThis.IconoplasmReaderDiagnostics?.matchesPortraitSource(${JSON.stringify(symbol)}, ${JSON.stringify(source)}, ${JSON.stringify(revision)}) ?? false`,
            returnByValue: true,
          })
          if (response.result?.value === true) return true
        } catch {
          /* retired execution world */
        }
      }
      return false
    },
    async close() {
      try {
        if (probeScriptId)
          await session.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: probeScriptId,
          })
      } finally {
        await session.detach()
      }
    },
  }
}

export function locateReaderPointerTarget(element) {
  const doc = element.ownerDocument
  const view = doc.defaultView
  const pdfPage = element.classList.contains("iconoplasm-pdf-hit-anchor")
    ? element.closest(".page")
    : null
  const obstructions = []
  // Wrapped aliases have disjoint line boxes: their UNION's center may be blank
  // page text. Hit-test actual fragments, never force events through an overlay.
  for (const rect of [...element.getClientRects()].sort((a, b) => b.width - a.width)) {
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    if (
      !rect.width ||
      !rect.height ||
      x < 0 ||
      y < 0 ||
      x >= view.innerWidth ||
      y >= view.innerHeight
    )
      continue
    const hit = doc.elementFromPoint(x, y)
    if (
      hit === element ||
      element.contains(hit) ||
      (pdfPage?.contains(hit) && !hit?.closest(".iconoplasm-tooltip"))
    )
      return { x, y }
    obstructions.push(hit?.tagName || "outside-viewport")
  }
  return { error: "target-obscured-or-outside-viewport", obstructions }
}

export async function measureHover(page, diagnostics, sample) {
  const selector = `.iconoplasm-gene[data-gene="${sample.symbol}"], .iconoplasm-pdf-hit-anchor[data-gene="${sample.symbol}"]`
  if (!/^[A-Z0-9-]{1,64}$/.test(sample.symbol)) throw new Error("Invalid benchmark symbol")
  const timeoutMs = sample.timeoutMs || READER_BUDGETS.sampleTimeoutMs
  const record = { ...sample, imageMs: null, detailsMs: null }
  try {
    await page.mouse.move(2, 2)
    await page.waitForTimeout(180)
    const target = page.locator(selector).nth(sample.occurrence || 0)
    await target.waitFor({ state: "attached", timeout: READER_BUDGETS.highlightTimeoutMs })
    await target.scrollIntoViewIfNeeded({ timeout: timeoutMs })
    const visibleAt = await page.evaluate(() => performance.timeOrigin + performance.now())
    // Fixed lead time, NEVER waitFor(isReady): failures must remain measurable.
    await page.waitForTimeout(sample.leadMs ?? 0)
    record.before = await diagnostics.inspect(sample.symbol)
    if (!record.before)
      throw new Error(
        "Installed extension lacks reader diagnostics; rebuild/reload its validation package",
      )
    const point = await target.evaluate(locateReaderPointerTarget)
    if (point.error) throw new Error(`${point.error}: ${point.obstructions.join(", ")}`)
    const before = await page.evaluate(() => globalThis.__iconoplasmReaderProbe.snapshot())
    record.highlightAfterLoadMs =
      before.loadAt && before.highlights[sample.symbol]
        ? Math.max(0, before.highlights[sample.symbol] - before.loadAt)
        : null
    record.visibleLeadMs = record.before.at - visibleAt
    record.predictionEligible =
      record.before.session.policy.speculative &&
      record.before.session.speculationStarted &&
      !(
        record.before.detailReady &&
        record.before.locatorReady &&
        !record.before.portraitExpected
      ) &&
      record.visibleLeadMs >= READER_BUDGETS.predictionLeadMs
    const deadline = Date.now() + timeoutMs
    const frames = page
      .frames()
      .filter((frame) => frame === page.mainFrame() || /lit-archival-frame\.html/.test(frame.url()))
    for (const frame of frames) {
      await frame.evaluate(installReaderProbe)
      await frame.evaluate((value) => globalThis.__iconoplasmReaderProbe.arm(value), {
        symbol: sample.symbol,
        sha: record.before.portraitSha || "",
        deadline,
      })
    }
    // PDF hit anchors intentionally sit under selectable text. Real pointer
    // coordinates exercise the PDF hit tester; force-hover/dispatchEvent do not.
    await page.mouse.move(point.x, point.y)
    let measurements
    while (Date.now() < deadline) {
      measurements = await Promise.all(
        frames.map((frame) =>
          frame.evaluate(() =>
            globalThis.__iconoplasmReaderProbe.snapshot({ includeImageSource: true }),
          ),
        ),
      )
      const parent = measurements[0]
      const painted = measurements.find((m) => m.result?.imageAt)
      const detail = measurements.find((m) => m.result?.detailsAt)
      const sourceVerified =
        painted &&
        (!painted.result.image.src.startsWith("data:") ||
          (await diagnostics.matchesPortraitSource(
            sample.symbol,
            painted.result.image.src,
            record.before.revision,
          )))
      if (parent.pointerAt && parent.result?.shellAt && painted && sourceVerified) {
        record.imageMs = Math.max(parent.result.shellAt, painted.result.imageAt) - parent.pointerAt
        record.image = {
          ...painted.result.image,
          src: painted.result.image.src.startsWith("data:")
            ? "data:image/[verified public bytes omitted]"
            : painted.result.image.src,
        }
        if (detail)
          record.detailsMs =
            Math.max(parent.result.shellAt, detail.result.detailsAt) - parent.pointerAt
        if (!sample.requireDetails || detail) break
      }
      await page.waitForTimeout(40)
    }
    if (!Number.isFinite(record.imageMs))
      throw new Error(`Image not painted within ${timeoutMs} ms`)
    if (sample.requireDetails && !Number.isFinite(record.detailsMs))
      throw new Error(`Properties not painted within ${timeoutMs} ms`)
    record.after = await diagnostics.inspect(sample.symbol)
  } catch (error) {
    record.error = String(error.message || error)
    record.observedFailure = await page
      .evaluate(() => ({
        shellVisible: Boolean(document.querySelector(".iconoplasm-tooltip-visible")),
        displayedSymbol:
          document.querySelector(".iconoplasm-tooltip-visible .iconoplasm-tooltip-symbol")
            ?.textContent || null,
        pointerAt: globalThis.__iconoplasmReaderProbe?.snapshot().pointerAt || null,
      }))
      .catch(() => null)
  } finally {
    await page.mouse.move(2, 2)
  }
  return record
}

export async function runReaderJourney(
  page,
  {
    url,
    rounds = 5,
    symbols = ["EZH2", "DNMT3A"],
    surface = "html",
    cacheState = "existing-profile",
    requireDetails = false,
    navigate,
    steps,
  } = {},
) {
  if (!url && !navigate) throw new Error("Journey needs a URL or explicit PDF navigation function")
  if (rounds < 1 || rounds > 20 || symbols.length < 1 || symbols.length > 10)
    throw new Error("Journey exceeds bounded workload")
  const path =
    steps ||
    symbols.flatMap((symbol, index) => [
      {
        symbol,
        kind: index === 0 ? "first-immediate" : "next-predicted",
        leadMs: index === 0 ? 0 : READER_BUDGETS.predictionLeadMs,
      },
      { symbol, kind: "repeat", leadMs: 0 },
    ])
  if (
    !Array.isArray(path) ||
    !path.length ||
    path.length * rounds > 160 ||
    path.some(
      (step) =>
        !/^[A-Z0-9-]{1,64}$/.test(step.symbol) ||
        !Number.isFinite(step.leadMs) ||
        step.leadMs < 0 ||
        step.leadMs > 10000,
    )
  )
    throw new Error("Invalid or unbounded reader path")
  const diagnostics = await openDiagnostics(page)
  const samples = []
  const pages = []
  const network = []
  const requests = new WeakMap()
  const sizesPending = new Set()
  const request = (req) => {
    if (network.length < 2000 && /iconoplasm|b-cdn\.net/.test(req.url())) {
      const entry = {
        at: Date.now(),
        method: req.method(),
        url: req.url().split("?")[0],
        resourceType: req.resourceType(),
        serviceWorker: Boolean(req.serviceWorker?.()),
      }
      network.push(entry)
      requests.set(req, entry)
    }
  }
  const finished = (req) => {
    const entry = requests.get(req)
    if (!entry) return
    entry.finishedAt = Date.now()
    const pending = req
      .sizes()
      .then(
        (sizes) => {
          entry.responseBodyBytes = sizes.responseBodySize
        },
        () => {
          entry.responseBodyBytes = null
        },
      )
      .finally(() => sizesPending.delete(pending))
    sizesPending.add(pending)
  }
  const failed = (req) => {
    const entry = requests.get(req)
    if (entry) entry.error = req.failure()?.errorText || "failed"
  }
  const response = (res) => {
    const entry = requests.get(res.request())
    if (entry) entry.status = res.status()
  }
  // This observes the existing browser. No routing/cache-disable trick changes
  // the healthy-path timings. Other tabs' worker traffic may be included, labeled.
  page.context().on("request", request)
  page.context().on("requestfinished", finished)
  page.context().on("requestfailed", failed)
  page.context().on("response", response)
  try {
    await diagnostics.installProbe()
    for (let round = 0; round < rounds; round++) {
      await page.bringToFront()
      if (navigate) await navigate(page, round)
      else if (round === 0) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      else await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 })
      for (const step of path) {
        samples.push(
          await measureHover(page, diagnostics, {
            surface,
            cacheState,
            round,
            requireDetails,
            ...step,
          }),
        )
      }
      pages.push(await page.evaluate(() => globalThis.__iconoplasmReaderProbe.snapshot()))
    }
    return {
      schema: 1,
      environment: await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        connection: navigator.connection
          ? {
              effectiveType: navigator.connection.effectiveType,
              rtt: navigator.connection.rtt,
              downlink: navigator.connection.downlink,
              saveData: navigator.connection.saveData,
            }
          : null,
        deviceMemory: navigator.deviceMemory || null,
        hardwareConcurrency: navigator.hardwareConcurrency,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      })),
      samples,
      groups: assessReaderSamples(samples),
      pages,
      network,
      limitations: [
        "Existing profile, not a cold browser unless explicitly established separately",
        "Browser paint-opportunity timing, not physical display scanout",
        "Network events may include other tabs; no account-wide capacity claim",
        "No p99 claim from this small sample; errors remain in attempt counts",
      ],
    }
  } finally {
    page.context().off("request", request)
    page.context().off("requestfinished", finished)
    page.context().off("requestfailed", failed)
    page.context().off("response", response)
    await Promise.race([
      Promise.allSettled([...sizesPending]),
      page.waitForTimeout(1000).catch(() => {}),
    ])
    for (const frame of page.frames())
      await frame.evaluate(() => globalThis.__iconoplasmReaderProbe?.stop()).catch(() => {})
    await diagnostics.close()
  }
}
