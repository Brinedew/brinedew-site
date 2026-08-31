;(function caretakerAdminDetailModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared) {
    throw new Error("Caretaker admin shared module must load before the detail module.")
  }
  var shared = modules.shared

  function createDetailController(context, dependencies) {
    function fact(label, value) {
      var wrapper = shared.element("div")
      shared.append(
        wrapper,
        shared.element("dt", "", label),
        shared.element(
          "dd",
          "",
          value === null || value === undefined || value === "" ? "—" : value,
        ),
      )
      return wrapper
    }

    function consequence(text, tone) {
      var paragraph = shared.element("p", "caretaker-admin__consequence", text)
      if (tone) paragraph.dataset.tone = tone
      return paragraph
    }

    function commandLabel(actionKey, normalLabel) {
      return context.state.commandIds.has(actionKey) ? "Retry the same command" : normalLabel
    }

    async function performMutation(actionKey, path, body, button, acceptedMessage) {
      var commandId = context.state.commandIds.get(actionKey)
      if (!commandId) {
        commandId = shared.secureCommandId()
        context.state.commandIds.set(actionKey, commandId)
      }
      if (button) {
        button.disabled = true
        button.setAttribute("aria-busy", "true")
      }
      shared.setStatus(context, "Submitting one idempotent authority command.", "info")
      try {
        var result = await shared.request(context, path, {
          method: "POST",
          body: Object.assign({}, body, { command_id: commandId }),
          timeoutMs: 30_000,
        })
        context.state.commandIds.delete(actionKey)
        await dependencies.loadRegistry()
        shared.setStatus(
          context,
          acceptedMessage +
            (result.projection_pending
              ? " The command is accepted; the read projection is catching up."
              : ""),
          result.projection_pending ? "info" : "ok",
        )
        return result
      } catch (error) {
        var uncertain = !(error instanceof shared.AuthorityHttpError) || Number(error.status) >= 500
        if (!uncertain) context.state.commandIds.delete(actionKey)
        if (error instanceof shared.AuthorityHttpError && error.status === 409) {
          await dependencies.loadRegistry()
        }
        shared.setStatus(
          context,
          shared.readableError(error) +
            (uncertain
              ? " The outcome is uncertain. Retry from this unchanged control to reuse the same command ID; do not issue a second action."
              : " The authority rejected the command without applying it."),
          "danger",
        )
        return null
      } finally {
        if (button) {
          button.disabled = false
          button.removeAttribute("aria-busy")
        }
        dependencies.renderOfferState()
        render()
      }
    }

    function actionButton(label, className) {
      var button = shared.element("button", className || "", label)
      button.type = "submit"
      return button
    }

    function render() {
      var refs = context.refs
      var state = context.state
      if (!refs.detail) return
      var assignment = state.registry.find(function findSelected(row) {
        return row.caretaker_assignment_id === state.selectedAssignmentId
      })
      if (!assignment) {
        shared.replace(
          refs.detail,
          shared.element("h3", "", "Select an assignment"),
          shared.element(
            "p",
            "small",
            "Lifecycle controls appear here with their exact consequence and current compare-and-swap version.",
          ),
        )
        return
      }

      var heading = shared.element(
        "h3",
        "",
        (assignment.canonical_symbol || assignment.gene_id) + " caretaker",
      )
      var subtitle = shared.element(
        "p",
        "caretaker-admin__detail-label",
        assignment.author_label || "Anonymous account",
      )
      var facts = shared.element("dl", "caretaker-admin__facts")
      shared.append(
        facts,
        fact("Status", shared.statusLabel(assignment.status)),
        fact("Assignment version", assignment.assignment_version),
        fact("Gene revision", assignment.gene_revision),
        fact("Head version", assignment.head_version),
        fact("Departure policy", assignment.relinquish_policy || "Not chosen"),
        fact("Canonical revision", assignment.canonical_revision_id || "None"),
        fact("Terms", assignment.terms_version_id || "Not accepted"),
      )
      var controls = shared.element("div", "caretaker-admin__controls")

      if (assignment.status === "pending_acceptance") {
        var cancelKey =
          "cancel:" + assignment.caretaker_assignment_id + ":" + assignment.assignment_version
        var cancelForm = shared.element("form", "caretaker-admin__action")
        shared.append(
          cancelForm,
          shared.element("h4", "", "Cancel invitation"),
          consequence(
            "The account will no longer be able to accept this invitation. No manifestation is deleted.",
            "warning",
          ),
        )
        var cancelButton = actionButton(commandLabel(cancelKey, "Cancel invitation"), "secondary")
        cancelForm.appendChild(cancelButton)
        cancelForm.addEventListener("submit", function cancelInvitation(event) {
          event.preventDefault()
          performMutation(
            cancelKey,
            "/assignments/" + encodeURIComponent(assignment.caretaker_assignment_id) + "/cancel",
            { expected_assignment_version: assignment.assignment_version },
            cancelButton,
            "Invitation cancelled.",
          )
        })
        controls.appendChild(cancelForm)
      }

      if (assignment.status === "active") {
        var suspendKey =
          "suspend:" + assignment.caretaker_assignment_id + ":" + assignment.assignment_version
        var suspendForm = shared.element("form", "caretaker-admin__action")
        shared.append(
          suspendForm,
          shared.element("h4", "", "Suspend caretaker access"),
          consequence(
            "The caretaker immediately loses write and selection authority. Existing public manifestations remain unchanged until you end the tenure.",
            "warning",
          ),
        )
        var suspendReasonLabel = shared.element("label", "", "Reason")
        var suspendReason = shared.element("textarea")
        suspendReason.required = true
        suspendReason.maxLength = 500
        suspendReason.rows = 3
        suspendReasonLabel.appendChild(suspendReason)
        var graceLabel = shared.element("label", "", "Optional grace end")
        var grace = shared.element("input")
        grace.type = "datetime-local"
        graceLabel.appendChild(grace)
        var suspendButton = actionButton(commandLabel(suspendKey, "Suspend access"), "secondary")
        shared.append(suspendForm, suspendReasonLabel, graceLabel, suspendButton)
        suspendForm.addEventListener("submit", function suspendAssignment(event) {
          event.preventDefault()
          var reason = suspendReason.value.trim()
          if (!reason) return suspendReason.focus()
          var graceEndsAt = grace.value ? new Date(grace.value).toISOString() : null
          performMutation(
            suspendKey,
            "/assignments/" + encodeURIComponent(assignment.caretaker_assignment_id) + "/suspend",
            {
              expected_assignment_version: assignment.assignment_version,
              suspension_reason: reason,
              grace_ends_at: graceEndsAt,
            },
            suspendButton,
            "Caretaker access suspended.",
          )
        })
        controls.appendChild(suspendForm)
      }

      if (assignment.status === "suspended") {
        var resumeKey =
          "resume:" + assignment.caretaker_assignment_id + ":" + assignment.assignment_version
        var resumeForm = shared.element("form", "caretaker-admin__action")
        shared.append(
          resumeForm,
          shared.element("h4", "", "Resume caretaker access"),
          consequence(
            "The same tenure regains write and selection authority. Its accepted terms and departure policy do not change.",
            "ok",
          ),
        )
        var resumeButton = actionButton(commandLabel(resumeKey, "Resume access"), "secondary")
        resumeForm.appendChild(resumeButton)
        resumeForm.addEventListener("submit", function resumeAssignment(event) {
          event.preventDefault()
          performMutation(
            resumeKey,
            "/assignments/" + encodeURIComponent(assignment.caretaker_assignment_id) + "/resume",
            { expected_assignment_version: assignment.assignment_version },
            resumeButton,
            "Caretaker access resumed.",
          )
        })
        controls.appendChild(resumeForm)
      }

      if (assignment.status === "active" || assignment.status === "suspended") {
        var endKey =
          "end:" + assignment.caretaker_assignment_id + ":" + assignment.assignment_version
        var endForm = shared.element(
          "form",
          "caretaker-admin__action caretaker-admin__action--danger",
        )
        shared.append(
          endForm,
          shared.element("h4", "", "End this caretaker tenure"),
          consequence(
            "This is a final role change. Choose what happens to manifestations authored during this tenure; the authority records that choice with the end event.",
            "danger",
          ),
        )
        var policyGroup = shared.element("fieldset", "caretaker-admin__policy-choice")
        policyGroup.appendChild(shared.element("legend", "", "Manifestations after departure"))
        ;[
          [
            "retain",
            "Keep them",
            "They remain eligible for canonical selection and the former caretaker may still withdraw their own lineage.",
          ],
          [
            "withdraw",
            "Withdraw them",
            "They leave public and canonical eligibility, but immutable history and moderation records remain.",
          ],
        ].forEach(function addPolicy(option) {
          var label = shared.element("label")
          var input = shared.element("input")
          input.type = "radio"
          input.name = "caretaker-relinquish-policy"
          input.value = option[0]
          input.required = true
          var copy = shared.element("span")
          shared.append(
            copy,
            shared.element("strong", "", option[1]),
            shared.element("small", "", option[2]),
          )
          shared.append(label, input, copy)
          policyGroup.appendChild(label)
        })
        var endReasonLabel = shared.element("label", "", "Reason")
        var endReason = shared.element("textarea")
        endReason.required = true
        endReason.maxLength = 500
        endReason.rows = 3
        endReasonLabel.appendChild(endReason)
        var endButton = actionButton(commandLabel(endKey, "End caretaker tenure"), "danger")
        shared.append(endForm, policyGroup, endReasonLabel, endButton)
        endForm.addEventListener("submit", function endAssignment(event) {
          event.preventDefault()
          var selectedPolicy = Array.from(
            endForm.querySelectorAll("input[name='caretaker-relinquish-policy']"),
          ).find(function findSelectedPolicy(input) {
            return input.checked
          })
          var reason = endReason.value.trim()
          if (!selectedPolicy) return policyGroup.focus()
          if (!reason) return endReason.focus()
          performMutation(
            endKey,
            "/assignments/" + encodeURIComponent(assignment.caretaker_assignment_id) + "/end",
            {
              expected_assignment_version: assignment.assignment_version,
              expected_head_version: assignment.head_version,
              expected_canonical_revision_id: assignment.canonical_revision_id || null,
              relinquish_policy: selectedPolicy.value,
              reason: reason,
            },
            endButton,
            "Caretaker tenure ended with the recorded manifestation policy.",
          )
        })
        controls.appendChild(endForm)
      }

      if (!controls.childNodes.length) {
        controls.appendChild(
          consequence(
            "This tenure is closed. Its immutable history remains available for audit.",
            "info",
          ),
        )
      }
      shared.replace(refs.detail, heading, subtitle, facts, controls)
    }

    return Object.freeze({
      commandLabel: commandLabel,
      performMutation: performMutation,
      render: render,
    })
  }

  modules.detail = Object.freeze({ create: createDetailController })
})(window)
