import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  createCaretakerManifestationPanel,
  manifestationWordDiff,
  normalizedDossier,
  proseValidationError,
  renderCaretakerManifestationPanel,
} from "./caretaker-manifestations.js"

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function dossier() {
  return {
    gene: { gene_id: "gene_tp53", symbol: "TP53" },
    viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
    assignment: {
      caretaker_assignment_id: "assignment_tp53",
      assignment_version: 3,
      status: "active",
      leave_policy: "retain",
    },
    head: {
      head_version: 4,
      gene_revision: 9,
      canonical_selection_id: "selection_4",
      canonical_revision_id: "revision_1",
    },
    manifestations: [
      {
        manifestation_id: "manifestation_own",
        author_is_viewer: true,
        belongs_to_current_assignment: true,
        can_withdraw: true,
        status: "active",
        row_version: 2,
        head_body: "Second body",
        revisions: [
          {
            manifestation_revision_id: "revision_2",
            revision_number: 2,
            lifecycle: "active",
            body: "Second body",
          },
          {
            manifestation_revision_id: "revision_1",
            revision_number: 1,
            lifecycle: "active",
            body: "First body",
          },
        ],
      },
      {
        manifestation_id: "manifestation_seed",
        origin: "system_seed",
        author_is_viewer: false,
        can_withdraw: false,
        status: "active",
        revisions: [],
      },
    ],
  }
}

test("the dossier renders a tabbed autosave dialog, exact version choices, and own-only deletion", () => {
  const html = renderCaretakerManifestationPanel(dossier(), escapeHtml)
  assert.match(html, /Your manifestation/)
  assert.match(html, /Changes autosave as a new version/)
  assert.match(html, /data-icono-caretaker-tab="manifestation"/)
  assert.match(html, /data-icono-caretaker-tab="history"/)
  assert.match(html, /data-icono-caretaker-tab="settings"/)
  assert.match(html, /Tags always remain private/)
  assert.match(html, /Use this version/)
  assert.match(html, /Compare with canonical/)
  assert.match(html, /Start from this version/)
  assert.match(html, /Delete this manifestation/)
  assert.match(html, /Stop being caretaker/)
  assert.match(
    html,
    /eligible for hard purge after 30 days unless (?:a legal hold applies|legally held)/,
  )
  assert.doesNotMatch(html, /curator/i)
  assert.equal((html.match(/data-icono-caretaker-withdraw=/g) || []).length, 1)
})

test("pending invitations pin visible terms and require an explicit departure default", () => {
  const pending = dossier()
  pending.assignment.status = "pending_acceptance"
  pending.assignment.terms = {
    terms_version_id: "terms_2026_08_30",
    document_url: "https://brinedew.bio/iconoplasm/caretaker-terms/",
    display_label: "Caretaker terms - 30 August 2026",
    content_sha256: "a".repeat(64),
  }
  pending.viewer = {
    is_caretaker: false,
    can_edit: false,
    can_accept: true,
    can_decline: true,
    suspended: false,
  }
  const html = renderCaretakerManifestationPanel(pending, escapeHtml)
  assert.match(html, /Accept caretaker role/)
  assert.match(html, /Decline invitation/)
  assert.match(html, /Caretaker terms - 30 August 2026/)
  assert.match(html, /data-icono-caretaker-terms-accepted/)
  assert.match(html, /name="caretaker-invitation-policy"/)
  assert.doesNotMatch(html, /name="caretaker-invitation-policy" value="retain" checked/)
  assert.match(html, /data-icono-caretaker-accept disabled/)
})

test("an invitation without a displayable terms version fails closed", () => {
  const pending = dossier()
  pending.assignment.status = "pending_acceptance"
  pending.viewer = {
    is_caretaker: true,
    can_edit: false,
    can_accept: true,
    can_decline: true,
    suspended: false,
  }
  const html = renderCaretakerManifestationPanel(pending, escapeHtml)
  assert.match(html, /terms are temporarily unavailable/)
  assert.doesNotMatch(html, /data-icono-caretaker-accept/)
})

test("a withdrawn own lineage is restored explicitly before another save", () => {
  const withdrawn = dossier()
  withdrawn.manifestations[0].status = "withdrawn"
  withdrawn.manifestations[0].can_withdraw = false
  withdrawn.manifestations[0].can_restore = true
  const html = renderCaretakerManifestationPanel(withdrawn, escapeHtml)
  assert.match(html, /Restore this manifestation/)
  assert.match(html, /Restore it before writing another version/)
  assert.doesNotMatch(html, /Save new version/)
})

test("a new tenure never edits an older retained lineage but may still withdraw it", () => {
  const multiple = dossier()
  multiple.manifestations[0].belongs_to_current_assignment = false
  multiple.manifestations[0].created_at = "2025-01-01T00:00:00.000Z"
  multiple.manifestations.unshift({
    manifestation_id: "manifestation_current_withdrawn",
    author_is_viewer: true,
    belongs_to_current_assignment: true,
    can_restore: true,
    can_withdraw: false,
    status: "withdrawn",
    row_version: 1,
    created_at: "2026-08-30T00:00:00.000Z",
    revisions: [],
  })
  const html = renderCaretakerManifestationPanel(multiple, escapeHtml)
  assert.doesNotMatch(html, /data-icono-caretaker-editor/)
  assert.match(html, /Restore this manifestation/)
  assert.match(html, /Record from a previous tenure/)
  assert.equal((html.match(/data-icono-caretaker-withdraw=/g) || []).length, 1)
})

test("purged history remains attributable but cannot be selected, forked, or rendered", () => {
  const purged = dossier()
  const version = purged.manifestations[1]
  version.author_label = "Former caretaker 7H2Q"
  version.revisions = [
    {
      manifestation_revision_id: "revision_purged",
      revision_number: 3,
      lifecycle: "purged",
      body_available: false,
      body: "must not render",
    },
  ]
  const html = renderCaretakerManifestationPanel(purged, escapeHtml)
  assert.match(html, /Former caretaker 7H2Q/)
  assert.match(html, /no longer available under its retention policy/)
  assert.doesNotMatch(html, /must not render/)
  assert.doesNotMatch(html, /data-icono-caretaker-fork="revision_purged"/)
  assert.doesNotMatch(html, /data-icono-caretaker-select="revision_purged"/)
})

test("canonical and current heads remain usable when history pagination moves them off-page", () => {
  const paged = dossier()
  paged.manifestations[0].manifestation_head_revision_id = "revision_1"
  paged.manifestations[0].head_body = ""
  paged.manifestations[0].revisions = [paged.manifestations[0].revisions[0]]
  paged.pinned_revisions = [
    {
      manifestation_revision_id: "revision_1",
      manifestation_id: "manifestation_own",
      revision_number: 1,
      lifecycle: "active",
      body: "First body",
      body_available: true,
    },
  ]
  const normalized = normalizedDossier(paged, "TP53")
  const own = normalized.manifestations[0]
  assert.equal(own.head_body, "First body")
  assert.equal(own.revisions.length, 2)
  const html = renderCaretakerManifestationPanel(normalized, escapeHtml)
  assert.match(html, /First body/)
  assert.match(html, /Canonical/)
})

test("the readable diff keeps unchanged context and marks both sides", () => {
  assert.deepEqual(manifestationWordDiff("calm blue cell", "calm red cell"), [
    { kind: "same", text: "calm " },
    { kind: "removed", text: "blue" },
    { kind: "added", text: "red" },
    { kind: "same", text: " cell" },
  ])
})

test("prose validation matches the 4,000 code-point and 16 KiB authority limits", () => {
  assert.equal(proseValidationError("ordinary manifestation"), "")
  assert.match(proseValidationError("x".repeat(4001)), /4,000/)
  assert.match(proseValidationError("\u0001"), /control/)
  assert.match(proseValidationError(""), /Write/)
})

test("signed-out mounting performs zero caretaker requests", async () => {
  const { document } = parseHTML('<div id="host"></div>')
  let requests = 0
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function () {
      requests += 1
      return {}
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  await panel.mount(host, { symbol: "TP53", currentUser: null, authResolved: true })
  assert.equal(requests, 0)
  assert.equal(host.hidden, true)
})

test("a suspension keeps an unsent local draft readable and explicitly removable", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const values = new Map([
    ["iconoplasm.caretakerDraft.v2:assignment_tp53", "Unsent <img src=x onerror=alert(1)> draft"],
  ])
  const storage = {
    getItem(key) {
      return values.get(key) || null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
  const suspended = dossier()
  suspended.assignment.status = "suspended"
  suspended.viewer.can_edit = false
  suspended.viewer.suspended = true
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function () {
      return suspended
    },
    escapeHtml,
    storage,
    confirmAction: () => true,
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const recovery = host.querySelector(".icono-caretaker-draft-recovery")
  assert.ok(recovery)
  assert.equal(
    recovery.querySelector("textarea").value,
    "Unsent <img src=x onerror=alert(1)> draft",
  )
  assert.equal(recovery.querySelector("img"), null)
  recovery
    .querySelector("[data-icono-caretaker-remove-draft]")
    .dispatchEvent(new Event("click", { bubbles: true }))
  assert.equal(values.size, 0)
  assert.equal(host.querySelector(".icono-caretaker-draft-recovery"), null)
})

test("autosaving appends an immutable version without silently changing canonical", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const calls = []
  const publicRefreshes = []
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      return dossier()
    },
    escapeHtml,
    storage: null,
    onCanonicalChanged: (symbol) => publicRefreshes.push(symbol),
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const form = host.querySelector("[data-icono-caretaker-editor]")
  form.querySelector("[data-icono-caretaker-prose]").value = "Third body"
  form
    .querySelector("[data-icono-caretaker-prose]")
    .dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const mutation = calls.find(function (call) {
    return call.path.endsWith("/revisions")
  })
  assert.ok(mutation)
  const body = JSON.parse(mutation.init.body)
  assert.equal(body.prose, "Third body")
  assert.equal("select_canonical" in body, false)
  assert.equal(body.expected_assignment_version, 3)
  assert.equal("expected_head_version" in body, false)
  assert.equal("expected_canonical_revision_id" in body, false)
  assert.match(body.command_id, /^cmd_/)
  assert.deepEqual(publicRefreshes, [])
  assert.match(host.textContent, /Manifestation autosaved as a new version/)
})

test("autosave persists Tags against the exact new revision and selects that derivative", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const calls = []
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      if ((init?.method || "GET") === "GET") return dossier()
      if (path.endsWith("/revisions")) {
        return { ok: true, manifestation_revision_id: "revision_3" }
      }
      if (path.endsWith("/tags-derivatives")) {
        return {
          ok: true,
          manifestation_derivative_id: "derivative_3",
          derivative_head_version: 0,
        }
      }
      return { ok: true }
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const prose = host.querySelector("[data-icono-caretaker-prose]")
  const tags = host.querySelector("[data-icono-caretaker-tags]")
  prose.value = "Third body"
  tags.value = "red coat, careful gaze"
  tags.dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const tagSave = calls.find((call) => call.path.endsWith("/tags-derivatives"))
  const tagSelect = calls.find((call) => call.path.endsWith("/tags-derivative-head"))
  assert.ok(tagSave)
  assert.equal(JSON.parse(tagSave.init.body).tags_text, "red coat, careful gaze")
  assert.ok(tagSelect)
  assert.equal(JSON.parse(tagSelect.init.body).manifestation_derivative_id, "derivative_3")
})

test("the Settings visibility switch uses manifestation and gene CAS versions", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const calls = []
  const refreshes = []
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      return (init?.method || "GET") === "GET" ? dossier() : { ok: true }
    },
    escapeHtml,
    storage: null,
    onCanonicalChanged: (symbol) => refreshes.push(symbol),
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const toggle = host.querySelector("[data-icono-caretaker-visibility]")
  toggle.checked = true
  toggle.dispatchEvent(new Event("change", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const mutation = calls.find((call) => call.path.endsWith("/page-visibility"))
  assert.ok(mutation)
  const body = JSON.parse(mutation.init.body)
  assert.equal(body.visible, true)
  assert.equal(body.expected_manifestation_version, 2)
  assert.equal(body.expected_gene_revision, 9)
  assert.deepEqual(refreshes, ["TP53"])
})

test("an uncertain save retry reuses the same command ID", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const mutations = []
  let attempts = 0
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      if ((init?.method || "GET") === "GET") return dossier()
      mutations.push({ path, init })
      attempts += 1
      if (attempts === 1) throw new TypeError("connection reset")
      return { ok: true }
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })

  function editSameBody() {
    const form = host.querySelector("[data-icono-caretaker-editor]")
    form.querySelector("[data-icono-caretaker-prose]").value = "Third body"
    form
      .querySelector("[data-icono-caretaker-prose]")
      .dispatchEvent(new Event("input", { bubbles: true }))
  }

  editSameBody()
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.match(host.querySelector("[data-icono-caretaker-status]").textContent, /uncertain/i)
  await new Promise((resolve) => setTimeout(resolve, 1200))

  assert.equal(mutations.length, 2)
  const first = JSON.parse(mutations[0].init.body)
  const second = JSON.parse(mutations[1].init.body)
  assert.equal(first.command_id, second.command_id)
  assert.equal(first.prose, "Third body")
  assert.equal(second.prose, "Third body")
})

test("withdraw and restore send the lineage row version instead of accepting stale state", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const current = dossier()
  const calls = []
  const confirmations = []
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      return (init?.method || "GET") === "GET" ? current : { ok: true }
    },
    escapeHtml,
    storage: null,
    confirmAction: (message) => {
      confirmations.push(message)
      return true
    },
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  host
    .querySelector("[data-icono-caretaker-withdraw]")
    .dispatchEvent(new Event("click", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const withdrawn = calls.find((call) => call.init?.method === "DELETE")
  assert.ok(withdrawn)
  assert.equal(JSON.parse(withdrawn.init.body).expected_manifestation_version, 2)
  assert.match(confirmations[0], /withdrawn immediately/)
  assert.match(
    confirmations[0],
    /eligible for hard purge after 30 days unless a legal hold applies/,
  )

  current.manifestations[0].status = "withdrawn"
  current.manifestations[0].can_withdraw = false
  current.manifestations[0].can_restore = true
  current.manifestations[0].row_version = 3
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  host
    .querySelector("[data-icono-caretaker-restore]")
    .dispatchEvent(new Event("click", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const restored = calls.find((call) => call.path.endsWith("/restore"))
  assert.ok(restored)
  assert.equal(JSON.parse(restored.init.body).expected_manifestation_version, 3)
})

test("remounting for another signed-in account does not duplicate or retain stale handlers", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const calls = []
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      return dossier()
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_old" },
    authResolved: true,
  })
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_current" },
    authResolved: true,
  })
  const form = host.querySelector("[data-icono-caretaker-editor]")
  form.querySelector("[data-icono-caretaker-prose]").value = "One current-account save"
  form
    .querySelector("[data-icono-caretaker-prose]")
    .dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(
    calls.filter(function (call) {
      return call.path.endsWith("/revisions")
    }).length,
    1,
  )
})

test("accepting sends the exact displayed terms and chosen departure default", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const pending = dossier()
  pending.assignment.status = "pending_acceptance"
  pending.assignment.terms = {
    terms_version_id: "terms_2026_08_30",
    document_url: "https://brinedew.bio/iconoplasm/caretaker-terms/",
    display_label: "Caretaker terms - 30 August 2026",
    content_sha256: "b".repeat(64),
  }
  pending.viewer = {
    is_caretaker: true,
    can_edit: false,
    can_accept: true,
    can_decline: true,
    suspended: false,
  }
  const active = dossier()
  const calls = []
  let reads = 0
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      if ((init?.method || "GET") === "GET") {
        reads += 1
        return reads === 1 ? pending : active
      }
      return { ok: true }
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const accepted = host.querySelector("[data-icono-caretaker-terms-accepted]")
  accepted.checked = true
  accepted.dispatchEvent(new Event("input", { bubbles: true }))
  const acceptButton = host.querySelector("[data-icono-caretaker-accept]")
  assert.equal(acceptButton.disabled, true, "terms consent alone is not a departure choice")
  const withdraw = host.querySelector('input[name="caretaker-invitation-policy"][value="withdraw"]')
  host
    .querySelector('input[name="caretaker-invitation-policy"][value="retain"]')
    .removeAttribute("checked")
  withdraw.setAttribute("checked", "")
  withdraw.dispatchEvent(new Event("input", { bubbles: true }))
  assert.equal(acceptButton.disabled, false)
  acceptButton.dispatchEvent(new Event("click", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const mutation = calls.find(function (call) {
    return call.path.endsWith("/accept")
  })
  assert.ok(mutation)
  const body = JSON.parse(mutation.init.body)
  assert.equal(body.terms_version_id, "terms_2026_08_30")
  assert.equal(body.terms_accepted, true)
  assert.equal(body.default_leave_policy, "withdraw")
  assert.equal(body.expected_assignment_version, 3)
})

test("an explicitly disabled dossier mounts no authority surface", async () => {
  const { document } = parseHTML('<div id="host"></div>')
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function () {
      return { ...dossier(), enabled: false }
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  const result = await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  assert.equal(result, null)
  assert.equal(host.hidden, true)
  assert.equal(host.childNodes.length, 0)
})
