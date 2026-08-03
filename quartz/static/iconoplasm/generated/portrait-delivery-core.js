/* GENERATED FILE. Edit shared/iconoplasm-portrait/portrait-delivery-core.js and rerun node scripts/sync-iconoplasm-shared.mjs. */

// shared/iconoplasm-portrait/portrait-delivery-core.js
var DEFAULT_PORTRAIT_DELIVERY_POLICY = Object.freeze({
  version: 1,
  canonical_origin: "https://iconoplasm.brinedew.bio",
  accelerator: Object.freeze({
    id: "bunny",
    origin: "https://iconoplasmportraits.b-cdn.net",
    enabled: true
  }),
  probe_timeout_ms: 2500,
  decision_scope: "tab"
});
var SOURCES = /* @__PURE__ */ new Set(["accelerator", "canonical"]);
var STATES = /* @__PURE__ */ new Set(["undecided", "accelerator", "canonical", "terminal_failure"]);
var DELIVERED_IMAGE_PATH_PREFIXES = Object.freeze(["/portraits/", "/gene-cards/"]);
function normalizedOrigin(raw, fallback = "") {
  try {
    const origin = new URL(String(raw || fallback)).origin;
    return origin.startsWith("https://") ? origin : "";
  } catch (_error) {
    return "";
  }
}
function normalizePortraitDeliveryPolicy(rawPolicy, fallbackPolicy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const raw = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : {};
  const fallback = fallbackPolicy && typeof fallbackPolicy === "object" ? fallbackPolicy : DEFAULT_PORTRAIT_DELIVERY_POLICY;
  const canonicalOrigin = normalizedOrigin(raw.canonical_origin, fallback.canonical_origin);
  const rawAccelerator = raw.accelerator && typeof raw.accelerator === "object" ? raw.accelerator : {};
  const fallbackAccelerator = fallback.accelerator || DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator;
  const acceleratorOrigin = normalizedOrigin(rawAccelerator.origin, fallbackAccelerator.origin);
  const acceleratorEnabled = (rawAccelerator.enabled ?? fallbackAccelerator.enabled) === true && Boolean(acceleratorOrigin);
  const timeout = Number(raw.probe_timeout_ms ?? fallback.probe_timeout_ms);
  if (!canonicalOrigin)
    throw new Error("Portrait delivery policy requires an HTTPS canonical_origin");
  return Object.freeze({
    version: 1,
    canonical_origin: canonicalOrigin,
    accelerator: Object.freeze({
      id: String(rawAccelerator.id || fallbackAccelerator.id || "accelerator").trim() || "accelerator",
      origin: acceleratorOrigin,
      enabled: acceleratorEnabled
    }),
    probe_timeout_ms: Number.isFinite(timeout) ? Math.max(100, Math.min(1e4, Math.round(timeout))) : 2500,
    decision_scope: "tab"
  });
}
function normalizePortraitDeliveryState(rawState, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy);
  let state = STATES.has(rawState?.state) ? rawState.state : "undecided";
  const failed = Array.isArray(rawState?.failed) ? Array.from(new Set(rawState.failed.filter((source) => SOURCES.has(source)))) : [];
  if (!normalizedPolicy.accelerator.enabled) {
    if (!failed.includes("accelerator")) failed.push("accelerator");
    if (state === "undecided" || state === "accelerator") state = "canonical";
  }
  if (failed.includes("accelerator") && failed.includes("canonical")) state = "terminal_failure";
  return { state, failed };
}
function portraitPath(rawUrl, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy);
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value, normalizedPolicy.canonical_origin);
    const allowedOrigins = /* @__PURE__ */ new Set([normalizedPolicy.canonical_origin]);
    if (normalizedPolicy.accelerator.origin) allowedOrigins.add(normalizedPolicy.accelerator.origin);
    if (!allowedOrigins.has(parsed.origin) || !DELIVERED_IMAGE_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix)))
      return "";
    return parsed.pathname + parsed.search;
  } catch (_error) {
    return "";
  }
}
function portraitSourceFromUrl(rawUrl, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy);
  const path = portraitPath(rawUrl, normalizedPolicy);
  if (!path) return "";
  try {
    const origin = new URL(String(rawUrl || ""), normalizedPolicy.canonical_origin).origin;
    if (origin === normalizedPolicy.canonical_origin) return "canonical";
    if (origin === normalizedPolicy.accelerator.origin) return "accelerator";
  } catch (_error) {
  }
  return "";
}
function portraitUrlForSource(path, source, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  if (!path) return "";
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy);
  const origin = source === "accelerator" && normalizedPolicy.accelerator.enabled ? normalizedPolicy.accelerator.origin : normalizedPolicy.canonical_origin;
  return origin + path;
}
function transitionPortraitDelivery(rawState, event, policy = DEFAULT_PORTRAIT_DELIVERY_POLICY) {
  const normalizedPolicy = normalizePortraitDeliveryPolicy(policy);
  const current = normalizePortraitDeliveryState(rawState, normalizedPolicy);
  const type = String(event?.type || "");
  const source = SOURCES.has(event?.source) ? event.source : "";
  if (type === "source_succeeded" && source) {
    return normalizePortraitDeliveryState(
      { state: source, failed: current.failed.filter((item) => item !== source) },
      normalizedPolicy
    );
  }
  if (type !== "source_failed" || !source || current.failed.includes(source)) return current;
  const failed = Array.from(/* @__PURE__ */ new Set([...current.failed, source]));
  const alternate = source === "accelerator" ? "canonical" : "accelerator";
  if (failed.includes(alternate) || alternate === "accelerator" && !normalizedPolicy.accelerator.enabled) {
    return normalizePortraitDeliveryState({ state: "terminal_failure", failed }, normalizedPolicy);
  }
  if (current.state === source || current.state === "undecided") {
    return normalizePortraitDeliveryState({ state: alternate, failed }, normalizedPolicy);
  }
  return normalizePortraitDeliveryState({ state: current.state, failed }, normalizedPolicy);
}
function createPortraitDeliverySession(options = {}) {
  let policy = normalizePortraitDeliveryPolicy(options.policy);
  let state = normalizePortraitDeliveryState(options.initialState, policy);
  let decisionPromise = null;
  const probe = typeof options.probe === "function" ? options.probe : null;
  const persist = typeof options.persist === "function" ? options.persist : null;
  function commit(nextState) {
    const normalized = normalizePortraitDeliveryState(nextState, policy);
    const changed = normalized.state !== state.state || normalized.failed.join("|") !== state.failed.join("|");
    state = normalized;
    if (changed && persist)
      Promise.resolve(persist({ ...state, failed: [...state.failed] })).catch(() => null);
    return changed;
  }
  function selectedSource() {
    if (state.state === "accelerator" || state.state === "canonical") return state.state;
    if (state.failed.includes("accelerator") || !policy.accelerator.enabled) return "canonical";
    return "accelerator";
  }
  function resolve(rawUrl) {
    const path = portraitPath(rawUrl, policy);
    if (!path) return String(rawUrl || "").trim();
    return portraitUrlForSource(path, selectedSource(), policy);
  }
  function configure(rawPolicy) {
    policy = normalizePortraitDeliveryPolicy(rawPolicy, policy);
    commit(state);
    return policy;
  }
  async function ensure(rawUrl) {
    const path = portraitPath(rawUrl, policy);
    if (!path) return String(rawUrl || "").trim();
    if (state.state !== "undecided") return resolve(rawUrl);
    if (decisionPromise) {
      await decisionPromise;
      return resolve(rawUrl);
    }
    if (!policy.accelerator.enabled || !probe) {
      commit(
        transitionPortraitDelivery(
          state,
          { type: "source_succeeded", source: "canonical" },
          policy
        )
      );
      return resolve(rawUrl);
    }
    const acceleratorUrl = portraitUrlForSource(path, "accelerator", policy);
    decisionPromise = Promise.resolve(probe(acceleratorUrl, policy.probe_timeout_ms)).then((succeeded) => {
      const event = succeeded ? { type: "source_succeeded", source: "accelerator" } : { type: "source_failed", source: "accelerator" };
      commit(transitionPortraitDelivery(state, event, policy));
      return selectedSource();
    }).catch(() => {
      commit(
        transitionPortraitDelivery(
          state,
          { type: "source_failed", source: "accelerator" },
          policy
        )
      );
      return selectedSource();
    }).finally(() => {
      decisionPromise = null;
    });
    await decisionPromise;
    return resolve(rawUrl);
  }
  function reportFailure(rawUrl) {
    const source = portraitSourceFromUrl(rawUrl, policy);
    if (!source)
      return { changed: false, state: snapshot(), replacementUrl: String(rawUrl || "").trim() };
    const changed = commit(
      transitionPortraitDelivery(state, { type: "source_failed", source }, policy)
    );
    return { changed, state: snapshot(), replacementUrl: resolve(rawUrl), failedSource: source };
  }
  function snapshot() {
    return { ...state, failed: [...state.failed] };
  }
  return { configure, ensure, policy: () => policy, reportFailure, resolve, state: snapshot };
}
export {
  DEFAULT_PORTRAIT_DELIVERY_POLICY,
  createPortraitDeliverySession,
  normalizePortraitDeliveryPolicy,
  normalizePortraitDeliveryState,
  portraitPath,
  portraitSourceFromUrl,
  portraitUrlForSource,
  transitionPortraitDelivery
};
