import {
  mountSidebarStack,
  wireSharedUserPanel,
  buildSharedUserPanelMarkup,
} from "./sidebar-shell.js?v=ec70a3b0941d0a38"

async function init() {
  const sidebar = document.querySelector(".right.sidebar")
  if (!sidebar) return

  const isHomepage = window.location.pathname === "/" || window.location.pathname === ""

  // Remove stack if it exists (SPA navigation away from a page where it was mounted)
  const existing = document.getElementById("brd-sidebar-stack")
  if (existing && existing.isConnected) {
    if (isHomepage) {
      existing.remove()
      return
    }
    // If stack still exists in the DOM (preserved by Micromorph), just update the login link
    const loginLink = existing.querySelector(".brd-sidebar-btn")
    if (loginLink) {
      const returnTo = encodeURIComponent(window.location.pathname)
      loginLink.href = "/api/auth/login?return_to=" + returnTo
    }
    return
  }

  // Don't mount on the landing page
  if (isHomepage) return

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
        wireSharedUserPanel(panel, {
          returnTo: window.location.pathname,
          onAuthChanged() {
            window.location.reload()
          },
        })
      }
    }
  } catch {}
}

init()
document.addEventListener("nav", init)
