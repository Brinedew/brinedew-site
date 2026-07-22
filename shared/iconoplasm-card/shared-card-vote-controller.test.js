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
