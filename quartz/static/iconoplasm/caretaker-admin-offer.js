;(function caretakerAdminOfferModule(global) {
  "use strict"

  var modules = global.IconoplasmCaretakerAdminModules
  if (!modules || !modules.shared) {
    throw new Error("Caretaker admin shared module must load before the offer module.")
  }
  var shared = modules.shared

  function createOfferController(context, dependencies) {
    function availabilityReason(item, kind) {
      var status = String(item.status || "")
      if (status !== "active") return shared.statusLabel(status || "Unavailable")
      if (kind === "gene" && !item.canonical_revision_id) {
        return "No verified manifestation source"
      }
      if (kind === "gene" && item.open_assignment_status) {
        return "Open assignment: " + shared.statusLabel(item.open_assignment_status)
      }
      return ""
    }

    function renderSearchResults(kind, items) {
      var refs = context.refs
      var state = context.state
      var target = kind === "gene" ? refs.geneResults : refs.accountResults
      if (!target) return
      if (!items.length) {
        shared.replace(target, shared.element("p", "small", "No matches."))
        return
      }
      var fragment = document.createDocumentFragment()
      items.forEach(function renderResult(item) {
        var reason = availabilityReason(item, kind)
        var button = shared.element("button", "caretaker-admin__result")
        button.type = "button"
        button.disabled = Boolean(reason)
        var title =
          kind === "gene"
            ? item.canonical_symbol || item.gene_id
            : item.author_label || "Anonymous account"
        var detail = kind === "gene" ? item.gene_id : item.account_id
        shared.append(
          button,
          shared.element("strong", "", title),
          shared.element("small", "", reason || detail),
        )
        button.addEventListener("click", function chooseResult() {
          if (kind === "gene") {
            state.selectedGene = item
            shared.replace(refs.geneResults)
            if (refs.geneQuery) refs.geneQuery.value = ""
          } else {
            state.selectedAccount = item
            shared.replace(refs.accountResults)
            if (refs.accountQuery) refs.accountQuery.value = ""
          }
          renderState()
        })
        fragment.appendChild(button)
      })
      shared.replace(target, fragment)
    }

    async function search(kind, rawQuery) {
      var queryValue = String(rawQuery || "").trim()
      var refs = context.refs
      var state = context.state
      var target = kind === "gene" ? refs.geneResults : refs.accountResults
      var sequenceKey = kind === "gene" ? "geneRequestSequence" : "accountRequestSequence"
      var sequence = ++state[sequenceKey]
      if (!queryValue) {
        shared.replace(target)
        return
      }
      shared.replace(target, shared.element("p", "small", "Searching."))
      try {
        var params = new URLSearchParams({ query: queryValue, limit: "20" })
        var payload = await shared.request(
          context,
          "/" + (kind === "gene" ? "genes" : "accounts") + "?" + params.toString(),
        )
        if (!context.mounted || sequence !== state[sequenceKey]) return
        renderSearchResults(
          kind,
          Array.isArray(payload[kind === "gene" ? "genes" : "accounts"])
            ? payload[kind === "gene" ? "genes" : "accounts"]
            : [],
        )
      } catch (error) {
        if (context.mounted && sequence === state[sequenceKey]) {
          shared.replace(
            target,
            shared.element("p", "caretaker-admin__inline-error", shared.readableError(error)),
          )
        }
      }
    }

    function renderState() {
      var refs = context.refs
      var state = context.state
      if (refs.geneSelection) {
        refs.geneSelection.textContent = state.selectedGene
          ? (state.selectedGene.canonical_symbol || state.selectedGene.gene_id) +
            " · revision " +
            state.selectedGene.gene_revision
          : "No gene selected."
      }
      if (refs.accountSelection) {
        refs.accountSelection.textContent = state.selectedAccount
          ? state.selectedAccount.author_label || "Anonymous account"
          : "No account selected."
      }
      if (refs.offer) {
        var hasActiveTerms = state.terms.some(shared.isActiveTerms)
        var ready = Boolean(
          state.entitlementPolicyVersion &&
          hasActiveTerms &&
          state.selectedGene &&
          state.selectedAccount &&
          !state.offerBusy,
        )
        refs.offer.disabled = !ready
        if (state.selectedGene && state.selectedAccount) {
          var key =
            "offer:" +
            state.selectedGene.gene_id +
            ":" +
            state.selectedAccount.account_id +
            ":" +
            state.selectedGene.gene_revision
          refs.offer.textContent = dependencies.commandLabel(key, "Send caretaker invitation")
        } else {
          refs.offer.textContent = "Send caretaker invitation"
        }
      }
    }

    async function offerAssignment() {
      var state = context.state
      if (
        !state.selectedGene ||
        !state.selectedAccount ||
        !state.entitlementPolicyVersion ||
        state.offerBusy
      )
        return
      var gene = state.selectedGene
      var account = state.selectedAccount
      var actionKey = "offer:" + gene.gene_id + ":" + account.account_id + ":" + gene.gene_revision
      state.offerBusy = true
      renderState()
      var result = await dependencies.performMutation(
        actionKey,
        "/offers",
        {
          gene_id: gene.gene_id,
          account_id: account.account_id,
          expected_gene_revision: gene.gene_revision,
          entitlement_policy_version: state.entitlementPolicyVersion,
        },
        context.refs.offer,
        "Caretaker invitation recorded.",
      )
      state.offerBusy = false
      if (result) {
        state.selectedGene = null
        state.selectedAccount = null
      }
      renderState()
    }

    function bindEvents() {
      var refs = context.refs
      context.eventController = new AbortController()
      var listenerOptions = { signal: context.eventController.signal }
      var registryTimer = null
      var geneTimer = null
      var accountTimer = null
      if (refs.refresh)
        refs.refresh.addEventListener(
          "click",
          function refreshRegistry() {
            dependencies.loadRegistry()
          },
          listenerOptions,
        )
      if (refs.registryMore)
        refs.registryMore.addEventListener(
          "click",
          function loadMore() {
            dependencies.loadRegistry({ append: true })
          },
          listenerOptions,
        )
      function scheduleRegistry() {
        shared.cancelTimer(context, registryTimer)
        registryTimer = shared.later(
          context,
          function refreshFilteredRegistry() {
            dependencies.loadRegistry()
          },
          shared.SEARCH_DELAY_MS,
        )
      }
      if (refs.registryQuery)
        refs.registryQuery.addEventListener("input", scheduleRegistry, listenerOptions)
      if (refs.registryStatus)
        refs.registryStatus.addEventListener("change", scheduleRegistry, listenerOptions)
      if (refs.geneQuery)
        refs.geneQuery.addEventListener(
          "input",
          function scheduleGeneSearch() {
            shared.cancelTimer(context, geneTimer)
            geneTimer = shared.later(
              context,
              function runGeneSearch() {
                search("gene", refs.geneQuery.value)
              },
              shared.SEARCH_DELAY_MS,
            )
          },
          listenerOptions,
        )
      if (refs.accountQuery)
        refs.accountQuery.addEventListener(
          "input",
          function scheduleAccountSearch() {
            shared.cancelTimer(context, accountTimer)
            accountTimer = shared.later(
              context,
              function runAccountSearch() {
                search("account", refs.accountQuery.value)
              },
              shared.SEARCH_DELAY_MS,
            )
          },
          listenerOptions,
        )
      if (refs.offer) refs.offer.addEventListener("click", offerAssignment, listenerOptions)
    }

    return Object.freeze({
      bindEvents: bindEvents,
      renderState: renderState,
      search: search,
    })
  }

  modules.offer = Object.freeze({ create: createOfferController })
})(window)
