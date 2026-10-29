// Failure modes 1 to 4 and 8 in e2e/geneguessr-direct-structures.shared.mjs, which holds
// the scene, the setup and the helpers. The GeneGuessr browser tests are four files so
// that they run side by side: as one file they took about 490 s, the E2E lane's whole wait.
// E2E scope: quartz/static/geneguessr/ quartz/static/vendor/ !workers/iconoplasm
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { ANONYMOUS_PDB_HEADER } from "../quartz/static/geneguessr/structure-bytes.js"
import { OUT } from "./harness.mjs"
import {
  PROVIDER_HOSTS,
  BCIF,
  alphaFoldCif,
  chromeAndMolstar,
  hostsOf,
  measured,
  origin,
  returningVisit,
  rows,
  save,
  setRewrite,
  swissModelPdb,
  visit,
} from "./geneguessr-direct-structures.shared.mjs"

test("page load plus three guesses: guess structures come from the providers, the target through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { result, page, context, tracker } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-direct",
    })
    mkdirSync(OUT, { recursive: true })
    await page.screenshot({
      path: path.join(OUT, "geneguessr-direct-structures.png"),
      fullPage: true,
    })
    const blobs = await page.evaluate(() => window.__blobs)
    const providerFetches = await page.evaluate(() => window.__providerFetches)
    await context.close()
    measured.direct = { ...result, blobs }

    assert.equal(
      result.counts.structureKey,
      0,
      `guess views through the Worker: ${result.requests}`,
    )
    assert.equal(result.counts.structureTarget, 1, "the target is one Worker view")
    assert.equal(result.counts.structureToken, 0, "no token request")
    assert.deepEqual(
      hostsOf(result.providerRequests),
      [...PROVIDER_HOSTS].sort(),
      "one request to each provider, for the three guesses",
    )
    assert.deepEqual(result.failed, [], "no viewer failed")
    assert.equal(result.complete.length, 4, `rendered viewers: ${result.complete}`)
    assert.deepEqual(tracker.cspViolations, [], "the policy lets every provider request through")
    // What Mol* is given: a SWISS-MODEL PDB always opens with the anonymous HEADER line, and
    // the file after it is the provider's, byte for byte.
    const header = new TextDecoder().decode(ANONYMOUS_PDB_HEADER)
    assert.equal(blobs.length, 4, "one blob per viewer")
    assert.ok(
      blobs.every((blob) => !blob.head.startsWith("TITLE     SWISS-MODEL")),
      "a SWISS-MODEL PDB reached Mol* without its HEADER line",
    )
    const swiss = blobs.filter((blob) => blob.head.startsWith("HEADER    MODEL"))
    assert.ok(swiss.length >= 1)
    for (const blob of swiss) assert.equal(blob.size, swissModelPdb().length + header.length)
    assert.ok(
      blobs.some((blob) => blob.size === BCIF.length),
      "the RCSB file is delivered whole",
    )
    assert.ok(
      blobs.some((blob) => blob.size === alphaFoldCif().length),
      "the AlphaFold file too",
    )
    for (const sent of tracker.providerHeaders) {
      assert.equal(sent.referer, undefined, `a provider got a referrer: ${sent.referer}`)
      assert.equal(sent.cookie, undefined, "a provider got a cookie")
    }
    // The page asks for exactly that: no credentials, no referrer, and the browser's own cache
    // for a repeat view (a provider such as RCSB sends no Cache-Control, so a default fetch
    // asks the provider again, 270 to 424 ms against 1 to 2 ms measured on 2026-10-03).
    assert.deepEqual(
      hostsOf(providerFetches.map((fetched) => `https://${fetched.host}/`)),
      [...PROVIDER_HOSTS].sort(),
    )
    for (const fetched of providerFetches) {
      assert.equal(fetched.credentials, "omit", `${fetched.host}: credentials`)
      assert.equal(fetched.referrerPolicy, "no-referrer", `${fetched.host}: referrer policy`)
      assert.equal(fetched.cache, "force-cache", `${fetched.host}: a repeat view is the browser's`)
    }
  } finally {
    save()
    await browser.close()
  }
})

test("the same visit with no direct URL in the payloads loads every guess through the Worker, as before", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: false })
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-proxy",
    })
    await context.close()
    measured.proxyOnly = result

    assert.equal(result.counts.structureKey, 3)
    assert.equal(result.counts.structureTarget, 1)
    assert.deepEqual(result.providerRequests, [], "the browser never talks to a provider")
    assert.deepEqual(result.failed, [])
    assert.equal(result.complete.length, 4)
  } finally {
    setRewrite({ directUrls: true })
    save()
    await browser.close()
  }
})

test("a returning visitor's load, opened cards and reload take every guess from its provider with no structure request to the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const visitor = await returningVisit(browser, { visitorCookie: "geneguessr_session=e2e-back" })
    await visitor.context.close()
    measured.returning = visitor.phases
    const [load, opened, reload] = visitor.phases
    for (const phase of visitor.phases) {
      assert.equal(phase.counts.structureKey, 0, `${phase.name}: no guess through the Worker`)
      assert.equal(phase.counts.structureToken, 0, `${phase.name}: no token request`)
      assert.deepEqual(phase.failed, [], `${phase.name}: no viewer failed`)
    }
    for (const phase of [load, reload]) {
      assert.equal(phase.counts.bootstrap, 1, `${phase.name}: one bootstrap`)
      assert.equal(phase.counts.structureTarget, 1, `${phase.name}: the target is one Worker view`)
    }
    assert.deepEqual(hostsOf(load.providerRequests), ["alphafold.ebi.ac.uk"], "load: the open card")
    assert.equal(load.complete.length, 2, `load: ${load.complete}`)
    assert.deepEqual(
      hostsOf(opened.providerRequests),
      ["models.rcsb.org", "swissmodel.expasy.org"],
      "opening the other cards loads them from their providers",
    )
    assert.equal(opened.counts.total, 0, "opening a card makes no Worker request")
    assert.deepEqual(hostsOf(reload.providerRequests), [...PROVIDER_HOSTS].sort(), "reload")
    assert.equal(reload.complete.length, 4, `reload: ${reload.complete}`)
  } finally {
    save()
    await browser.close()
  }
})

test("no payload and no provider request names the target before the reveal", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { result, context, page } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-secret",
    })
    const target = rows.find((row) => row.uniprot === result.target)
    const seen = await page.evaluate(async (base) => {
      const response = await fetch(`${base}/api/game/bootstrap`, { credentials: "include" })
      return response.text()
    }, origin)
    await context.close()

    const nameable = [target.uniprot, target.pdb_id, target.swissmodel_url, target.alphafold_url]
      .filter(Boolean)
      .map(String)
    const everyRequest = [...result.requests, ...result.providerRequests].join("\n")
    for (const secret of nameable) {
      assert.ok(!seen.includes(secret), `the bootstrap names the target: ${secret}`)
      assert.ok(!everyRequest.includes(secret), `a request names the target: ${secret}`)
    }
    assert.match(seen, /\/api\/structure-cached\?type=target/)
  } finally {
    await browser.close()
  }
})
