import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import {
  CROP_CODE_POINTS,
  DEFAULT_NIGHT_GENES,
  MAX_NIGHT_GENES,
  MAX_CODE_POINTS,
  ROWS_WRITTEN_PER_GENE,
  commandIdFor,
  createRoutePoster,
  loadCandidates,
  loadCursor,
  parseRestoreArgs,
  restoreGenes,
  saveCursor,
  writeReceipt,
} from "./restore-cropped-seed-prose.mjs"

// B-977: the operator script that sends the workstation's full seed texts to the
// restore route. The route is the judge (workers/iconoplasm/caretaker/
// manifestation-seed-prose-restoration.test.js drives the real route against the
// real authority schema); this file covers what the script alone decides.
// Failure modes, written before the code:
// 1. It sends a text the route must refuse (not longer than 4,000, over 10,000
//    after normalization) or misses one it should send, or opens prompts.db for
//    writing.
// 2. A retry after a timeout or CPU kill uses a new command id and so writes a
//    second revision; or the id changes between nights.
// 3. A dry run sends something, or an execute run starts right after the 00:00 UTC
//    reset without a reason.
// 4. The night's slice ignores the D1 row budget, so a viral-day allowance is
//    spent by one operator job.
// 5. The saved cursor skips past a failed gene, which is then never retried.
// 6. A refused token or a quota 429 keeps hammering the route.
// 7. The receipt does not say restored / skipped / failed counts and the cost.

const LATE = new Date("2026-10-05T21:00:00.000Z")
const EARLY = new Date("2026-10-05T01:00:00.000Z")

function text(codePoints, label = "x") {
  const sentence = `${label} protein rests at the nuclear periphery. `
  return Array.from(sentence.repeat(Math.ceil(codePoints / sentence.length) + 1))
    .slice(0, codePoints)
    .join("")
}

function makePromptsDb(t, entries) {
  const dir = mkdtempSync(path.join(tmpdir(), "b977-prompts-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "prompts.db")
  const db = new DatabaseSync(file)
  db.exec(
    "CREATE TABLE manifestations (gene_symbol TEXT PRIMARY KEY, manifestation TEXT, status TEXT DEFAULT 'pending')",
  )
  const insert = db.prepare("INSERT INTO manifestations VALUES (?, ?, ?)")
  for (const [symbol, body, status = "generated"] of entries) insert.run(symbol, body, status)
  db.close()
  return { dir, file }
}

test("loadCandidates picks the genes with 4,001 to 10,000 characters after normalization, in symbol order", (t) => {
  const crlf = text(4500, "crlf").replace(/ protein /g, " protein\r\n")
  const { file } = makePromptsDb(t, [
    ["BBB2", text(6000, "b")],
    ["AAA1", text(4001, "a")],
    ["EXACT", text(CROP_CODE_POINTS, "e")], // not cut: nothing to restore
    ["SHORT", text(1200, "s")],
    ["LIMIT", text(MAX_CODE_POINTS, "l")], // exactly 10,000 is allowed
    ["OVER", text(MAX_CODE_POINTS + 1, "o")], // left for the caretaker GUI
    ["HUGE", text(184_408, "h")], // FAM189B-like
    ["FAILED", text(6000, "f"), "failed"],
    ["CRLF", crlf],
  ])

  const { genes, over } = loadCandidates(file)

  assert.deepEqual(
    genes.map((gene) => gene.gene_symbol),
    ["AAA1", "BBB2", "CRLF", "LIMIT"],
  )
  assert.deepEqual(over.map((gene) => gene.gene_symbol).sort(), ["HUGE", "OVER"])
  assert.equal(genes.find((gene) => gene.gene_symbol === "AAA1").code_points, 4001)
  assert.deepEqual(
    loadCandidates(file, { after: "BBB2" }).genes.map((gene) => gene.gene_symbol),
    ["CRLF", "LIMIT"],
  )
})

test("prompts.db is opened read-only", (t) => {
  const { file } = makePromptsDb(t, [["AAA1", text(5000)]])
  const before = readFileSync(file)
  loadCandidates(file)
  assert.deepEqual(readFileSync(file), before)
  assert.ok(!existsSync(`${file}-wal`) && !existsSync(`${file}-journal`))
})

test("a command id depends on the gene and its normalized text and nothing else", () => {
  const a = commandIdFor("AAA1", "one\r\ntwo")
  assert.equal(a, commandIdFor("AAA1", "one\ntwo"))
  assert.notEqual(a, commandIdFor("AAA2", "one\ntwo"))
  assert.notEqual(a, commandIdFor("AAA1", "one\ntwo!"))
  assert.match(a, /^b977_restore_[a-f0-9]{48}$/)
})

function poster(replies) {
  const calls = []
  const post = async (call) => {
    calls.push(call)
    const reply = typeof replies === "function" ? replies(call, calls.length) : replies
    return reply
  }
  return { post, calls }
}

const restored = (rows = 64) => ({
  status: 200,
  body: { ok: true, status: "restored", d1_rows_written: rows, bunny_fetches: 5 },
})

const SAMPLE_PROSE = text(4500, "g")
const sample = (n) =>
  Array.from({ length: n }, (_, index) => ({
    gene_symbol: `G${String(index).padStart(4, "0")}`,
    prose: `${index} ${SAMPLE_PROSE}`,
  }))

test("a dry run sends nothing and prints the plan with its cost", async () => {
  const receipt = await restoreGenes({ genes: sample(6817), mode: "dry-run", now: EARLY })
  assert.equal(receipt.calls, 0)
  assert.equal(receipt.cost_estimate.genes, 6817)
  assert.equal(receipt.cost_estimate.d1_rows_written_estimate, 6817 * ROWS_WRITTEN_PER_GENE)
  assert.match(receipt.plan.summary, /6,817 genes qualify/)
  assert.ok(receipt.cost_estimate.nights_at_default > 30, "rows, not requests, set the pace")
})

test("execute before 20:00 UTC is refused without an incident reason", async () => {
  const { post, calls } = poster(restored())
  await assert.rejects(
    restoreGenes({ genes: sample(2), post, mode: "execute", now: EARLY }),
    (error) => error.code === "RUN_LATE_IN_THE_UTC_DAY",
  )
  assert.equal(calls.length, 0)
  const receipt = await restoreGenes({
    genes: sample(2),
    post,
    mode: "execute",
    now: EARLY,
    allowEarlyReason: "incident B-977 test",
  })
  assert.equal(receipt.early_reason, "incident B-977 test")
  assert.equal(receipt.restored, 2)
})

test("a night restores at most the row budget allows, and the default stays under 15,000 rows", async () => {
  assert.ok(DEFAULT_NIGHT_GENES * ROWS_WRITTEN_PER_GENE <= 15_000)
  assert.ok(MAX_NIGHT_GENES * ROWS_WRITTEN_PER_GENE <= 20_000)
  const { post, calls } = poster(restored())
  const receipt = await restoreGenes({
    genes: sample(DEFAULT_NIGHT_GENES + 50),
    post,
    mode: "execute",
    now: LATE,
  })
  assert.equal(calls.length, DEFAULT_NIGHT_GENES)
  assert.equal(receipt.restored, DEFAULT_NIGHT_GENES)
  assert.ok(receipt.d1_rows_written_estimated <= 15_000)
  assert.equal(receipt.complete, false)

  // A tighter explicit row budget stops earlier and says why.
  const tight = await restoreGenes({
    genes: sample(50),
    post: poster(restored()).post,
    mode: "execute",
    now: LATE,
    rowBudget: ROWS_WRITTEN_PER_GENE * 3,
  })
  assert.equal(tight.restored, 3)
  assert.equal(tight.stopped, "row_budget")
})

test("the receipt counts restored, skipped and failed genes and lists what needs a look", async () => {
  const answers = {
    G0000: restored(),
    G0001: {
      status: 200,
      body: { ok: true, status: "skipped_not_cropped", reason: "already_full" },
    },
    G0002: {
      status: 200,
      body: { ok: true, status: "skipped_not_cropped", reason: "different_text" },
    },
    G0003: { status: 200, body: { ok: true, status: "skipped_caretaker_canonical" } },
    G0004: {
      status: 202,
      body: {
        ok: true,
        status: "restored",
        projection_pending: true,
        d1_rows_written: 70,
        bunny_fetches: 5,
      },
    },
    G0005: { status: 409, body: { error: { code: "STALE_AUTHORITY_STATE" } } },
  }
  const { post } = poster((call) => answers[call.geneSymbol])
  const receipt = await restoreGenes({ genes: sample(6), post, mode: "execute", now: LATE })

  assert.equal(receipt.restored, 2)
  assert.equal(receipt.restored_projection_pending, 1)
  assert.equal(receipt.skipped_not_cropped, 2)
  assert.deepEqual(receipt.different_text, ["G0002"])
  assert.equal(receipt.skipped_caretaker_canonical, 1)
  assert.deepEqual(receipt.failed, [
    { gene_symbol: "G0005", status: 409, code: "STALE_AUTHORITY_STATE" },
  ])
  assert.equal(receipt.d1_rows_written_authority_observed, 64 + 70)
  assert.equal(receipt.bunny_fetches, 10)
})

test("a 503 is retried with the same command id; a 4xx is not retried", async () => {
  const seen = []
  const { post } = poster((call, n) => {
    seen.push(call.commandId)
    if (call.geneSymbol === "G0000") return n < 3 ? { status: 503, body: null } : restored()
    return { status: 400, body: { error: { code: "INVALID_SEED_RESTORE_REQUEST" } } }
  })
  const receipt = await restoreGenes({
    genes: sample(2),
    post,
    mode: "execute",
    now: LATE,
    sleep: async () => {},
  })

  assert.equal(receipt.retries, 2)
  assert.equal(receipt.restored, 1)
  assert.equal(new Set(seen.slice(0, 3)).size, 1, "all attempts for a gene share one command id")
  assert.equal(seen.length, 4, "the 400 was tried once")
  assert.equal(receipt.failed[0].code, "INVALID_SEED_RESTORE_REQUEST")
})

test("a thrown network error is retried, and a gene that never answers is a failure", async () => {
  const { post, calls } = poster(() => {
    throw new Error("socket hang up")
  })
  const receipt = await restoreGenes({
    genes: sample(1),
    post,
    mode: "execute",
    now: LATE,
    sleep: async () => {},
  })
  assert.equal(calls.length, 4)
  assert.equal(receipt.failed.length, 1)
  assert.equal(receipt.failed[0].code, "socket hang up")
})

test("the saved cursor stops before the first failure so that gene is visited again", async () => {
  const saved = []
  const { post } = poster((call) =>
    call.geneSymbol === "G0002"
      ? { status: 409, body: { error: { code: "STALE_AUTHORITY_STATE" } } }
      : restored(),
  )
  const receipt = await restoreGenes({
    genes: sample(5),
    post,
    mode: "execute",
    now: LATE,
    onProgress: (symbol) => saved.push(symbol),
  })
  assert.deepEqual(saved, ["G0000", "G0001"])
  assert.equal(receipt.next_after, "G0001")
  assert.equal(receipt.restored, 4, "the run still carried on past the failure")
})

test("a refused token, a quota 429 or too many failures stop the run at once", async () => {
  for (const [status, stopped] of [
    [403, "unauthorized"],
    [401, "unauthorized"],
    [429, "body_quota"],
  ]) {
    const { post, calls } = poster({ status, body: null })
    const receipt = await restoreGenes({ genes: sample(5), post, mode: "execute", now: LATE })
    assert.equal(receipt.stopped, stopped)
    assert.equal(calls.length, 1)
  }
  const { post } = poster({ status: 400, body: { error: { code: "X" } } })
  const receipt = await restoreGenes({
    genes: sample(30),
    post,
    mode: "execute",
    now: LATE,
    maxFailures: 4,
  })
  assert.equal(receipt.stopped, "too_many_failures")
  assert.equal(receipt.failed.length, 4)
})

test("the cursor and receipt files round-trip", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "b977-state-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "nested", "cursor.json")
  assert.equal(loadCursor(file), "")
  saveCursor(file, "ABCD1")
  assert.equal(loadCursor(file), "ABCD1")
  const first = writeReceipt(dir, { mode: "execute", started_at: "2026-10-05T21:00:00.000Z" })
  const second = writeReceipt(dir, { mode: "execute", started_at: "2026-10-05T21:00:00.000Z" })
  assert.notEqual(first, second)
  assert.equal(JSON.parse(readFileSync(first, "utf8")).mode, "execute")
})

test("the poster needs a token and posts the command id, gene and text as JSON", async () => {
  assert.throws(() => createRoutePoster({ token: "" }), /ADMIN_TOKEN_MISSING/)
  let sent = null
  const post = createRoutePoster({
    token: "secret-token",
    fetchImpl: async (url, init) => {
      sent = { url, init }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
  })
  const reply = await post({ commandId: "b977_restore_abc", geneSymbol: "AAA1", prose: "text" })
  assert.equal(reply.status, 200)
  assert.equal(
    sent.url,
    "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/caretakers/restore-seed-prose",
  )
  assert.equal(sent.init.headers.Authorization, "Bearer secret-token")
  assert.deepEqual(JSON.parse(sent.init.body), {
    command_id: "b977_restore_abc",
    gene_symbol: "AAA1",
    prose: "text",
  })
})

test("arguments are bounded", () => {
  assert.deepEqual(parseRestoreArgs([]).maxGenes, null)
  assert.equal(parseRestoreArgs(["--max-genes", "5"]).maxGenes, 5)
  assert.throws(
    () => parseRestoreArgs(["--max-genes", String(MAX_NIGHT_GENES + 1)]),
    /whole number/,
  )
  assert.throws(() => parseRestoreArgs(["--from", "bad symbol"]), /gene symbol/)
  assert.equal(parseRestoreArgs(["--from", "start"]).from, "start")
  assert.throws(() => parseRestoreArgs(["--allow-early", " "]), /reason/)
  assert.throws(() => parseRestoreArgs(["--force"]), /Unknown option/)
})
