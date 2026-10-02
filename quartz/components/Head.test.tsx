import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { render } from "preact-render-to-string"
import HeadConstructor from "./Head"
import { QuartzComponentProps } from "./types"
import { ICONOPLASM_HOME_TITLE, iconoplasmPageTitle } from "../static/iconoplasm/page-title.js"

// B-818: every Iconoplasm page title comes from one template, "<page> |
// Iconoplasm", with the home page as the brand page. Ways this can fail:
//  1. A frontmatter title carries the site name ("Privacy Policy — Iconoplasm"),
//     so the template doubles it or a hand-typed separator survives.
//  2. og:title or twitter:title differs from <title>, so a shared link unfurls
//     under another name than the browser tab shows.
//  3. The home page loses its brand-first title, or a main-site essay gains the
//     Iconoplasm suffix.
//  4. The JSON-LD headline repeats the site name instead of naming the page.
//  5. The page's own h1 names it differently from its title.

const Head = HeadConstructor()
const contentRoot = path.join(process.cwd(), "content", "apps", "iconoplasm")

function frontmatter(file: string): Record<string, string> {
  const text = readFileSync(file, "utf8")
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ""
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z]+):\s*"?(.*?)"?\s*$/)
    if (match) fields[match[1]] = match[2]
  }
  return fields
}

function renderHead(slug: string, title: string) {
  const props = {
    cfg: {
      locale: "en-US",
      baseUrl: "brinedew.bio",
      pageTitle: "Brinedew",
      pageTitleSuffix: "",
      theme: {
        cdnCaching: false,
        fontOrigin: "local",
        typography: {},
        colors: { lightMode: { light: "#fff" }, darkMode: { light: "#000" } },
      },
    },
    fileData: { slug, frontmatter: { title } },
    externalResources: { css: [], js: [], additionalHead: [] },
    ctx: { cfg: { plugins: { emitters: [] } } },
  } as unknown as QuartzComponentProps
  const html = render(<Head {...props} />)
  const attribute = (pattern: RegExp) => html.match(pattern)?.[1]
  const jsonLd = JSON.parse(attribute(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)!)
  return {
    title: attribute(/<title>([^<]*)<\/title>/),
    ogTitle: attribute(/<meta property="og:title" content="([^"]*)"/),
    twitterTitle: attribute(/<meta name="twitter:title" content="([^"]*)"/),
    headline: jsonLd.headline,
  }
}

test("Iconoplasm pages are titled by the one template, everywhere a title appears", () => {
  const pages = readdirSync(contentRoot).filter((name) => name.endsWith(".md"))
  assert.ok(pages.length >= 5)
  for (const name of pages) {
    const file = path.join(contentRoot, name)
    const page = frontmatter(file).title
    const slug = `apps/iconoplasm/${name.replace(/\.md$/, "")}`
    const isHome = name === "index.md"
    // 1
    assert.doesNotMatch(page, / [-—|] /, `${name} title names the page only`)
    assert.ok(isHome ? page === "Iconoplasm" : !/Iconoplasm/.test(page), name)
    const head = renderHead(slug, page)
    const expected = isHome ? ICONOPLASM_HOME_TITLE : iconoplasmPageTitle(page)
    // 2 and 3
    assert.equal(head.title, expected, name)
    assert.equal(head.ogTitle, expected, name)
    assert.equal(head.twitterTitle, expected, name)
    // 4
    assert.equal(head.headline, page, name)
    // 5
    if (!isHome) {
      const heading = readFileSync(file, "utf8").match(/^# (.+)$/m)?.[1]
      assert.equal(heading, page, `${name} h1`)
    }
  }
  assert.equal(ICONOPLASM_HOME_TITLE, "Iconoplasm | Gene character cards")
  assert.equal(iconoplasmPageTitle("Privacy Policy"), "Privacy Policy | Iconoplasm")
})

test("main-site pages keep their own titles", () => {
  // 3
  const head = renderHead("posts/aging-clocks", "Aging clocks")
  assert.equal(head.title, "Aging clocks")
  assert.equal(head.ogTitle, "Aging clocks")
})
