const VOTE_LOGIN_DIALOG_SELECTOR = "[data-icono-vote-login-prompt]"
const VOTE_LOGIN_DIALOG_CONTENT = `
  <button type="button" class="icono-vote-login-close" aria-label="Close">Close</button>
  <div class="icono-vote-login-copy">
    <h2 class="icono-vote-login-title" id="icono-vote-login-title">Log in with Discord to vote</h2>
  </div>
  <a class="icono-vote-login-link" data-icono-vote-login-link autofocus>
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

  const existing = ownerDocument.querySelector(VOTE_LOGIN_DIALOG_SELECTOR)
  if (existing) {
    focusWithoutScrolling(existing.querySelector("[data-icono-vote-login-link]"))
    return existing
  }

  const dialog = ownerDocument.createElement("dialog")
  dialog.className = "icono-vote-login-dialog"
  dialog.setAttribute("data-icono-vote-login-prompt", "")
  dialog.setAttribute("aria-labelledby", "icono-vote-login-title")
  dialog.innerHTML = VOTE_LOGIN_DIALOG_CONTENT

  const closeButton = dialog.querySelector(".icono-vote-login-close")
  const loginLink = dialog.querySelector("[data-icono-vote-login-link]")
  loginLink.href = loginUrl

  closeButton.addEventListener("click", function () {
    dialog.close("dismiss")
  })
  dialog.addEventListener("click", function (event) {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    if (outside) dialog.close("dismiss")
  })
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
