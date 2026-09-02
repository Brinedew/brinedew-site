import { createCaretakerManifestationEventWiring } from "./caretaker-manifestations-events.js?v=20260902-caretaker-editor-v5"
import {
  MAX_PROSE_CODE_POINTS,
  allRevisions,
  codePointLength,
  commandId,
  defaultDraftStorage,
  normalizedDossier,
  normalizedSymbol,
  ownManifestation,
  proseValidationError,
  revisionById,
} from "./caretaker-manifestations-model.js?v=20260902-caretaker-editor-v5"
import { renderCaretakerManifestationPanel } from "./caretaker-manifestations-view.js?v=20260902-caretaker-editor-v5"

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
      const value =
        prose && typeof prose === "object"
          ? { prose: String(prose.prose || ""), tags: String(prose.tags || "") }
          : { prose: String(prose || ""), tags: "" }
      storage?.setItem(draftKey(state), JSON.stringify(value))
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
      const raw = String(storage?.getItem(draftKey(state)) || "")
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          return { prose: String(parsed.prose || ""), tags: String(parsed.tags || "") }
        }
      } catch (_error) {}
      return { prose: raw, tags: "" }
    } catch (_error) {
      return null
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
      control.disabled = busy || control.hasAttribute("data-icono-caretaker-disabled")
    })
  }

  function render(state, { preserveDraft = false } = {}) {
    const existingDialog = state.host.querySelector("[data-icono-caretaker-dialog]")
    const wasOpen = existingDialog?.open === true
    const draft = preserveDraft
      ? {
          prose: String(state.host.querySelector("[data-icono-caretaker-prose]")?.value || ""),
          tags: String(state.host.querySelector("[data-icono-caretaker-tags]")?.value || ""),
        }
      : null
    state.host.innerHTML = renderCaretakerManifestationPanel(state.dossier, escapeHtml)
    const textarea = state.host.querySelector("[data-icono-caretaker-prose]")
    const tags = state.host.querySelector("[data-icono-caretaker-tags]")
    const restored = draft || restoreDraft(state)
    if (textarea && restored) {
      textarea.value = restored.prose
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    }
    if (tags && restored) {
      tags.value = restored.tags
      tags.dispatchEvent(new Event("input", { bubbles: true }))
    }
    if (!textarea && restored?.prose) mountLocalDraftRecovery(state, restored.prose)
    if (textarea) updateCount(textarea)
    initTagPills(state)
    if (state.basedOnRevisionId) showBasis(state)
    activateTab(state, state.activeTab || "manifestation")
    const dialog = state.host.querySelector("[data-icono-caretaker-dialog]")
    if (wasOpen && dialog && !dialog.open) dialog.showModal()
  }

  function activateTab(state, tab) {
    const selectedTab = new Set(["manifestation", "history", "settings"]).has(tab)
      ? tab
      : "manifestation"
    state.activeTab = selectedTab
    state.host.querySelectorAll("[data-icono-caretaker-tab]").forEach(function (button) {
      const selected = button.getAttribute("data-icono-caretaker-tab") === selectedTab
      button.setAttribute("aria-selected", selected ? "true" : "false")
      button.tabIndex = selected ? 0 : -1
    })
    state.host.querySelectorAll("[data-icono-caretaker-tabpanel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-icono-caretaker-tabpanel") !== selectedTab
    })
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

  function parseTagList(value) {
    return String(value || "")
      .split(/\r?\n|,/)
      .map(function (line) {
        return line.trim()
      })
      .filter(function (line) {
        return line.length > 0
      })
  }

  function dispatchInput(control) {
    // Tests run the panel inside linkedom documents whose Event implementation
    // differs from the Node global, so construct the event from the control's
    // own document.
    const EventCtor = control.ownerDocument?.defaultView?.Event || Event
    control.dispatchEvent(new EventCtor("input", { bubbles: true }))
  }

  function writeTagList(source, tags) {
    source.value = tags.join(", ")
    dispatchInput(source)
  }

  // The tags source stays a hidden textarea so the autosave, draft, and
  // authority flows keep reading the same control; the pills are its editor.
  function initTagPills(state) {
    const form = state.host.querySelector("[data-icono-caretaker-editor]")
    const source = form?.querySelector("[data-icono-caretaker-tags]")
    const pills = form?.querySelector("[data-icono-caretaker-pills]")
    const input = form?.querySelector("[data-icono-caretaker-tags-input]")
    const box = form?.querySelector("[data-icono-caretaker-tags-editor]")
    const count = form?.querySelector("[data-icono-caretaker-tags-count]")
    if (!source || !pills || !input) return
    const suggestions = parseTagList(source.dataset.caretakerTagsSuggestions || "")
    if (source.disabled) {
      const tags = parseTagList(source.value)
      count.textContent = `${tags.length.toLocaleString()} tag${tags.length === 1 ? "" : "s"}`
      return
    }

    function syncCount(tags) {
      if (count)
        count.textContent = `${tags.length.toLocaleString()} tag${tags.length === 1 ? "" : "s"}`
    }

    function renderPills() {
      const tags = parseTagList(source.value)
      pills.replaceChildren()
      tags.forEach(function (tag, index) {
        const item = document.createElement("li")
        item.className = "icono-caretaker-pill"
        const label = document.createElement("span")
        label.className = "icono-caretaker-pill__label"
        label.textContent = tag
        const remove = document.createElement("button")
        remove.type = "button"
        remove.className = "icono-caretaker-pill__remove"
        remove.setAttribute("aria-label", `Remove tag ${tag}`)
        remove.textContent = "×"
        remove.addEventListener("click", function () {
          const remaining = parseTagList(source.value)
          remaining.splice(index, 1)
          writeTagList(source, remaining)
          renderPills()
        })
        item.appendChild(label)
        item.appendChild(remove)
        pills.appendChild(item)
      })
      if (!tags.length) {
        const empty = document.createElement("li")
        empty.className = "icono-caretaker-pills__empty"
        empty.textContent = "No tags yet."
        pills.appendChild(empty)
      }
      syncCount(tags)
    }

    function addTags(candidates) {
      const existing = parseTagList(source.value)
      let added = false
      candidates.forEach(function (candidate) {
        const tag = String(candidate || "").trim()
        if (!tag || existing.indexOf(tag) !== -1) return
        existing.push(tag)
        added = true
      })
      if (added) writeTagList(source, existing)
      input.value = ""
      renderPills()
    }

    function addSuggestions() {
      const pending = suggestions.filter(function (tag) {
        return parseTagList(source.value).indexOf(tag) === -1
      })
      if (!pending.length) return
      addTags(pending)
    }

    function renderSuggestions() {
      const used = parseTagList(source.value)
      const pending = suggestions.filter(function (tag) {
        return used.indexOf(tag) === -1
      })
      const existingRow = box?.querySelector(".icono-caretaker-tags-suggestions")
      if (existingRow) existingRow.remove()
      if (!pending.length) return
      const row = document.createElement("div")
      row.className = "icono-caretaker-tags-suggestions"
      pending.forEach(function (tag) {
        const chip = document.createElement("button")
        chip.type = "button"
        chip.className = "icono-caretaker-tags-suggestion"
        chip.textContent = tag
        chip.addEventListener("click", function () {
          addTags([tag])
        })
        row.appendChild(chip)
      })
      box?.appendChild(row)
    }

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault()
        addTags(input.value.split(/\r?\n|,/))
        renderSuggestions()
      } else if (event.key === "Backspace" && !input.value) {
        const tags = parseTagList(source.value)
        if (!tags.length) return
        tags.pop()
        writeTagList(source, tags)
        renderPills()
        renderSuggestions()
      }
    })
    input.addEventListener("blur", function () {
      if (input.value.trim()) {
        addTags(input.value.split(/\r?\n|,/))
        renderSuggestions()
      }
    })
    input.addEventListener("paste", function (event) {
      const text = String(event.clipboardData?.getData("text") || "")
      if (!/[\r\n,]/.test(text)) return
      event.preventDefault()
      addTags(text.split(/\r?\n|,/))
      renderSuggestions()
    })
    source.addEventListener("input", renderPills)
    renderPills()
    renderSuggestions()
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
    const own = ownManifestation(state.dossier)
    const headRevision = own?.revisions?.find(function (revision) {
      return revision.manifestation_revision_id === own.manifestation_head_revision_id
    })
    const derivative = headRevision?.derivative
    if (derivative?.manifestation_derivative_id && derivative.body_available !== false) {
      try {
        const material = await request(
          state,
          `/derivatives/${encodeURIComponent(derivative.manifestation_derivative_id)}/body`,
          { method: "GET" },
        )
        own.head_tags = String(material?.tags?.tags_text || "")
      } catch (_error) {
        own.head_tags = ""
        own.tags_body_unavailable = true
      }
    } else if (!own) {
      // Fresh caretaker: prefill from the canonical manifestation this gene
      // already shows, so the editor never opens on a misleading blank page.
      const canonical = allRevisions(state.dossier).find(function (item) {
        return (
          item.revision?.manifestation_revision_id ===
          String(state.dossier.head?.canonical_revision_id || "")
        )
      })
      const canonicalDerivative = canonical?.revision?.derivative
      if (
        canonical &&
        canonicalDerivative?.manifestation_derivative_id &&
        canonicalDerivative.body_available !== false
      ) {
        try {
          const material = await request(
            state,
            `/derivatives/${encodeURIComponent(canonicalDerivative.manifestation_derivative_id)}/body`,
            { method: "GET" },
          )
          state.dossier.prefill_tags_text = String(material?.tags?.tags_text || "")
        } catch (_error) {
          state.dossier.prefill_tags_text = ""
        }
      }
    }
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

  async function retryTags(state) {
    if (state.busy) return
    setBusy(state, true)
    try {
      await reload(state)
      if (ownManifestation(state.dossier)?.tags_body_unavailable) {
        setStatus(
          state,
          "Saved Tags are still temporarily unavailable. Editing remains paused so they cannot be replaced by blank text.",
          "error",
        )
        return
      }
      setStatus(state, "Saved Tags loaded. Editing is available again.", "success")
    } catch (error) {
      setStatus(
        state,
        String(error?.message || "Saved Tags could not be loaded. Editing remains paused."),
        "error",
      )
    } finally {
      setBusy(state, false)
    }
  }

  function refreshPublicManifestation(state, result) {
    const canonicalRevisionId = String(state.dossier?.head?.canonical_revision_id || "")
    const canonicalManifestation = state.dossier?.manifestations?.find(function (manifestation) {
      return manifestation?.revisions?.some(function (revision) {
        return revision.manifestation_revision_id === canonicalRevisionId
      })
    })
    const expectation = Object.freeze({
      canonicalRevisionId,
      publicPageVisible: canonicalManifestation?.public_page_visible === true,
    })
    function refreshIfStillMounted() {
      const current = mounted.get(state.host)
      if (!current || current.symbol !== state.symbol) return null
      return onCanonicalChanged(state.symbol, expectation)
    }
    const retryDelays = [0, 1_000, 3_000, 7_000, 15_000]
    function attempt(index) {
      const run = function () {
        void Promise.resolve()
          .then(refreshIfStillMounted)
          .then(function (matchesPublishedState) {
            if (matchesPublishedState !== false || index + 1 >= retryDelays.length) return
            attempt(index + 1)
          })
          .catch(function () {
            if (index + 1 < retryDelays.length) attempt(index + 1)
          })
      }
      const delay = retryDelays[index]
      if (delay > 0) globalThis.setTimeout(run, delay)
      else run()
    }
    attempt(0)
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

  function autosaveIndicator(state, message, tone = "") {
    const target = state.host.querySelector("[data-icono-caretaker-autosave-state]")
    if (!target) return
    target.textContent = message
    target.dataset.tone = tone
  }

  function scheduleAutosave(state) {
    globalThis.clearTimeout(state.autosaveTimer)
    autosaveIndicator(state, "Unsaved changes", "pending")
    state.autosaveTimer = globalThis.setTimeout(function () {
      void autosave(state)
    }, 1100)
  }

  async function autosave(state) {
    if (state.busy) return scheduleAutosave(state)
    const proseControl = state.host.querySelector("[data-icono-caretaker-prose]")
    const tagsControl = state.host.querySelector("[data-icono-caretaker-tags]")
    if (!proseControl || !tagsControl) return
    const snapshot = {
      prose: String(proseControl.value || "")
        .normalize("NFC")
        .replace(/\r\n?/g, "\n"),
      tags: String(tagsControl.value || "")
        .normalize("NFC")
        .replace(/\r\n?/g, "\n"),
    }
    const validation = proseValidationError(snapshot.prose)
    if (validation) {
      autosaveIndicator(state, "Not saved", "error")
      return setStatus(state, validation, "error")
    }
    if (new TextEncoder().encode(snapshot.tags).byteLength > 32 * 1024 - 3) {
      autosaveIndicator(state, "Not saved", "error")
      return setStatus(state, "Keep Tags below 32 KiB.", "error")
    }
    const fingerprint = JSON.stringify(snapshot)
    if (fingerprint === state.lastSavedFingerprint) {
      autosaveIndicator(state, "Saved", "success")
      return
    }
    autosaveIndicator(state, "Saving…", "pending")
    saveDraft(state, snapshot)
    try {
      const own = ownManifestation(state.dossier)
      const revision = await mutate(
        state,
        "/revisions",
        {
          prose: snapshot.prose,
          expected_assignment_version: Number(state.dossier.assignment?.assignment_version || 0),
          expected_manifestation_version: Number(own?.row_version || 0),
          based_on_revision_id: state.basedOnRevisionId || null,
        },
        { success: "Manifestation autosaved as a new version.", preserveDraft: true },
      )
      if (!revision) return
      if (snapshot.tags.trim()) {
        const submitted = await mutate(
          state,
          `/revisions/${encodeURIComponent(revision.manifestation_revision_id)}/tags-derivatives`,
          {
            tags_text: snapshot.tags,
            expected_gene_revision: Number(state.dossier.head.gene_revision || 0),
          },
          { success: "Tags autosaved.", preserveDraft: true },
        )
        if (!submitted) return
        await mutate(
          state,
          `/revisions/${encodeURIComponent(revision.manifestation_revision_id)}/tags-derivative-head`,
          {
            manifestation_derivative_id: submitted.manifestation_derivative_id,
            expected_derivative_head_version: Number(submitted.derivative_head_version || 0),
            expected_gene_revision: Number(state.dossier.head.gene_revision || 0),
          },
          { success: "Manifestation and Tags autosaved.", preserveDraft: true },
        )
      }
      state.lastSavedFingerprint = fingerprint
      state.basedOnRevisionId = null
      const current = {
        prose: String(state.host.querySelector("[data-icono-caretaker-prose]")?.value || ""),
        tags: String(state.host.querySelector("[data-icono-caretaker-tags]")?.value || ""),
      }
      if (JSON.stringify(current) === fingerprint) clearDraft(state)
      autosaveIndicator(state, "Saved", "success")
    } catch (_error) {
      autosaveIndicator(state, "Not saved — retrying", "error")
      scheduleAutosave(state)
    }
  }

  const wire = createCaretakerManifestationEventWiring({
    clearDraft,
    confirmAction,
    escapeHtml,
    loadOlderHistory,
    mounted,
    mutate,
    retryTags,
    scheduleAutosave,
    saveDraft,
    setStatus,
    showBasis,
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
      activeTab: "manifestation",
      autosaveTimer: null,
      lastSavedFingerprint: null,
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

  function open(host) {
    const dialog = host?.querySelector?.("[data-icono-caretaker-dialog]")
    if (!dialog) return false
    if (!dialog.open) dialog.showModal()
    return true
  }

  return Object.freeze({ mount, open })
}

export { normalizedDossier, proseValidationError }
