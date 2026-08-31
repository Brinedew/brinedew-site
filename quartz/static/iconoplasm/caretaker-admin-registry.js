;(function caretakerAdminRegistryModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared) {
    throw new Error("Caretaker admin shared module must load before the registry module.")
  }
  var shared = modules.shared

  function createRegistryController(context, dependencies) {
    function renderPolicy() {
      var refs = context.refs
      var state = context.state
      if (!refs.policy) return
      if (!state.entitlementPolicyVersion) {
        refs.policy.textContent = "Policy unavailable. Invitations are disabled."
        refs.policy.dataset.tone = "danger"
        return
      }
      var currentTerms = state.terms.find(shared.isActiveTerms)
      if (!currentTerms) {
        refs.policy.textContent = state.entitlementPolicyVersion + " · no active terms"
        refs.policy.dataset.tone = "danger"
        return
      }
      var policyName = shared.element("strong", "", state.entitlementPolicyVersion)
      var termsLabel = currentTerms.display_label || currentTerms.terms_version_id
      var termsDocument = currentTerms.document_url
        ? shared.element("a", "", termsLabel)
        : shared.element("span", "", termsLabel)
      if (currentTerms.document_url) {
        termsDocument.href = currentTerms.document_url
        termsDocument.target = "_blank"
        termsDocument.rel = "noopener noreferrer"
      }
      var termsHash = shared.element(
        "span",
        "caretaker-admin__policy-hash",
        "SHA-256 " + currentTerms.document_sha256,
      )
      shared.replace(refs.policy, policyName, termsDocument, termsHash)
      refs.policy.dataset.tone = "ok"
    }

    async function loadTerms() {
      var state = context.state
      try {
        var payload = await shared.request(context, "/terms")
        state.entitlementPolicyVersion = String(payload.entitlement_policy_version || "").trim()
        state.terms = Array.isArray(payload.terms) ? payload.terms.slice() : []
        if (!state.entitlementPolicyVersion) {
          throw new Error("The authority did not declare an entitlement policy version.")
        }
        renderPolicy()
        dependencies.renderOfferState()
      } catch (error) {
        state.entitlementPolicyVersion = ""
        state.terms = []
        renderPolicy()
        dependencies.renderOfferState()
        shared.setStatus(context, shared.readableError(error), "danger")
      }
    }

    function registryUrl(after) {
      var params = new URLSearchParams()
      var refs = context.refs
      var queryValue = refs.registryQuery ? String(refs.registryQuery.value || "").trim() : ""
      var statusValue = refs.registryStatus ? String(refs.registryStatus.value || "").trim() : ""
      if (queryValue) params.set("query", queryValue)
      if (statusValue) params.set("status", statusValue)
      params.set("limit", "50")
      if (after) params.set("after", after)
      return "/registry?" + params.toString()
    }

    async function load(options) {
      var appendResults = Boolean(options && options.append)
      var state = context.state
      var refs = context.refs
      var sequence = ++state.registryRequestSequence
      var after = appendResults ? state.nextCursor : ""
      if (refs.refresh) refs.refresh.disabled = true
      if (refs.registryMore) refs.registryMore.disabled = true
      if (!appendResults) shared.setStatus(context, "Loading the caretaker registry.", "info")
      try {
        var payload = await shared.request(context, registryUrl(after))
        if (!context.mounted || sequence !== state.registryRequestSequence) return
        var assignments = Array.isArray(payload.assignments) ? payload.assignments : []
        if (appendResults) {
          var byId = new Map(
            state.registry.map(function key(row) {
              return [row.caretaker_assignment_id, row]
            }),
          )
          assignments.forEach(function merge(row) {
            byId.set(row.caretaker_assignment_id, row)
          })
          state.registry = Array.from(byId.values())
        } else {
          state.registry = assignments
        }
        state.nextCursor = String(payload.next_cursor || "")
        if (
          state.selectedAssignmentId &&
          !state.registry.some(function selectedStillVisible(row) {
            return row.caretaker_assignment_id === state.selectedAssignmentId
          })
        ) {
          state.selectedAssignmentId = ""
        }
        render()
        dependencies.renderDetail()
        shared.setStatus(
          context,
          state.registry.length
            ? "Registry current: " +
                state.registry.length +
                " assignment" +
                (state.registry.length === 1 ? "" : "s") +
                "."
            : "No caretaker assignments match these filters.",
          "ok",
        )
      } catch (error) {
        if (context.mounted && sequence === state.registryRequestSequence) {
          shared.setStatus(context, shared.readableError(error), "danger")
        }
      } finally {
        if (context.mounted && sequence === state.registryRequestSequence) {
          if (refs.refresh) refs.refresh.disabled = false
          if (refs.registryMore) refs.registryMore.disabled = false
        }
      }
    }

    function render() {
      var refs = context.refs
      var state = context.state
      if (!refs.registryBody) return
      if (!state.registry.length) {
        var emptyRow = shared.element("tr")
        var emptyCell = shared.element(
          "td",
          "caretaker-admin__empty",
          "No assignments match these filters.",
        )
        emptyCell.colSpan = 6
        emptyRow.appendChild(emptyCell)
        shared.replace(refs.registryBody, emptyRow)
      } else {
        var rows = state.registry.map(function renderAssignment(assignment) {
          var row = shared.element("tr")
          row.dataset.selected =
            assignment.caretaker_assignment_id === state.selectedAssignmentId ? "true" : "false"
          shared.append(
            row,
            shared.element(
              "td",
              "caretaker-admin__gene",
              assignment.canonical_symbol || assignment.gene_id,
            ),
            shared.element("td", "", assignment.author_label || "Anonymous account"),
          )
          var statusCell = shared.element("td")
          statusCell.appendChild(
            shared.element("span", "caretaker-admin__badge", shared.statusLabel(assignment.status)),
          )
          statusCell.firstChild.dataset.status = String(assignment.status || "")
          row.appendChild(statusCell)
          row.appendChild(
            shared.element(
              "td",
              "caretaker-admin__mono",
              assignment.entitlement_policy_version || "—",
            ),
          )
          row.appendChild(
            shared.element(
              "td",
              "",
              shared.formatDate(assignment.started_at || assignment.created_at),
            ),
          )
          var actionCell = shared.element("td")
          var selectButton = shared.element(
            "button",
            "secondary caretaker-admin__select",
            "Inspect",
          )
          selectButton.type = "button"
          selectButton.setAttribute(
            "aria-label",
            "Inspect " +
              (assignment.canonical_symbol || assignment.gene_id) +
              " caretaker assignment",
          )
          selectButton.addEventListener("click", function selectAssignment() {
            state.selectedAssignmentId = assignment.caretaker_assignment_id
            render()
            dependencies.renderDetail()
          })
          actionCell.appendChild(selectButton)
          row.appendChild(actionCell)
          return row
        })
        shared.replace.apply(null, [refs.registryBody].concat(rows))
      }
      if (refs.registryMore) refs.registryMore.hidden = !state.nextCursor
    }

    return Object.freeze({
      load: load,
      loadTerms: loadTerms,
      render: render,
      renderPolicy: renderPolicy,
    })
  }

  modules.registry = Object.freeze({ create: createRegistryController })
})(window)
