import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const popupHtmlUrl = new URL("./popup.html", import.meta.url)
const popupCssUrl = new URL("./popup.css", import.meta.url)

test("popup header exposes the Iconoplasm website link for store-installed users", async () => {
  const [html, css] = await Promise.all([
    readFile(popupHtmlUrl, "utf8"),
    readFile(popupCssUrl, "utf8"),
  ])

  assert.match(
    html,
    /<a[\s\S]*class="popup-site-link"[\s\S]*href="https:\/\/iconoplasm\.brinedew\.bio\/"/,
  )
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener"/)
  assert.match(html, /aria-label="Open Iconoplasm website"/)
  assert.match(css, /\.popup-header-actions/)
  assert.match(css, /\.popup-site-link/)
})
