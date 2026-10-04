import assert from "node:assert/strict"
import test from "node:test"

import { anonymiseCommentPost } from "./iconoplasm/account-erasure/discord-comment-mirror.js"
import { commentMirrorContent } from "./lib/iconoplasm-comment-discord-mirror.js"
import { BOT_TOKEN, CHANNEL_ID, FakeNetwork } from "./test-helpers/fake-discord-and-bunny.js"

// B-992 review: the erased person's name must leave the channel, and no post of a comment that stays
// may be deleted. Failure modes, written before the fix:
// 1. A removed comment with no post of its own (written before the mirror existed) deletes the post
//    of the same person's later comment on the same gene, a comment that stays.
// 2. A comment edited on the site after it was posted keeps the person's name in the channel.
// 3. The post that quotes a removed comment is no longer deleted.

const config = { token: BOT_TOKEN, channelId: CHANNEL_ID }
const link = "https://iconoplasm.brinedew.bio/gene/TP53"
const label = "Former contributor 1"

function channelWithPost(network, body) {
  network.addMessage({
    at: Date.parse("2026-09-01T00:03:01Z"),
    content: commentMirrorContent({ symbol: "TP53", link, username: "ada", body }),
  })
}

const erase = (comment, remove) =>
  anonymiseCommentPost(
    config,
    { fetches: 10 },
    { gene_symbol: "TP53", username: "ada", ...comment },
    { label, remove },
  )

test("a removed comment with no post of its own anonymises the person's nearby post, never deletes it", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  channelWithPost(network, "Second thought.")

  const outcome = await erase(
    { created_at: "2026-09-01T00:00:00Z", body: "First thought, from before the mirror." },
    true,
  )

  assert.equal(outcome, "edited")
  assert.equal(network.messages.length, 1)
  assert.equal(network.messages[0].content.includes(`**${label}**: Second thought.`), true)
  assert.equal(network.messages[0].content.includes("ada"), false)
})

test("a comment edited on the site after posting still takes the name off its post", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  channelWithPost(network, "First draft.")

  const outcome = await erase(
    { created_at: "2026-09-01T00:03:00Z", body: "Edited on the site after it was posted." },
    false,
  )

  assert.equal(outcome, "edited")
  assert.equal(network.messages[0].content.includes(`**${label}**: First draft.`), true)
})

test("the post that quotes a removed comment is deleted", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  channelWithPost(network, "Second thought.")

  const outcome = await erase({ created_at: "2026-09-01T00:03:00Z", body: "Second thought." }, true)

  assert.equal(outcome, "deleted")
  assert.equal(network.messages.length, 0)
})
