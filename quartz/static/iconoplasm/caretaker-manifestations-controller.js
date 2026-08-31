import { createCaretakerManifestationEventWiring } from "./caretaker-manifestations-events.js"
import {
  MAX_PROSE_CODE_POINTS,
  codePointLength,
  commandId,
  defaultDraftStorage,
  normalizedDossier,
  normalizedSymbol,
  proseValidationError,
  revisionById,
} from "./caretaker-manifestations-model.js"
import { renderCaretakerManifestationPanel } from "./caretaker-manifestations-view.js"

export function createCaretakerManifestationPanel({
  fetchJSON,
  escapeHtml,
  confirmAction = function (message) {
    return globalThis.confirm ? globalThis.confirm(message) : false
  },
  storage = defaultDraftStorage(),
  onCanonicalChanged = function () {},
  onDossierChanged = function () {},
} = {}) {
  if (typeof fetchJSON !== "function") throw new TypeError("fetchJSON is required")
  if (typeof escapeHtml !== "function") throw new TypeError("escapeHtml is required")
  const mounted = new WeakMap()
  const wiredHosts = new WeakSet()

  function apiPath(symbol, suffix = "") {
    return `/api/iconoplasm/caretaker/genes/${encodeURIComponent(symbol)}${suffix}`
  }

  function draftKey(state) {
    return `iconoplasm.caretakerDraft.v2:${state.dossier.assignment?.caretaker_assignment_id || "none"}`
  }

  function saveDraft(state, prose) {
    try {
      storage?.setItem(draftKey(state), String(prose || ""))
    } catch (_error) {
      // A storage-disabled browser still keeps the mounted textarea intact.
    }
  }

  function clearDraft(state) {
    try {
      storage?.removeItem(draftKey(state))
    } catch (_error) {}
  }

  function restoreDraft(state) {
    try {
      return String(storage?.getItem(draftKey(state)) || "")
    } catch (_error) {
      return ""
    }
  }

  function setStatus(state, message, tone = "") {
    const target = state.host.querySelector("[data-icono-caretaker-status]")
    if (!target) return
    target.hidden = !message
    target.textContent = String(message || "")
    target.dataset.tone = tone
  }

  function setBusy(state, busy) {
    state.busy = busy
    state.host.setAttribute("aria-busy", busy ? "true" : "false")
    state.host.querySelectorAll("button, textarea, input").forEach(function (control) {
      control.disabled = busy
    })
  }

  function render(state, { preserveDraft = false } = {}) {
    const draft = preserveDraft
      ? state.host.querySelector("[data-icono-caretaker-prose]")?.value
      : ""
    state.host.innerHTML = renderCaretakerManifestationPanel(state.dossier, escapeHtml)
    const textarea = state.host.querySelector("[data-icono-caretaker-prose]")
    const restored = draft || restoreDraft(state)
    if (textarea && restored) textarea.value = restored
    if (!textarea && restored) mountLocalDraftRecovery(state, restored)
    if (textarea) updateCount(textarea)
    if (state.basedOnRevisionId) showBasis(state)
  }

  function mountLocalDraftRecovery(state, prose) {
    const document = state.host.ownerDocument
    const panel = state.host.querySelector(".icono-caretaker-panel")
    const insertionPoint = state.host.querySelector(
      ".icono-caretaker-lineages, .icono-caretaker-versions",
    )
    if (!document || !panel || !prose) return
    const section = document.createElement("section")
    section.className = "icono-caretaker-draft-recovery"
    section.setAttribute("aria-labelledby", "icono-caretaker-draft-recovery-title")
    section.innerHTML =
      '<h3 id="icono-caretaker-draft-recovery-title">Unsaved draft on this device</h3>' +
      "<p>This text has not been sent to Iconoplasm. It remains readable through a suspension or role change so you can copy it before removing it.</p>"
    const textarea = document.createElement("textarea")
    textarea.readOnly = true
    textarea.rows = 6
    textarea.value = String(prose)
    textarea.setAttribute("aria-label", "Unsaved caretaker draft")
    section.appendChild(textarea)
    const remove = document.createElement("button")
    remove.type = "button"
    remove.className = "icono-button icono-button--danger-quiet"
    remove.setAttribute("data-icono-caretaker-remove-draft", "")
    remove.textContent = "Remove draft from this device"
    section.appendChild(remove)
    panel.insertBefore(section, insertionPoint || null)
  }

  function showBasis(state) {
    const target = state.host.querySelector("[data-icono-caretaker-basis]")
    if (!target) return
    const item = revisionById(state.dossier, state.basedOnRevisionId)
    target.hidden = !item
    target.textContent = item
      ? `Starting from version ${item.revision.revision_number || ""}. Saving creates a new version in your manifestation history.`
      : ""
  }

  function updateCount(textarea) {
    const count = textarea.closest("form")?.querySelector("[data-icono-caretaker-count]")
    if (count)
      count.textContent = `${codePointLength(textarea.value).toLocaleString()} / ${MAX_PROSE_CODE_POINTS.toLocaleString()}`
  }

  function request(state, suffix, init) {
    return fetchJSON(apiPath(state.symbol, suffix), {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
        ...(init?.headers || {}),
      },
    })
  }

  async function reload(state, options) {
    const payload = await request(state, "", { method: "GET" })
    state.dossier = normalizedDossier(payload, state.symbol)
    render(state, options)
    void Promise.resolve().then(function () {
      return onDossierChanged({
        host: state.host,
        symbol: state.symbol,
        dossier: state.dossier,
      })
    })
    return state.dossier
  }

  async function loadOlderHistory(state) {
    if (state.busy || !state.dossier.history.next_cursor) return
    setBusy(state, true)
    try {
      const payload = await request(
        state,
        `?history_cursor=${encodeURIComponent(state.dossier.history.next_cursor)}`,
        { method: "GET" },
      )
      const older = normalizedDossier(payload, state.symbol)
      const byManifestation = new Map(
        state.dossier.manifestations.map(function (item) {
          return [item.manifestation_id, item]
        }),
      )
      older.manifestations.forEach(function (item) {
        const existing = byManifestation.get(item.manifestation_id)
        if (!existing) {
          state.dossier.manifestations.push(item)
          return
        }
        const seen = new Set(
          (existing.revisions || []).map(function (revision) {
            return revision.manifestation_revision_id
          }),
        )
        existing.revisions = (existing.revisions || []).concat(
          (item.revisions || []).filter(function (revision) {
            return !seen.has(revision.manifestation_revision_id)
          }),
        )
      })
      state.dossier.history = older.history
      render(state, { preserveDraft: true })
    } catch (error) {
      setStatus(state, String(error?.message || "Older versions could not be loaded."), "error")
    } finally {
      setBusy(state, false)
    }
  }

  function refreshPublicManifestation(state, result) {
    function refreshIfStillMounted() {
      const current = mounted.get(state.host)
      if (!current || current.symbol !== state.symbol) return null
      return onCanonicalChanged(state.symbol)
    }
    void Promise.resolve()
      .then(refreshIfStillMounted)
      .catch(function () {})
    if (result?.projection_pending) {
      ;[1_000, 3_000].forEach(function scheduleProjectionRead(delay) {
        globalThis.setTimeout(function refreshAfterProjectionWake() {
          void Promise.resolve()
            .then(refreshIfStillMounted)
            .catch(function () {})
        }, delay)
      })
    }
  }

  async function mutate(
    state,
    suffix,
    body,
    { method = "POST", success, preserveDraft = false, refreshPublic = false } = {},
  ) {
    if (state.busy) return null
    const bodyJson = JSON.stringify(body)
    const fingerprint = `${method}\n${suffix}\n${bodyJson}`
    if (state.pendingMutation && state.pendingMutation.fingerprint !== fingerprint) {
      await reload(state, { preserveDraft: true }).catch(function () {})
      state.pendingMutation = null
      setStatus(
        state,
        "The previous command had an uncertain outcome. Authority state was refreshed; review it before trying a different change.",
        "warn",
      )
      return null
    }
    const pending =
      state.pendingMutation ||
      Object.freeze({
        fingerprint,
        commandId: commandId(),
      })
    state.pendingMutation = pending
    setBusy(state, true)
    try {
      const result = await request(state, suffix, {
        method,
        body: JSON.stringify({ ...body, command_id: pending.commandId }),
      })
      state.pendingMutation = null
      let reloadError = null
      try {
        await reload(state, { preserveDraft })
      } catch (error) {
        reloadError = error
      }
      if (refreshPublic) refreshPublicManifestation(state, result)
      if (reloadError) {
        setStatus(
          state,
          `The command was accepted, but the latest authority state could not be reloaded. Refresh before another change. ${String(reloadError?.message || "")}`.trim(),
          "warn",
        )
        return result
      }
      setStatus(
        state,
        success +
          (result?.projection_pending
            ? " The public gene view is catching up to the accepted authority event."
            : ""),
        result?.projection_pending ? "warn" : "success",
      )
      return result
    } catch (error) {
      const status = Number(error?.status || 0)
      if (status >= 400 && status < 500) state.pendingMutation = null
      if (status === 409) {
        await reload(state, { preserveDraft: true }).catch(function () {})
        setStatus(
          state,
          "The gene changed in another tab. Your text is safe; review the newest version and save again.",
          "warn",
        )
      } else {
        setStatus(
          state,
          String(error?.message || "The caretaker change could not be saved.") +
            (status === 0 || status >= 500
              ? " The outcome is uncertain. Retry this unchanged action to reuse the same command ID; a different action will refresh authority state first."
              : ""),
          "error",
        )
      }
      throw error
    } finally {
      setBusy(state, false)
    }
  }

  const wire = createCaretakerManifestationEventWiring({
    clearDraft,
    confirmAction,
    escapeHtml,
    loadOlderHistory,
    mounted,
    mutate,
    saveDraft,
    setStatus,
    updateCount,
    wiredHosts,
  })

  async function mount(host, { symbol, currentUser, authResolved }) {
    if (!host) return null
    host.replaceChildren()
    host.hidden = true
    if (!authResolved || !currentUser) {
      mounted.delete(host)
      return null
    }
    const state = {
      host,
      symbol: normalizedSymbol(symbol),
      dossier: null,
      busy: false,
      basedOnRevisionId: null,
      pendingMutation: null,
    }
    mounted.set(host, state)
    host.hidden = false
    host.innerHTML =
      '<section class="icono-caretaker-panel is-loading" aria-busy="true"><p>Loading caretaker record…</p></section>'
    wire(host)
    try {
      await reload(state)
      if (!state.dossier.enabled) {
        host.hidden = true
        host.replaceChildren()
        return null
      }
      return state.dossier
    } catch (error) {
      host.innerHTML =
        '<section class="icono-caretaker-panel"><p class="icono-caretaker-status" data-tone="error">' +
        escapeHtml(String(error?.message || "Caretaker record could not be loaded.")) +
        "</p></section>"
      return null
    }
  }

  return Object.freeze({ mount })
}

export { normalizedDossier, proseValidationError }
