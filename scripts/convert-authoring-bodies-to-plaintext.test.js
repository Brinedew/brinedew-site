// B-859: end-to-end test of the one-shot operator script that rewrites the
// 38,487 encrypted manifestation and Tags body objects as plain text.
//
// The script drives the production Worker's admin route and writes to the
// private object zone, so a mistake spends meters, leaves the zone half
// converted, or loses a body. It is tested against the real route handler, the
// real conversion, the real authority schema and a fake Bunny zone, never
// against a copy of their rules. Every way it could go wrong, written down
// BEFORE the script existed:
//
//   F1  A "dry run" that writes, or that needs the admin token. Dry run is the
//       default; it sends nothing to the Worker and prices the job.
//   F2  A slice larger than the route's cap, so the first call is refused and
//       the night is lost. The test drives the real route and its real cap.
//   F3  A conversion that does not converge: after `--execute` finishes, a
//       `--verify` pass must find no envelope left, and a second `--execute`
//       must convert nothing and write nothing.
//   F4  A night that cannot be capped or resumed. `--max-bodies` stops on a
//       row boundary and saves the cursor; the next run starts exactly there,
//       and no object is written twice across the two runs.
//   F5  A transient Worker failure (a CPU kill on a cold isolate, a 503) loses
//       a slice. It is retried, then retried smaller; a slice that keeps
//       failing stops the run and says where to resume.
//   F6  A failed object is skipped silently. It is listed by id and code, the
//       rest of the run continues, and too many failures stop the run.
//   F7  A run without the admin token sends requests anyway, or keeps going
//       after the Worker says the token is wrong.
//   F8  It runs right after the 00:00 UTC reset and spends the day's allowance
//       up front (AGENTS.md). Execute and verify refuse before 20:00 UTC unless
//       the operator names an incident reason, which the receipt records.
//   F9  A mistyped option widens or corrupts the run: all are refused.
//  F10  Verification writes, trusts a partial scan as a full one, or reports
//       clean while an envelope or a damaged object remains. It never saves a
//       cursor.
//  F11  The receipt or the log carries a body's text, or the token.
//  F12  A damaged cursor file silently restarts the job, or a missing one
//       breaks it.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { PLAINTEXT_CONVERSION_MAX_BODIES } from "../workers/iconoplasm/caretaker/manifestation-plaintext-conversion.js"
import { createIconoplasmCaretakerAdminHandlers } from "../workers/iconoplasm-caretaker-admin-routes.js"
import {
  bodyEnvironment,
  bootstrap,
  installBunnyFake,
  seedLegacyRevision,
  seedLegacyTags,
} from "../workers/iconoplasm/caretaker/manifestation-plaintext-test-support.js"
import {
  DEFAULT_NIGHT_BODIES,
  DEFAULT_SLICE_BODIES,
  LATE_UTC_HOUR,
  convertBodies,
  conversionCost,
  createRoutePoster,
  loadState,
  parseConvertArgs,
  saveState,
  writeReceipt,
} from "./convert-authoring-bodies-to-plaintext.mjs"

const EVENING = new Date("2026-10-03T21:00:00.000Z")
const EARLY = new Date("2026-10-03T05:00:00.000Z")
const TOKEN = "test-admin-token-never-printed"
const noSleep = async () => {}

// The real route in front of a real conversion. `fault` can answer a request
// itself (a 503, a 403) before the route sees it.
async function world(t, { legacyRevisions = 4, legacyTags = 3 } = {}) {
  const bunny = installBunnyFake(t)
  const context = await bootstrap(t, "8401", bunny)
  const keyed = bodyEnvironment()
  const seen = []
  let tagsDone = 0
  for (let index = 0; index < legacyRevisions; index += 1) {
    const revision = await seedLegacyRevision(context, keyed, bunny, {
      name: `8401r${index}`,
      prose: `Legacy manifestation number ${index} of the fixture gene.`,
      first: index === 0,
    })
    seen.push(revision)
    if (tagsDone < legacyTags) {
      await seedLegacyTags(context, keyed, bunny, {
        name: `8401t${index}`,
        revisionId: revision.revisionId,
        sourceBodySha256: revision.body_sha256,
        tagsText: `tag ${index}, another tag`,
        fieldsJson: { group: [`tag ${index}`] },
      })
      tagsDone += 1
    }
  }
  const env = { ICONOPLASM_AUTHORING_DB: context.db, ...keyed }
  const requests = []
  const handlers = createIconoplasmCaretakerAdminHandlers({
    isAdmin: async (request) => request.headers.get("authorization") === `Bearer ${TOKEN}`,
    json: (body, status = 200) => Response.json(body, { status }),
    resolveActiveAccount: async () => ({ account_id: "account_admin_plain" }),
    wakeAuthorityProjection: async () => ({ ok: true, results: [] }),
  })
  const world = {
    bunny,
    context,
    keyed,
    seen,
    requests,
    fault: () => null,
    post: null,
  }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push({ url: String(url), body, authorization: init.headers.Authorization })
    const forced = world.fault(requests.length, body)
    if (forced) return forced
    return handlers["caretaker_admin.plaintext_bodies"]({
      request: new Request(url, { ...init, headers: new Headers(init.headers) }),
      env,
      done: (_name, response) => response,
    })
  }
  world.post = createRoutePoster({ origin: "https://iconoplasm.test", token: TOKEN, fetchImpl })
  return world
}

function run(world, options = {}) {
  return convertBodies({
    post: world.post,
    mode: "execute",
    state: { revision: "", derivative: "" },
    now: EVENING,
    sleep: noSleep,
    ...options,
  })
}

const totals = (receipt) => ({
  converted: receipt.converted,
  plaintext: receipt.plaintext,
  legacy: receipt.legacy,
  failed: receipt.failed.length,
})

test("F1 a dry run sends nothing, needs no token, and prices the job", async (t) => {
  const w = await world(t)
  const receipt = await convertBodies({
    post: null,
    mode: "dry-run",
    state: { revision: "", derivative: "" },
    now: EARLY,
    sleep: noSleep,
  })
  assert.equal(receipt.mode, "dry-run")
  assert.equal(w.requests.length, 0)
  assert.equal(w.bunny.log.length, 0)
  const cost = receipt.cost
  assert.equal(cost.d1_rows_written, 0, "the job writes nothing to D1")
  assert.ok(cost.worker_requests > 12_000 && cost.worker_requests < 14_000)
  assert.equal(cost.bunny_storage_puts, 38_487)
  assert.deepEqual(conversionCost(DEFAULT_NIGHT_BODIES).worker_requests, 6_667)
})

test("F2 slices never exceed the route's own cap, which the real route enforces", async (t) => {
  const w = await world(t)
  assert.ok(DEFAULT_SLICE_BODIES <= PLAINTEXT_CONVERSION_MAX_BODIES)
  await run(w)
  assert.ok(w.requests.length > 0)
  assert.ok(w.requests.every((request) => request.body.limit <= PLAINTEXT_CONVERSION_MAX_BODIES))
  const refused = await w.post({ kind: "revision", after: "", limit: 5, execute: false })
  assert.equal(refused.status, 400)
})

test("F3 execute converges: verify finds no envelope, and a second pass writes nothing", async (t) => {
  const w = await world(t)
  const before = await convertBodies({
    post: w.post,
    mode: "verify",
    state: {},
    now: EVENING,
    sleep: noSleep,
  })
  assert.equal(before.clean, false)
  assert.equal(before.legacy, 4 + 1 + 3, "4 caretaker revisions, the seed, and 3 Tags bodies")

  const first = await run(w)
  assert.equal(first.stopped, null)
  assert.deepEqual(
    [first.converted, first.failed.length, first.done.revision, first.done.derivative],
    [8, 0, true, true],
  )
  const after = await convertBodies({
    post: w.post,
    mode: "verify",
    state: {},
    now: EVENING,
    sleep: noSleep,
  })
  assert.equal(after.clean, true)
  assert.equal(after.legacy, 0)

  const puts = w.bunny.count("PUT")
  const second = await run(w)
  assert.deepEqual(totals(second), { converted: 0, plaintext: 8, legacy: 0, failed: 0 })
  assert.equal(w.bunny.count("PUT"), puts, "nothing is written twice")

  // The artifact a later agent can check: the receipts on disk.
  const dir = mkdtempSync(path.join(tmpdir(), "convert-bodies-"))
  const files = [first, after, second].map((receipt) => writeReceipt(dir, receipt))
  assert.equal(readdirSync(dir).length, 3)
  assert.equal(JSON.parse(readFileSync(files[1], "utf8")).clean, true)
})

test("F4 --max-bodies stops on a row boundary, saves the cursor, and the next run resumes there", async (t) => {
  const w = await world(t)
  const state = { revision: "", derivative: "" }
  const saved = []
  const first = await run(w, {
    state,
    maxBodies: 5,
    onProgress: (snapshot) => saved.push({ ...snapshot }),
  })
  assert.equal(first.stopped, "max_bodies")
  assert.equal(first.scanned.revision + first.scanned.derivative, 5)
  assert.ok(saved.length > 0)
  assert.deepEqual(saved.at(-1), state)
  const firstPuts = w.bunny.count("PUT")

  const second = await run(w, { state })
  assert.equal(second.stopped, null)
  assert.equal(
    first.converted + second.converted,
    8,
    "every legacy body is converted across the two nights",
  )
  assert.equal(
    w.bunny.count("PUT") - firstPuts,
    second.converted,
    "the second night wrote only what it converted: no body is written twice",
  )
  assert.equal(second.done.revision && second.done.derivative, true)
})

test("F5 a failed slice is retried, then retried smaller, then stops the run with the place to resume", async (t) => {
  const w = await world(t)
  w.fault = (count) => (count === 1 ? new Response("unavailable", { status: 503 }) : null)
  const recovered = await run(w)
  assert.equal(recovered.stopped, null)
  assert.equal(recovered.converted, 8)
  assert.ok(recovered.retries >= 1)

  const w2 = await world(t)
  w2.fault = () => new Response("unavailable", { status: 503 })
  const state = { revision: "", derivative: "" }
  const dead = await run(w2, { state })
  assert.equal(dead.stopped, "slice_failed")
  assert.equal(dead.converted, 0)
  assert.deepEqual(
    state,
    { revision: "", derivative: "" },
    "nothing advanced, so a rerun starts here",
  )
  const limits = w2.requests.map((request) => request.body.limit)
  assert.ok(limits.includes(1), "the slice was retried at one body")
  assert.ok(w2.requests.length <= 8, "a dead Worker is not hammered forever")
})

test("F6 a failed object is listed by id and code, the run continues, and many failures stop it", async (t) => {
  const w = await world(t)
  const target = w.seen[1]
  w.bunny.rules.push(({ method, objectKey }) =>
    method === "PUT" && objectKey === target.objectKey
      ? new Response(null, { status: 503 })
      : undefined,
  )
  const receipt = await run(w)
  assert.deepEqual(
    receipt.failed.map((entry) => [entry.kind, entry.id, entry.code]),
    [["revision", target.revisionId, "write"]],
  )
  assert.equal(receipt.converted, 7)
  assert.equal(receipt.stopped, null)

  const w2 = await world(t)
  w2.bunny.rules.push(({ method }) =>
    method === "PUT" ? new Response(null, { status: 503 }) : undefined,
  )
  const stopped = await run(w2, { maxFailures: 2 })
  assert.equal(stopped.stopped, "too_many_failures")
  assert.ok(stopped.failed.length >= 2)
})

test("F7 no token refuses before any call, and a wrong token stops the run at once", async (t) => {
  assert.throws(() => createRoutePoster({ token: "" }), /ICONOPLASM_ADMIN_TOKEN/)
  assert.throws(() => createRoutePoster({ token: undefined }), /ICONOPLASM_ADMIN_TOKEN/)
  const w = await world(t)
  const wrong = createRoutePoster({
    origin: "https://iconoplasm.test",
    token: "not-the-token",
    fetchImpl: async (url, init) => {
      w.requests.push({ url })
      return Response.json({ error: "Unauthorized" }, { status: 403 })
    },
  })
  const receipt = await convertBodies({
    post: wrong,
    mode: "execute",
    state: { revision: "", derivative: "" },
    now: EVENING,
    sleep: noSleep,
  })
  assert.equal(receipt.stopped, "unauthorized")
  assert.ok(w.requests.length <= 2, "one refusal per lane, then nothing")
  assert.equal(w.bunny.count("PUT"), 0)
})

test("F8 execute and verify refuse before 20:00 UTC unless an incident reason is given, and the receipt records it", async (t) => {
  const w = await world(t)
  for (const mode of ["execute", "verify"]) {
    await assert.rejects(
      convertBodies({ post: w.post, mode, state: {}, now: EARLY, sleep: noSleep }),
      /RUN_LATE_IN_THE_UTC_DAY/,
    )
  }
  assert.equal(w.requests.length, 0)
  const early = await convertBodies({
    post: w.post,
    mode: "execute",
    state: { revision: "", derivative: "" },
    now: EARLY,
    sleep: noSleep,
    allowEarlyReason: "incident B-999: key rotation due",
  })
  assert.equal(early.early_reason, "incident B-999: key rotation due")
  assert.equal(LATE_UTC_HOUR, 20)
  const late = await run(w)
  assert.equal(late.early_reason, null)
})

test("F9 mistyped options are refused", () => {
  assert.deepEqual(parseConvertArgs([]), {
    execute: false,
    verify: false,
    maxBodies: null,
    maxFailures: 10,
    fromStart: false,
    allowEarlyReason: null,
  })
  assert.equal(parseConvertArgs(["--execute", "--max-bodies", "1500"]).maxBodies, 1500)
  for (const argv of [
    ["--bogus"],
    ["--max-bodies"],
    ["--max-bodies", "0"],
    ["--max-bodies", "abc"],
    ["--max-bodies", "100000"],
    ["--max-failures", "0"],
    ["--execute", "--verify"],
    ["--allow-early"],
  ]) {
    assert.throws(() => parseConvertArgs(argv), undefined, JSON.stringify(argv))
  }
})

test("F10 verify is read-only, never saves a cursor, and is clean only for a complete scan with nothing left", async (t) => {
  const w = await world(t)
  const saved = []
  const original = Object.fromEntries(
    [...w.bunny.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString("hex")]),
  )
  const verify = await convertBodies({
    post: w.post,
    mode: "verify",
    state: {},
    now: EVENING,
    sleep: noSleep,
    onProgress: (snapshot) => saved.push(snapshot),
  })
  assert.deepEqual(saved, [], "verify saves no cursor")
  assert.ok(w.requests.every((request) => request.body.execute === false))
  assert.equal(w.bunny.count("PUT"), 0)
  assert.deepEqual(
    Object.fromEntries(
      [...w.bunny.objects].map(([key, bytes]) => [key, Buffer.from(bytes).toString("hex")]),
    ),
    original,
  )
  assert.equal(verify.clean, false)

  await run(w)
  const partial = await convertBodies({
    post: w.post,
    mode: "verify",
    state: {},
    now: EVENING,
    sleep: noSleep,
    maxBodies: 3,
  })
  assert.equal(partial.complete, false)
  assert.equal(partial.clean, false, "a partial scan is never called clean")

  w.bunny.objects.set(w.seen[0].objectKey, new Uint8Array([1, 2, 3]))
  const damaged = await convertBodies({
    post: w.post,
    mode: "verify",
    state: {},
    now: EVENING,
    sleep: noSleep,
  })
  assert.equal(damaged.clean, false)
  assert.deepEqual(
    damaged.failed.map((entry) => [entry.id, entry.code]),
    [[w.seen[0].revisionId, "integrity"]],
  )
})

test("F11 the receipt and the log carry no body text and no token", async (t) => {
  const w = await world(t)
  const lines = []
  const receipt = await run(w, { log: (line) => lines.push(String(line)) })
  const text = JSON.stringify(receipt) + lines.join("\n")
  assert.equal(text.includes(TOKEN), false)
  for (const entry of w.seen) assert.equal(text.includes(entry.prose), false)
  assert.equal(text.includes("another tag"), false)
})

test("F12 a missing cursor file starts at the beginning and a damaged one refuses to guess", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "convert-bodies-state-"))
  const file = path.join(dir, "cursor.json")
  assert.deepEqual(loadState(file), { revision: "", derivative: "" })
  saveState(file, { revision: "revision_a", derivative: "derivative_b" })
  assert.deepEqual(loadState(file), { revision: "revision_a", derivative: "derivative_b" })
  writeFileSync(file, "{not json")
  assert.throws(() => loadState(file), /cursor file/)
  writeFileSync(file, JSON.stringify({ revision: 7, derivative: "x" }))
  assert.throws(() => loadState(file), /cursor file/)
  writeFileSync(file, JSON.stringify({ revision: "bad id!", derivative: "" }))
  assert.throws(() => loadState(file), /cursor file/)
})
