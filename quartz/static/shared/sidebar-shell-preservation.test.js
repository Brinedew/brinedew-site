import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  mountSidebarStack,
  fetchAuthenticatedUser,
  buildSharedUserPanelMarkup,
  logoutAuthenticatedUser,
  wireSharedUserPanel,
} from "./sidebar-shell.js"

test("temporary auth failure preserves the marker and offers retry instead of Guest", async () => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch }
  const document = createSidebarDocument()
  document.cookie = "brinedew_session_present=1"
  globalThis.document = document
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 })
  try {
    await assert.rejects(
      fetchAuthenticatedUser({ authBase: "https://example.test" }),
      /unavailable/,
    )
    assert.equal(document.cookie, "brinedew_session_present=1")
    const host = document.createElement("div")
    host.innerHTML = buildSharedUserPanelMarkup()
    assert.doesNotMatch(host.textContent, /Guest|Discord Login/)
    let retries = 0
    wireSharedUserPanel(host, { onAuthRetry: () => retries++ })
    host.querySelector("[data-brd-user-retry]").click()
    assert.equal(retries, 1)
    globalThis.fetch = async () =>
      Response.json({ authenticated: true, user: { id: "test-user", username: "Reader" } })
    const user = await fetchAuthenticatedUser({ authBase: "https://example.test" })
    assert.match(buildSharedUserPanelMarkup({ user }), /Reader/)
    assert.equal(document.querySelectorAll("iframe").length, 0)
    globalThis.fetch = async () => new Response(null, { status: 401 })
    assert.equal(await fetchAuthenticatedUser({ authBase: "https://example.test" }), null)
    assert.match(document.cookie, /Max-Age=0/)
    assert.match(buildSharedUserPanelMarkup(), /Guest/)
  } finally {
    Object.assign(globalThis, previous)
  }
})

test("bootstrap, malformed JSON and failed logout cannot silently erase authentication", async () => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch }
  const document = createSidebarDocument()
  document.cookie = "brinedew_session_present=1"
  globalThis.document = document
  try {
    await assert.rejects(
      fetchAuthenticatedUser({ payloadPromise: Promise.reject(new Error("offline")) }),
      /offline/,
    )
    globalThis.fetch = async () => Response.json({})
    await assert.rejects(fetchAuthenticatedUser(), /Invalid session/)
    globalThis.fetch = async () => new Response(null, { status: 503 })
    await assert.rejects(logoutAuthenticatedUser(), /Logout failed/)
    assert.equal(document.cookie, "brinedew_session_present=1")
  } finally {
    Object.assign(globalThis, previous)
  }
})

function createSidebarDocument() {
  const { document } = parseHTML(`
    <html><body>
      <aside class="right sidebar"><div class="page-tags-section"></div></aside>
    </body></html>
  `)
  return document
}

function panels(inboxMarkup, geneMarkup) {
  return [
    { id: "brd-shared-user-panel", markup: '<button id="logout">Log out</button>' },
    {
      id: "icono-request-inbox-panel",
      markup: inboxMarkup,
      preserveScrollSelector: ".icono-request-inbox__group-body",
    },
    { id: "icono-sidebar-panel", markup: geneMarkup },
  ]
}

test("route updates preserve the sidebar stack, account panel, inbox DOM, and inbox scroll", () => {
  const document = createSidebarDocument()
  const previousDocument = globalThis.document
  globalThis.document = document
  try {
    const inboxMarkup = `
      <div class="icono-request-inbox">
        <sl-details data-icono-request-group="ready" open>
          <div class="icono-request-inbox__group-body"><a href="/gene/TP53">TP53</a></div>
        </sl-details>
      </div>
    `
    const stack = mountSidebarStack({
      sidebar: document.querySelector(".right.sidebar"),
      stackId: "brd-sidebar-stack",
      preserveExisting: true,
      panels: panels(inboxMarkup, "<p>Gene A</p>"),
    })
    const userPanel = document.getElementById("brd-shared-user-panel")
    const inboxPanel = document.getElementById("icono-request-inbox-panel")
    const inboxBody = inboxPanel.querySelector(".icono-request-inbox__group-body")
    inboxBody.scrollTop = 184

    const nextStack = mountSidebarStack({
      sidebar: document.querySelector(".right.sidebar"),
      stackId: "brd-sidebar-stack",
      preserveExisting: true,
      panels: panels(inboxMarkup, "<p>Gene B</p>"),
    })

    assert.equal(nextStack === stack, true)
    assert.equal(document.getElementById("brd-shared-user-panel") === userPanel, true)
    assert.equal(document.getElementById("icono-request-inbox-panel") === inboxPanel, true)
    assert.equal(inboxPanel.querySelector(".icono-request-inbox__group-body") === inboxBody, true)
    assert.equal(inboxBody.scrollTop, 184)
    assert.equal(document.getElementById("icono-sidebar-panel").textContent.trim(), "Gene B")
  } finally {
    globalThis.document = previousDocument
  }
})

test("an inbox data refresh updates only its panel and restores each group scroll position", () => {
  const document = createSidebarDocument()
  const previousDocument = globalThis.document
  globalThis.document = document
  try {
    const firstInbox = `
      <sl-details data-icono-request-group="ready" open>
        <div class="icono-request-inbox__group-body"><a>old ready</a></div>
      </sl-details>
      <sl-details data-icono-request-group="waiting">
        <div class="icono-request-inbox__group-body"><a>old waiting</a></div>
      </sl-details>
    `
    mountSidebarStack({
      sidebar: document.querySelector(".right.sidebar"),
      stackId: "brd-sidebar-stack",
      preserveExisting: true,
      panels: panels(firstInbox, "<p>Gene A</p>"),
    })
    const userPanel = document.getElementById("brd-shared-user-panel")
    const genePanel = document.getElementById("icono-sidebar-panel")
    const inboxPanel = document.getElementById("icono-request-inbox-panel")
    const bodies = inboxPanel.querySelectorAll(".icono-request-inbox__group-body")
    bodies[0].scrollTop = 133
    bodies[1].scrollTop = 27

    const nextInbox = firstInbox.replace("old ready", "updated ready")
    mountSidebarStack({
      sidebar: document.querySelector(".right.sidebar"),
      stackId: "brd-sidebar-stack",
      preserveExisting: true,
      panels: panels(nextInbox, "<p>Gene A</p>"),
    })

    const nextBodies = inboxPanel.querySelectorAll(".icono-request-inbox__group-body")
    assert.equal(document.getElementById("brd-shared-user-panel") === userPanel, true)
    assert.equal(document.getElementById("icono-sidebar-panel") === genePanel, true)
    assert.equal(document.getElementById("icono-request-inbox-panel") === inboxPanel, true)
    assert.equal(nextBodies[0].scrollTop, 133)
    assert.equal(nextBodies[1].scrollTop, 27)
    assert.match(inboxPanel.textContent, /updated ready/)
  } finally {
    globalThis.document = previousDocument
  }
})
