;(function caretakerAdminRegistryModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared) {
    throw new Error("Caretaker admin shared module must load before the registry module.")
  }
  var shared = modules.shared

  function createRegistryController(context, dependencies) {
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

    function select(assignmentId) {
      context.state.selectedAssignmentId = assignmentId
      render()
      dependencies.renderDetail()
    }

    // One row per role, the whole row a target, as in Linear's member list.
    // The gene cell holds the row's button, so Tab and Enter reach every row.
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
        emptyCell.colSpan = 5
        emptyRow.appendChild(emptyCell)
        shared.replace(refs.registryBody, emptyRow)
      } else {
        var rows = state.registry.map(function renderAssignment(assignment) {
          var row = shared.element("tr")
          var selected = assignment.caretaker_assignment_id === state.selectedAssignmentId
          row.dataset.selected = selected ? "true" : "false"
          var geneCell = shared.element("td", "caretaker-admin__gene")
          var selectButton = shared.element(
            "button",
            "caretaker-admin__row-button",
            assignment.canonical_symbol || assignment.gene_id,
          )
          selectButton.type = "button"
          selectButton.setAttribute("aria-pressed", selected ? "true" : "false")
          selectButton.addEventListener("click", function selectAssignment() {
            select(assignment.caretaker_assignment_id)
          })
          geneCell.appendChild(selectButton)
          var statusCell = shared.element("td")
          var badge = shared.element(
            "span",
            "caretaker-admin__badge",
            shared.statusLabel(assignment.status),
          )
          badge.dataset.status = String(assignment.status || "")
          statusCell.appendChild(badge)
          shared.append(
            row,
            geneCell,
            shared.element("td", "", assignment.author_label || "Anonymous account"),
            statusCell,
            shared.element(
              "td",
              "",
              shared.formatDay(assignment.started_at || assignment.created_at),
            ),
            shared.element(
              "td",
              "",
              assignment.ended_at ? shared.formatDay(assignment.ended_at) : "",
            ),
          )
          row.addEventListener("click", function selectFromRow(event) {
            if (event.target !== selectButton) select(assignment.caretaker_assignment_id)
          })
          return row
        })
        shared.replace.apply(null, [refs.registryBody].concat(rows))
      }
      if (refs.registryMore) refs.registryMore.hidden = !state.nextCursor
    }

    function bindEvents() {
      var refs = context.refs
      context.eventController = new AbortController()
      var listenerOptions = { signal: context.eventController.signal }
      var registryTimer = null
      if (refs.refresh)
        refs.refresh.addEventListener(
          "click",
          function refreshRegistry() {
            load()
          },
          listenerOptions,
        )
      if (refs.registryMore)
        refs.registryMore.addEventListener(
          "click",
          function loadMore() {
            load({ append: true })
          },
          listenerOptions,
        )
      function scheduleRegistry() {
        shared.cancelTimer(context, registryTimer)
        registryTimer = shared.later(
          context,
          function refreshFilteredRegistry() {
            load()
          },
          shared.SEARCH_DELAY_MS,
        )
      }
      if (refs.registryQuery)
        refs.registryQuery.addEventListener("input", scheduleRegistry, listenerOptions)
      if (refs.registryStatus)
        refs.registryStatus.addEventListener("change", scheduleRegistry, listenerOptions)
    }

    return Object.freeze({
      bindEvents: bindEvents,
      load: load,
      render: render,
    })
  }

  modules.registry = Object.freeze({ create: createRegistryController })
})(window)
