// Draft pages are static HTML: the build hides everything after the preview in
// .draft-locked (renderPage.tsx) and shows the #draft-cta card. This script
// decides, per reader, whether the curtain opens. Supporters (Discord guild
// members) and the admin read the whole draft; a signed-in reader who is not a
// supporter sees the "become a supporter" card; guests keep the login card and
// cost no request.

import { getFullSlug } from "../../util/path"

const SESSION_HINT = "brinedew_session_present=1"

function hasSessionHint(): boolean {
  return document.cookie.split(";").some((part) => part.trim() === SESSION_HINT)
}

type DraftReader = { is_admin?: boolean; is_guild_member?: boolean }

async function fetchReader(): Promise<DraftReader | null> {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const payload = await response.json()
    return payload?.authenticated && payload.user ? (payload.user as DraftReader) : null
  } catch {
    return null
  }
}

function showForSignedInReader(cta: HTMLElement) {
  cta.querySelector<HTMLElement>(".draft-cta-msg--guest")?.setAttribute("hidden", "")
  cta.querySelector<HTMLElement>(".draft-cta-msg--user")?.removeAttribute("hidden")
  cta.querySelector<HTMLElement>(".draft-cta-btn--login")?.setAttribute("hidden", "")
  cta.querySelector<HTMLElement>(".draft-cta-btn--support")?.removeAttribute("hidden")
}

async function applyDraftGate() {
  const body = document.body
  body.classList.remove("draft-unlocked")
  if (body.dataset.pageDraft !== "true" || !hasSessionHint()) return

  const slug = getFullSlug(window)
  const reader = await fetchReader()
  // A slower response must not unlock a page the reader has already left.
  if (!reader || getFullSlug(window) !== slug) return

  if (reader.is_admin || reader.is_guild_member) {
    body.classList.add("draft-unlocked")
    return
  }
  const cta = document.getElementById("draft-cta")
  if (cta) showForSignedInReader(cta)
}

document.addEventListener("nav", () => {
  void applyDraftGate()
})
