import assert from "node:assert/strict"
import test from "node:test"

import {
  standaloneIconoplasmHtml,
  unservedIconoplasmLinks,
} from "./prepare-iconoplasm-edge-assets.mjs"

// B-812: Tutorial, About and Caretaker Terms on iconoplasm.brinedew.bio used to
// resolve to paths only brinedew.bio serves, so readers got the Iconoplasm
// homepage instead. The build rewrites them and refuses unserved local links.

test("main-site and legal links point at their real owners", () => {
  const html = standaloneIconoplasmHtml(
    [
      '<a href="../../apps/iconoplasm/caretaker-terms">Terms</a>',
      '<a href="../../apps/iconoplasm/privacy">Privacy</a>',
      '<a href="/About.html">About</a>',
      '<a href="/posts">Posts</a>',
      '<a href="/posts/support-me">Support</a>',
      '<a href="/wiki/Tutorial-How-to-generate-and-edit-blots-in-Iconoplasm">Tutorial</a>',
    ].join(""),
  )
  assert.match(html, /href="\/caretaker-terms"/)
  assert.match(html, /href="\/privacy"/)
  assert.match(html, /href="https:\/\/brinedew\.bio\/about"/)
  assert.match(html, /href="https:\/\/brinedew\.bio\/posts"/)
  assert.match(html, /href="https:\/\/brinedew\.bio\/posts\/support-me"/)
  assert.match(
    html,
    /href="https:\/\/brinedew\.bio\/wiki\/tutorial-how-to-generate-and-edit-blots-in-iconoplasm"/,
  )
  assert.deepEqual(unservedIconoplasmLinks(html, ["caretaker-terms.html", "privacy.html"]), [])
})

test("a local link this host cannot serve is reported", () => {
  const html = '<a href="/">Home</a><a href="/gene/TP53">TP53</a><a href="/About.html">About</a>'
  assert.deepEqual(unservedIconoplasmLinks(html, ["index.html"]), ["/About.html"])
})
