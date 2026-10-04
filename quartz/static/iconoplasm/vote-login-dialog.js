import { bindDialog, createDialogElement, setDialogTitle } from "./dialog.js?v=a5c98f9ed0ae3eb6"

const VOTE_LOGIN_DIALOG_SELECTOR = "[data-icono-vote-login-prompt]"
const VOTE_LOGIN_DIALOG_BODY = `
  <a class="icono-button icono-button--primary icono-vote-login-link" data-icono-vote-login-link autofocus>
    Log in with Discord
  </a>
`

function focusWithoutScrolling(element) {
  if (element && typeof element.focus === "function") {
    element.focus({ preventScroll: true })
  }
}

export function openVoteLoginDialog(options = {}) {
  const ownerDocument = options.document || globalThis.document
  if (!ownerDocument?.body) {
    throw new Error("A document body is required to open the vote login dialog")
  }
  const loginUrl = String(options.loginUrl || "").trim()
  if (!loginUrl) {
    throw new Error("A Discord login URL is required to open the vote login dialog")
  }
  const title = String(options.title || "Log in with Discord to vote").trim()

  const existing = ownerDocument.querySelector(VOTE_LOGIN_DIALOG_SELECTOR)
  if (existing) {
    setDialogTitle(existing, title)
    existing.querySelector("[data-icono-vote-login-link]").href = loginUrl
    focusWithoutScrolling(existing.querySelector("[data-icono-vote-login-link]"))
    return existing
  }

  const dialog = createDialogElement(ownerDocument, {
    id: "icono-vote-login",
    titleId: "icono-vote-login-title",
    title,
    size: "compact",
    className: "icono-vote-login-dialog",
    dataAttributes: { "data-icono-vote-login-prompt": "" },
    body: VOTE_LOGIN_DIALOG_BODY,
  })
  const loginLink = dialog.querySelector("[data-icono-vote-login-link]")
  loginLink.href = loginUrl

  bindDialog(dialog)
  dialog.addEventListener(
    "close",
    function () {
      dialog.remove()
      focusWithoutScrolling(options.returnFocus)
    },
    { once: true },
  )

  ownerDocument.body.appendChild(dialog)

  try {
    dialog.showModal()
  } catch (error) {
    dialog.remove()
    throw error
  }

  focusWithoutScrolling(loginLink)
  return dialog
}
