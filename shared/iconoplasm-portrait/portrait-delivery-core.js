// ARCHITECTURE FENCE [IPD-001]
// Bunny is intentionally the healthy-tab default: direct portrait reads avoid
// spending the Cloudflare Worker budget. A resolver failure on one network is
// why the one-probe canonical fallback exists; it is not a reason to disable
// Bunny globally. See architecture-fences.json and the portrait runbook before
// changing this default.
// Country is not connectivity: a working Vietnamese ISP/VPN uses Bunny too.
// This policy owns byte delivery, never canonical image selection. The owner's
// paid Bunny service replaces unavailable R2; canonical URLs are not a CDN ban.
export const DEFAULT_PORTRAIT_DELIVERY_POLICY = Object.freeze({
  version: 1,
  canonical_origin: "https://iconoplasm.brinedew.bio",
  accelerator: Object.freeze({
    id: "bunny",
    origin: "https://iconoplasmportraits.b-cdn.net",
    enabled: true,
  }),
  probe_timeout_ms: 2500,
  fallback_hedge_delay_ms: 350,
  // A probe that times out is ambiguous: a cold CDN object measured 0.4-1.7 s
  // from a healthy network, so a slow first byte must not convert the tab into
  // first-party (Worker-metered) image delivery for its whole life. Only a
  // timeout arms this retry; a definitive DNS/HTTP failure stays permanent.
  accelerator_retry_after_ms: 60_000,
  decision_scope: "tab",
})

const SOURCES = new Set(["accelerator", "canonical"])
const STATES = new Set(["undecided", "accelerator", "canonical", "terminal_failure"])
const DELIVERED_IMAGE_PATH_PREFIXES = Object.freeze(["/portraits/", "/gene-cards/"])

function normalizedOrigin(raw, fallback = "") {
  try {
    const origin = new URL(String(raw || fallback)).origin
    return origin.startsWith("https://") ? origin : ""
  } catch (_error) {
    return ""
  }
}

export function normalizePortraitDeliveryPolicy(
  rawPolicy,
  fallbackPolicy = DEFAULT_PORTRAIT_DELIVERY_POLICY,
) {
  const raw = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : {}
  const fallback =
    fallbackPolicy && typeof fallbackPolicy === "object"
      ? fallbackPolicy
      : DEFAULT_PORTRAIT_DELIVERY_POLICY
  const canonicalOrigin = normalizedOrigin(raw.canonical_origin, fallback.canonical_origin)
  const rawAccelerator =
    raw.accelerator && typeof raw.accelerator === "object" ? raw.accelerator : {}
  const fallbackAccelerator = fallback.accelerator || DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator
  const acceleratorOrigin = normalizedOrigin(rawAccelerator.origin, fallbackAccelerator.origin)
  const acceleratorEnabled =
    (rawAccelerator.enabled ?? fallbackAccelerator.enabled) === true && Boolean(acceleratorOrigin)
  const timeout = Number(raw.probe_timeout_ms ?? fallback.probe_timeout_ms)
  const hedgeDelay = Number(raw.fallback_hedge_delay_ms ?? fallback.fallback_hedge_delay_ms)
  const retryAfter = Number(
    raw.accelerator_retry_after_ms ??
      fallback.accelerator_retry_after_ms ??
      DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator_retry_after_ms,
  )

  if (!canonicalOrigin)
    throw new Error("Portrait delivery policy requires an HTTPS canonical_origin")
  return Object.freeze({
    version: 1,
    canonical_origin: canonicalOrigin,
    accelerator: Object.freeze({
      id:
        String(rawAccelerator.id || fallbackAccelerator.id || "accelerator").trim() ||
        "accelerator",
      origin: acceleratorOrigin,
      enabled: acceleratorEnabled,
    }),
    probe_timeout_ms: Number.isFinite(timeout)
      ? Math.max(100, Math.min(10_000, Math.round(timeout)))
      : 2500,
    fallback_hedge_delay_ms: Number.isFinite(hedgeDelay)
      ? Math.max(0, Math.min(2000, Math.round(hedgeDelay)))
      : 350,
    accelerator_retry_after_ms: Number.isFinite(retryAfter)
      ? Math.max(5_000, Math.min(600_000, Math.round(retryAfter)))
      : 60_000,
    decision_scope: "tab",
  })
}

export function normalizePortraitDeliveryState(
  rawState,
  policy = DEFAULT_PORTRAIT_DELIVERY_POLICY,
) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy)
  let state = STATES.has(rawState?.state) ? rawState.state : "undecided"
  const failed = Array.isArray(rawState?.failed)
    ? Array.from(new Set(rawState.failed.filter((source) => SOURCES.has(source))))
    : []
  if (!normalizedPolicy.accelerator.enabled) {
    if (!failed.includes("accelerator")) failed.push("accelerator")
    if (state === "undecided" || state === "accelerator") state = "canonical"
  }
  if (failed.includes("accelerator") && failed.includes("canonical")) state = "terminal_failure"
  const retryAt = Number(rawState?.accelerator_retry_at)
  if (
    Number.isFinite(retryAt) &&
    retryAt > 0 &&
    failed.includes("accelerator") &&
    normalizedPolicy.accelerator.enabled &&
    state === "canonical"
  ) {
    return { state, failed, accelerator_retry_at: Math.round(retryAt) }
  }
  return { state, failed }
}

// A transient accelerator failure expires: once the retry time has passed the
// tab is undecided again and the next image re-probes the CDN once.
export function expirePortraitDeliveryRetry(
  rawState,
  now = Date.now(),
  policy = DEFAULT_PORTRAIT_DELIVERY_POLICY,
) {
  const current = normalizePortraitDeliveryState(rawState, policy)
  const retryAt = current.accelerator_retry_at
  if (!retryAt || !(Number(now) >= retryAt)) return current
  return normalizePortraitDeliveryState(
    { state: "undecided", failed: current.failed.filter((item) => item !== "accelerator") },
    policy,
  )
}

export function portraitPath(rawUrl, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy)
  const value = String(rawUrl || "").trim()
  if (!value) return ""
  try {
    const parsed = new URL(value, normalizedPolicy.canonical_origin)
    const allowedOrigins = new Set([normalizedPolicy.canonical_origin])
    if (normalizedPolicy.accelerator.origin) allowedOrigins.add(normalizedPolicy.accelerator.origin)
    if (
      !allowedOrigins.has(parsed.origin) ||
      !DELIVERED_IMAGE_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))
    )
      return ""
    return parsed.pathname + parsed.search
  } catch (_error) {
    return ""
  }
}

export function portraitSourceFromUrl(rawUrl, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy)
  const path = portraitPath(rawUrl, normalizedPolicy)
  if (!path) return ""
  try {
    const origin = new URL(String(rawUrl || ""), normalizedPolicy.canonical_origin).origin
    if (origin === normalizedPolicy.canonical_origin) return "canonical"
    if (origin === normalizedPolicy.accelerator.origin) return "accelerator"
  } catch (_error) {}
  return ""
}

export function portraitUrlForSource(path, source, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  if (!path) return ""
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy)
  const origin =
    source === "accelerator" && normalizedPolicy.accelerator.enabled
      ? normalizedPolicy.accelerator.origin
      : normalizedPolicy.canonical_origin
  return origin + path
}

export function transitionPortraitDelivery(
  rawState,
  event,
  policy = DEFAULT_PORTRAIT_DELIVERY_POLICY,
  now = Date.now(),
) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy)
  const current = normalizePortraitDeliveryState(rawState, normalizedPolicy)
  const type = String(event?.type || "")
  const source = SOURCES.has(event?.source) ? event.source : ""
  if (type === "source_succeeded" && source) {
    return normalizePortraitDeliveryState(
      { state: source, failed: current.failed.filter((item) => item !== source) },
      normalizedPolicy,
    )
  }
  if (type !== "source_failed" || !source) return current
  if (current.failed.includes(source)) {
    // A definitive failure after a transient one makes the block permanent.
    if (source === "accelerator" && current.accelerator_retry_at && event?.transient !== true) {
      return normalizePortraitDeliveryState(
        { state: current.state, failed: current.failed },
        normalizedPolicy,
      )
    }
    return current
  }

  const failed = Array.from(new Set([...current.failed, source]))
  const alternate = source === "accelerator" ? "canonical" : "accelerator"
  if (source === "canonical" && current.accelerator_retry_at) {
    // The accelerator only timed out earlier; canonical failing outright is the
    // stronger signal, so try the accelerator again instead of going terminal.
    return normalizePortraitDeliveryState(
      { state: "accelerator", failed: ["canonical"] },
      normalizedPolicy,
    )
  }
  if (
    failed.includes(alternate) ||
    (alternate === "accelerator" && !normalizedPolicy.accelerator.enabled)
  ) {
    return normalizePortraitDeliveryState({ state: "terminal_failure", failed }, normalizedPolicy)
  }
  const retry =
    source === "accelerator" && event?.transient === true
      ? { accelerator_retry_at: Number(now) + normalizedPolicy.accelerator_retry_after_ms }
      : {}
  if (current.state === source || current.state === "undecided") {
    return normalizePortraitDeliveryState({ state: alternate, failed, ...retry }, normalizedPolicy)
  }
  return normalizePortraitDeliveryState(
    { state: current.state, failed, ...retry },
    normalizedPolicy,
  )
}

export function createPortraitDeliverySession(options = {}) {
  let policy = normalizePortraitDeliveryPolicy(options.policy)
  let state = normalizePortraitDeliveryState(options.initialState, policy)
  const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  let decisionRevision = 0
  let decisionPromise = null
  const probe = typeof options.probe === "function" ? options.probe : null
  const persist = typeof options.persist === "function" ? options.persist : null
  const now = typeof options.now === "function" ? options.now : () => Date.now()

  function commit(nextState) {
    const normalized = normalizePortraitDeliveryState(nextState, policy)
    const changed =
      normalized.state !== state.state ||
      normalized.failed.join("|") !== state.failed.join("|") ||
      (normalized.accelerator_retry_at || 0) !== (state.accelerator_retry_at || 0)
    state = normalized
    if (changed) decisionRevision += 1
    if (changed && persist)
      Promise.resolve(persist({ ...state, failed: [...state.failed] })).catch(() => null)
    return changed
  }

  // Called before every read of the decision: an expired transient failure
  // returns the tab to "undecided" so the next ensure() re-probes once.
  function refresh() {
    if (!state.accelerator_retry_at) return
    const expired = expirePortraitDeliveryRetry(state, now(), policy)
    if (expired.state !== state.state) commit(expired)
  }

  function selectedSource() {
    refresh()
    if (state.state === "accelerator" || state.state === "canonical") return state.state
    if (state.failed.includes("accelerator") || !policy.accelerator.enabled) return "canonical"
    return "accelerator"
  }

  function resolve(rawUrl) {
    const path = portraitPath(rawUrl, policy)
    if (!path) return String(rawUrl || "").trim()
    return portraitUrlForSource(path, selectedSource(), policy)
  }

  function plan(rawUrl) {
    const path = portraitPath(rawUrl, policy)
    if (!path) {
      const url = String(rawUrl || "").trim()
      return {
        path: "",
        primarySource: "",
        primaryUrl: url,
        fallbackSource: "",
        fallbackUrl: "",
        hedgeDelayMs: 0,
        timeoutMs: policy.probe_timeout_ms,
        state: snapshot(),
      }
    }
    const primarySource = selectedSource()
    const fallbackSource = primarySource === "accelerator" ? "canonical" : "accelerator"
    const canFallback =
      !state.failed.includes(fallbackSource) &&
      (fallbackSource !== "accelerator" || policy.accelerator.enabled)
    return {
      path,
      primarySource,
      primaryUrl: portraitUrlForSource(path, primarySource, policy),
      fallbackSource: canFallback ? fallbackSource : "",
      fallbackUrl: canFallback ? portraitUrlForSource(path, fallbackSource, policy) : "",
      // A healthy CDN retains its head start. Once canonical works, do not
      // re-test a blocked CDN on every image: the alternate starts only if
      // canonical itself fails. No cooldown, polling or elapsed-time reset.
      hedgeDelayMs: primarySource === "accelerator" ? policy.fallback_hedge_delay_ms : null,
      timeoutMs: policy.probe_timeout_ms,
      decisionId: `${sessionId}:${decisionRevision}`,
      state: snapshot(),
    }
  }

  function configure(rawPolicy) {
    policy = normalizePortraitDeliveryPolicy(rawPolicy, policy)
    commit(state)
    return policy
  }

  async function ensure(rawUrl) {
    const path = portraitPath(rawUrl, policy)
    if (!path) return String(rawUrl || "").trim()
    refresh()
    if (state.state !== "undecided") return resolve(rawUrl)
    if (decisionPromise) {
      await decisionPromise
      return resolve(rawUrl)
    }
    if (!policy.accelerator.enabled || !probe) {
      commit(
        transitionPortraitDelivery(
          state,
          { type: "source_succeeded", source: "canonical" },
          policy,
        ),
      )
      return resolve(rawUrl)
    }
    const acceleratorUrl = portraitUrlForSource(path, "accelerator", policy)
    decisionPromise = Promise.resolve(probe(acceleratorUrl, policy.probe_timeout_ms))
      .then((result) => {
        // true: CDN answered. "timeout": no answer within the probe ceiling,
        // which is ambiguous and expires. Anything else: definitive failure.
        const event =
          result === true
            ? { type: "source_succeeded", source: "accelerator" }
            : result === "timeout"
              ? { type: "source_failed", source: "accelerator", transient: true }
              : { type: "source_failed", source: "accelerator" }
        commit(transitionPortraitDelivery(state, event, policy, now()))
        return selectedSource()
      })
      .catch(() => {
        commit(
          transitionPortraitDelivery(
            state,
            { type: "source_failed", source: "accelerator" },
            policy,
          ),
        )
        return selectedSource()
      })
      .finally(() => {
        decisionPromise = null
      })
    await decisionPromise
    return resolve(rawUrl)
  }

  function reportFailure(rawUrl) {
    const source = portraitSourceFromUrl(rawUrl, policy)
    if (!source)
      return { changed: false, state: snapshot(), replacementUrl: String(rawUrl || "").trim() }
    const changed = commit(
      transitionPortraitDelivery(state, { type: "source_failed", source }, policy),
    )
    return { changed, state: snapshot(), replacementUrl: resolve(rawUrl), failedSource: source }
  }

  function reportSuccess(rawUrl, decisionId = null) {
    const source = portraitSourceFromUrl(rawUrl, policy)
    if (!source) return { changed: false, state: snapshot() }
    if (decisionId !== null && decisionId !== `${sessionId}:${decisionRevision}`) {
      return { changed: false, state: snapshot(), ignored: "superseded_decision" }
    }
    const changed = commit(
      transitionPortraitDelivery(state, { type: "source_succeeded", source }, policy),
    )
    return { changed, state: snapshot(), successfulSource: source }
  }

  function snapshot() {
    refresh()
    return { ...state, failed: [...state.failed] }
  }

  return {
    configure,
    ensure,
    plan,
    policy: () => policy,
    reportFailure,
    reportSuccess,
    resolve,
    state: snapshot,
  }
}
