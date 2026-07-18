import assert from "node:assert/strict"
import test from "node:test"

import { editRecapOnDiscord } from "./discord.js"

test("posted recap correction replaces Discord content and attachment in one PATCH", async () => {
  const originalFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return Response.json({ id: "1527828214741729370" })
  }

  try {
    const result = await editRecapOnDiscord(
      { DISCORD_BOT_TOKEN: "secret" },
      {
        day: "2026-07-17",
        channelId: "1449749419628040315",
        messageId: "1527828214741729370",
        content: "Corrected recap",
        screenshotBytes: new Uint8Array([137, 80, 78, 71]),
      },
    )

    assert.equal(result.messageId, "1527828214741729370")
    assert.equal(
      request.url,
      "https://discord.com/api/v10/channels/1449749419628040315/messages/1527828214741729370",
    )
    assert.equal(request.init.method, "PATCH")
    assert.equal(request.init.headers.Authorization, "Bot secret")
    assert.ok(request.init.body instanceof FormData)
    assert.deepEqual(JSON.parse(request.init.body.get("payload_json")), {
      content: "Corrected recap",
      attachments: [{ id: "0", filename: "structure-2026-07-17.png" }],
    })
    assert.equal(request.init.body.get("files[0]").name, "structure-2026-07-17.png")
  } finally {
    globalThis.fetch = originalFetch
  }
})
