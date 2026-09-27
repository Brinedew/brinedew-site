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

function fakeAuthority() {
  const now = Date.now()
  const revisions = [
    {
      manifestation_revision_id: "revision_2",
      revision_number: 2,
      event_sequence: 2,
      lifecycle: "active",
      created_at: new Date(now - DAY).toISOString(),
      body: NEWER,
      derivative: { status: "accepted", tags_sha256: "b".repeat(64) },
    },
    {
      manifestation_revision_id: "revision_1",
      revision_number: 1,
      event_sequence: 1,
      lifecycle: "active",
      created_at: new Date(now - 2 * DAY).toISOString(),
      body: OLD,
      derivative: { status: "accepted", tags_sha256: "a".repeat(64) },
    },
  ]
  const state = {
    head: { head_version: 4, gene_revision: 9, canonical_revision_id: "revision_2" },
    posts: [],
  }
  const own = () => ({
    manifestation_id: "manifestation_current",
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
      manifestations: [own()],
    }
  }
  function handle(pathname, request) {
    const base = "/api/iconoplasm/caretaker/genes/TP53"
    if (!pathname.startsWith(base)) return pathname.startsWith("/api/iconoplasm/") ? {} : undefined
    if (request.method() === "GET") return pathname === base ? dossier() : {}
    const suffix = pathname.slice(base.length)
    const body = JSON.parse(request.postData() || "{}")
    state.posts.push({ suffix, body })
    if (suffix === "/revisions") {
      const number = revisions.length + 1
      revisions.unshift({
        manifestation_revision_id: `revision_${number}`,
        revision_number: number,
        event_sequence: number,
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

    // Autosave runs after 1.1 s of quiet: four authority calls, then Saved.
    await page.waitForFunction(
      () =>
        document.querySelector("[data-icono-caretaker-autosave-state]")?.dataset.state === "saved",
      null,
      { timeout: 20_000 },
    )
    const suffixes = authority.state.posts.map((post) => post.suffix.replace(/revision_\d+/, "R"))
    assert.deepEqual(
      suffixes,
      [
        "/revisions",
        "/revisions/R/tags-derivatives",
        "/revisions/R/tags-derivative-head",
        "/canonical-selections",
      ],
      "2: one save appends one version",
    )
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
