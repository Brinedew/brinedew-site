import assert from "node:assert/strict"
import test from "node:test"

import { buildAiSearchJsonLd, getAiSearchPageType } from "./aiSearchMetadata"
import { type QuartzPluginData } from "../plugins/vfile"
import { type FullSlug } from "./path"

const licenseSlug = "apps/iconoplasm/license" as FullSlug

test("explicit safe schema type can distinguish an app-owned policy page", () => {
  assert.equal(
    getAiSearchPageType({
      slug: licenseSlug,
      frontmatter: { title: "Image License — Iconoplasm", schemaType: "WebPage" },
    }),
    "WebPage",
  )
})

test("unknown schema type cannot inject arbitrary structured data", () => {
  assert.equal(
    getAiSearchPageType({
      slug: licenseSlug,
      frontmatter: { title: "Image License — Iconoplasm", schemaType: "DangerousThing" },
    }),
    "SoftwareApplication",
  )
})

function buildFor(slug: string, title: string) {
  return buildAiSearchJsonLd({
    baseUrl: "brinedew.bio",
    pageTitle: "Brinedew",
    locale: "en-US",
    fileData: {
      slug: slug as FullSlug,
      frontmatter: { title },
      description: `${title} description`,
    } as QuartzPluginData,
  })
}

test("About is the canonical pseudonymous Brinedew profile", () => {
  const jsonLd = buildFor("About", "About")
  const person = jsonLd.mainEntity as Record<string, unknown>

  assert.equal(jsonLd["@type"], "ProfilePage")
  assert.equal(person["@type"], "Person")
  assert.equal(person["@id"], "https://brinedew.bio/#brinedew")
  assert.equal(person.name, "Brinedew")
  assert.equal(person.url, "https://brinedew.bio/about")
  assert.deepEqual(person.sameAs, [
    "https://github.com/Brinedew",
    "https://www.lesswrong.com/users/brinedew",
    "https://addons.mozilla.org/en-US/firefox/user/19832112/",
  ])
  assert.doesNotMatch(JSON.stringify(jsonLd), /Vladimir|Organization/)
})

test("the Brinedew website is published by the same stable Person identity", () => {
  const jsonLd = buildFor("index", "Brinedew")
  const publisher = jsonLd.publisher as Record<string, unknown>

  assert.equal(jsonLd["@type"], "WebSite")
  assert.equal(jsonLd["@id"], "https://brinedew.bio/#website")
  assert.equal(publisher["@type"], "Person")
  assert.equal(publisher["@id"], "https://brinedew.bio/#brinedew")
  assert.equal(publisher.sameAs, undefined)
})

test("Iconoplasm owns store identities without assigning them to GeneGuessr", () => {
  const iconoplasm = buildFor("apps/iconoplasm", "Iconoplasm - Gene character cards")
  const iconoplasmPrivacy = buildFor("apps/iconoplasm/privacy", "Privacy Policy — Iconoplasm")
  const geneGuessr = buildFor("apps/geneguessr", "GeneGuessr")

  assert.equal(iconoplasm["@id"], "https://iconoplasm.brinedew.bio/#application")
  assert.deepEqual(iconoplasm.sameAs, [
    "https://addons.mozilla.org/en-US/firefox/addon/iconoplasm-gene-illustrations/",
    "https://microsoftedge.microsoft.com/addons/detail/iconoplasm/ocfhohjhkflpmaiimgjfobdoogdfpmog",
  ])
  assert.equal(
    (iconoplasm.creator as Record<string, unknown>)["@id"],
    "https://brinedew.bio/#brinedew",
  )
  assert.equal(geneGuessr["@id"], "https://geneguessr.brinedew.bio/#application")
  assert.equal(iconoplasmPrivacy.sameAs, undefined)
  assert.equal(iconoplasmPrivacy.subjectOf, undefined)
  assert.equal(geneGuessr.sameAs, undefined)
  assert.equal(geneGuessr.subjectOf, undefined)
})
