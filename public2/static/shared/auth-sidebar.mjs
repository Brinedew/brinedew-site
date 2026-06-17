import { mountSidebarStack, wireSharedUserPanel, buildSharedUserPanelMarkup } from "./sidebar-shell.js"

async function init() {
  const sidebar = document.querySelector(".right.sidebar")
  if (!sidebar) return

  // If stack still exists in the DOM (preserved by Micromorph), just update the login link
  const existing = document.getElementById("brd-sidebar-stack")
  if (existing && existing.isConnected) {
    const loginLink = existing.querySelector('.brd-sidebar-btn')
    if (loginLink) {
      const returnTo = encodeURIComponent(window.location.pathname)
      loginLink.href = '/api/auth/login?return_to=' + returnTo
    }
    return
  }

  // First mount — create the stack
  const stack = mountSidebarStack({
    sidebar,
    stackId: "brd-sidebar-stack",
    panels: [
      {
        id: "brd-shared-user-panel",
        className: "brd-sidebar-panel--user",
        markup: buildSharedUserPanelMarkup({ returnTo: window.location.pathname }),
      },
    ],
  })
  if (!stack) return

  // Fetch auth and swap to user panel
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" })
    if (!res.ok) throw new Error()
    const data = await res.json()
    if (data.authenticated && data.user) {
      const panel = stack.querySelector("#brd-shared-user-panel")
      if (panel) {
        panel.innerHTML = buildSharedUserPanelMarkup({
          user: data.user,
          returnTo: window.location.pathname,
        })
        wireSharedUserPanel(panel, { returnTo: window.location.pathname, onAuthChanged() { window.location.reload() } })
      }
    }
  } catch {}
}

init()
document.addEventListener("nav", init)
