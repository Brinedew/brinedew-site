import { revisionById } from "./caretaker-manifestations-model.js?v=de638e47ba183354"
import { historyPreviewMarkup } from "./caretaker-manifestations-view.js?v=4d68b4ca5075c217"

export function createCaretakerManifestationEventWiring({
  clearDraft,
  confirmAction,
  escapeHtml,
  loadOlderHistory,
  mounted,
  mutate,
  retryAfterReconnect,
  retryTags,
  retrySave,
  scheduleAutosave,
  saveDraft,
  keepReview,
  undoReview,
  taggerize,
  setStatus,
  showBasis,
  updateCount,
  wiredHosts,
} = {}) {
  function wire(host) {
    if (wiredHosts.has(host)) return
    wiredHosts.add(host)
    // B-874: a save that failed because the network dropped resumes on reconnect.
    host.ownerDocument?.defaultView?.addEventListener?.("online", function () {
      const state = mounted.get(host)
      if (state) void retryAfterReconnect(state)
    })
    host.addEventListener("input", function (event) {
      const state = mounted.get(host)
      if (!state) return
      const termsAcceptance = state.host.querySelector("[data-icono-caretaker-terms-accepted]")
      if (event.target.closest?.("[data-icono-caretaker-terms-accepted]")) {
        const accept = state.host.querySelector("[data-icono-caretaker-accept]")
        if (accept) {
          accept.disabled = termsAcceptance?.checked !== true || state.busy
        }
        return
      }
      const prose = event.target.closest?.("[data-icono-caretaker-prose]")
      const tags = event.target.closest?.("[data-icono-caretaker-tags]")
      if (!prose && !tags) return
      const form = event.target.closest("[data-icono-caretaker-editor]")
      const proseControl = form?.querySelector("[data-icono-caretaker-prose]")
      const tagsControl = form?.querySelector("[data-icono-caretaker-tags]")
      if (proseControl) updateCount(proseControl)
      saveDraft(state, {
        prose: String(proseControl?.value || ""),
        tags: String(tagsControl?.value || ""),
      })
      scheduleAutosave(state)
    })
    host.addEventListener("click", function (event) {
      const state = mounted.get(host)
      if (!state) return
      const target = event.target.closest?.("button")
      if (!target) return
      if (target.hasAttribute("data-icono-caretaker-retry-save")) {
        void retrySave(state)
        return
      }
      const direction = target.getAttribute("data-icono-caretaker-taggerize")
      if (direction) {
        void taggerize(state, direction)
        return
      }
      if (target.hasAttribute("data-icono-caretaker-review-keep")) {
        keepReview(state)
        return
      }
      if (target.hasAttribute("data-icono-caretaker-review-undo")) {
        undoReview(state)
        return
      }
      if (target.hasAttribute("data-icono-caretaker-retry-tags")) {
        void retryTags(state)
        return
      }
      const tab = target.getAttribute("data-icono-caretaker-tab")
      if (tab) {
        state.activeTab = tab
        state.host.querySelectorAll("[data-icono-caretaker-tab]").forEach(function (button) {
          const selected = button.getAttribute("data-icono-caretaker-tab") === tab
          button.setAttribute("aria-selected", selected ? "true" : "false")
          button.tabIndex = selected ? 0 : -1
        })
        state.host.querySelectorAll("[data-icono-caretaker-tabpanel]").forEach(function (panel) {
          panel.hidden = panel.getAttribute("data-icono-caretaker-tabpanel") !== tab
        })
        return
      }
      const versionId = target.getAttribute("data-icono-caretaker-version")
      if (versionId) {
        state.selectedRevisionId = versionId
        state.host.querySelectorAll("[data-icono-caretaker-version]").forEach(function (item) {
          if (item.getAttribute("data-icono-caretaker-version") === versionId) {
            item.setAttribute("aria-current", "true")
          } else item.removeAttribute("aria-current")
        })
        const preview = state.host.querySelector("[data-icono-caretaker-preview]")
        if (preview) {
          preview.outerHTML = historyPreviewMarkup(state.dossier, versionId, escapeHtml)
        }
        return
      }
      const forkRevisionId = target.getAttribute("data-icono-caretaker-fork")
      if (forkRevisionId) {
        const selected = revisionById(state.dossier, forkRevisionId)
        const textarea = state.host.querySelector("[data-icono-caretaker-prose]")
        if (!selected || !textarea) return
        state.basedOnRevisionId = forkRevisionId
        state.host.querySelector('[data-icono-caretaker-tab="manifestation"]')?.click()
        textarea.value = String(selected.revision.body || "")
        saveDraft(state, {
          prose: textarea.value,
          tags: String(state.host.querySelector("[data-icono-caretaker-tags]")?.value || ""),
        })
        updateCount(textarea)
        showBasis(state)
        textarea.focus()
        scheduleAutosave(state)
        return
      }
      if (target.hasAttribute("data-icono-caretaker-history-more")) {
        void loadOlderHistory(state)
        return
      }
      if (target.hasAttribute("data-icono-caretaker-remove-draft")) {
        if (!confirmAction("Remove this unsaved caretaker draft from this device?")) return
        clearDraft(state)
        target.closest(".icono-caretaker-draft-recovery")?.remove()
        setStatus(state, "Unsaved draft removed from this device.", "success")
        return
      }
      if (target.hasAttribute("data-icono-caretaker-accept")) {
        const terms = state.dossier.assignment?.terms
        const termsAccepted = state.host.querySelector(
          "[data-icono-caretaker-terms-accepted]",
        )?.checked
        if (!terms?.terms_version_id || termsAccepted !== true) {
          setStatus(state, "Read and accept the displayed caretaker terms first.", "error")
          return
        }
        void mutate(
          state,
          `/assignments/${encodeURIComponent(state.dossier.assignment.caretaker_assignment_id)}/accept`,
          {
            expected_assignment_version: Number(state.dossier.assignment.assignment_version || 0),
            terms_version_id: terms.terms_version_id,
            terms_accepted: true,
          },
          { success: `You are now the caretaker of ${state.symbol}.` },
        ).catch(function () {})
        return
      }
      if (target.hasAttribute("data-icono-caretaker-decline")) {
        if (!confirmAction(`Decline the invitation to care for ${state.symbol}?`)) return
        void mutate(
          state,
          `/assignments/${encodeURIComponent(state.dossier.assignment.caretaker_assignment_id)}/decline`,
          {
            expected_assignment_version: Number(state.dossier.assignment.assignment_version || 0),
          },
          { success: `Caretaker invitation for ${state.symbol} declined.` },
        ).catch(function () {})
        return
      }
      if (target.hasAttribute("data-icono-caretaker-end")) {
        if (!confirmAction(`Stop being caretaker of ${state.symbol}?`)) return
        void mutate(
          state,
          `/assignments/${encodeURIComponent(state.dossier.assignment.caretaker_assignment_id)}/end`,
          {
            expected_assignment_version: Number(state.dossier.assignment.assignment_version || 0),
            expected_head_version: state.dossier.head.head_version,
            expected_canonical_revision_id: state.dossier.head.canonical_revision_id || null,
          },
          {
            success: "Caretaker role ended.",
            refreshPublic: true,
          },
        ).catch(function () {})
      }
    })
    host.addEventListener("change", function (event) {
      const state = mounted.get(host)
      const control = event.target.closest?.("[data-icono-caretaker-visibility]")
      if (!state || !control) return
      // B-1106: the text the gene uses now, whoever wrote it.
      const currentId = state.dossier.head?.manifestation_id
      if (!currentId) return
      const current = (state.dossier.manifestations || []).find(
        (item) => item.manifestation_id === currentId,
      )
      void mutate(
        state,
        `/manifestations/${encodeURIComponent(currentId)}/page-visibility`,
        {
          visible: control.checked,
          expected_assignment_version: Number(state.dossier.assignment?.assignment_version || 0),
          expected_manifestation_version: Number(current?.row_version || 0),
          expected_gene_revision: Number(state.dossier.head.gene_revision || 0),
        },
        {
          success: control.checked
            ? "Manifestation text is visible on the gene page."
            : "Manifestation text is hidden from the gene page.",
          refreshPublic: true,
        },
      ).catch(function () {})
    })
  }
  return wire
}
