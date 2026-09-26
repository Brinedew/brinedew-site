import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { afterEach, beforeEach } from "node:test"
import { Event as DOMEvent, parseHTML } from "linkedom"

import {
  createCaretakerManifestationPanel,
  manifestationWordDiff,
  normalizedDossier,
  proseValidationError,
  renderCaretakerManifestationPanel,
} from "./caretaker-manifestations.js"

let originalGlobals
beforeEach(() => {
  originalGlobals = Object.fromEntries(
    ["document", "Event"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  // The controller dispatches browser Events. Use the same DOM implementation
  // as the document instead of Node's native, read-only Event objects.
  globalThis.Event = DOMEvent
})
afterEach(() => {
  for (const key of ["document", "Event"]) {
    if (originalGlobals[key]) Object.defineProperty(globalThis, key, originalGlobals[key])
    else delete globalThis[key]
  }
})

test("the caretaker modal versions its complete immutable module graph", async () => {
  const modules = [
    "caretaker-manifestations.js",
    "caretaker-manifestations-controller.js",
    "caretaker-manifestations-events.js",
    "caretaker-manifestations-view.js",
  ]
  for (const moduleName of modules) {
    const source = await readFile(new URL(moduleName, import.meta.url), "utf8")
    const localImports = Array.from(
      source.matchAll(/(?:from\s+|import\s*)["'](\.\.?\/[^"']+\.js(?:\?[^"']*)?)["']/g),
      (match) => match[1],
    )
    assert.deepEqual(
      localImports.filter((specifier) => !specifier.includes("?v=")),
      [],
      `${moduleName} must version every static submodule import`,
    )
  }
  const controller = await readFile(
    new URL("caretaker-manifestations-controller.js", import.meta.url),
    "utf8",
  )
  assert.match(controller, /const retryDelays = \[0, 1_000, 3_000, 7_000, 15_000\]/)
  assert.match(controller, /matchesPublishedState !== false/)
})

test("caretaker load failures name the affected tools and allow one explicit retry", async () => {
  const { document } = parseHTML('<html><body><div id="host"></div></body></html>')
  globalThis.document = document
  const host = document.getElementById("host")
  let calls = 0
  const panel = createCaretakerManifestationPanel({
    escapeHtml,
    fetchJSON: async () => {
      calls++
      throw Object.assign(new Error("SESSION_AUTHORITY_UNAVAILABLE"), { status: 503 })
    },
  })
  await panel.mount(host, {
    symbol: "TRIM28",
    currentUser: { account_id: "account_test" },
    authResolved: true,
  })
  assert.match(host.textContent, /Caretaker tools are temporarily unavailable/)
  assert.doesNotMatch(host.textContent, /SESSION_AUTHORITY|AUTHENTICATION|Sign in/)
  assert.equal(calls, 1)
  host.querySelector("[data-icono-caretaker-retry-load]").click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 2)
  assert.ok(host.querySelector("[data-icono-caretaker-retry-load]"))
})

test("an expired caretaker session gives a contextual sign-in action", async () => {
  const { document } = parseHTML('<html><body><div id="host"></div></body></html>')
  globalThis.document = document
  const host = document.getElementById("host")
  const panel = createCaretakerManifestationPanel({
    escapeHtml,
    loginUrl: "/api/auth/login?return_to=%2Fgene%2FTRIM28",
    fetchJSON: async () => {
      throw Object.assign(new Error("AUTHENTICATION_REQUIRED"), { status: 401 })
    },
  })
  await panel.mount(host, {
    symbol: "TRIM28",
    currentUser: { account_id: "account_test" },
    authResolved: true,
  })
  assert.match(host.textContent, /Your session expired.*caretaker tools/)
  assert.equal(host.querySelector("a").textContent, "Sign in")
  assert.equal(
    host.querySelector("a").getAttribute("href"),
    "/api/auth/login?return_to=%2Fgene%2FTRIM28",
  )
  assert.doesNotMatch(host.textContent, /AUTHENTICATION_REQUIRED/)
})

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

function allRevisionIds(value) {
  return value.manifestations.flatMap((item) =>
    (item.revisions || []).map((revision) => revision.manifestation_revision_id),
  )
}

test("the dossier renders a tabbed autosave dialog, exact version choices, and own-only deletion", () => {
  const html = renderCaretakerManifestationPanel(dossier(), escapeHtml)
  assert.match(html, /Manifestation</)
  assert.match(
    html,
    /data-icono-caretaker-autosave-state data-state="saved" role="status" title="Saved"><svg class="icono-caretaker-cloud"[^]*?data-icono-caretaker-autosave-label>Saved</,
  )
  assert.match(html, /data-icono-caretaker-tab="manifestation"/)
  assert.match(html, /data-icono-caretaker-tab="history"/)
  assert.match(html, /data-icono-caretaker-tab="settings"/)
  assert.match(html, /data-icono-caretaker-tag-categories/)
  // B-835: History is a timeline + preview; Settings holds the danger zone.
  assert.match(html, /Tags always stay private/)
  assert.match(html, /data-icono-caretaker-version="/, "versions are a selectable timeline")
  assert.match(html, /data-icono-caretaker-preview/, "the selected version is previewed")
  assert.match(html, /Edit from here/)
  assert.match(html, /Danger zone/)
  assert.match(html, /Delete the current manifestation/)
  assert.match(html, /Stop being caretaker/)
  assert.match(html, /Purged after 30 days unless legally held/)
  // B-874: there is no second save step and no second meaning of "public".
  const other = dossier()
  const nonCanonical = allRevisionIds(other).find((id) => id !== other.head.canonical_revision_id)
  for (const selectedRevisionId of [nonCanonical, other.head.canonical_revision_id]) {
    const selected = renderCaretakerManifestationPanel(other, escapeHtml, { selectedRevisionId })
    assert.doesNotMatch(selected, /Make public|Use my version|New images use your version/)
    assert.doesNotMatch(selected, /data-icono-caretaker-select/)
    assert.doesNotMatch(selected, /icono-caretaker-badge">Public/)
  }
  // The version new images are drawn from is marked by a glyph, not the word "public".
  const marks = html.match(/data-icono-caretaker-source-mark[^>]*>/g) || []
  assert.equal(marks.length, 2, "one mark in the timeline, one in the preview of that version")
  assert.match(marks[0], /title="New images are drawn from this version"/)
  assert.doesNotMatch(html, /curator/i)
  assert.equal((html.match(/data-icono-caretaker-withdraw=/g) || []).length, 1)
})

test("pending invitations pin visible terms and ask no departure question (B-860)", () => {
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
  assert.doesNotMatch(html, /caretaker-invitation-policy/, "text always stays with the gene")
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
  assert.match(html, /data-icono-caretaker-restore="/)
  assert.match(html, /Restore the current manifestation/)
  assert.match(html, /Restore it before writing another version/)
  assert.doesNotMatch(html, /Save new version/)
})

test("a new tenure forks an older lineage and may withdraw it like any steward (B-860)", () => {
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
  assert.match(html, /Restore the current manifestation/)
  assert.match(html, /Delete an earlier manifestation/)
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
  const html = renderCaretakerManifestationPanel(purged, escapeHtml, {
    selectedRevisionId: "revision_purged",
  })
  assert.match(html, /Former caretaker 7H2Q/)
  assert.match(html, /removed under the retention policy/)
  assert.doesNotMatch(html, /must not render/)
  assert.doesNotMatch(html, /data-icono-caretaker-fork="revision_purged"/)
  assert.doesNotMatch(html, /data-icono-caretaker-select="revision_purged"/)
  // B-872: Edit from here stays in place, greyed and unwired, instead of vanishing.
  assert.match(
    html.match(/<button[^>]*>Edit from here<\/button>/)?.[0] || "",
    / disabled data-icono-caretaker-disabled/,
  )
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
  const html = renderCaretakerManifestationPanel(normalized, escapeHtml, {
    selectedRevisionId: "revision_1",
  })
  assert.match(html, /data-icono-caretaker-version="revision_1"/)
  assert.match(html, /First body/)
  assert.match(html, /data-icono-caretaker-source-mark/, "the image source stays marked")
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

test("a failed Tags body read pauses editing until an explicit retry restores the exact Tags", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  let bodyReads = 0
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async function (path) {
      if (!path.endsWith("/body")) {
        const current = dossier()
        current.manifestations[0].manifestation_head_revision_id = "revision_2"
        current.manifestations[0].revisions[0].derivative = {
          manifestation_derivative_id: "derivative_revision_2",
          body_available: true,
        }
        return current
      }
      bodyReads += 1
      if (bodyReads === 1) {
        const error = new Error("Tags storage is temporarily unavailable")
        error.status = 500
        throw error
      }
      return { tags: { tags_text: "rose seal, archive plate" } }
    },
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")

  await panel.mount(host, { symbol: "TP53", currentUser: { id: "account_1" }, authResolved: true })

  assert.equal(host.querySelector("[data-icono-caretaker-prose]").disabled, true)
  assert.equal(host.querySelector("[data-icono-caretaker-tags]").disabled, true)
  assert.match(host.textContent, /Editing is paused so they cannot be replaced by blank text/)

  host
    .querySelector("[data-icono-caretaker-retry-tags]")
    .dispatchEvent(new Event("click", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(bodyReads, 2)
  assert.equal(host.querySelector("[data-icono-caretaker-prose]").disabled, false)
  assert.equal(host.querySelector("[data-icono-caretaker-tags]").disabled, false)
  assert.equal(host.querySelector("[data-icono-caretaker-tags]").value, "rose seal, archive plate")
  assert.equal(host.querySelector("[data-icono-caretaker-retry-tags]") === null, true)
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
  assert.equal(recovery.querySelector("img") === null, true)
  recovery
    .querySelector("[data-icono-caretaker-remove-draft]")
    .dispatchEvent(new Event("click", { bubbles: true }))
  assert.equal(values.size, 0)
  assert.equal(host.querySelector(".icono-caretaker-draft-recovery") === null, true)
})

test("category rows add, edit and remove tags without flattening their fields", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async () => dossier(),
    escapeHtml,
    storage: null,
  })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const source = host.querySelector("[data-icono-caretaker-tags]")
  function key(input, value) {
    const event = new Event("keydown", { bubbles: true })
    event.key = value
    input.dispatchEvent(event)
  }
  host.querySelector('[data-tag-category="outfit"] [data-add-tag]').click()
  let input = host.querySelector('input[aria-label="Add outfit tag"]')
  input.value = "embroidered coat"
  key(input, "Enter")
  assert.deepEqual(JSON.parse(source.dataset.fieldsJson).outfit, ["embroidered coat"])
  assert.ok(host.querySelector('input[aria-label="Add outfit tag"]'))
  key(host.querySelector('input[aria-label="Add outfit tag"]'), "Escape")
  host.querySelector('[aria-label="Edit embroidered coat"]').click()
  input = host.querySelector('[aria-label="Edit outfit tag"]')
  input.value = "linen coat"
  key(input, "Enter")
  assert.deepEqual(JSON.parse(source.dataset.fieldsJson).outfit, ["linen coat"])
  host.querySelector('[aria-label="Remove linen coat"]').click()
  assert.deepEqual(JSON.parse(source.dataset.fieldsJson).outfit, [])
  assert.equal(source.value, "")
  assert.ok(host.querySelector('[data-tag-category="hair"]'))
  // B-873: caretakers edit tag values; the category skeleton comes from the
  // generation prompt and is not theirs to extend.
  assert.equal(host.querySelector('[aria-label="Add category"]') === null, true)
  assert.equal(host.querySelector(".icono-caretaker-add-category") === null, true)
  assert.equal(host.querySelector("[data-icono-caretaker-prose]").value, "Second body")
  await new Promise((resolve) => setTimeout(resolve, 1200))
})
test("a text-only save without Tags is not yet a source for new images (B-874)", async () => {
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
  // No Tags means no generation recipe, so new images stay on the last complete version.
  assert.equal(
    calls.some((call) => call.path.endsWith("/canonical-selections")),
    false,
  )
  assert.deepEqual(publicRefreshes, [])
  assert.equal(host.querySelector("[data-icono-caretaker-autosave-state]").textContent, "Saved")
})

test("autosave persists Tags, then makes the new version the one new images use (B-874)", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const calls = []
  const publicRefreshes = []
  const panel = createCaretakerManifestationPanel({
    onCanonicalChanged: (symbol) => publicRefreshes.push(symbol),
    fetchJSON: async function (path, init) {
      calls.push({ path, init })
      if ((init?.method || "GET") === "GET") return dossier()
      if (path.endsWith("/revisions")) {
        // The real save response names both the lineage and the new revision.
        return {
          ok: true,
          manifestation_id: "manifestation_own",
          manifestation_revision_id: "revision_3",
        }
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
  tags.dataset.fieldsJson = JSON.stringify({
    outfit: ["red coat"],
    face: ["careful gaze"],
    bespoke: [],
  })
  tags.dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const tagSave = calls.find((call) => call.path.endsWith("/tags-derivatives"))
  const tagSelect = calls.find((call) => call.path.endsWith("/tags-derivative-head"))
  assert.ok(tagSave)
  assert.equal(JSON.parse(tagSave.init.body).tags_text, "red coat, careful gaze")
  assert.deepEqual(JSON.parse(tagSave.init.body).fields_json, {
    outfit: ["red coat"],
    face: ["careful gaze"],
    bespoke: [],
  })
  assert.ok(tagSelect)
  assert.equal(JSON.parse(tagSelect.init.body).manifestation_derivative_id, "derivative_3")

  // B-874: no second "Use my version" step. Once the version is complete, it is
  // what new images are drawn from, through the same authority command.
  const mutations = calls.filter((call) => (call.init?.method || "GET") !== "GET")
  assert.deepEqual(
    mutations.map((call) => call.path.split("/").pop()),
    ["revisions", "tags-derivatives", "tags-derivative-head", "canonical-selections"],
  )
  const selection = JSON.parse(mutations[3].init.body)
  assert.equal(selection.manifestation_revision_id, "revision_3")
  assert.equal(selection.manifestation_id, "manifestation_own")
  assert.equal(selection.expected_canonical_revision_id, "revision_1")
  assert.equal(selection.expected_head_version, 4)
  assert.equal(selection.expected_assignment_version, 3)
  assert.deepEqual(publicRefreshes, ["TP53"])
  assert.equal(host.querySelector("[data-icono-caretaker-autosave-state]").textContent, "Saved")
})

test("Retry resumes a failed Tags upload without creating another revision", async () => {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const calls = []
  let uploads = 0
  const panel = createCaretakerManifestationPanel({
    fetchJSON: async (path, init) => {
      if ((init?.method || "GET") === "GET") return dossier()
      calls.push({ path, body: JSON.parse(init.body) })
      if (path.endsWith("/revisions")) return { manifestation_revision_id: "revision_retry" }
      if (path.endsWith("/tags-derivatives")) {
        if (++uploads === 1) throw new TypeError("connection reset")
        return { manifestation_derivative_id: "derivative_retry", derivative_head_version: 0 }
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
  const form = host.querySelector("[data-icono-caretaker-editor]")
  const tags = form.querySelector("[data-icono-caretaker-tags]")
  tags.value = "linen coat"
  tags.dataset.fieldsJson = JSON.stringify({ outfit: ["linen coat"] })
  tags.dispatchEvent(new Event("input", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.equal(host.querySelector("[data-icono-caretaker-editor]") === form, true)
  assert.equal(host.querySelector("[data-icono-caretaker-autosave-state]").textContent, "Not saved")
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(uploads, 1, "the first automatic retry waits 2 seconds (B-874)")
  host.querySelector("[data-icono-caretaker-retry-save]").click()
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(calls.filter((c) => c.path.endsWith("/revisions")).length, 1)
  const retries = calls.filter((c) => c.path.endsWith("/tags-derivatives"))
  assert.equal(retries.length, 2)
  assert.deepEqual(retries[0].body, retries[1].body)
  assert.equal(host.querySelector("[data-icono-caretaker-autosave-state]").textContent, "Saved")
})

async function mountForAutosave(fetchJSON) {
  const { document, Event } = parseHTML('<div id="host"></div>')
  globalThis.document = document
  const panel = createCaretakerManifestationPanel({ fetchJSON, escapeHtml, storage: null })
  const host = document.getElementById("host")
  await panel.mount(host, {
    symbol: "TP53",
    currentUser: { account_id: "acct_1" },
    authResolved: true,
  })
  const prose = host.querySelector("[data-icono-caretaker-prose]")
  prose.value = "Third body"
  prose.dispatchEvent(new Event("input", { bubbles: true }))
  const autosaveState = () =>
    host.querySelector("[data-icono-caretaker-autosave-state]").textContent
  return { document, Event, host, autosaveState }
}

test("an autosave in flight never greys out Close, the × or the tabs (B-874)", async () => {
  let release
  const { host } = await mountForAutosave(async (path, init) => {
    if ((init?.method || "GET") === "GET") return dossier()
    await new Promise((resolve) => (release = resolve))
    return { manifestation_revision_id: "revision_3" }
  })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(typeof release, "function", "the save is in flight")
  const controls = host.querySelectorAll("[data-icono-caretaker-close], [data-icono-caretaker-tab]")
  assert.equal(controls.length, 5, "two close controls and three tabs")
  for (const control of controls) {
    assert.equal(control.disabled, false, control.getAttribute("aria-label") || control.textContent)
  }
  release()
})

test("the autosave indicator is a glyph whose state reads without words (B-874)", async () => {
  let release
  let attempts = 0
  const { host } = await mountForAutosave(async (path, init) => {
    if ((init?.method || "GET") === "GET") return dossier()
    if (++attempts === 1) {
      await new Promise((resolve) => (release = resolve))
      return { manifestation_revision_id: "revision_3" }
    }
    throw Object.assign(new Error("Assignment is not active"), { status: 403 })
  })
  const indicator = () => host.querySelector("[data-icono-caretaker-autosave-state]")
  const glyph = () => indicator().querySelector("svg")
  assert.equal(indicator().dataset.state, "unsaved")
  assert.equal(
    glyph()?.getAttribute("aria-hidden"),
    "true",
    "the glyph is decoration for sighted users",
  )
  assert.equal(indicator().title, "Unsaved changes")
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(indicator().dataset.state, "saving")
  assert.equal(indicator().textContent, "Saving…", "screen readers still hear the word")
  release()
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(indicator().dataset.state, "saved")
  assert.equal(glyph() !== null, true, "updating the state keeps the glyph")
  const prose = host.querySelector("[data-icono-caretaker-prose]")
  prose.value = "Fourth body"
  prose.dispatchEvent(new globalThis.Event("input", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.equal(indicator().dataset.state, "failed")
  assert.equal(indicator().title, "Not saved")
})

test("an uncertain autosave failure retries by itself when the browser reconnects (B-874)", async () => {
  const revisions = []
  const { document, Event, autosaveState } = await mountForAutosave(async (path, init) => {
    if ((init?.method || "GET") === "GET") return dossier()
    revisions.push(JSON.parse(init.body))
    if (revisions.length === 1) throw new TypeError("Failed to fetch")
    return { manifestation_revision_id: "revision_3" }
  })
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.equal(autosaveState(), "Not saved")
  document.defaultView.dispatchEvent(new Event("online"))
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(revisions.length, 2)
  assert.equal(revisions[0].command_id, revisions[1].command_id, "the retry reuses the command")
  assert.equal(autosaveState(), "Saved")
})

test("an uncertain autosave failure retries by itself after 2 seconds (B-874)", async () => {
  let attempts = 0
  const { autosaveState } = await mountForAutosave(async (path, init) => {
    if ((init?.method || "GET") === "GET") return dossier()
    if (++attempts === 1) throw Object.assign(new Error("Bad gateway"), { status: 502 })
    return { manifestation_revision_id: "revision_3" }
  })
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.equal(autosaveState(), "Not saved")
  await new Promise((resolve) => setTimeout(resolve, 2100))
  assert.equal(attempts, 2)
  assert.equal(autosaveState(), "Saved")
})

test("a rejected autosave waits for a person, even after reconnecting (B-874)", async () => {
  let attempts = 0
  const { document, Event, autosaveState } = await mountForAutosave(async (path, init) => {
    if ((init?.method || "GET") === "GET") return dossier()
    attempts += 1
    throw Object.assign(new Error("Assignment is not active"), { status: 403 })
  })
  await new Promise((resolve) => setTimeout(resolve, 1250))
  document.defaultView.dispatchEvent(new Event("online"))
  await new Promise((resolve) => setTimeout(resolve, 2100))
  assert.equal(attempts, 1)
  assert.equal(autosaveState(), "Not saved")
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
  host.querySelector("[data-icono-caretaker-retry-save]").click()
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

test("accepting sends the exact displayed terms and no departure choice (B-860)", async () => {
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
  assert.equal(acceptButton.disabled, false, "terms consent is the only choice")
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
  assert.equal(body.default_leave_policy, undefined)
  assert.equal(body.expected_assignment_version, 3)
})

test("an explicitly disabled dossier mounts no authority surface", async () => {
  const { document } = parseHTML('<div id="host"></div>')
  globalThis.document = document
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

test("B-740 saved tag fields stay parseable under a text-only attribute escaper", async () => {
  // The live iconoplasm app passes its div-based `esc`, which escapes &, < and
  // > but leaves raw quotes. A JSON attribute must survive that escaper: a
  // truncated data-fields-json made readTagFields throw and rendered the whole
  // caretaker island as temporarily unavailable on production.
  function textOnlyEscapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  }
  const { readTagFields } = await import("./caretaker-tag-editor.js")
  const withFields = dossier()
  withFields.prefill_fields = {
    accessories: ["empty_brass_tortoiseshell_gauntlet", "no_headgear"],
    colors: ["baby_pink_skin", "medical_white_garment"],
    note: 'quote " and ampersand & stay intact',
  }
  const html = renderCaretakerManifestationPanel(withFields, textOnlyEscapeHtml)
  const { document } = parseHTML('<html><body><div id="host"></div></body></html>')
  const host = document.getElementById("host")
  host.innerHTML = html
  const source = host.querySelector("[data-icono-caretaker-tags]")
  assert.ok(source, "the tag source textarea must render")
  assert.deepEqual(readTagFields(source), withFields.prefill_fields)
})
