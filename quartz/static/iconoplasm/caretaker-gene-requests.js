// B-1137: the gene page's half of asking a gene's caretaker for the gene. The
// rules live in workers/iconoplasm/caretaker-gene-requests.js. The Caretaker's
// Handbook: "Go to a gene page and click the "request swap" button in the gene
// toolbar. The caretaker for that gene will get a swap request notification and
// can either accept or reject it. You can only have one swap request active at a
// time."
//
// It fills the toolbar slot the claim button uses (app.js,
// hydrateCaretakerClaimAction), from the same GET .../claim answer:
//  - on a gene someone else looks after (`request`): "Request swap", or, for a
//    person who looks after no gene, a request to become its caretaker; "Cancel
//    request" while one is pending; the button on a timer after a rejection;
//  - on your own gene (`incoming`): "Requests" with their count, opening the
//    list where each is accepted or rejected.
// The words are the Handbook's and the switch dialog's. Where those have none,
// each control keeps the words of the product whose pattern it copies:
// Facebook groups' "Cancel request", LinkedIn's "Add a note" with its character
// count, Discord's count of pending requests.
import {
  closeDialog,
  createDialogElement,
  openDialog,
  setDialogTitle,
} from "./dialog.js?v=a5c98f9ed0ae3eb6"

const API = "/api/iconoplasm/caretaker/genes/"

// How long ago a request came, at a glance (the request inbox's ages).
function ageText(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso || "")) / 1000))
  if (!Number.isFinite(seconds)) return ""
  if (seconds < 60) return "just now"
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago"
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago"
  return Math.floor(seconds / 86400) + "d ago"
}

// Until sl-checkbox is defined its checked property is unset, so the attribute
// speaks for it (B-1104).
function isChecked(box) {
  if (!box) return false
  return typeof box.checked === "boolean" ? box.checked : box.hasAttribute("checked")
}

function closeMenu(target) {
  const menu = target.closest("[popover]")
  if (menu && menu.matches(":popover-open")) menu.hidePopover()
}

// `switchInventoryMarkup(from, to)` is the switch dialog's list of what stays and
// what is undone (to = null for a gene given away with none taken in return);
// `capabilitiesMarkup` the first claim's list of what a caretaker can do;
// `termsMarkup(terms, checked)` its terms box; `renderCooldown` the button on a
// timer; `portraitUrl(symbol)` a promise of a gene's small portrait.
export function createGeneRequestControls({
  fetchJSON,
  esc,
  commandId,
  switchInventoryMarkup,
  capabilitiesMarkup,
  termsMarkup,
  renderCooldown,
  portraitUrl,
}) {
  function post(symbol, path, body) {
    return fetchJSON(API + encodeURIComponent(symbol) + path, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    })
  }

  function showStatus(status, message, tone) {
    status.hidden = !message
    status.textContent = message || ""
    if (tone) status.dataset.tone = tone
    else delete status.dataset.tone
  }

  // The dialog sits next to the toolbar, as the claim dialog does (B-838), so
  // closing the More menu never hides it.
  function mountDialog({ target, dialogHost }, options) {
    const dialog = createDialogElement(document, { size: "standard", ...options })
    ;(dialogHost || target).replaceChildren(dialog)
    return dialog
  }

  function wireTerms(box, submit) {
    const sync = () => {
      submit.disabled = !isChecked(box)
    }
    for (const name of ["change", "sl-change"]) box?.addEventListener(name, sync)
    customElements.whenDefined("sl-checkbox").then(sync)
    return sync
  }

  // The new-request Discord message links to the gene page with this hash; the
  // page opens the list when it arrives.
  const REQUESTS_HASH = "#gene-requests"

  function takeRequestsHash() {
    if (window.location.hash !== REQUESTS_HASH) return false
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    )
    return true
  }

  function render(context) {
    const { target, payload } = context
    if (payload?.request) return renderRequester(context, payload.request)
    if (payload?.incoming?.requests?.length) return renderHolder(context, payload.incoming)
    takeRequestsHash()
    target.replaceChildren()
  }

  // --- The person asking -------------------------------------------------

  function requestLabel(symbol, request) {
    return request.mode === "swap" ? "Request swap" : "Request to become a " + symbol + " caretaker"
  }

  function renderRequester(context, request) {
    const { target, symbol } = context
    if (request.pending) return renderPending(context, request.pending)
    if (request.reason === "rejected_recently") {
      renderCooldown(target, symbol, request, context.rehydrate, requestLabel(symbol, request))
      return
    }
    if (!request.available || !request.terms) {
      target.replaceChildren()
      return
    }
    const label = requestLabel(symbol, request)
    const terms = request.terms
    const offered = request.mode === "swap" ? request.offered : null
    // A caretaker who already accepted these terms sees the box ticked, as in the
    // switch dialog.
    const accepted = Boolean(offered && offered.terms_version_id === terms.terms_version_id)
    const dialogId = "icono-gene-request-dialog-" + symbol
    target.innerHTML =
      '<button type="button" class="icono-button icono-canonical-new-candidate-btn icono-caretaker-claim-btn" data-icono-gene-request-open aria-haspopup="dialog" aria-controls="' +
      esc(dialogId) +
      '"><span>' +
      esc(label) +
      "</span></button>"
    const dialog = mountDialog(context, {
      id: dialogId,
      title: label,
      className: "icono-caretaker-claim-dialog icono-gene-request-dialog",
      body:
        '<form class="icono-caretaker-claim-form" data-icono-gene-request-form>' +
        '<p class="icono-gene-request-lead">The caretaker for ' +
        esc(symbol) +
        " will get a " +
        (offered ? "swap " : "") +
        "request notification and can either accept or reject it.</p>" +
        (request.replaces
          ? '<p class="icono-gene-request-lead">You can only have one request active at a time, so this withdraws your request for ' +
            esc(request.replaces.canonical_symbol) +
            ".</p>"
          : "") +
        (offered ? switchInventoryMarkup(offered, symbol) : capabilitiesMarkup) +
        '<div class="icono-gene-request-note">' +
        '<button type="button" class="icono-button icono-button--small" data-icono-gene-request-note-open>Add a note</button>' +
        '<label class="icono-gene-request-note__field" data-icono-gene-request-note-field hidden><span>Add a note</span>' +
        '<textarea class="icono-suggest-input" data-icono-gene-request-note rows="3" maxlength="' +
        esc(request.note_max_length) +
        '"></textarea><span class="icono-gene-request-note__count" data-icono-gene-request-note-count>0/' +
        esc(request.note_max_length) +
        "</span></label></div>" +
        termsMarkup(terms, accepted) +
        '<p class="icono-caretaker-status" data-icono-gene-request-status hidden role="status"></p>' +
        "</form>",
      footer:
        '<button type="button" class="icono-button" data-icono-gene-request-cancel>Cancel</button>' +
        '<button type="button" class="icono-button icono-button--primary" data-icono-gene-request-submit' +
        (accepted ? "" : " disabled") +
        ">Send request</button>",
    })
    const box = dialog.querySelector("[data-icono-caretaker-claim-terms]")
    const submit = dialog.querySelector("[data-icono-gene-request-submit]")
    const status = dialog.querySelector("[data-icono-gene-request-status]")
    const note = dialog.querySelector("[data-icono-gene-request-note]")
    const noteField = dialog.querySelector("[data-icono-gene-request-note-field]")
    const noteOpen = dialog.querySelector("[data-icono-gene-request-note-open]")
    const count = dialog.querySelector("[data-icono-gene-request-note-count]")
    const sync = wireTerms(box, submit)
    let pendingCommandId = null
    target.querySelector("[data-icono-gene-request-open]").addEventListener("click", () => {
      closeMenu(target)
      openDialog(dialog)
      sync()
    })
    dialog
      .querySelector("[data-icono-gene-request-cancel]")
      .addEventListener("click", () => closeDialog(dialog))
    noteOpen.addEventListener("click", () => {
      noteOpen.hidden = true
      noteField.hidden = false
      note.focus()
    })
    note.addEventListener("input", () => {
      count.textContent = note.value.length + "/" + request.note_max_length
    })
    submit.addEventListener("click", () => {
      if (submit.disabled || !isChecked(box)) return
      submit.disabled = true
      showStatus(status, "Sending request…")
      pendingCommandId ||= commandId()
      post(symbol, "/requests", {
        command_id: pendingCommandId,
        holder_assignment_id: request.holder_assignment_id,
        offered_assignment_id: offered ? offered.caretaker_assignment_id : null,
        replace_request_id: request.replaces ? request.replaces.request_id : null,
        note: note.value.trim() || null,
        terms_accepted: true,
        terms_version_id: terms.terms_version_id,
      })
        .then(() => {
          closeDialog(dialog)
          context.rehydrate()
        })
        .catch((error) => {
          showStatus(status, String(error?.message || "The request could not be sent."), "error")
          submit.disabled = !isChecked(box)
        })
    })
  }

  function renderPending(context, pending) {
    const { target, symbol } = context
    target.innerHTML =
      '<button type="button" class="icono-button icono-canonical-new-candidate-btn icono-caretaker-claim-btn" data-icono-gene-request-withdraw><span>Cancel request</span></button>' +
      '<span class="icono-caretaker-status" data-icono-gene-request-status hidden role="status"></span>'
    const button = target.querySelector("[data-icono-gene-request-withdraw]")
    const status = target.querySelector("[data-icono-gene-request-status]")
    button.addEventListener("click", () => {
      button.disabled = true
      post(symbol, "/requests/" + encodeURIComponent(pending.request_id) + "/withdraw", {})
        .then(() => context.rehydrate())
        .catch((error) => {
          button.disabled = false
          showStatus(
            status,
            String(error?.message || "The request could not be cancelled."),
            "error",
          )
        })
    })
  }

  // --- The gene's caretaker -----------------------------------------------

  function requesterMarkup(item) {
    const name = item.requester ? item.requester.username : item.requester_label
    return (
      '<div class="icono-gene-request__who">' +
      (item.requester
        ? '<img class="icono-caretaker-identity__avatar" src="' +
          esc(item.requester.avatar_url) +
          '" alt="" loading="lazy" decoding="async">'
        : '<span class="icono-gene-request__avatar-blank" aria-hidden="true"></span>') +
      '<span class="icono-gene-request__name">' +
      esc(name) +
      "</span>" +
      '<time class="icono-gene-request__age" datetime="' +
      esc(item.created_at) +
      '">' +
      esc(ageText(item.created_at)) +
      "</time></div>"
    )
  }

  function rowMarkup(item) {
    const offered = item.offered ? item.offered.canonical_symbol : ""
    return (
      '<li class="icono-gene-request" data-icono-gene-request="' +
      esc(item.request_id) +
      '">' +
      requesterMarkup(item) +
      (offered
        ? '<div class="icono-gene-request__offer" aria-label="Swap for ' +
          esc(offered) +
          '"><span class="icono-gene-request__swap" aria-hidden="true">⇄</span>' +
          '<img class="icono-gene-request__portrait" data-icono-gene-request-portrait="' +
          esc(offered) +
          '" alt="" hidden><span class="icono-gene-request__symbol">' +
          esc(offered) +
          "</span></div>"
        : "") +
      (item.note ? '<p class="icono-gene-request__note">' + esc(item.note) + "</p>" : "") +
      '<div class="icono-actions icono-gene-request__actions">' +
      '<button type="button" class="icono-button icono-button--small" data-icono-gene-request-reject>Reject</button>' +
      '<button type="button" class="icono-button icono-button--small icono-button--primary" data-icono-gene-request-accept>Accept</button>' +
      "</div>" +
      '<p class="icono-caretaker-status" data-icono-gene-request-row-status hidden role="status"></p>' +
      "</li>"
    )
  }

  function renderHolder(context, incoming) {
    const { target, symbol } = context
    const dialogId = "icono-gene-requests-dialog-" + symbol
    const listTitle = "Requests for " + symbol
    let items = incoming.requests.slice()
    const countText = () => String(items.length) + (incoming.more ? "+" : "")
    target.innerHTML =
      '<button type="button" class="icono-button icono-canonical-new-candidate-btn icono-caretaker-claim-btn" data-icono-gene-requests-open aria-haspopup="dialog" aria-controls="' +
      esc(dialogId) +
      '"><span>Requests</span><span class="icono-gene-request-count" data-icono-gene-request-count>' +
      esc(countText()) +
      "</span></button>"
    const dialog = mountDialog(context, {
      id: dialogId,
      title: listTitle,
      className: "icono-gene-request-dialog",
      body: "",
      footer: "",
    })
    const body = dialog.querySelector(".icono-dialog__body")
    const panel = dialog.querySelector(".icono-dialog__panel")
    const footer = document.createElement("div")
    footer.className = "icono-dialog__footer"
    panel.appendChild(footer)

    function showList() {
      setDialogTitle(dialog, listTitle)
      body.innerHTML =
        '<ul class="icono-gene-request-list">' + items.map(rowMarkup).join("") + "</ul>"
      footer.hidden = true
      footer.replaceChildren()
      for (const img of body.querySelectorAll("[data-icono-gene-request-portrait]")) {
        Promise.resolve(portraitUrl(img.getAttribute("data-icono-gene-request-portrait")))
          .then((url) => {
            if (!url) return
            img.src = url
            img.hidden = false
          })
          .catch(() => {})
      }
      for (const row of body.querySelectorAll("[data-icono-gene-request]")) {
        const item = items.find(
          (candidate) => candidate.request_id === row.getAttribute("data-icono-gene-request"),
        )
        row
          .querySelector("[data-icono-gene-request-accept]")
          .addEventListener("click", () => showAccept(item))
        row
          .querySelector("[data-icono-gene-request-reject]")
          .addEventListener("click", (event) => reject(item, row, event.currentTarget))
      }
    }

    function reject(item, row, button) {
      const status = row.querySelector("[data-icono-gene-request-row-status]")
      button.disabled = true
      post(symbol, "/requests/" + encodeURIComponent(item.request_id) + "/reject", {})
        .then(() => {
          items = items.filter((candidate) => candidate !== item)
          if (!items.length && !incoming.more) {
            closeDialog(dialog)
            context.rehydrate()
            return
          }
          target.querySelector("[data-icono-gene-request-count]").textContent = countText()
          showList()
        })
        .catch((error) => {
          button.disabled = false
          showStatus(
            status,
            String(error?.message || "The request could not be rejected."),
            "error",
          )
        })
    }

    // Accepting a swap is a switch for the caretaker, so it asks what the switch
    // dialog asks; giving the gene away asks what "Stop being caretaker" says.
    function showAccept(item) {
      const name = item.requester ? item.requester.username : item.requester_label
      const offered = item.offered ? item.offered.canonical_symbol : ""
      const holder = incoming.holder
      const terms = incoming.terms
      const accepted = Boolean(offered && holder.terms_version_id === terms.terms_version_id)
      const from = { canonical_symbol: symbol, has_supervote: holder.has_supervote }
      setDialogTitle(dialog, offered ? "Switch to " + offered + "?" : "Stop being caretaker?")
      body.innerHTML =
        '<form class="icono-caretaker-claim-form">' +
        (offered
          ? switchInventoryMarkup(from, offered) + termsMarkup(terms, accepted)
          : '<p class="icono-gene-request-lead">' +
            esc(name) +
            " can then care for " +
            esc(symbol) +
            ".</p>" +
            switchInventoryMarkup(from, null)) +
        '<p class="icono-caretaker-status" data-icono-gene-request-status hidden role="status"></p>' +
        "</form>"
      footer.hidden = false
      footer.innerHTML =
        '<button type="button" class="icono-button" data-icono-gene-request-back>Back</button>' +
        '<button type="button" class="icono-button icono-button--primary" data-icono-gene-request-confirm' +
        (offered && !accepted ? " disabled" : "") +
        ">Accept</button>"
      const box = body.querySelector("[data-icono-caretaker-claim-terms]")
      const confirm = footer.querySelector("[data-icono-gene-request-confirm]")
      const status = body.querySelector("[data-icono-gene-request-status]")
      if (box) wireTerms(box, confirm)()
      footer.querySelector("[data-icono-gene-request-back]").addEventListener("click", showList)
      confirm.addEventListener("click", () => {
        if (confirm.disabled || (box && !isChecked(box))) return
        confirm.disabled = true
        showStatus(status, "Accepting…")
        post(symbol, "/requests/" + encodeURIComponent(item.request_id) + "/accept", {
          expected_assignment_version: holder.assignment_version,
          ...(offered ? { terms_accepted: true, terms_version_id: terms.terms_version_id } : {}),
        })
          .then(() => {
            closeDialog(dialog)
            context.roleChanged()
          })
          .catch((error) => {
            showStatus(
              status,
              String(error?.message || "The request could not be accepted."),
              "error",
            )
            confirm.disabled = Boolean(box && !isChecked(box))
          })
      })
    }

    target.querySelector("[data-icono-gene-requests-open]").addEventListener("click", () => {
      closeMenu(target)
      showList()
      openDialog(dialog)
    })
    if (takeRequestsHash()) {
      showList()
      openDialog(dialog)
    }
  }

  return { render }
}
