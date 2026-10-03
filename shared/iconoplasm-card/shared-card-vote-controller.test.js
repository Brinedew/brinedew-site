import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { parseHTML } from "linkedom"

const generatedRuntimePath = new URL(
  "../../quartz/static/iconoplasm/generated/shared-card-runtime.js",
  import.meta.url,
)

function response(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  }
}

test("responsive vote views share one controller and one mutation", async () => {
  const runtime = await readFile(generatedRuntimePath, "utf8")
  const sandbox = { console, clearTimeout, setTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtime, sandbox)

  const shared = sandbox.IconoplasmCardShared
  const markup = shared.voteBoxMarkup('data-test-view="mobile"', { variant: "label" })
  const desktopMarkup = shared.voteBoxMarkup('data-test-view="desktop"', {
    variant: "label",
  })
  const { document } = parseHTML(`<main>${markup}${desktopMarkup}</main>`)
  const [mobileBox, desktopBox] = document.querySelectorAll("[data-icono-vote-box]")
  const fetchCalls = []
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ body: JSON.parse(init.body), url })
    return response({
      authenticated: true,
      snapshot: {
        image_upvotes: fetchCalls.length === 1 ? 1 : 0,
        image_downvotes: 0,
        image_score: fetchCalls.length === 1 ? 1 : 0,
        user_vote: fetchCalls.length === 1 ? 1 : 0,
      },
    })
  }

  const handle = shared.wireVoteBox(mobileBox, {
    assetSha: "abc123",
    deferSnapshot: true,
    fetchImpl,
    mirrorBoxes: [desktopBox],
    symbol: "PTEN",
  })
  handle.setSnapshot(
    { image_upvotes: 0, image_downvotes: 0, image_score: 0, user_vote: 0 },
    { authenticated: true },
  )

  assert.equal(handle.boxes.length, 2)
  assert.equal(mobileBox.getAttribute("data-icono-vote-wired"), "true")
  assert.equal(desktopBox.getAttribute("data-icono-vote-wired"), "true")

  desktopBox.querySelector("[data-icono-vote-up]").click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(fetchCalls.length, 1, "one click must produce one authoritative mutation")
  assert.match(fetchCalls[0].url, /\/api\/iconoplasm\/votes\/set$/)
  assert.equal(fetchCalls[0].body.vote_value, 1)
  for (const box of [mobileBox, desktopBox]) {
    assert.equal(box.querySelector("[data-icono-vote-up]").classList.contains("active"), true)
    assert.equal(box.querySelector("[data-icono-vote-down]").classList.contains("active"), false)
  }

  mobileBox.querySelector("[data-icono-vote-up]").click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(fetchCalls.length, 2, "the alternate responsive view must reuse the same controller")
  assert.equal(fetchCalls[1].body.vote_value, 0)
  for (const box of [mobileBox, desktopBox]) {
    assert.equal(box.querySelector("[data-icono-vote-up]").classList.contains("active"), false)
    assert.equal(box.querySelector("[data-icono-vote-down]").classList.contains("active"), false)
  }
})

test("authentication failures return the exact vote control that opened the login prompt", async () => {
  const runtime = await readFile(generatedRuntimePath, "utf8")
  const sandbox = { console, clearTimeout, setTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtime, sandbox)

  const shared = sandbox.IconoplasmCardShared
  const { document } = parseHTML(`<main>${shared.voteBoxMarkup("", { variant: "label" })}</main>`)
  const box = document.querySelector("[data-icono-vote-box]")
  const upButton = box.querySelector("[data-icono-vote-up]")
  let authPromptSource = null

  shared.wireVoteBox(box, {
    assetSha: "abc123",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ code: "AUTH_REQUIRED", error: "Log in" }),
    }),
    onAuthRequired(_error, sourceControl) {
      authPromptSource = sourceControl
    },
    symbol: "TP53",
  })

  upButton.click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(authPromptSource === upButton, true)
})

// A vote the server refuses must tell the reader why and put the controls back.
//
// Ways this can fail, written before the code:
//  1. a 429 (voting paused until 00:00 UTC) or any other HTTP refusal that carries a JSON
//     `error` sentence reaches the reader as nothing, "HTTP 429", or the raw status;
//  2. a network failure or an error page with no JSON shows browser jargon ("Failed to
//     fetch", "HTTP 502") instead of a short generic line;
//  3. the refused tick stays lit, or the score, or the stored snapshot, keeps the vote the
//     server did not take (including a flip away from an existing vote);
//  4. a 4xx still costs a second request (the snapshot refresh) on top of the refused one;
//  5. a 5xx or a lost response stops reconciling with the server, which may have committed;
//  6. a 401 shows a refusal sentence besides the login prompt, or stops opening the prompt;
//  7. the buttons stay disabled after a refusal, so the reader cannot try again after the
//     reset;
//  8. a successful vote shows a message.
const GENERIC_VOTE_FAILURE = "Couldn't save your vote. Please try again."
const PAUSED_SENTENCE =
  "Voting is paused until 00:00 UTC to protect the site's daily database allowance."

function httpFailure(status, payload) {
  return {
    ok: false,
    status,
    text: async () =>
      payload === undefined ? "<html>Bad gateway</html>" : JSON.stringify(payload),
  }
}

function snapshotAnswer(snapshot) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ authenticated: true, snapshot }),
  })
}

function voteSnapshot(up, down, userVote) {
  return {
    image_upvotes: up,
    image_downvotes: down,
    image_score: up - down,
    user_vote: userVote,
  }
}

// A clock the test owns. The runtime under test gets this `Date`, `setTimeout` and
// `clearTimeout`, so a day-long pause can be crossed without waiting.
function fakeClock(startIso = "2026-10-03T14:00:00.000Z") {
  let now = Date.parse(startIso)
  let nextId = 1
  const timers = new Map()
  class ClockDate extends Date {
    constructor(...args) {
      if (args.length) super(...args)
      else super(now)
    }
    static now() {
      return now
    }
  }
  return {
    Date: ClockDate,
    setTimeout(callback, delay) {
      const id = nextId++
      timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    // Moves the wall clock and runs every timer that has come due, oldest first.
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].callback()
      }
      now = target
    },
    // Moves the wall clock only: the timers did not run, as on a laptop that slept.
    jump(ms) {
      now += ms
    },
    pending: () => timers.size,
  }
}

// `hold` keeps the vote request in flight until `release()`, so a test can look at the screen
// before the server answers. `respondWith` swaps the server's answer between taps.
async function refusalRig({ initial, setResponse, snapshotResponse, hold = false, onVoteFailed }) {
  const storage = new Map()
  const clock = fakeClock()
  let respond = setResponse
  let release = () => {}
  const gate = hold ? new Promise((resolve) => (release = resolve)) : null
  const sandbox = {
    console,
    Date: clock.Date,
    clearTimeout: clock.clearTimeout,
    setTimeout: clock.setTimeout,
  }
  sandbox.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(await readFile(generatedRuntimePath, "utf8"), sandbox)
  const shared = sandbox.IconoplasmCardShared
  const markup = shared.voteBoxMarkup("", { variant: "label" })
  const { document } = parseHTML(`<main>${markup}${markup}</main>`)
  const [box, mirror] = document.querySelectorAll("[data-icono-vote-box]")
  const calls = []
  const messages = []
  const failures = []
  const errors = []
  let authPrompts = 0
  const fetchImpl = async (url, init) => {
    calls.push(String(url).replace(/^.*\/api\/iconoplasm/, ""))
    if (/\/votes\/set$/.test(url)) {
      if (gate) await gate
      return respond(JSON.parse(init.body))
    }
    if (snapshotResponse) return snapshotResponse()
    throw new Error("unexpected request " + url)
  }
  const handle = shared.wireVoteBox(box, {
    assetSha: "abc123",
    deferSnapshot: true,
    fetchImpl,
    mirrorBoxes: [mirror],
    onAuthRequired() {
      authPrompts += 1
    },
    onError(phase, error) {
      errors.push({ phase, status: Number((error && error.status) || 0) })
    },
    onVoteFailed(message, error) {
      messages.push(message)
      failures.push(error)
      if (onVoteFailed) onVoteFailed(message, error)
    },
    symbol: "PTEN",
  })
  handle.setSnapshot(initial, { authenticated: true })
  const view = (root) => ({
    up: root.querySelector("[data-icono-vote-up]").classList.contains("active"),
    down: root.querySelector("[data-icono-vote-down]").classList.contains("active"),
    upDisabled: root.querySelector("[data-icono-vote-up]").disabled === true,
    downDisabled: root.querySelector("[data-icono-vote-down]").disabled === true,
    upAria: root.querySelector("[data-icono-vote-up]").getAttribute("aria-disabled"),
    downAria: root.querySelector("[data-icono-vote-down]").getAttribute("aria-disabled"),
    paused: root.hasAttribute("data-icono-vote-paused"),
    score: root.getAttribute("title"),
  })
  return {
    box,
    mirror,
    calls,
    clock,
    messages,
    failures,
    errors,
    storage,
    respondWith: (next) => {
      respond = next
    },
    details: (up, down) => shared.voteSummaryDetails(voteSnapshot(up, down, 0)),
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
    release: () => release(),
    view,
    authPrompts: () => authPrompts,
  }
}

test("a 429 refusal shows the server's sentence and puts the vote back", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(3, 1, 0),
    hold: true,
    setResponse: () =>
      httpFailure(429, { ok: false, code: "VOTE_DAILY_BUDGET_EXHAUSTED", error: PAUSED_SENTENCE }),
  })
  rig.mirror.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  // The tick is lit before the server answers, in both views.
  for (const root of [rig.box, rig.mirror]) {
    assert.equal(rig.view(root).up, true)
    assert.equal(rig.view(root).score === rig.details(4, 1), true)
  }
  assert.equal(rig.messages.length, 0)
  rig.release()
  await rig.settle()

  assert.equal(rig.messages.length, 1)
  assert.equal(rig.messages[0] === PAUSED_SENTENCE, true)
  for (const root of [rig.box, rig.mirror]) {
    const shown = rig.view(root)
    assert.equal(shown.up, false)
    assert.equal(shown.down, false)
    assert.equal(shown.score === rig.details(3, 1), true)
  }
  assert.equal(rig.storage.size, 0, "a vote the server refused must not stay in storage")
  assert.equal(rig.errors.length, 1)
  assert.equal(rig.errors[0].phase, "set")
  assert.equal(rig.errors[0].status, 429)
})

test("a refused 4xx costs one request, not a second snapshot read", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => httpFailure(429, { error: PAUSED_SENTENCE }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 1)
  assert.equal(rig.calls[0], "/votes/set")
})

for (const [status, sentence] of [
  [400, "vote_value must be -1, 0, or 1"],
  [404, "That candidate no longer exists."],
  [409, "Another vote changed this candidate. Reload and try again."],
  [503, "Votes are temporarily unavailable."],
]) {
  test(`a ${status} refusal shows the sentence the server sent`, async () => {
    const rig = await refusalRig({
      initial: voteSnapshot(1, 0, 0),
      setResponse: () => httpFailure(status, { ok: false, error: sentence }),
      snapshotResponse: snapshotAnswer(voteSnapshot(1, 0, 0)),
    })
    rig.box.querySelector("[data-icono-vote-down]").click()
    await rig.settle()
    assert.equal(rig.messages.length, 1)
    assert.equal(rig.messages[0] === sentence, true)
  })
}

test("a refused flip restores the earlier vote, not an empty one", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(4, 0, 1),
    hold: true,
    setResponse: () => httpFailure(429, { error: PAUSED_SENTENCE }),
  })
  rig.box.querySelector("[data-icono-vote-down]").click()
  await rig.settle()
  assert.equal(rig.view(rig.box).down, true)
  assert.equal(rig.view(rig.box).up, false)
  rig.release()
  await rig.settle()

  for (const root of [rig.box, rig.mirror]) {
    const shown = rig.view(root)
    assert.equal(shown.up, true)
    assert.equal(shown.down, false)
    assert.equal(shown.score === rig.details(4, 0), true)
  }
  assert.equal(JSON.parse([...rig.storage.values()][0]).user_vote, 1)
})

// B-912: after the server says "not now" (429) the box stops asking until it said it would work.
//
// Ways this can fail, written before the code:
//  1. after a 429 the next tap still sends a vote request, so a reader who taps three times
//     costs the Worker three refused requests;
//  2. a tap on the paused box is silent, which is the original silent snap-back again, on a
//     phone where a disabled button shows no tooltip;
//  3. a tap on the paused box lights the tick again, or writes it to storage;
//  4. the paused box looks live (nothing dimmed, nothing for a screen reader), or it is
//     really `disabled`, so the tap never arrives and the sentence cannot be shown again;
//  5. the pause never ends: a tab still open after 00:00 UTC keeps saying "paused until 00:00
//     UTC", because the box waited for a reload or for a timer that a sleeping laptop never ran;
//  6. the pause ends early, or the same tap that ends it is swallowed;
//  7. a 429 with no usable number (absent, zero, negative, text) unlocks itself on a guess
//     instead of waiting for the reload, or a huge number locks the box for longer than a day;
//  8. a refusal that is not a 429 (400, 404, 409, 5xx, 401) pauses the box, though those are
//     about one request, not about the site's allowance;
//  9. a callback that throws on a paused tap breaks the click handler;
// 10. a second 429 after the pause ended does not pause the box again.
const RESET_SECONDS = 3_600

function budgetSpent(extra = {}) {
  return httpFailure(429, {
    ok: false,
    code: "VOTE_DAILY_BUDGET_EXHAUSTED",
    error: PAUSED_SENTENCE,
    ...extra,
  })
}

test("after a 429 the box sends nothing more and says why on every tap", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(3, 1, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: RESET_SECONDS }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.deepEqual(rig.calls, ["/votes/set"])
  assert.equal(rig.messages.length, 1)

  rig.box.querySelector("[data-icono-vote-up]").click()
  rig.box.querySelector("[data-icono-vote-down]").click()
  rig.mirror.querySelector("[data-icono-vote-up]").click()
  await rig.settle()

  assert.deepEqual(rig.calls, ["/votes/set"], "three taps on a paused box send nothing")
  assert.equal(rig.messages.length, 4, "every tap on the paused box shows the sentence again")
  for (const message of rig.messages) assert.equal(message === PAUSED_SENTENCE, true)
  assert.equal(rig.failures[0].status, 429)
  assert.equal(rig.failures[1], null, "a tap that sent no request has no error to hand over")
  for (const root of [rig.box, rig.mirror]) {
    const shown = rig.view(root)
    assert.equal(shown.up, false)
    assert.equal(shown.down, false)
    assert.equal(shown.score === rig.details(3, 1), true)
  }
  assert.equal(rig.storage.size, 0, "a tap on the paused box must not write a vote")
  assert.equal(rig.errors.length, 1, "taps that sent nothing are not errors")
})

test("a paused box looks paused in every view and still receives the tap", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: RESET_SECONDS }),
  })
  for (const root of [rig.box, rig.mirror]) {
    assert.equal(rig.view(root).paused, false)
    assert.equal(rig.view(root).upAria, null)
  }
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  for (const root of [rig.box, rig.mirror]) {
    const shown = rig.view(root)
    assert.equal(shown.paused, true)
    assert.equal(shown.upAria, "true")
    assert.equal(shown.downAria, "true")
    assert.equal(shown.upDisabled, false, "a disabled button swallows the tap that shows why")
    assert.equal(shown.downDisabled, false)
  }
})

test("the pause ends at the server's reset, by timer", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: 90 }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  rig.clock.advance(89_000)
  assert.equal(rig.view(rig.box).paused, true, "one second early is still paused")
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 1)

  rig.clock.advance(1_000)
  for (const root of [rig.box, rig.mirror]) {
    const shown = rig.view(root)
    assert.equal(shown.paused, false)
    assert.equal(shown.upAria, null)
    assert.equal(shown.downAria, null)
  }
  rig.respondWith(snapshotAnswer(voteSnapshot(1, 0, 1)))
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 2, "the first tap after the reset reaches the server")
  assert.equal(rig.view(rig.box).up, true)
})

test("a tap after the reset goes through even if the timer never ran", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: 90 }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  // A laptop that slept through the reset: the wall clock moved, the timer did not fire.
  rig.clock.jump(120_000)
  rig.respondWith(snapshotAnswer(voteSnapshot(1, 0, 1)))
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 2, "the tap that finds the reset passed is not swallowed")
  assert.equal(rig.view(rig.box).paused, false)
  assert.equal(rig.view(rig.box).up, true)
})

test("a 429 that carries no usable number pauses the box until reload", async () => {
  for (const retry of [undefined, 0, -5, "90", "soon", null]) {
    const rig = await refusalRig({
      initial: voteSnapshot(0, 0, 0),
      setResponse: () => budgetSpent(retry === undefined ? {} : { retry_after_seconds: retry }),
    })
    const timersBefore = rig.clock.pending()
    rig.box.querySelector("[data-icono-vote-up]").click()
    await rig.settle()
    assert.equal(
      rig.clock.pending(),
      timersBefore,
      `retry_after_seconds ${JSON.stringify(retry)}: no timer to unlock on a guess`,
    )
    rig.clock.advance(48 * 3_600_000)
    rig.box.querySelector("[data-icono-vote-up]").click()
    await rig.settle()
    assert.equal(
      rig.calls.length,
      1,
      `retry_after_seconds ${JSON.stringify(retry)}: still paused two days later`,
    )
    assert.equal(rig.view(rig.box).paused, true)
  }
})

test("a reset longer than a day is clamped to a day", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: 10_000_000 }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  rig.clock.advance(86_399_000)
  assert.equal(rig.view(rig.box).paused, true)
  rig.clock.advance(1_000)
  assert.equal(rig.view(rig.box).paused, false)
})

for (const status of [400, 404, 409, 500, 503]) {
  test(`a ${status} refusal does not pause the box`, async () => {
    const rig = await refusalRig({
      initial: voteSnapshot(0, 0, 0),
      setResponse: () => httpFailure(status, { ok: false, error: "Not this time." }),
      snapshotResponse: snapshotAnswer(voteSnapshot(0, 0, 0)),
    })
    rig.box.querySelector("[data-icono-vote-up]").click()
    await rig.settle()
    assert.equal(rig.view(rig.box).paused, false)
    assert.equal(rig.view(rig.box).upAria, null)
    assert.equal(rig.view(rig.box).upDisabled, false)
    assert.equal(rig.view(rig.box).downDisabled, false)
    rig.box.querySelector("[data-icono-vote-up]").click()
    await rig.settle()
    assert.equal(
      rig.calls.filter((call) => call === "/votes/set").length,
      2,
      "the second tap reaches the server",
    )
  })
}

test("a 401 does not pause the box", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () =>
      httpFailure(401, { code: "AUTH_REQUIRED", error: "Please log-in first to vote." }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 2)
  assert.equal(rig.authPrompts(), 2)
  assert.equal(rig.view(rig.box).paused, false)
})

test("a callback that throws on a paused tap does not break the click", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: RESET_SECONDS }),
    onVoteFailed(_message, error) {
      if (error === null) throw new Error("the host notice failed")
    },
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.doesNotThrow(() => rig.box.querySelector("[data-icono-vote-up]").click())
  await rig.settle()
  assert.equal(rig.errors.at(-1).phase, "vote_failed")
  assert.equal(rig.calls.length, 1)
})

test("a second 429 after the pause ended pauses the box again with its own sentence", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => budgetSpent({ retry_after_seconds: 60 }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  rig.clock.advance(60_000)
  rig.respondWith(() =>
    httpFailure(429, { ok: false, error: "Still paused.", retry_after_seconds: 30 }),
  )
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 2)
  assert.equal(rig.messages.at(-1) === "Still paused.", true)
  assert.equal(rig.view(rig.box).paused, true)
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.calls.length, 2, "paused again")
  rig.clock.advance(30_000)
  assert.equal(rig.view(rig.box).paused, false)
})

test("an error page with no JSON shows the generic line, never the status text", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => httpFailure(502, undefined),
    snapshotResponse: snapshotAnswer(voteSnapshot(0, 0, 0)),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.messages.length, 1)
  assert.equal(rig.messages[0] === GENERIC_VOTE_FAILURE, true)
})

test("a network failure shows the generic line and reconciles with the server", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => {
      throw new TypeError("Failed to fetch")
    },
    snapshotResponse: snapshotAnswer(voteSnapshot(1, 0, 1)),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.messages.length, 1)
  assert.equal(rig.messages[0] === GENERIC_VOTE_FAILURE, true)
  // The response was lost, so the server may have taken the vote: the snapshot decides.
  assert.deepEqual(rig.calls, ["/votes/set", "/votes/snapshot"])
  assert.equal(rig.view(rig.box).up, true)
  assert.equal(rig.view(rig.box).score === rig.details(1, 0), true)
})

test("a 5xx keeps the optimistic vote until the snapshot answers", async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const answer = snapshotAnswer(voteSnapshot(0, 0, 0))
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: () => httpFailure(500, { error: "Votes are temporarily unavailable." }),
    snapshotResponse: async () => {
      await gate
      return answer()
    },
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.deepEqual(rig.calls, ["/votes/set", "/votes/snapshot"])
  assert.equal(rig.view(rig.box).up, true, "a 5xx is ambiguous: the server may have committed")
  release()
  await rig.settle()
  assert.equal(rig.view(rig.box).up, false)
})

test("a 401 still opens the login prompt and shows no refusal sentence", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(2, 0, 0),
    setResponse: () =>
      httpFailure(401, { code: "AUTH_REQUIRED", error: "Please log-in first to vote." }),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.authPrompts(), 1)
  assert.equal(rig.messages.length, 0)
  assert.equal(rig.view(rig.box).up, false)
  assert.equal(rig.calls.length, 1)
})

test("a vote the server takes shows no message", async () => {
  const rig = await refusalRig({
    initial: voteSnapshot(0, 0, 0),
    setResponse: snapshotAnswer(voteSnapshot(1, 0, 1)),
  })
  rig.box.querySelector("[data-icono-vote-up]").click()
  await rig.settle()
  assert.equal(rig.messages.length, 0)
  assert.equal(rig.view(rig.box).up, true)
})
