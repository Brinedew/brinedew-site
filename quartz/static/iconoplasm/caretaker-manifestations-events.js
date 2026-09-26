import {
  ownManifestation,
  revisionById,
} from "./caretaker-manifestations-model.js?v=fcee998f5b583a90"
import { historyPreviewMarkup } from "./caretaker-manifestations-view.js?v=a88fd2bfc61bf773"

export function createCaretakerManifestationEventWiring({
  clearDraft,
  confirmAction,
  escapeHtml,
  loadOlderHistory,
  mounted,
  mutate,
  retryTags,
  retrySave,
  scheduleAutosave,
  saveDraft,
  setStatus,
  showBasis,
  updateCount,
  wiredHosts,
} = {}) {
  function wire(host) {
    if (wiredHosts.has(host)) return
    wiredHosts.add(host)
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
      if (target.hasAttribute("data-icono-caretaker-close")) {
        target.closest("dialog")?.close()
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
        if (preview) preview.outerHTML = historyPreviewMarkup(state.dossier, versionId, escapeHtml)
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
      const revisionId = target.getAttribute("data-icono-caretaker-select")
      if (revisionId) {
        void mutate(
          state,
          "/canonical-selections",
          {
            manifestation_id: target.getAttribute("data-manifestation-id"),
            manifestation_revision_id: revisionId,
            expected_assignment_version: Number(state.dossier.assignment?.assignment_version || 0),
            expected_head_version: state.dossier.head.head_version,
            expected_canonical_revision_id: state.dossier.head.canonical_revision_id || null,
          },
          { success: "Canonical manifestation changed.", refreshPublic: true },
        ).catch(function () {})
        return
      }
      const manifestationId = target.getAttribute("data-icono-caretaker-withdraw")
      if (manifestationId) {
        const manifestation = state.dossier.manifestations.find(function (item) {
          return item.manifestation_id === manifestationId
        })
        const fallback = String(
          manifestation?.withdrawal_preview?.fallback_label || "the next eligible version",
        )
        if (
          !confirmAction(
            `Delete this manifestation lineage (${manifestation?.revisions?.length || 0} versions)? It will be withdrawn immediately, ${fallback} will become canonical, and its encrypted body will become eligible for hard purge after 30 days unless a legal hold applies.`,
          )
        )
          return
        void mutate(
          state,
          `/manifestations/${encodeURIComponent(manifestationId)}`,
          {
            expected_assignment_version: Number(state.dossier.assignment?.assignment_version || 0),
            expected_manifestation_version: Number(manifestation?.row_version || 0),
            expected_head_version: state.dossier.head.head_version,
            expected_canonical_revision_id: state.dossier.head.canonical_revision_id || null,
          },
          {
            method: "DELETE",
            success: "The manifestation was withdrawn.",
            refreshPublic: true,
          },
        ).catch(function () {})
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
      const restoreManifestationId = target.getAttribute("data-icono-caretaker-restore")
      if (restoreManifestationId) {
        const manifestation = state.dossier.manifestations.find(function (item) {
          return item.manifestation_id === restoreManifestationId
        })
        void mutate(
          state,
          `/manifestations/${encodeURIComponent(restoreManifestationId)}/restore`,
          {
            expected_assignment_version: Number(state.dossier.assignment?.assignment_version || 0),
            expected_manifestation_version: Number(manifestation?.row_version || 0),
            expected_head_version: state.dossier.head.head_version,
            expected_canonical_revision_id: state.dossier.head.canonical_revision_id || null,
          },
          {
            success: "The manifestation was restored and made canonical.",
            refreshPublic: true,
          },
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
      const own = ownManifestation(state.dossier)
      if (!own) return
      void mutate(
        state,
        `/manifestations/${encodeURIComponent(own.manifestation_id)}/page-visibility`,
        {
          visible: control.checked,
          expected_assignment_version: Number(state.dossier.assignment?.assignment_version || 0),
          expected_manifestation_version: Number(own.row_version || 0),
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
