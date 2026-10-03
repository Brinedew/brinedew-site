import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { parseHTML } from "linkedom"

const generatedRuntimePath = new URL(
  "../../quartz/static/iconoplasm/generated/shared-card-runtime.js",
  import.meta.url,
)








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



function budgetSpent(extra = {}) {
  return httpFailure(429, {
    ok: false,
    code: "VOTE_DAILY_BUDGET_EXHAUSTED",
    error: PAUSED_SENTENCE,
    ...extra,
  })
}







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




