// B-722: a caretaker can go back to an older wording without losing the newer
// one. Real browser, real built site; only the caretaker API is a fake server
// that keeps state like the authority does (every save is a new, immutable
// version; the image source is a pointer).
//
// Ways the journey could fail, each asserted below:
// 1. "Edit from here" does not put the old text in the editor;
// 2. the autosave does not create a new version (nothing saved), or overwrites
//    the newer version instead of appending;
// 3. the new version does not record which version it started from;
// 4. the image source does not move to the restored text;
// 5. afterwards History loses the newer wording, or cannot show it.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and the request log land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

const OLD = "A guardian who stops damaged cells."
const NEWER = "A guardian in a lab coat who shouts at damaged cells."
const DAY = 24 * 60 * 60 * 1000

function savedVersion(id, sequence, msAgo, body) {
  return {
    manifestation_revision_id: id,
    revision_number: sequence,
    event_sequence: sequence,
    lifecycle: "active",
    created_at: new Date(Date.now() - msAgo).toISOString(),
    body,
    derivative: { status: "accepted", tags_sha256: String(sequence % 10).repeat(64) },
  }
}

// `revisions` are the viewer's own lineage, newest first. `predecessor` is an
// optional earlier caretaker's lineage, which the current caretaker manages
// (B-860) but did not write.
function fakeAuthority({
  revisions = [
    savedVersion("revision_2", 2, DAY, NEWER),
    savedVersion("revision_1", 1, 2 * DAY, OLD),
  ],
  predecessor = null,
  canonical = revisions[0].manifestation_revision_id,
} = {}) {
  const state = {
    head: { head_version: 4, gene_revision: 9, canonical_revision_id: canonical },
    posts: [],
  }
  let sequence = Math.max(
    ...[...revisions, ...(predecessor?.revisions || [])].map((item) => item.event_sequence),
  )
  const own = () => ({
    manifestation_id: "manifestation_current",
    author_label: "Bob",
    author_is_viewer: true,
    belongs_to_current_assignment: true,
    can_withdraw: true,
    status: "active",
    row_version: revisions.length,
    manifestation_head_revision_id: revisions[0].manifestation_revision_id,
    head_body: revisions[0].body,
    head_tags: "lab coat",
    head_fields: { outfit: ["lab coat"] },
    revisions: revisions.map((revision) => ({ ...revision })),
  })
  function dossier() {
    return {
      gene: { gene_id: "gene_tp53", symbol: "TP53" },
      viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
      assignment: {
        caretaker_assignment_id: "assignment_tp53",
        assignment_version: 3,
        status: "active",
      },
      head: { ...state.head },
      manifestations: predecessor ? [own(), predecessor] : [own()],
    }
  }
  function handle(pathname, request) {
    const base = "/api/iconoplasm/caretaker/genes/TP53"
    if (!pathname.startsWith(base)) return pathname.startsWith("/api/iconoplasm/") ? {} : undefined
    if (request.method() === "GET") return pathname === base ? dossier() : {}
    const suffix = pathname.slice(base.length)
    const body = JSON.parse(request.postData() || "{}")
    state.posts.push({ suffix, body })
    // B-859 step 3: a save with Tags is one command: the revision, its Tags,
    // the Tags head and the canonical selection.
    if (suffix === "/saves") {
      const number = revisions.length + 1
      sequence++
      revisions.unshift({
        manifestation_revision_id: `revision_${number}`,
        revision_number: number,
        event_sequence: sequence,
        lifecycle: "active",
        created_at: new Date().toISOString(),
        body: body.prose,
        based_on_revision_id: body.based_on_revision_id,
        derivative: { status: "accepted", tags_sha256: "c".repeat(64) },
      })
      state.head.canonical_revision_id = `revision_${number}`
      state.head.head_version++
      return {
        manifestation_id: "manifestation_current",
        manifestation_revision_id: `revision_${number}`,
        manifestation_derivative_id: `derivative_revision_${number}`,
        canonical_revision_id: `revision_${number}`,
      }
    }
    if (suffix === "/revisions") {
      const number = revisions.length + 1
      sequence++
      revisions.unshift({
        manifestation_revision_id: `revision_${number}`,
        revision_number: number,
        event_sequence: sequence,
        lifecycle: "active",
        created_at: new Date().toISOString(),
        body: body.prose,
        based_on_revision_id: body.based_on_revision_id,
      })
      return {
        manifestation_id: "manifestation_current",
        manifestation_revision_id: `revision_${number}`,
      }
    }
    const tags = suffix.match(/^\/revisions\/([^/]+)\/tags-derivatives$/)
    if (tags) {
      const revision = revisions.find((item) => item.manifestation_revision_id === tags[1])
      revision.derivative = { status: "accepted", tags_sha256: "c".repeat(64) }
      return { manifestation_derivative_id: `derivative_${tags[1]}`, derivative_head_version: 0 }
    }
    if (/^\/revisions\/[^/]+\/tags-derivative-head$/.test(suffix)) return { ok: true }
    if (suffix === "/canonical-selections") {
      state.head.canonical_revision_id = body.manifestation_revision_id
      state.head.head_version++
      return { ok: true }
    }
    return { ok: true }
  }
  return { handle, state, revisions }
}

// B-860 and B-874: the nightmare handover. Ada cared for TP53 for weeks; Bob
// took over and in ten minutes of autosaves replaced her text. Bob (or the next
// caretaker) must be able to see where Ada's work ends, bring it back in one
// move, and still manage Ada's lineage, which he did not write.
const ADA = "A guardian who halts the cell cycle when DNA breaks."
test("after a bad handover, the previous caretaker's text is one row away and comes back in one move", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const minute = 60 * 1000
  const authority = fakeAuthority({
    revisions: [
      savedVersion("bob_3", 5, 50 * minute, "lol gene go brr brr"),
      savedVersion("bob_2", 4, 55 * minute, "lol gene go brr"),
      savedVersion("bob_1", 3, 60 * minute, "lol gene"),
    ],
    predecessor: {
      manifestation_id: "manifestation_ada",
      author_label: "Ada",
      author_is_viewer: false,
      belongs_to_current_assignment: false,
      can_withdraw: true,
      status: "active",
      row_version: 2,
      revisions: [
        savedVersion("ada_2", 2, 3 * DAY, ADA),
        savedVersion("ada_1", 1, 3 * DAY + 5 * minute, "A guardian who halts the cell cycle."),
      ],
    },
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    await routeProduction(context, origin, authority.handle)
    const page = await context.newPage()
    await page.goto(`${HOST}/gene/TP53?caretaker=open`)
    await page.waitForSelector(".icono-caretaker-dialog[open]", { timeout: 30_000 })
    await page.click('[data-icono-caretaker-tab="history"]')

    // Two rows, one per caretaker's run; Ada's last version heads hers.
    const sessions = await page.$$eval("[data-icono-caretaker-session]", (items) =>
      items.map((item) => ({
        head: item
          .querySelector("[data-icono-caretaker-version]")
          .getAttribute("data-icono-caretaker-version"),
        text: item.querySelector(".icono-caretaker-timeline__item").textContent,
        toggle: item.querySelector("[data-icono-caretaker-session-toggle]")?.textContent || "",
      })),
    )
    assert.deepEqual(
      sessions.map((session) => session.head),
      ["bob_3", "ada_2"],
      "one row per caretaker run",
    )
    assert.equal(sessions[0].toggle.trim(), "3 saves")
    assert.equal(sessions[1].text.includes("Ada"), true, sessions[1].text)
    await page.screenshot({ path: path.join(OUT, "caretaker-handover-1-history.png") })

    // One move: select Ada's last version, edit from it, let autosave run.
    await page.click('[data-icono-caretaker-version="ada_2"]')
    await page.click("[data-icono-caretaker-fork]")
    assert.equal(await page.locator("[data-icono-caretaker-prose]").inputValue(), ADA)
    await page.waitForFunction(
      () =>
        document.querySelector("[data-icono-caretaker-autosave-state]")?.dataset.state === "saved",
      null,
      { timeout: 20_000 },
    )
    const saved = authority.state.posts.find((post) => post.suffix === "/saves").body
    assert.equal(saved.prose, ADA, "Ada's text is saved as the newest version")
    assert.equal(saved.based_on_revision_id, "ada_2", "and records that it came from Ada's")
    assert.equal(authority.state.head.canonical_revision_id, "revision_4", "images use it")

    // Bob's run is still in History, and Ada's lineage is still Bob's to manage.
    await page.click('[data-icono-caretaker-tab="history"]')
    const rows = await page.$$eval("[data-icono-caretaker-version]", (items) =>
      items.map((item) => item.getAttribute("data-icono-caretaker-version")),
    )
    for (const id of ["revision_4", "bob_3", "ada_2"]) {
      assert.equal(rows.includes(id), true, `${id} is listed (${rows.join(", ")})`)
    }
    await page.screenshot({ path: path.join(OUT, "caretaker-handover-2-after.png") })
    await page.click('[data-icono-caretaker-tab="settings"]')
    assert.equal(
      (await page.$('[data-icono-caretaker-withdraw="manifestation_ada"]')) !== null,
      true,
      "the current caretaker can withdraw the predecessor's lineage",
    )
    await context.close()
  } finally {
    server.close()
    await browser.close()
  }
})

test("a caretaker restores an older wording and the newer one stays in History", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const authority = fakeAuthority()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    await routeProduction(context, origin, authority.handle)
    const page = await context.newPage()
    await page.goto(`${HOST}/gene/TP53?caretaker=open`)
    await page.waitForSelector(".icono-caretaker-dialog[open]", { timeout: 30_000 })

    // Pick the old wording in History and edit from it.
    await page.click('[data-icono-caretaker-tab="history"]')
    await page.click('[data-icono-caretaker-version="revision_1"]')
    await page.screenshot({ path: path.join(OUT, "caretaker-restore-1-history.png") })
    await page.click("[data-icono-caretaker-fork]")
    const editor = page.locator("[data-icono-caretaker-prose]")
    assert.equal(await editor.inputValue(), OLD, "1: the old text is in the editor")

    // Autosave runs after 1.1 s of quiet: one authority call (B-859), then Saved.
    await page.waitForFunction(
      () =>
        document.querySelector("[data-icono-caretaker-autosave-state]")?.dataset.state === "saved",
      null,
      { timeout: 20_000 },
    )
    const suffixes = authority.state.posts.map((post) => post.suffix.replace(/revision_\d+/, "R"))
    assert.deepEqual(suffixes, ["/saves"], "2: one save appends one version")
    const saved = authority.state.posts[0].body
    assert.equal(saved.prose, OLD, "2: the saved text is the old wording")
    assert.equal(saved.based_on_revision_id, "revision_1", "3: it records where it started")
    assert.equal(authority.revisions.length, 3, "2: appended, nothing overwritten")
    assert.equal(
      authority.state.head.canonical_revision_id,
      "revision_3",
      "4: new images are drawn from the restored text",
    )

    // History still holds the newer wording, readable in the preview.
    await page.click('[data-icono-caretaker-tab="history"]')
    const rows = await page.$$eval("[data-icono-caretaker-version]", (items) =>
      items.map((item) => item.getAttribute("data-icono-caretaker-version")),
    )
    for (const id of ["revision_3", "revision_2", "revision_1"]) {
      assert.equal(rows.includes(id), true, `5: ${id} is listed (${rows.join(", ")})`)
    }
    await page.click('[data-icono-caretaker-version="revision_2"]')
    const preview = await page.textContent("[data-icono-caretaker-preview]")
    assert.equal(preview.includes("shouts at damaged cells"), true, "5: the newer wording reads")
    await page.screenshot({ path: path.join(OUT, "caretaker-restore-2-after.png") })
    await context.close()
  } finally {
    writeFileSync(
      path.join(OUT, "caretaker-restore-journey.json"),
      JSON.stringify({ posts: authority.state.posts, head: authority.state.head }, null, 2),
    )
    server.close()
    await browser.close()
  }
})
