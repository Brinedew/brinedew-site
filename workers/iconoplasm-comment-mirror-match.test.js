import assert from "node:assert/strict"
import test from "node:test"

import { anonymiseCommentPost } from "./iconoplasm/account-erasure/discord-comment-mirror.js"
import { commentMirrorContent } from "./lib/iconoplasm-comment-discord-mirror.js"
import { BOT_TOKEN, CHANNEL_ID, FakeNetwork } from "./test-helpers/fake-discord-and-bunny.js"

// B-992 review: the erasure acts only on the post that quotes the comment it is erasing. Failure
// modes, written before the fix:
// 1. A removed comment with no post of its own (written before the mirror existed) deletes the post
//    of the same person's later comment on the same gene, a comment that stays.
// 2. A comment whose text no longer matches its post edits a different comment's post.

const config = { token: BOT_TOKEN, channelId: CHANNEL_ID }
const link = "https://iconoplasm.brinedew.bio/gene/TP53"
const at = (iso) => Date.parse(iso)

function channelWithLaterComment(network) {
  network.addMessage({
    at: at("2026-09-01T00:03:01Z"),
    content: commentMirrorContent({
      symbol: "TP53",
      link,
      username: "ada",
      body: "Second thought.",
    }),
  })
}

test("a removed comment with no post of its own leaves the person's other post alone", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  channelWithLaterComment(network)

  const outcome = await anonymiseCommentPost(
    config,
    { fetches: 10 },
    {
      created_at: "2026-09-01T00:00:00Z",
      gene_symbol: "TP53",
      username: "ada",
      body: "First thought, from before the mirror.",
    },
    { label: "Former contributor 1", remove: true },
  )

  assert.equal(outcome, "not_found")
  assert.equal(network.messages.length, 1)
  assert.equal(network.messages[0].content.includes("**ada**: Second thought."), true)
})

test("a comment whose text no longer matches its post edits no other post", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  channelWithLaterComment(network)

  const outcome = await anonymiseCommentPost(
    config,
    { fetches: 10 },
    {
      created_at: "2026-09-01T00:02:00Z",
      gene_symbol: "TP53",
      username: "ada",
      body: "Edited on the site after it was posted.",
    },
    { label: "Former contributor 1", remove: false },
  )

  assert.equal(outcome, "not_found")
  assert.equal(network.messages[0].content.includes("**ada**: Second thought."), true)
})

test("the post that quotes the comment is still found and rewritten", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  channelWithLaterComment(network)

  const outcome = await anonymiseCommentPost(
    config,
    { fetches: 10 },
    {
      created_at: "2026-09-01T00:03:00Z",
      gene_symbol: "TP53",
      username: "ada",
      body: "Second thought.",
    },
    { label: "Former contributor 1", remove: false },
  )

  assert.equal(outcome, "edited")
  assert.equal(
    network.messages[0].content.includes("**Former contributor 1**: Second thought."),
    true,
  )
  assert.equal(network.messages[0].content.includes("ada"), false)
})
