import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { parseHTML } from "linkedom"

// B-913: the archival card lives in an iframe, so the refused-vote sentence has to cross to the
// page that owns the notice. This runs the real generated card runtime inside the real frame
// script, with a linkedom document and a parent that records what it is sent.
//
// Ways this can fail, written before the code:
//  1. a refused vote inside the frame posts nothing to the parent, so the reader sees nothing
//     (the state before B-913);
//  2. the frame posts the raw error text ("HTTP 429", "Failed to fetch") instead of the sentence
//     the runtime built;
//  3. a vote the server takes posts a failure;
//  4. a 401 stops posting the login prompt, or also posts a refusal (two notices for one tap);
//  5. a tap on the paused box posts nothing, so the parent cannot show the sentence again;
//  6. the message is missing the `source` marker the parent checks, or the symbol.
const PAUSED = "Voting is paused until 00:00 UTC to protect the site's daily database allowance."
const SOURCE = "iconoplasm-lit-archival-frame"
const FAILED = "ICONOPLASM_LIT_ARCHIVAL_VOTE_FAILED"
const AUTH = "ICONOPLASM_LIT_ARCHIVAL_AUTH_REQUIRED"

async function frameRig(respondToVote) {
  const { window: dom, document } = parseHTML(
    '<!doctype html><html><head></head><body><div id="iconoplasm-root">' +
      '<div id="lit-archival-card-slot"></div></div></body></html>',
  )
  // linkedom's Range cannot build a fragment; a template does the same job for the frame.
  document.createRange = () => ({
    selectNodeContents() {},
    createContextualFragment(markup) {
      const template = document.createElement("template")
      template.innerHTML = markup
      return template.content
    },
  })
  const posted = []
  const listeners = new Map()
  const calls = []
  const parent = { postMessage: (message) => posted.push(message) }
  const sandbox = {
    console,
    AbortController,
    Element: dom.Element,
    Image: class {
      addEventListener() {}
    },
    document,
    parent,
    // The runtime pauses a refused box with a timer as long as the server's reset; an unref'd
    // timer lets this test process exit instead of waiting out the hour.
    setTimeout: (callback, delay) => {
      const timer = setTimeout(callback, delay)
      timer.unref()
      return timer
    },
    clearTimeout,
    requestAnimationFrame: () => 0,
    addEventListener: (type, callback) => listeners.set(type, callback),
    fetch: async (url, init) => {
      const path = String(url).replace(/^.*\/api\/iconoplasm/, "")
      calls.push(path)
      const answer =
        path === "/votes/snapshot"
          ? {
              status: 200,
              body: {
                authenticated: true,
                snapshot: { image_upvotes: 0, image_downvotes: 0, image_score: 0, user_vote: 0 },
              },
            }
          : respondToVote(JSON.parse(init.body))
      return {
        ok: answer.status < 400,
        status: answer.status,
        text: async () =>
          answer.body === undefined ? "<html>Bad gateway</html>" : JSON.stringify(answer.body),
      }
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.runInNewContext(
    await readFile(new URL("./generated/shared-card-runtime.js", import.meta.url), "utf8"),
    sandbox,
  )
  vm.runInNewContext(
    await readFile(new URL("./lit-archival-frame.js", import.meta.url), "utf8"),
    sandbox,
  )
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  listeners.get("message")({
    source: parent,
    data: {
      type: "ICONOPLASM_LIT_ARCHIVAL_RENDER",
      requestId: "1",
      symbol: "TP53",
      loading: true,
      pageUrl: "https://iconoplasm.brinedew.bio/gene/TP53",
      gene: { symbol: "TP53", full_name: "tumor protein p53" },
      vote: { symbol: "TP53", assetSha: "ab12", visionId: "v1", candidateImageId: 0 },
    },
  })
  await settle()
  const box = document.querySelector("[data-icono-vote-box]")
  assert.equal(box !== null, true, "the frame must render a vote box")
  return {
    calls,
    settle,
    tap: async () => {
      document.querySelector("[data-icono-vote-up]").click()
      await settle()
    },
    ofType: (type) => posted.filter((message) => message.type === type),
  }
}

test("a refused vote in the frame posts the server's sentence to the parent", async () => {
  const rig = await frameRig(() => ({
    status: 429,
    body: {
      ok: false,
      code: "VOTE_DAILY_BUDGET_EXHAUSTED",
      error: PAUSED,
      retry_after_seconds: 3600,
    },
  }))
  await rig.tap()
  const failures = rig.ofType(FAILED)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].message === PAUSED, true)
  assert.equal(failures[0].source, SOURCE)
  assert.equal(failures[0].symbol, "TP53")
  assert.equal(rig.ofType(AUTH).length, 0)
})

test("every tap on the paused box posts the sentence again and sends no request", async () => {
  const rig = await frameRig(() => ({
    status: 429,
    body: { ok: false, error: PAUSED, retry_after_seconds: 3600 },
  }))
  await rig.tap()
  await rig.tap()
  await rig.tap()
  assert.equal(rig.ofType(FAILED).length, 3)
  assert.equal(rig.calls.filter((call) => call === "/votes/set").length, 1)
})

test("a lost connection posts the generic line, never the browser's words", async () => {
  const rig = await frameRig(() => ({ status: 502, body: undefined }))
  await rig.tap()
  const failures = rig.ofType(FAILED)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].message === "Couldn't save your vote. Please try again.", true)
})

test("a vote the server takes posts nothing to the parent", async () => {
  const rig = await frameRig(() => ({
    status: 200,
    body: {
      ok: true,
      snapshot: { image_upvotes: 1, image_downvotes: 0, image_score: 1, user_vote: 1 },
    },
  }))
  await rig.tap()
  assert.equal(rig.ofType(FAILED).length, 0)
  assert.equal(rig.ofType(AUTH).length, 0)
})

test("a 401 still posts the login prompt and no refusal", async () => {
  const rig = await frameRig(() => ({
    status: 401,
    body: { code: "AUTH_REQUIRED", error: "Please log-in first to vote." },
  }))
  await rig.tap()
  assert.equal(rig.ofType(AUTH).length, 1)
  assert.equal(rig.ofType(FAILED).length, 0)
})
