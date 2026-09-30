import assert from "node:assert/strict"
import test from "node:test"

import { createRequestInbox } from "./request-inbox.js"

// B-880: the caretaker panel reports its dossier on every load and every reload,
// and each autosave reloads it four times. Each report used to refresh the whole
// inbox (notifications + caretaker/me = 2 Worker requests), so one autosave cost
// 8 requests for an inbox that had not changed, and every signed-in gene view
// fetched the inbox twice.
function inboxWithCounter() {
  const calls = []
  const inbox = createRequestInbox({
    fetchJSON: async (path) => {
      calls.push(path.split("?")[0])
      return { ok: true, authenticated: true, requests: [], caretaking: [] }
    },
    getCurrentUser: () => ({ account_id: "acct_1" }),
    renderSidebar: () => {},
    escapeHtml: (value) => String(value),
  })
  return { inbox, calls }
}

const dossier = (status, isCaretaker = true) => ({
  viewer: { is_caretaker: isCaretaker, can_accept: status === "pending_acceptance" },
  assignment: { status },
})

test("the first dossier report of a gene does not refetch the inbox (B-880)", async () => {
  const { inbox, calls } = inboxWithCounter()
  await inbox.noteCaretakerDossier({ symbol: "STAT5A", dossier: dossier("active") })
  assert.deepEqual(calls, [])
})

test("reloads that leave the caretaker status unchanged cost nothing (B-880)", async () => {
  const { inbox, calls } = inboxWithCounter()
  for (let i = 0; i < 5; i += 1) {
    await inbox.noteCaretakerDossier({ symbol: "STAT5A", dossier: dossier("active") })
  }
  assert.deepEqual(calls, [])
})

test("accepting, declining or ending a caretakership refreshes the inbox once (B-880)", async () => {
  const { inbox, calls } = inboxWithCounter()
  await inbox.noteCaretakerDossier({ symbol: "TP53", dossier: dossier("pending_acceptance") })
  await inbox.noteCaretakerDossier({ symbol: "TP53", dossier: dossier("active") })
  assert.deepEqual(calls.sort(), ["/api/iconoplasm/caretaker/me", "/api/iconoplasm/notifications"])
  await inbox.noteCaretakerDossier({ symbol: "TP53", dossier: dossier("active") })
  assert.equal(calls.length, 2, "an unchanged reload after the change costs nothing")
})

test("each gene keeps its own status, and signing out forgets them (B-880)", async () => {
  const { inbox, calls } = inboxWithCounter()
  await inbox.noteCaretakerDossier({ symbol: "TP53", dossier: dossier("active") })
  await inbox.noteCaretakerDossier({ symbol: "SOX11", dossier: dossier("ended", false) })
  assert.deepEqual(calls, [], "two first observations, two different genes")
  inbox.reset()
  await inbox.noteCaretakerDossier({ symbol: "TP53", dossier: dossier("ended", false) })
  assert.deepEqual(calls, [], "after a reset the next report is a first observation again")
})
