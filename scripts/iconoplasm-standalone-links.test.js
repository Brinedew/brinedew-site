import assert from "node:assert/strict"
import test from "node:test"

import {
  ICONOPLASM_MOVED_PATHS,
  ICONOPLASM_MOVED_PREFIXES,
  ICONOPLASM_REDIRECTS,
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
    "apps/iconoplasm/index",
  )
  assert.match(html, /href="\/caretaker-terms"/)
  assert.match(html, /href="\/privacy"/)
  assert.match(html, /href="https:\/\/brinedew\.bio\/about"/)
  assert.match(html, /href="https:\/\/brinedew\.bio\/posts"/)
  assert.match(html, /href="https:\/\/brinedew\.bio\/posts\/support-me"/)
  assert.match(html, /href="\/docs\/tutorial"/)
  assert.deepEqual(
    unservedIconoplasmLinks(html, ["caretaker-terms.html", "privacy.html", "docs/tutorial.html"]),
    [],
  )
})

// B-1164: the docs are Quartz pages under apps/iconoplasm/docs/, served here at
// /docs/<page>. Quartz links them relative to that main-site slug. Ways this can fail:
//  1. A sibling doc or the landing page resolves against /docs/faq's real URL
//     and lands on /tutorial or /docs/index, which this host doesn't serve.
//  2. A legal page or the archive is linked as /apps/iconoplasm/..., one redirect away.
//  3. A tutorial screenshot points at /attachments/ here, which this host doesn't
//     serve (the vault's attachments stay on brinedew.bio), so readers see broken images.
//  4. A wiki note or post linked from a doc lands on this host's SPA instead of brinedew.bio.
//  5. The shared scripts, styles, anchors and outside links are rewritten.
test("a docs page's relative links resolve to this host or to brinedew.bio", () => {
  const html = standaloneIconoplasmHtml(
    [
      '<link href="../../../index.css" rel="stylesheet">',
      '<script src="../../../static/resource-after-1.js"></script>',
      '<a href="./tutorial#2-log-in">Tutorial</a>',
      '<a href="../docs/">Docs</a>',
      '<a href="../privacy">Privacy</a>',
      '<a href="../">Archive</a>',
      '<img src="../../../attachments/image-29.png">',
      '<a href="../../../wiki/support-me">Support</a>',
      '<a href="#who-are-caretakers">Anchor</a>',
      '<a href="https://slatestarcodex.com/">SSC</a>',
      '<a href="mailto:support@brinedew.bio">Mail</a>',
    ].join(""),
    "apps/iconoplasm/docs/faq",
  )
  // 1
  assert.match(html, /href="\/docs\/tutorial#2-log-in"/)
  assert.match(html, /href="\/docs"/)
  // 2
  assert.match(html, /href="\/privacy"/)
  assert.match(html, /href="\/">Archive/)
  // 3
  assert.match(html, /src="https:\/\/brinedew\.bio\/attachments\/image-29\.png"/)
  // 4
  assert.match(html, /href="https:\/\/brinedew\.bio\/wiki\/support-me"/)
  // 5
  assert.match(html, /href="\/index\.css"/)
  assert.match(html, /src="\/static\/resource-after-1\.js"/)
  assert.match(html, /href="#who-are-caretakers"/)
  assert.match(html, /href="https:\/\/slatestarcodex\.com\/"/)
  assert.match(html, /href="mailto:support@brinedew\.bio"/)
  assert.deepEqual(
    unservedIconoplasmLinks(html, [
      "index.css",
      "index.html",
      "privacy.html",
      "docs.html",
      "docs/tutorial.html",
    ]),
    [],
  )
})

// B-818: one table of moved paths drives both the 301s and the link rewrites.
// Ways this can fail:
//  1. A moved path gets a 301 but the Quartz pages still link to it, so every
//     click pays a redirect hop (or the reverse: rewritten, never redirected,
//     so outside links to it land on the SPA homepage).
//  2. An exact rule sits below a splat that also matches it, so the splat wins
//     (the Title-Case tutorial slug would go to the main site's alias stub).
//  3. A dynamic (splat) rule precedes static ones, against the platform's rule
//     that static redirects come first.
//  4. A rule's source is not a clean path or its status is not a permanent 301.
test("every moved path is redirected once and rewritten in the pages", () => {
  const lines = ICONOPLASM_REDIRECTS.trim().split("\n")
  for (const [from, to] of ICONOPLASM_MOVED_PATHS) {
    // 1
    assert.ok(lines.includes(`${from} ${to} 301`), from)
    assert.match(standaloneIconoplasmHtml(`<a href="${from}">x</a>`), new RegExp(`href="${to}"`))
    // 2
    const exact = lines.indexOf(`${from} ${to} 301`)
    for (const [prefix] of ICONOPLASM_MOVED_PREFIXES)
      if (from.startsWith(prefix))
        assert.ok(exact < lines.findIndex((line) => line.startsWith(`${prefix}* `)), from)
  }
  for (const [from, to] of ICONOPLASM_MOVED_PREFIXES) {
    // 1
    assert.ok(lines.includes(`${from}* ${to}:splat 301`), from)
    assert.match(
      standaloneIconoplasmHtml(`<a href="${from}some-page">x</a>`),
      new RegExp(`href="${to}some-page"`),
    )
  }
  // 3
  const firstDynamic = lines.findIndex((line) => line.includes("*"))
  assert.ok(lines.slice(firstDynamic).every((line) => line.includes("*")))
  // 4
  for (const line of lines)
    assert.match(line, /^\/[A-Za-z0-9._/-]*\*? (?:https:\/\/\S+|\/\S*) 301$/)
})

// B-906: the footer the Quartz pages share with the main site links /about. This host has
// no About page of its own, so the build points that link at the main site (the build
// refuses an unserved local link), and a visitor who lands on /about here is sent there.
test("the main site's /about footer link goes straight to the main site", () => {
  const html = standaloneIconoplasmHtml('<footer><a href="/about">About</a></footer>')
  assert.match(html, /href="https:\/\/brinedew\.bio\/about"/)
  assert.deepEqual(unservedIconoplasmLinks(html, ["index.html"]), [])
  assert.ok(ICONOPLASM_REDIRECTS.split("\n").includes("/about https://brinedew.bio/about 301"))
})

test("a local link this host cannot serve is reported", () => {
  const html = '<a href="/">Home</a><a href="/gene/TP53">TP53</a><a href="/About.html">About</a>'
  assert.deepEqual(unservedIconoplasmLinks(html, ["index.html"]), ["/About.html"])
})
