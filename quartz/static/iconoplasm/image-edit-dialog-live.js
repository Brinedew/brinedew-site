export const IMAGE_EDIT_POLL_FAST_INTERVAL_MS = 4000
export const IMAGE_EDIT_POLL_SLOW_INTERVAL_MS = 10000
export const IMAGE_EDIT_POLL_FAST_PHASE_MS = 60000
export const IMAGE_EDIT_POLL_MAX_WAIT_MS = 600000

/**
 * Returns true when an image-edit job has not yet reached a terminal state.
 */
export function isImageEditJobPendingStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
  return normalized === "queued" || normalized === "running"
}

/**
 * Chooses the CSS aspect ratio expression for the image-edit preview without
 * cropping or zooming the edited portrait. Prefers the edited result's
 * natural dimensions once loaded, falling back to the before/source dimensions.
 */
export function resolveImageEditAspectRatio(dims = {}) {
  const candidates = [
    [dims.afterWidth, dims.afterHeight],
    [dims.beforeWidth, dims.beforeHeight],
    [dims.sourceWidth, dims.sourceHeight],
    [dims.width, dims.height],
  ]
  for (const [rawW, rawH] of candidates) {
    const w = Number(rawW || 0)
    const h = Number(rawH || 0)
    if (w > 0 && h > 0) return Math.round(w) + " / " + Math.round(h)
  }
  return ""
}

function normalizeEditJobId(itemOrId) {
  if (typeof itemOrId === "string") return itemOrId.trim()
  if (!itemOrId || typeof itemOrId !== "object") return ""
  const explicit = String(itemOrId.edit_job_id || itemOrId.id || "").trim()
  if (explicit) return explicit
  const reqId = Number(itemOrId.request_id || 0) || 0
  return reqId > 0 ? "request-" + reqId : ""
}

/**
 * Watches one queued free image-edit job only while its modal dialog remains
 * open and visible, transitioning the open dialog as soon as the job finishes
 * or the Request Inbox observes it ready.
 */
export function createImageEditJobWatcher({
  fetchJob,
  isDialogOpen,
  onResolved,
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (id) => globalThis.clearTimeout(id),
  nowFn = () => Date.now(),
  documentObj = typeof document !== "undefined" ? document : null,
  windowObj = typeof window !== "undefined" ? window : null,
  fastIntervalMs = IMAGE_EDIT_POLL_FAST_INTERVAL_MS,
  slowIntervalMs = IMAGE_EDIT_POLL_SLOW_INTERVAL_MS,
  fastPhaseMs = IMAGE_EDIT_POLL_FAST_PHASE_MS,
  maxWaitMs = IMAGE_EDIT_POLL_MAX_WAIT_MS,
}) {
  let activeJobId = ""
  let activeSessionVersion = 0
  let watchToken = 0
  let startedAt = 0
  let timer = 0
  let inflight = false
  let listenersWired = false

  function isPageVisible() {
    if (!documentObj || !("visibilityState" in documentObj)) return true
    return documentObj.visibilityState === "visible"
  }

  function clearTimer() {
    if (!timer) return
    clearTimeoutFn(timer)
    timer = 0
  }

  function nextDelayMs() {
    const elapsed = nowFn() - startedAt
    if (elapsed >= maxWaitMs) return 0
    return elapsed < fastPhaseMs ? fastIntervalMs : slowIntervalMs
  }

  function scheduleNext(expectedToken) {
    clearTimer()
    if (!activeJobId || expectedToken !== watchToken) return
    if (!isDialogOpen() || !isPageVisible()) return
    const delay = nextDelayMs()
    if (!delay) {
      stop()
      return
    }
    timer = setTimeoutFn(() => {
      timer = 0
      void checkNow(expectedToken)
    }, delay)
  }

  async function checkNow(expectedToken = watchToken) {
    if (!activeJobId || expectedToken !== watchToken) return null
    if (!isDialogOpen()) {
      stop()
      return null
    }
    if (inflight) return null
    clearTimer()
    inflight = true
    const jobId = activeJobId
    const sessionVersion = activeSessionVersion
    try {
      const job = await fetchJob(jobId)
      if (expectedToken !== watchToken || jobId !== activeJobId || !isDialogOpen()) return null
      if (job && !isImageEditJobPendingStatus(job.status)) {
        stop()
        onResolved(job, sessionVersion)
        return job
      }
    } catch (error) {
      if (expectedToken !== watchToken) return null
      const status = Number((error && error.status) || 0)
      if (status === 401 || status === 403 || status === 404) {
        stop()
        return null
      }
    } finally {
      inflight = false
    }
    if (expectedToken === watchToken && activeJobId) {
      scheduleNext(expectedToken)
    }
    return null
  }

  function handleResumeSignal() {
    if (!activeJobId || !isDialogOpen() || !isPageVisible()) return
    void checkNow(watchToken)
  }

  function ensureListeners() {
    if (listenersWired) return
    listenersWired = true
    if (documentObj && typeof documentObj.addEventListener === "function") {
      documentObj.addEventListener("visibilitychange", () => {
        if (!isPageVisible()) clearTimer()
        else handleResumeSignal()
      })
    }
    if (windowObj && typeof windowObj.addEventListener === "function") {
      windowObj.addEventListener("focus", handleResumeSignal)
    }
  }

  function start({ jobId, sessionVersion }) {
    const cleanId = String(jobId || "").trim()
    stop()
    if (!cleanId) return
    ensureListeners()
    activeJobId = cleanId
    activeSessionVersion = Number(sessionVersion || 0) || 0
    startedAt = nowFn()
    scheduleNext(watchToken)
  }

  function stop() {
    watchToken += 1
    activeJobId = ""
    activeSessionVersion = 0
    clearTimer()
  }

  function notifyReadyJobs(readyEditJobs) {
    if (!activeJobId || !Array.isArray(readyEditJobs) || !readyEditJobs.length) return
    const matches = readyEditJobs.some((item) => normalizeEditJobId(item) === activeJobId)
    if (!matches) return
    void checkNow(watchToken)
  }

  return {
    checkNow,
    getActiveJobId: () => activeJobId,
    notifyReadyJobs,
    start,
    stop,
  }
}

/**
 * Formats a free edit model label with a leading "(Free) " badge so free and
 * paid options scan consistently without scanning to the end of the line.
 */
export function formatFreeImageEditModelLabel(rawLabel) {
  const base = String(rawLabel || "")
    .trim()
    .replace(/\s*\(Free\)\s*$/i, "")
    .replace(/^\(Free\)\s*/i, "")
    .trim()
  return base ? "(Free) " + base : "(Free)"
}

/**
 * Builds sorted edit-provider dropdown options with all free-queue models on
 * top regardless of connected paid APIs, then alphanumerically within tiers.
 */
export function buildImageEditProviderOptions({
  supported = [],
  configured = {},
  lastUsed = null,
} = {}) {
  let lastUsedValue = ""
  if (lastUsed && lastUsed.provider_id && lastUsed.model) {
    lastUsedValue = lastUsed.provider_id + ":" + lastUsed.model
  }
  const options = []
  ;(Array.isArray(supported) ? supported : []).forEach((sp) => {
    const isFreeProvider = Boolean(sp && sp.free_queue)
    if (!isFreeProvider && !configured[sp.provider_id]) return
    ;(sp.model_options || []).forEach((m) => {
      const isFreeOption = isFreeProvider || Boolean(m && m.free_queue)
      const value = sp.provider_id + ":" + m.model
      const rawModelLabel = String((m && (m.label || m.model)) || "")
      const label = isFreeOption
        ? formatFreeImageEditModelLabel(rawModelLabel)
        : sp.label + " · " + rawModelLabel
      if (!lastUsedValue && m && m.last_used) lastUsedValue = value
      options.push({
        value,
        label,
        free: isFreeOption,
        lastUsed: false,
      })
    })
  })
  options.sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true })
  })
  if (lastUsedValue) {
    options.forEach((opt) => {
      if (opt.value === lastUsedValue) {
        opt.lastUsed = true
        opt.label = opt.label + " · last used"
      }
    })
  }
  let selectedValue = lastUsedValue || (options.length ? options[0].value : "")
  if (selectedValue && !options.some((opt) => opt.value === selectedValue)) {
    selectedValue = options.length ? options[0].value : ""
  }
  return { options, selectedValue }
}

function normalizeAdjustmentHex(value) {
  const hex = String(value || "").trim()
  return /^#[0-9a-f]{3,8}$/i.test(hex) ? hex : ""
}

function formatOneAdjustmentChip(kind, value, text) {
  const cleanKind = String(kind || "").trim()
  if (!cleanKind) return null
  if (cleanKind === "remove_ai_generation_errors") {
    return { kind: cleanKind, label: "Remove visible AI errors", toneHex: "" }
  }
  if (cleanKind === "sex") {
    const clean = String(value || "").trim()
    if (!clean) return null
    return { kind: cleanKind, label: "Sex · " + clean, toneHex: "" }
  }
  if (cleanKind === "age_years") {
    if (value == null || value === "") return null
    return { kind: cleanKind, label: "Age · " + String(value) + " years", toneHex: "" }
  }
  if (cleanKind === "mass_kg") {
    if (value == null || value === "") return null
    return { kind: cleanKind, label: "Mass · " + String(value) + " kg", toneHex: "" }
  }
  if (cleanKind === "surface_tone_hex") {
    const clean = String(value || "").trim()
    const toneHex = normalizeAdjustmentHex(clean)
    if (!clean && !toneHex) return null
    return { kind: cleanKind, label: "Surface tone · " + (toneHex || clean), toneHex }
  }
  if (cleanKind === "fantastical_feature") {
    const clean = String(value || "").trim()
    const isRemoval = !clean || /remove all fantastical/i.test(clean)
    return {
      kind: cleanKind,
      label: isRemoval ? "Remove fantastical features" : "Feature · " + clean,
      toneHex: "",
    }
  }
  if (cleanKind === "fashion_styles") {
    const list = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : String(value || "")
          .split(/\s*\+\s*|\s*,\s*/)
          .map((item) => item.trim())
          .filter(Boolean)
    if (!list.length) return null
    return { kind: cleanKind, label: "Style mix · " + list.join(" + "), toneHex: "" }
  }
  const fallbackText = String(value || text || "").trim()
  return {
    kind: cleanKind,
    label: fallbackText ? cleanKind + " · " + fallbackText : cleanKind,
    toneHex: "",
  }
}

/**
 * Formats stored job.adjustments into read-only summary chip descriptors
 * for Review mode so caretakers can verify what produced the edit without
 * re-exposing the interactive request form.
 */
export function formatImageEditAdjustmentChips(adjustments) {
  const chips = []
  if (Array.isArray(adjustments)) {
    for (const entry of adjustments) {
      if (!entry || typeof entry !== "object") continue
      const chip = formatOneAdjustmentChip(entry.kind, entry.value, entry.text)
      if (chip) chips.push(chip)
    }
    return chips
  }
  if (adjustments && typeof adjustments === "object") {
    for (const [kind, value] of Object.entries(adjustments)) {
      if (value === false || value == null) continue
      const chip = formatOneAdjustmentChip(kind, value, "")
      if (chip) chips.push(chip)
    }
  }
  return chips
}

/**
 * Derives visibility, sizing, disabled state, and labels for every control in
 * the portrait edit modal across its two distinct modes:
 * - "request": two-column editor with [Edit] only
 * - "review": single-column before/after review with centered [Discard] + [Publish]
 */
export function resolveImageEditDialogUiState({
  mode = "request",
  job = null,
  loading = false,
  discarding = false,
  publishing = false,
  encryptionConfigured = false,
  isFreeProvider = false,
  hasSelectedProvider = false,
  hasAdjustment = false,
} = {}) {
  const normalizedMode = mode === "review" ? "review" : "request"
  if (normalizedMode === "request") {
    return {
      mode: "request",
      dialogSize: "wide",
      controlsHidden: false,
      reviewSummaryHidden: true,
      editHidden: false,
      editDisabled: Boolean(
        loading ||
        (!encryptionConfigured && !isFreeProvider) ||
        !hasSelectedProvider ||
        !hasAdjustment,
      ),
      editLabel: loading && !discarding ? (isFreeProvider ? "Queueing..." : "Editing...") : "Edit",
      discardHidden: true,
      discardDisabled: true,
      discardLabel: "Discard",
      publishHidden: true,
      publishDisabled: true,
      publishLabel: "Publish",
    }
  }

  const jobStatus = String((job && job.status) || "")
    .trim()
    .toLowerCase()
  const isPublished = Boolean(job && job.published)
  const canDiscard = Boolean(
    job && !isPublished && (jobStatus === "succeeded" || jobStatus === "failed"),
  )
  const canPublish = Boolean(job && !isPublished && jobStatus === "succeeded")
  const isPublishing = Boolean(publishing || (loading && !discarding && canPublish))

  return {
    mode: "review",
    dialogSize: "standard",
    controlsHidden: true,
    reviewSummaryHidden: false,
    editHidden: true,
    editDisabled: true,
    editLabel: "Edit",
    discardHidden: false,
    discardDisabled: Boolean(loading || !canDiscard),
    discardLabel: discarding ? "Discarding..." : "Discard",
    publishHidden: false,
    publishDisabled: Boolean(loading || !canPublish),
    publishLabel: isPublishing ? "Publishing..." : "Publish",
  }
}

export function formatImageEditModelLabel(job) {
  if (!job || typeof job !== "object") return ""
  const explicit = String(job.model_label || "").trim()
  if (explicit) return explicit
  const rawModel = String(job.model || "").trim()
  if (!rawModel) return ""
  return rawModel
    .replace(/^comfyui-edit:/i, "")
    .replace(/^\s*\(Free\)\s+/i, "")
    .replace(/\s*\(Free\)\s*$/i, "")
    .trim()
}
