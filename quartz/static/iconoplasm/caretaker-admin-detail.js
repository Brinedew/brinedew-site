;(function caretakerAdminDetailModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared) {
    throw new Error("Caretaker admin shared module must load before the detail module.")
  }
  var shared = modules.shared
  var SVG = "http://www.w3.org/2000/svg"
  // The caretaker panel's own mark and words for the text new images are drawn
  // from (caretaker-manifestations-view.js, SOURCE_MARK).
  var SOURCE_LABEL = "New images are drawn from this version"
  var characters = new Intl.NumberFormat("en")

  function createDetailController(context, dependencies) {
    function sourceMark() {
      var mark = document.createElementNS(SVG, "svg")
      mark.setAttribute("viewBox", "0 0 24 24")
      mark.setAttribute("class", "caretaker-admin__source-mark")
      mark.setAttribute("role", "img")
      mark.setAttribute("aria-label", SOURCE_LABEL)
      var title = document.createElementNS(SVG, "title")
      title.textContent = SOURCE_LABEL
      var frame = document.createElementNS(SVG, "rect")
      frame.setAttribute("x", "3.5")
      frame.setAttribute("y", "5")
      frame.setAttribute("width", "17")
      frame.setAttribute("height", "14")
      frame.setAttribute("rx", "2")
      var hills = document.createElementNS(SVG, "path")
      hills.setAttribute("d", "m3.5 16 5-5 4 4 3-3 5 5")
      var sun = document.createElementNS(SVG, "circle")
      sun.setAttribute("cx", "15.5")
      sun.setAttribute("cy", "9.5")
      sun.setAttribute("r", "1.4")
      shared.append(mark, title, frame, hills, sun)
      return mark
    }

    function textRow(title, count, options) {
      var row = shared.element("li", "caretaker-admin__text")
      if (options.source) row.dataset.source = "true"
      var name = shared.element("span", "caretaker-admin__text-name", title)
      if (options.author) name.appendChild(shared.element("small", "", options.author))
      shared.append(
        row,
        name,
        shared.element(
          "span",
          "caretaker-admin__text-size",
          count ? characters.format(count) + " characters" : "",
        ),
      )
      if (options.withdrawn) {
        var tag = shared.element("span", "caretaker-admin__badge", "Withdrawn")
        tag.dataset.status = "withdrawn"
        row.appendChild(tag)
      }
      if (options.source) row.appendChild(sourceMark())
      return row
    }

    // The role's newest version, the version new images are drawn from (when it
    // is another one), and the Original, so a cut text shows against the full one.
    function textsList(assignment) {
      var versions = assignment.versions || {}
      var newest = versions.newest
      var source = assignment.drawn_from || { kind: "original" }
      var list = shared.element("ol", "caretaker-admin__texts")
      var sourceIsOwnNewest =
        source.kind === "version" && source.own && newest && source.number === newest.number
      if (source.kind === "version" && !sourceIsOwnNewest) {
        list.appendChild(
          textRow("Version " + source.number, source.characters, {
            source: true,
            author: source.own ? "" : source.author_label,
          }),
        )
      }
      if (newest) {
        list.appendChild(
          textRow("Version " + newest.number, newest.characters, {
            source: sourceIsOwnNewest,
            withdrawn: versions.total > 0 && versions.kept === 0,
          }),
        )
      }
      list.appendChild(
        textRow("Original", assignment.original_characters, { source: source.kind === "original" }),
      )
      return list
    }

    function versionsLabel(verb, count) {
      return verb + " " + count + " version" + (count === 1 ? "" : "s")
    }

    async function performMutation(path, body, button, acceptedMessage) {
      if (button) {
        button.disabled = true
        button.setAttribute("aria-busy", "true")
      }
      shared.setStatus(context, "", "info")
      try {
        var result = await shared.request(context, path, {
          method: "POST",
          body: body,
          timeoutMs: 30_000,
        })
        await dependencies.loadRegistry()
        shared.setStatus(context, acceptedMessage, "ok")
        return result
      } catch (error) {
        if (error instanceof shared.AuthorityHttpError && error.status === 409) {
          await dependencies.loadRegistry()
        }
        shared.setStatus(context, shared.readableError(error), "danger")
        return null
      } finally {
        if (button) {
          button.disabled = false
          button.removeAttribute("aria-busy")
        }
        render()
      }
    }

    function actionButton(label, className) {
      var button = shared.element("button", className || "", label)
      button.type = "submit"
      return button
    }

    function assignmentPath(assignment, action) {
      return "/assignments/" + encodeURIComponent(assignment.caretaker_assignment_id) + "/" + action
    }

    function reasonField(label) {
      var wrapper = shared.element("label", "", label)
      var input = shared.element("textarea")
      input.required = true
      input.maxLength = 500
      input.rows = 3
      wrapper.appendChild(input)
      return { wrapper: wrapper, input: input }
    }

    function render() {
      var refs = context.refs
      var state = context.state
      if (!refs.detail) return
      var assignment = state.registry.find(function findSelected(row) {
        return row.caretaker_assignment_id === state.selectedAssignmentId
      })
      if (!assignment) {
        shared.replace(refs.detail, shared.element("h3", "", "Select a caretaker"))
        return
      }

      var symbol = assignment.canonical_symbol || assignment.gene_id
      var heading = shared.element("h3", "caretaker-admin__detail-heading")
      var geneLink = shared.element("a", "", symbol)
      geneLink.href = "/gene/" + encodeURIComponent(symbol)
      var badge = shared.element(
        "span",
        "caretaker-admin__badge",
        shared.statusLabel(assignment.status),
      )
      badge.dataset.status = String(assignment.status || "")
      shared.append(heading, geneLink, badge)
      var started = assignment.started_at || assignment.created_at
      var subtitle = shared.element(
        "p",
        "caretaker-admin__detail-label",
        (assignment.author_label || "Anonymous account") +
          " · " +
          shared.formatDay(started) +
          (assignment.ended_at ? " – " + shared.formatDay(assignment.ended_at) : ""),
      )
      var controls = shared.element("div", "caretaker-admin__controls")
      var version = assignment.assignment_version
      var kept = Number(assignment.versions && assignment.versions.kept) || 0
      var author = assignment.author_label || "Anonymous account"

      if (assignment.status === "pending_acceptance") {
        var cancelForm = shared.element("form", "caretaker-admin__action")
        var cancelButton = actionButton("Cancel invitation", "secondary")
        cancelForm.appendChild(cancelButton)
        cancelForm.addEventListener("submit", function cancelInvitation(event) {
          event.preventDefault()
          performMutation(
            assignmentPath(assignment, "cancel"),
            { expected_assignment_version: version },
            cancelButton,
            "Invitation cancelled.",
          )
        })
        controls.appendChild(cancelForm)
      }

      if (assignment.status === "active") {
        var suspendForm = shared.element("form", "caretaker-admin__action")
        suspendForm.appendChild(shared.element("h4", "", "Suspend caretaker access"))
        var suspendReason = reasonField("Reason")
        var graceLabel = shared.element("label", "", "Optional grace end")
        var grace = shared.element("input")
        grace.type = "datetime-local"
        graceLabel.appendChild(grace)
        var suspendButton = actionButton("Suspend access", "secondary")
        shared.append(suspendForm, suspendReason.wrapper, graceLabel, suspendButton)
        suspendForm.addEventListener("submit", function suspendAssignment(event) {
          event.preventDefault()
          var reason = suspendReason.input.value.trim()
          if (!reason) return suspendReason.input.focus()
          performMutation(
            assignmentPath(assignment, "suspend"),
            {
              expected_assignment_version: version,
              suspension_reason: reason,
              grace_ends_at: grace.value ? new Date(grace.value).toISOString() : null,
            },
            suspendButton,
            "Caretaker access suspended.",
          )
        })
        controls.appendChild(suspendForm)
      }

      if (assignment.status === "suspended") {
        var resumeForm = shared.element("form", "caretaker-admin__action")
        var resumeButton = actionButton("Resume access", "secondary")
        resumeForm.appendChild(resumeButton)
        resumeForm.addEventListener("submit", function resumeAssignment(event) {
          event.preventDefault()
          performMutation(
            assignmentPath(assignment, "resume"),
            { expected_assignment_version: version },
            resumeButton,
            "Caretaker access resumed.",
          )
        })
        controls.appendChild(resumeForm)
      }

      if (assignment.status === "active" || assignment.status === "suspended") {
        var endForm = shared.element(
          "form",
          "caretaker-admin__action caretaker-admin__action--danger",
        )
        endForm.appendChild(shared.element("h4", "", "End caretaker tenure"))
        // Keep or roll back the role's versions, as Wikipedia's rollback names it
        // ("rollback 3 edits"). A role with none has nothing to choose.
        var policyGroup = null
        if (kept > 0) {
          policyGroup = shared.element("fieldset", "caretaker-admin__policy-choice")
          ;[
            ["retain", versionsLabel("Keep", kept)],
            ["withdraw", versionsLabel("Roll back", kept)],
          ].forEach(function addPolicy(option) {
            var label = shared.element("label")
            var input = shared.element("input")
            input.type = "radio"
            input.name = "caretaker-relinquish-policy"
            input.value = option[0]
            input.required = true
            shared.append(label, input, shared.element("span", "", option[1]))
            policyGroup.appendChild(label)
          })
          endForm.appendChild(policyGroup)
        }
        var endReason = reasonField("Reason")
        var endButton = actionButton("End caretaker tenure", "danger")
        shared.append(endForm, endReason.wrapper, endButton)
        endForm.addEventListener("submit", function endAssignment(event) {
          event.preventDefault()
          var selected = policyGroup
            ? Array.from(policyGroup.querySelectorAll("input")).find(function checked(input) {
                return input.checked
              })
            : { value: "retain" }
          var reason = endReason.input.value.trim()
          if (!selected) return policyGroup.querySelector("input").focus()
          if (!reason) return endReason.input.focus()
          performMutation(
            assignmentPath(assignment, "end"),
            {
              expected_assignment_version: version,
              relinquish_policy: selected.value,
              reason: reason,
            },
            endButton,
            "Caretaker tenure ended.",
          )
        })
        controls.appendChild(endForm)
      }

      // B-1097: a role that ended keeping its versions can roll them back later.
      // The words after it are MediaWiki's rollback summary ("Reverted edits by").
      if (assignment.status === "ended" && assignment.relinquish_policy === "retain" && kept > 0) {
        var rollbackForm = shared.element("form", "caretaker-admin__rollback")
        var rollbackButton = actionButton(versionsLabel("Roll back", kept), "danger")
        rollbackForm.appendChild(rollbackButton)
        rollbackForm.addEventListener("submit", function rollBack(event) {
          event.preventDefault()
          performMutation(
            assignmentPath(assignment, "withdraw"),
            { expected_assignment_version: version },
            rollbackButton,
            "Reverted versions by " + author + ".",
          )
        })
        controls.appendChild(rollbackForm)
      }

      shared.replace(refs.detail, heading, subtitle, textsList(assignment))
      if (controls.childNodes.length) refs.detail.appendChild(controls)
    }

    return Object.freeze({
      performMutation: performMutation,
      render: render,
    })
  }

  modules.detail = Object.freeze({ create: createDetailController })
})(window)
