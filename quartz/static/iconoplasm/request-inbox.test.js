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

test("onReadyCandidates receives unread candidate items only and unreadCandidateShasFor deduplicates SHAs (B-1265)", async () => {
  const readyCalls = []
  const shaA = "a".repeat(64)
  const shaB = "b".repeat(64)
  const inbox = createRequestInbox({
    fetchJSON: async (path) => {
      if (path.startsWith("/api/iconoplasm/notifications?")) {
        return {
          ok: true,
          authenticated: true,
          unread_count: 3,
          ready_count: 3,
          open_count: 0,
          ready_requests: [
            {
              notification_id: 1,
              request_id: 11,
              request_kind: "new_candidate",
              gene_symbol: "tp53",
              fulfilled_asset_sha256: shaA.toUpperCase(),
              unread: true,
              gene_url: "/gene/TP53",
            },
            {
              notification_id: 2,
              request_id: 12,
              request_kind: "new_candidate",
              gene_symbol: "TP53",
              fulfilled_asset_sha256: shaA,
              unread: true,
              gene_url: "/gene/TP53",
            },
            {
              notification_id: 3,
              request_id: 13,
              request_kind: "edit_image",
              edit_job_id: "request-13",
              gene_symbol: "TP53",
              fulfilled_asset_sha256: shaB,
              unread: true,
              gene_url: "/gene/TP53",
            },
          ],
          open_requests: [],
        }
      }
      return { ok: true, caretaker: null }
    },
    getCurrentUser: () => ({ account_id: "acct_1" }),
    renderSidebar: () => {},
    escapeHtml: (value) => String(value),
    onReadyCandidates: async (items) => {
      readyCalls.push(items.map((item) => item.notification_id))
    },
  })

  await inbox.refresh()
  assert.deepEqual(readyCalls, [[1, 2]])
  assert.deepEqual(inbox.unreadCandidateShasFor("tp53"), [shaA])
})

test("pendingViewedGene waits for onReadyCandidates and honors canMarkGeneViewed (B-1265)", async () => {
  const events = []
  const shaNew = "c".repeat(64)
  let allowMark = false
  let notificationsPayload = {
    ok: true,
    authenticated: true,
    unread_count: 1,
    ready_count: 1,
    open_count: 0,
    ready_requests: [
      {
        notification_id: 21,
        request_id: 210,
        request_kind: "new_candidate",
        gene_symbol: "TP53",
        fulfilled_asset_sha256: shaNew,
        unread: true,
        gene_url: "/gene/TP53",
      },
    ],
    open_requests: [],
  }
  const inbox = createRequestInbox({
    fetchJSON: async (path) => {
      if (path.startsWith("/api/iconoplasm/notifications?")) {
        return notificationsPayload
      }
      if (path === "/api/iconoplasm/notifications/read") {
        events.push("markRead")
        notificationsPayload = {
          ok: true,
          authenticated: true,
          unread_count: 0,
          ready_count: 0,
          open_count: 0,
          ready_requests: [],
          open_requests: [],
        }
        return { ok: true }
      }
      return { ok: true, caretaker: null }
    },
    getCurrentUser: () => ({ account_id: "acct_1" }),
    renderSidebar: () => {},
    escapeHtml: (value) => String(value),
    onReadyCandidates: async () => {
      events.push("onReadyCandidates")
    },
    canMarkGeneViewed: (symbol, items) => {
      events.push(`canMark:${symbol}:${items.length}:${allowMark}`)
      return allowMark
    },
  })

  await inbox.noteGeneViewed("TP53")
  await inbox.refresh()
  assert.deepEqual(events, ["onReadyCandidates", "canMark:TP53:1:false"])
  assert.deepEqual(inbox.unreadCandidateShasFor("TP53"), [shaNew])

  allowMark = true
  await inbox.noteGeneViewed("TP53")
  assert.deepEqual(events, [
    "onReadyCandidates",
    "canMark:TP53:1:false",
    "canMark:TP53:1:true",
    "markRead",
  ])
  assert.deepEqual(inbox.unreadCandidateShasFor("TP53"), [])
})

test("sidebar receipt and Ready notice route candidate clicks through onOpenCandidateReceipt and preserve modifier clicks (B-1265)", async () => {
  const candidateClicks = []
  const editClicks = []
  const shaNew = "d".repeat(64)
  const shaEdit = "e".repeat(64)
  let phase = 1

  function makeElement(tagName) {
    const attrs = new Map()
    const listeners = new Map()
    const classes = new Set()
    return {
      tagName: tagName.toUpperCase(),
      children: [],
      parentNode: null,
      _iconoRequestInboxWired: false,
      className: "",
      href: "",
      innerHTML: "",
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, [])
        listeners.get(type).push(fn)
      },
      dispatchEvent: (event) => {
        for (const fn of listeners.get(event.type) || []) fn(event)
      },
      appendChild(child) {
        child.parentNode = this
        this.children.push(child)
        return child
      },
      remove() {
        if (!this.parentNode) return
        const idx = this.parentNode.children.indexOf(this)
        if (idx >= 0) this.parentNode.children.splice(idx, 1)
        this.parentNode = null
      },
    }
  }

  const body = makeElement("body")
  const prevDocument = globalThis.document
  const prevWindow = globalThis.window
  const pendingTimers = new Set()
  globalThis.document = {
    body,
    visibilityState: "visible",
    getElementById: (id) => body.children.find((child) => child.id === id) || null,
    createElement: (tag) => makeElement(tag),
  }
  globalThis.window = {
    setTimeout: (fn, ms) => {
      const id = setTimeout(() => {
        pendingTimers.delete(id)
        fn()
      }, ms)
      pendingTimers.add(id)
      return id
    },
    clearTimeout: (id) => {
      pendingTimers.delete(id)
      clearTimeout(id)
    },
  }

  let inbox = null
  try {
    inbox = createRequestInbox({
      fetchJSON: async (path) => {
        if (path.startsWith("/api/iconoplasm/notifications?")) {
          if (phase === 1) {
            return {
              ok: true,
              authenticated: true,
              unread_count: 0,
              ready_count: 0,
              open_count: 1,
              ready_requests: [],
              open_requests: [{ request_id: 1, gene_symbol: "TP53", gene_url: "/gene/TP53" }],
            }
          }
          if (phase === 2) {
            return {
              ok: true,
              authenticated: true,
              unread_count: 1,
              ready_count: 1,
              open_count: 0,
              ready_requests: [
                {
                  notification_id: 31,
                  request_id: 310,
                  request_kind: "new_candidate",
                  gene_symbol: "TP53",
                  fulfilled_asset_sha256: shaNew,
                  unread: true,
                  gene_url: "/gene/TP53",
                },
              ],
              open_requests: [],
            }
          }
          return {
            ok: true,
            authenticated: true,
            unread_count: 1,
            ready_count: 1,
            open_count: 0,
            ready_requests: [
              {
                notification_id: 32,
                request_id: 320,
                request_kind: "edit_image",
                edit_job_id: "request-320",
                gene_symbol: "TP53",
                fulfilled_asset_sha256: shaEdit,
                unread: true,
                gene_url: "/gene/TP53",
              },
            ],
            open_requests: [],
          }
        }
        return { ok: true, caretaker: null }
      },
      getCurrentUser: () => ({ account_id: "acct_1" }),
      renderSidebar: () => {},
      escapeHtml: (value) => String(value),
      onOpenCandidateReceipt: (info) => candidateClicks.push(info),
      onOpenEditJob: (info) => editClicks.push(info),
    })

    // Wire a simulated sidebar receipt link
    const receiptLink = makeElement("a")
    receiptLink.setAttribute("data-icono-request-receipt", "")
    receiptLink.setAttribute("data-icono-request-gene-symbol", "TP53")
    receiptLink.setAttribute("href", "/gene/TP53")
    const stack = {
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === "[data-icono-request-receipt]" ? [receiptLink] : []),
    }

    await inbox.refresh()
    phase = 2
    await inbox.refresh({ announce: true })
    inbox.wire(stack)

    let prevented = false
    receiptLink.dispatchEvent({
      type: "click",
      ctrlKey: true,
      button: 0,
      preventDefault: () => {
        prevented = true
      },
    })
    assert.equal(prevented, false, "Ctrl+click should allow opening in a new tab")
    assert.equal(candidateClicks.length, 0)

    receiptLink.dispatchEvent({
      type: "click",
      button: 0,
      preventDefault: () => {
        prevented = true
      },
    })
    assert.equal(prevented, true)
    assert.deepEqual(candidateClicks.at(-1)?.assetShas, [shaNew])
    assert.equal(candidateClicks.at(-1)?.geneSymbol, "TP53")

    // Clicking the floating candidate toast routes through onOpenCandidateReceipt and removes the toast
    const candidateNotice = body.children.find((el) => el.id === "icono-request-ready-notice")
    assert.ok(candidateNotice, "floating candidate notice should be mounted")
    let noticePrevented = false
    candidateNotice.dispatchEvent({
      type: "click",
      button: 0,
      preventDefault: () => {
        noticePrevented = true
      },
    })
    assert.equal(noticePrevented, true)
    assert.equal(candidateClicks.length, 2)
    assert.equal(candidateNotice.parentNode, null, "notice should be removed on click")

    // Floating edit toast routes through onOpenEditJob
    phase = 3
    await inbox.refresh({ announce: true })
    const editNotice = body.children.find((el) => el.id === "icono-request-ready-notice")
    assert.ok(editNotice, "floating edit notice should be mounted")
    editNotice.dispatchEvent({
      type: "click",
      button: 0,
      preventDefault: () => {},
    })
    assert.equal(editClicks.length, 1)
    assert.equal(editClicks[0].editJobId, "request-320")
  } finally {
    if (inbox) inbox.stop()
    for (const id of pendingTimers) clearTimeout(id)
    pendingTimers.clear()
    globalThis.document = prevDocument
    globalThis.window = prevWindow
  }
})
