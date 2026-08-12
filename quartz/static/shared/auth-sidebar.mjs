import {
  mountSidebarStack,
  wireSharedUserPanel,
  buildSharedUserPanelMarkup,
} from "./sidebar-shell.js?v=d8bcfb8f19d3a065"

function isAccountChromePath(pathname) {
  // Account UI belongs on apps / settings only. Those pages mount their own
  // sidebar stacks and never load this module (see Head.tsx). Essay, wiki,
  // tag, and other reading pages must not show Guest / Discord Login chrome.
  return false
}

async function init() {
  const pathname = window.location.pathname || "/"
  const existing = document.getElementById("brd-sidebar-stack")

  if (!isAccountChromePath(pathname)) {
    if (existing && existing.isConnected) existing.remove()
    return
  }

  const sidebar = document.querySelector(".right.sidebar")
  if (!sidebar) return

  if (existing && existing.isConnected) {
    const loginLink = existing.querySelector(".brd-sidebar-btn")
    if (loginLink) {
      const returnTo = encodeURIComponent(pathname)
      loginLink.href = "/api/auth/login?return_to=" + returnTo
    }
    return
  }

  const stack = mountSidebarStack({
    sidebar,
    stackId: "brd-sidebar-stack",
    panels: [
      {
        id: "brd-shared-user-panel",
        className: "brd-sidebar-panel--user",
        markup: buildSharedUserPanelMarkup({ returnTo: pathname }),
      },
    ],
  })
  if (!stack) return

  try {
    const res = await fetch("/api/auth/me", { credentials: "include" })
    if (!res.ok) throw new Error()
    const data = await res.json()
    if (data.authenticated && data.user) {
      const panel = stack.querySelector("#brd-shared-user-panel")
      if (panel) {
        panel.innerHTML = buildSharedUserPanelMarkup({
          user: data.user,
          returnTo: pathname,
        })
        wireSharedUserPanel(panel, {
          returnTo: pathname,
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
