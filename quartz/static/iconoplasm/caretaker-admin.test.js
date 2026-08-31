import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { parseHTML } from "linkedom"

const CONTROLLER_SOURCE_NAMES = [
  "caretaker-admin-shared.js",
  "caretaker-admin-registry.js",
  "caretaker-admin-detail.js",
  "caretaker-admin-offer.js",
  "caretaker-admin.js",
]
const CONTROLLER_SOURCES = await Promise.all(
  CONTROLLER_SOURCE_NAMES.map(async (name) => ({
    name,
    source: await readFile(new URL(`./${name}`, import.meta.url), "utf8"),
  })),
)
const ADMIN_SOURCE = await readFile(new URL("./admin.js", import.meta.url), "utf8")
const ADMIN_HTML_SOURCE = await readFile(
  new URL("../../../workers/iconoplasm-admin-html.js", import.meta.url),
  "utf8",
)

const MARKUP = `<!doctype html><html><body>
  <main data-caretaker-admin>
    <button data-caretaker-refresh></button>
    <p data-caretaker-status></p>
    <div data-caretaker-policy></div>
    <input data-caretaker-gene-query />
    <div data-caretaker-gene-results></div>
    <div data-caretaker-gene-selection></div>
    <input data-caretaker-account-query />
    <div data-caretaker-account-results></div>
    <div data-caretaker-account-selection></div>
    <button data-caretaker-offer disabled></button>
    <input data-caretaker-registry-query />
    <select data-caretaker-registry-status><option value="">All</option></select>
    <table><tbody data-caretaker-registry-body></tbody></table>
    <button data-caretaker-registry-more hidden></button>
    <aside data-caretaker-detail></aside>
  </main>
</body></html>`

const ACTIVE_ASSIGNMENT = Object.freeze({
  caretaker_assignment_id: "assignment-1",
  gene_id: "gene-tp53",
  canonical_symbol: "TP53",
  account_id: "account-1",
  author_label: "<img src=x onerror=alert(1)>",
  account_status: "active",
  status: "active",
  assignment_version: 4,
  terms_version_id: "terms_2026_08_30_v1",
  entitlement_policy_version: "caretaker_standard_v1",
  relinquish_policy: "retain",
  created_at: "2026-08-30T00:00:00.000Z",
  started_at: "2026-08-30T01:00:00.000Z",
  suspended_at: null,
  ended_at: null,
  head_version: 7,
  gene_revision: 11,
  canonical_revision_id: "revision-1",
})

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

function createHarness(fetchImplementation) {
  const { window } = parseHTML(MARKUP)
  window.fetch = fetchImplementation
  window.AbortController = AbortController
  window.URLSearchParams = URLSearchParams
  window.Intl = Intl
  window.setTimeout = setTimeout
  window.clearTimeout = clearTimeout
  const context = vm.createContext({
    window,
    document: window.document,
    AbortController,
    URL,
    URLSearchParams,
    Intl,
    TextEncoder,
    Uint8Array,
    Map,
    Set,
    Date,
    Number,
    Object,
    Array,
    String,
    Boolean,
    Promise,
    Error,
    console,
  })
  for (const { name, source } of CONTROLLER_SOURCES) {
    vm.runInContext(source, context, { filename: name })
  }
  return { window, document: window.document, api: window.IconoplasmCaretakerAdmin }
}

async function settle(milliseconds = 0) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function dispatchInput(window, input, value) {
  input.value = value
  input.dispatchEvent(new window.Event("input", { bubbles: true }))
}

function baseFetch(calls, overrides = {}) {
  return async (url, init = {}) => {
    calls.push({ url, init })
    if (overrides[url]) return overrides[url](url, init)
    if (url === "/api/iconoplasm/admin/caretakers/terms") {
      return jsonResponse({
        ok: true,
        entitlement_policy_version: "caretaker_standard_v1",
        terms: [
          {
            terms_version_id: "terms_2026_08_30_v1",
            document_sha256: "a".repeat(64),
            effective_at: "2026-08-30T00:00:00.000Z",
            retired_at: null,
          },
        ],
      })
    }
    if (url.startsWith("/api/iconoplasm/admin/caretakers/registry?")) {
      return jsonResponse({ ok: true, assignments: [ACTIVE_ASSIGNMENT], next_cursor: "" })
    }
    throw new Error(`Unexpected test request: ${url}`)
  }
}

test("admin shell owns a real caretaker tab and mounts the isolated controller", () => {
  assert.match(ADMIN_HTML_SOURCE, /data-tab="caretakers"/)
  assert.match(ADMIN_HTML_SOURCE, /id="panel-caretakers"/)
  const controllerScriptIndexes = CONTROLLER_SOURCE_NAMES.map((name) =>
    ADMIN_HTML_SOURCE.indexOf(name),
  )
  assert.ok(
    controllerScriptIndexes.every((index) => index >= 0),
    "every caretaker controller module must be present in the admin shell",
  )
  assert.deepEqual(
    controllerScriptIndexes,
    controllerScriptIndexes.slice().sort((left, right) => left - right),
    "caretaker controller modules must load in dependency order",
  )
  assert.ok(
    controllerScriptIndexes.at(-1) < ADMIN_HTML_SOURCE.indexOf('src="/static/iconoplasm/admin.js?'),
    "caretaker controller must load before the tab router",
  )
  assert.match(ADMIN_SOURCE, /caretakers: document\.getElementById\("panel-caretakers"\)/)
  assert.match(ADMIN_SOURCE, /IconoplasmCaretakerAdmin\.mount\(\)/)
  assert.match(ADMIN_SOURCE, /IconoplasmCaretakerAdmin\.unmount\(\)/)
})

test("caretaker controller modules remain bounded and responsibility-split", () => {
  for (const { name, source } of CONTROLLER_SOURCES) {
    const physicalLines = source.split(/\r?\n/).length
    assert.ok(physicalLines < 400, `${name} has ${physicalLines} physical lines`)
  }
  const facade = CONTROLLER_SOURCES.find(({ name }) => name === "caretaker-admin.js")
  assert.ok(facade.source.split(/\r?\n/).length < 100, "caretaker facade must stay small")
})

test("offer uses server policy, exact gene revision, and one idempotent POST", async () => {
  const calls = []
  const fetch = baseFetch(calls, {
    "/api/iconoplasm/admin/caretakers/genes?query=TP53&limit=20": async () =>
      jsonResponse({
        ok: true,
        genes: [
          {
            gene_id: "gene-no-source",
            canonical_symbol: "NOSOURCE",
            status: "active",
            head_version: 0,
            gene_revision: 1,
            canonical_revision_id: null,
            open_assignment_status: null,
          },
          {
            gene_id: "gene-tp53",
            canonical_symbol: "TP53",
            status: "active",
            head_version: 7,
            gene_revision: 11,
            canonical_revision_id: "revision-1",
            open_assignment_status: null,
          },
        ],
      }),
    "/api/iconoplasm/admin/caretakers/accounts?query=Brinedew&limit=20": async () =>
      jsonResponse({
        ok: true,
        accounts: [{ account_id: "account-1", author_label: "Brinedew", status: "active" }],
      }),
    "/api/iconoplasm/admin/caretakers/offers": async () =>
      jsonResponse({ ok: true, event_id: "event-1", accepted_event_sequence: 19 }),
  })
  const harness = createHarness(fetch)
  assert.equal(harness.api.mount(), true)
  await settle()

  dispatchInput(
    harness.window,
    harness.document.querySelector("[data-caretaker-gene-query]"),
    "TP53",
  )
  await settle(250)
  const geneButtons = harness.document.querySelectorAll("[data-caretaker-gene-results] button")
  assert.equal(geneButtons[0].disabled, true)
  assert.match(geneButtons[0].textContent, /No verified manifestation source/)
  geneButtons[1].click()
  dispatchInput(
    harness.window,
    harness.document.querySelector("[data-caretaker-account-query]"),
    "Brinedew",
  )
  await settle(250)
  harness.document.querySelector("[data-caretaker-account-results] button").click()

  const offer = harness.document.querySelector("[data-caretaker-offer]")
  assert.equal(offer.disabled, false)
  offer.click()
  offer.click()
  await settle()

  const posts = calls.filter(
    (call) => call.url === "/api/iconoplasm/admin/caretakers/offers" && call.init.method === "POST",
  )
  assert.equal(posts.length, 1)
  const body = JSON.parse(posts[0].init.body)
  assert.match(body.command_id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(
    {
      gene_id: body.gene_id,
      account_id: body.account_id,
      expected_gene_revision: body.expected_gene_revision,
      entitlement_policy_version: body.entitlement_policy_version,
    },
    {
      gene_id: "gene-tp53",
      account_id: "account-1",
      expected_gene_revision: 11,
      entitlement_policy_version: "caretaker_standard_v1",
    },
  )
  harness.api.unmount()
})

test("registry treats labels as text and renders only state-valid controls", async () => {
  const calls = []
  const harness = createHarness(baseFetch(calls))
  harness.api.mount()
  await settle(20)

  assert.equal(harness.document.querySelector("[data-caretaker-registry-body] img"), null)
  assert.match(
    harness.document.querySelector("[data-caretaker-registry-body]").textContent,
    /<img src=x onerror=alert\(1\)>/,
  )
  harness.document.querySelector("[data-caretaker-registry-body] button").click()
  const detail = harness.document.querySelector("[data-caretaker-detail]")
  assert.match(detail.textContent, /Suspend caretaker access/)
  assert.match(detail.textContent, /End this caretaker tenure/)
  assert.doesNotMatch(detail.textContent, /Resume caretaker access/)
  assert.doesNotMatch(detail.textContent, /Cancel invitation/)
  assert.equal(detail.querySelector("input[name='caretaker-relinquish-policy']:checked"), null)
  harness.api.unmount()
})

test("uncertain suspend retry reuses the same command ID and preserves CAS", async () => {
  const calls = []
  var suspendAttempts = 0
  const suspendUrl = "/api/iconoplasm/admin/caretakers/assignments/assignment-1/suspend"
  const fetch = baseFetch(calls, {
    [suspendUrl]: async () => {
      suspendAttempts += 1
      if (suspendAttempts === 1) throw new TypeError("connection reset")
      return jsonResponse({ ok: true, event_id: "event-2", accepted_event_sequence: 20 })
    },
  })
  const harness = createHarness(fetch)
  harness.api.mount()
  await settle(20)
  harness.document.querySelector("[data-caretaker-registry-body] button").click()

  function submitSuspension(reason) {
    const form = Array.from(harness.document.querySelectorAll("[data-caretaker-detail] form")).find(
      (candidate) => /Suspend caretaker access/.test(candidate.textContent),
    )
    form.querySelector("textarea").value = reason
    form.dispatchEvent(new harness.window.Event("submit", { bubbles: true, cancelable: true }))
  }

  submitSuspension("Investigating account compromise")
  await settle()
  assert.match(
    harness.document.querySelector("[data-caretaker-status]").textContent,
    /outcome is uncertain/i,
  )
  submitSuspension("Investigating account compromise")
  await settle()

  const posts = calls.filter((call) => call.url === suspendUrl)
  assert.equal(posts.length, 2)
  const first = JSON.parse(posts[0].init.body)
  const second = JSON.parse(posts[1].init.body)
  assert.equal(first.command_id, second.command_id)
  assert.equal(first.expected_assignment_version, 4)
  assert.equal(second.expected_assignment_version, 4)
  harness.api.unmount()
})

test("end command requires an explicit retention choice and sends all head CAS fields", async () => {
  const calls = []
  const endUrl = "/api/iconoplasm/admin/caretakers/assignments/assignment-1/end"
  const fetch = baseFetch(calls, {
    [endUrl]: async () =>
      jsonResponse({ ok: true, event_id: "event-3", accepted_event_sequence: 21 }),
  })
  const harness = createHarness(fetch)
  harness.api.mount()
  await settle(20)
  harness.document.querySelector("[data-caretaker-registry-body] button").click()
  const endForm = Array.from(
    harness.document.querySelectorAll("[data-caretaker-detail] form"),
  ).find((candidate) => /End this caretaker tenure/.test(candidate.textContent))
  endForm.querySelector("input[value='withdraw']").checked = true
  endForm.querySelector("textarea").value = "Caretaker requested departure"
  endForm.dispatchEvent(new harness.window.Event("submit", { bubbles: true, cancelable: true }))
  await settle()

  const post = calls.find((call) => call.url === endUrl)
  assert.ok(post)
  const body = JSON.parse(post.init.body)
  assert.equal(body.expected_assignment_version, 4)
  assert.equal(body.expected_head_version, 7)
  assert.equal(body.expected_canonical_revision_id, "revision-1")
  assert.equal(body.relinquish_policy, "withdraw")
  assert.equal(body.reason, "Caretaker requested departure")
  harness.api.unmount()
})
