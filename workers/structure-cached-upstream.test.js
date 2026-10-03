// The GeneGuessr structure-bytes route fetches only what the server itself derives.
//
// `/api/structure-cached?key=<provider>/<id>.<ext>` is a public GET. It learns the
// upstream from the key: RCSB for `pdb/` keys, the stored `proteins` row for
// `alphafold/` and `swissmodel/` keys, and the derived AlphaFold file as the last
// resort. It never takes an upstream URL from the caller. A caller-chosen URL would
// make the Worker an open relay that spends our requests and bandwidth, and would
// serve the caller's own bytes, with a content type the caller picks, from our API
// origin.
//
// Everything runs through the real Worker. The network is a stub that behaves like
// Workers `fetch`: it follows redirects unless the caller says `redirect: "manual"`,
// it records every URL it is asked for (each redirect hop included), and a URL it
// has no route for answers 200 with hostile HTML, so a request that reaches the
// wrong place is visible in the body and in the call list.
//
// Failure modes this file proves, each written before the code that fixes it:
//   H1  a caller's `upstream=` URL is fetched (any host, userinfo, IP literal,
//       localhost, odd port, http, other schemes), or changes what is fetched
//   H2  a stored or derived upstream outside the three provider hosts is fetched
//   H3  a redirect from a provider to another host is followed; a redirect loop
//       or chain is followed without a bound; a redirect inside the providers breaks
//   H4  the response's Content-Type comes from the upstream, so hostile HTML is
//       served as HTML; nothing stops the browser sniffing the body
//   H6  one of the three real providers stops being served
import assert from "node:assert/strict"
import test, { mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

const AF_PDB_URL = "https://alphafold.ebi.ac.uk/files/AF-Q9AF01-F1-model_v6.pdb"
const AF_CIF_URL = "https://alphafold.ebi.ac.uk/files/AF-Q9AF02-F1-model_v6.cif"
const SM_PDB_URL =
  "https://swissmodel.expasy.org/repository/uniprot/Q9SM01.pdb?range=8-148&template=5ltu.1.A&provider=swissmodel"
const RCSB_URL = "https://models.rcsb.org/v1/1B64/full?encoding=bcif&copy_all_categories=false"

const AF_PDB_KEY = "alphafold/Q9AF01.pdb"
const AF_CIF_KEY = "alphafold/Q9AF02.cif"
const SM_PDB_KEY = "swissmodel/Q9SM01_5ltu_1_A.pdb"
const RCSB_KEY = "pdb/1B64.bcif"

const PROVIDER_BYTES = "provider-bytes"

const row = (uniprot, columns) => ({
  uniprot,
  structure_source: null,
  pdb_id: null,
  alphafold_url: null,
  swissmodel_url: null,
  swissmodel_template: null,
  ...columns,
})

const STORED_ROWS = {
  Q9AF01: row("Q9AF01", { structure_source: "alphafold", alphafold_url: AF_PDB_URL }),
  Q9AF02: row("Q9AF02", { structure_source: "alphafold", alphafold_url: AF_CIF_URL }),
  Q9SM01: row("Q9SM01", {
    structure_source: "swissmodel",
    swissmodel_url: SM_PDB_URL,
    swissmodel_template: "5ltu.1.A",
  }),
}

function createDb(rowsByUniprot) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM proteins/i)
      return {
        bind(uniprot) {
          return {
            async first() {
              return rowsByUniprot[String(uniprot || "").toUpperCase()] || null
            },
          }
        },
      }
    },
  }
}

// `routes` maps a URL to `{ status, headers, body }` or `{ status, location }`.
// A URL with no route answers 200 with hostile HTML naming the URL it was fetched from.
function installNetwork(routes = {}) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    let url = String(input)
    const mode = init.redirect || "follow"
    for (let hop = 0; hop < 20; hop += 1) {
      calls.push({ url, redirect: mode })
      const answer = routes[url] ?? {
        status: 200,
        headers: { "Content-Type": "text/html" },
        body: `<script>hostile bytes from ${url}</script>`,
      }
      if (answer.location) {
        if (mode === "error") throw new TypeError("redirect refused")
        if (mode === "manual") {
          return new Response(null, {
            status: answer.status ?? 302,
            headers: { Location: answer.location },
          })
        }
        url = new URL(answer.location, url).toString()
        continue
      }
      return new Response(answer.body ?? PROVIDER_BYTES, {
        status: answer.status ?? 200,
        headers: answer.headers ?? { "Content-Type": "application/octet-stream" },
      })
    }
    throw new TypeError("too many redirects")
  }
  return {
    calls,
    urls: () => calls.map((call) => call.url),
    restore: () => (globalThis.fetch = original),
  }
}

// One request through the real Worker with the given stored rows and network routes.
async function getStructure(query, { rows = STORED_ROWS, routes = {} } = {}) {
  const network = installNetwork(routes)
  const waits = []
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  try {
    const env = { DB: createDb(rows) }
    const response = await worker.fetch(
      new Request(`https://geneguessr.brinedew.bio/api/structure-cached?${query}`),
      env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    const body = await response.text()
    await Promise.allSettled(waits)
    return { response, body, calls: network.calls, urls: network.urls() }
  } finally {
    network.restore()
    mock.restoreAll()
  }
}

const keyQuery = (key) => `key=${encodeURIComponent(key)}`
const hintedQuery = (key, hint) => `${keyQuery(key)}&upstream=${encodeURIComponent(hint)}`

// What each key resolves to with no caller input at all.
const DERIVED = [
  [AF_PDB_KEY, AF_PDB_URL],
  [AF_CIF_KEY, AF_CIF_URL],
  [SM_PDB_KEY, SM_PDB_URL],
  [RCSB_KEY, RCSB_URL],
]

const HOSTILE_URLS = [
  // another host
  "https://example.test/a.cif",
  "https://evil.example/files/AF-Q9AF01-F1-model_v6.pdb",
  // the providers' names with something else around them
  "https://alphafold.ebi.ac.uk.evil.example/files/a.pdb",
  "https://evilalphafold.ebi.ac.uk/files/a.pdb",
  "https://ebi.ac.uk/files/a.pdb",
  "https://alphafold.ebi.ac.uk@evil.example/files/a.pdb",
  "https://alphafold.ebi.ac.uk:secret@evil.example/files/a.pdb",
  "https://swissmodel.expasy.org%2f@evil.example/a.pdb",
  "https://evil.example/#@alphafold.ebi.ac.uk/files/a.pdb",
  "https://evil.example\\@alphafold.ebi.ac.uk/files/a.pdb",
  // addresses and local names
  "https://127.0.0.1/a.cif",
  "https://127.1/a.cif",
  "https://2130706433/a.cif",
  "https://0x7f000001/a.cif",
  "https://[::1]/a.cif",
  "https://169.254.169.254/latest/meta-data/",
  "https://10.0.0.1/a.cif",
  "https://localhost/a.cif",
  "https://localhost.localdomain/a.cif",
  "https://internal/a.cif",
  // ports
  "https://alphafold.ebi.ac.uk:8443/files/a.pdb",
  "https://alphafold.ebi.ac.uk:444/files/a.pdb",
  "https://models.rcsb.org:80/v1/1B64/full",
  // protocols
  "http://alphafold.ebi.ac.uk/files/AF-Q9AF01-F1-model_v6.pdb",
  "http://models.rcsb.org/v1/1B64/full",
  "ftp://alphafold.ebi.ac.uk/files/a.pdb",
  "file:///etc/passwd",
  "data:text/html,<script>alert(1)</script>",
  "javascript:alert(1)",
  // not absolute
  "//evil.example/a.cif",
  "/files/a.pdb",
  "alphafold.ebi.ac.uk/files/a.pdb",
  // a provider host, but not the file this key names
  "https://alphafold.ebi.ac.uk/files/AF-OTHER-F1-model_v6.pdb",
  "https://models.rcsb.org/v1/9ZZZ/full?encoding=bcif",
  "",
]

test("H6: the three providers are served with exactly the URL the server derives", async () => {
  for (const [key, derived] of DERIVED) {
    const { response, body, urls, calls } = await getStructure(keyQuery(key), {
      routes: { [derived]: { body: PROVIDER_BYTES } },
    })
    assert.equal(response.status, 200, key)
    assert.equal(
      body.replace(/^HEADER[^\n]*\n/, ""),
      PROVIDER_BYTES,
      `${key} serves provider bytes`,
    )
    assert.deepEqual(urls, [derived], `${key} fetches only its own upstream`)
    assert.equal(calls[0].redirect, "manual", `${key}: redirects are the server's to follow`)
  }
})

test("H1: no caller-supplied upstream is ever fetched, whatever it looks like", async () => {
  let checked = 0
  for (const [key, derived] of DERIVED) {
    for (const hint of HOSTILE_URLS) {
      const { response, body, urls } = await getStructure(hintedQuery(key, hint), {
        routes: { [derived]: { body: PROVIDER_BYTES } },
      })
      const label = `${key} with upstream=${JSON.stringify(hint)}`
      assert.deepEqual(urls, [derived], `${label}: fetched ${JSON.stringify(urls)}`)
      assert.equal(response.status, 200, label)
      assert.doesNotMatch(body, /hostile/, label)
      checked += 1
    }
  }
  assert.equal(checked, DERIVED.length * HOSTILE_URLS.length)
})

test("H1: a repeated and an empty upstream parameter change nothing either", async () => {
  const derived = AF_PDB_URL
  for (const query of [
    `${keyQuery(AF_PDB_KEY)}&upstream=https://evil.example/a&upstream=https://evil.example/b`,
    `${keyQuery(AF_PDB_KEY)}&upstream=`,
    `${keyQuery(AF_PDB_KEY)}&UPSTREAM=https://evil.example/a`,
    `${keyQuery(AF_PDB_KEY)}&upstream[]=https://evil.example/a`,
  ]) {
    const { response, urls } = await getStructure(query, {
      routes: { [derived]: { body: PROVIDER_BYTES } },
    })
    assert.equal(response.status, 200, query)
    assert.deepEqual(urls, [derived], query)
  }
})

// A stored value is data we wrote, but it is the last free-form input left.
// Whatever resolves, the fetch refuses it unless it is https on one of the three
// provider hosts.
const REFUSED_STORED_URLS = HOSTILE_URLS.filter(Boolean)
  .filter((url) => !/^https:\/\/(alphafold\.ebi\.ac\.uk|models\.rcsb\.org)\/[^@]*$/.test(url))
  .map((url) => (/\.(pdb|cif)\b/.test(url) ? url : `${url}.pdb`))

test("H2: a stored upstream that is not https on a provider host is refused without a fetch", async () => {
  let checked = 0
  for (const hostile of REFUSED_STORED_URLS) {
    const rows = {
      Q9BAD01: row("Q9BAD01", { structure_source: "alphafold", alphafold_url: hostile }),
      Q9BAD02: row("Q9BAD02", {
        structure_source: "swissmodel",
        swissmodel_url: hostile,
        swissmodel_template: "tpl",
      }),
    }
    const format = /\.cif\b/.test(hostile) ? "cif" : "pdb"
    for (const key of [`alphafold/Q9BAD01.${format}`, `swissmodel/Q9BAD02_tpl.${format}`]) {
      const { response, body, urls } = await getStructure(keyQuery(key), { rows })
      const label = `${key} stored as ${JSON.stringify(hostile)}`
      assert.deepEqual(urls, [], `${label}: fetched ${JSON.stringify(urls)}`)
      assert.equal(response.status, 404, label)
      assert.doesNotMatch(body, /hostile/, label)
      checked += 1
    }
  }
  assert.equal(checked, REFUSED_STORED_URLS.length * 2)
})

test("H2: the AlphaFold file derived from a key that names no stored row stays on the provider host", async () => {
  // The id is limited to [A-Za-z0-9_-], so the derived URL cannot leave its path.
  const derived = "https://alphafold.ebi.ac.uk/files/AF-QZZZZZ-F1-model_v6.cif"
  const { response, urls } = await getStructure(keyQuery("alphafold/QZZZZZ.cif"), {
    routes: { [derived]: { body: PROVIDER_BYTES } },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(urls, [derived])
  for (const key of [
    "alphafold/a@evil.example.cif",
    "alphafold/a.evil.example/x.cif",
    "pdb/../x.bcif",
  ]) {
    const refused = await getStructure(keyQuery(key))
    assert.equal(refused.response.status, 400, key)
    assert.deepEqual(refused.urls, [], key)
  }
})

test("H3: a provider's redirect to another host is not followed", async () => {
  const targets = [
    "https://evil.example/x.pdb",
    "http://alphafold.ebi.ac.uk/files/AF-Q9AF01-F1-model_v6.pdb",
    "https://alphafold.ebi.ac.uk@evil.example/x.pdb",
    "https://alphafold.ebi.ac.uk:8443/x.pdb",
    "https://127.0.0.1/x.pdb",
    "https://localhost/x.pdb",
    "https://169.254.169.254/latest/meta-data/",
    "ftp://alphafold.ebi.ac.uk/x.pdb",
    "//evil.example/x.pdb",
  ]
  for (const location of targets) {
    for (const status of [301, 302, 303, 307, 308]) {
      const { response, body, urls } = await getStructure(keyQuery(AF_PDB_KEY), {
        routes: { [AF_PDB_URL]: { status, location } },
      })
      const label = `${status} to ${location}`
      assert.deepEqual(urls, [AF_PDB_URL], `${label}: asked for ${JSON.stringify(urls)}`)
      assert.equal(response.status, 502, label)
      assert.doesNotMatch(body, /hostile/, label)
    }
  }
})

test("H3: a redirect that hops through the providers and then leaves is stopped at the last good hop", async () => {
  const hop2 = "https://alphafold.ebi.ac.uk/files/step2.pdb"
  const { response, urls } = await getStructure(keyQuery(AF_PDB_KEY), {
    routes: {
      [AF_PDB_URL]: { location: hop2 },
      [hop2]: { location: "https://evil.example/step3.pdb" },
    },
  })
  assert.equal(response.status, 502)
  assert.deepEqual(urls, [AF_PDB_URL, hop2])
})

test("H3: a redirect loop is cut after three hops", async () => {
  const a = AF_PDB_URL
  const b = "https://alphafold.ebi.ac.uk/files/loop-b.pdb"
  const { response, urls } = await getStructure(keyQuery(AF_PDB_KEY), {
    routes: { [a]: { location: b }, [b]: { location: a } },
  })
  assert.equal(response.status, 502)
  assert.ok(urls.length <= 4, `${urls.length} requests for one lookup`)
})

test("H3: a redirect that stays on the providers is followed, relative or absolute", async () => {
  const moved = "https://alphafold.ebi.ac.uk/files/moved/AF-Q9AF01-F1-model_v6.pdb"
  const relative = await getStructure(keyQuery(AF_PDB_KEY), {
    routes: {
      [AF_PDB_URL]: { status: 301, location: "/files/moved/AF-Q9AF01-F1-model_v6.pdb" },
      [moved]: { body: PROVIDER_BYTES },
    },
  })
  assert.equal(relative.response.status, 200)
  assert.deepEqual(relative.urls, [AF_PDB_URL, moved])

  const absolute = await getStructure(keyQuery(RCSB_KEY), {
    routes: {
      [RCSB_URL]: { status: 308, location: "https://models.rcsb.org/v1/1B64/full?encoding=bcif" },
      "https://models.rcsb.org/v1/1B64/full?encoding=bcif": { body: PROVIDER_BYTES },
    },
  })
  assert.equal(absolute.response.status, 200)
  assert.equal(absolute.urls.length, 2)
})

test("H4: the Content-Type comes from the key, never from the upstream, and the browser may not sniff it", async () => {
  const hostileHeaders = { "Content-Type": "text/html; charset=utf-8" }
  const expected = [
    [AF_CIF_KEY, AF_CIF_URL, "chemical/x-cif"],
    [AF_PDB_KEY, AF_PDB_URL, "chemical/x-pdb"],
    [SM_PDB_KEY, SM_PDB_URL, "chemical/x-pdb"],
    [RCSB_KEY, RCSB_URL, "application/octet-stream"],
  ]
  for (const [key, derived, contentType] of expected) {
    const { response } = await getStructure(keyQuery(key), {
      routes: { [derived]: { headers: hostileHeaders, body: "<script>alert(1)</script>" } },
    })
    assert.equal(response.status, 200, key)
    assert.equal(response.headers.get("content-type"), contentType, key)
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", key)
  }
  const missing = await getStructure(keyQuery(AF_CIF_KEY), {
    routes: { [AF_CIF_URL]: { headers: {}, body: PROVIDER_BYTES } },
  })
  assert.equal(missing.response.headers.get("content-type"), "chemical/x-cif")
})
