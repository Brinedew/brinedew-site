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
