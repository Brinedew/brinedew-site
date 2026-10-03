// The target stays secret until the game is over.
//
// A GeneGuessr player is asked to name a protein from clues they pay for or earn. Whatever the
// Worker sends before the game ends must not name the answer or spell out a clue the player has
// not unlocked: the unrevealed text, the gene, the accession, the full name and the scalar
// facts (length, tissue, properties) all stay on the server. The browser only gets redaction
// bars with the word lengths, and a locked clue (one whose text would give the gene away) can
// never be bought.
//
// Everything here runs through the real Worker, on a real local D1 built from the real GeneGuessr
// migrations, with a real protein (human TP53, P04637: its UniProt length, the InterPro domain
// names, GO terms and Reactome pathway names it carries) as the target.
//
// Failure modes this file proves, each written before the code that fixes it:
//   X1  the bootstrap of a running game carries a clue's text, the gene, the accession, the
//       full name, or a scalar fact of the target
//   X2  a guess that shares one clue reveals more than that clue, or the guess response itself
//       carries text of a clue the player has not unlocked
//   X3  a locked clue (its text names the gene) can be bought, or buying one spends the hint
//   X4  a bought clue is not on the next bootstrap, or the other clues come with it
//   X5  the full record is withheld after the player wins or loses, or shows before
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"
const MAX_GUESSES = 10

// What the catalog stores for human TP53. `domains`, GO terms and pathways are the names the
// real entry carries; the length is its UniProt length.
const TP53 = {
  uniprot: "P04637",
  gene: "TP53",
  full_name: "Cellular tumor antigen p53",
  length: 393,
  tissue_label: "Low tissue specificity",
  synonyms: ["LFS1", "TRP53"],
  domains: [
    "P53 DNA-binding domain",
    "P53 tetramerisation motif",
    "P53 transactivation motif",
    "TP53 regulatory region",
  ],
  go_bp: ["apoptotic process", "cell cycle arrest"],
  go_mf: ["DNA-binding transcription factor activity"],
  go_cc: ["nucleoplasm"],
  pathways: ["TP53 Regulates Transcription of Cell Death Genes", "Stabilization of p53"],
  locations: ["Nucleus"],
}

// Text that must not reach a player who has unlocked nothing.
const SECRET_TEXT = [
  "TP53",
  "P04637",
  "Cellular tumor antigen p53",
  "393 amino acid",
  "Low tissue specificity",
  "LFS1",
  "TRP53",
  "P53 DNA-binding domain",
  "P53 tetramerisation motif",
  "P53 transactivation motif",
  "regulatory region",
  "apoptotic process",
  "cell cycle arrest",
  "DNA-binding transcription factor activity",
  "nucleoplasm",
  "TP53 Regulates Transcription of Cell Death Genes",
  "Stabilization of p53",
]

let db
let dispose
let guesses

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  const rows = productionShapedCatalogRows()
    .filter((row) => row.structure_source === "pdb" && row.gene_summary)
    .slice(0, 14)
  await seedCatalog(db, rows)
  // Every other protein is transmembrane and secreted, so no ordinary guess shares the
  // target's "Soluble" and "Intracellular" properties by accident.
  await db.prepare("UPDATE proteins SET tmh = 1, secreted = 1, length = 900").run()
  const [target, sharing, ...others] = rows
  await db
    .prepare(
      `UPDATE proteins SET uniprot = ?, gene = ?, full_name = ?, length = ?, tmh = 0, secreted = 0,
         tissue_label = ?, synonyms = ?, domains = ?, go_bp = ?, go_mf = ?, go_cc = ?,
         pathways = ?, locations = ?
       WHERE id = ?`,
    )
    .bind(
      TP53.uniprot,
      TP53.gene,
      TP53.full_name,
      TP53.length,
      TP53.tissue_label,
      JSON.stringify(TP53.synonyms),
      JSON.stringify(TP53.domains),
      JSON.stringify(TP53.go_bp),
      JSON.stringify(TP53.go_mf),
      JSON.stringify(TP53.go_cc),
      JSON.stringify(TP53.pathways),
      JSON.stringify(TP53.locations),
      target.id,
    )
    .run()
  // One protein that shares exactly one domain and one GO term with the target.
  await db
    .prepare("UPDATE proteins SET domains = ?, go_bp = ?, full_name = ? WHERE id = ?")
    .bind(
      JSON.stringify(["P53 tetramerisation motif"]),
      JSON.stringify(["apoptotic process"]),
      "Tetramerising test protein",
      sharing.id,
    )
    .run()
  guesses = { sharing: sharing.uniprot, others: others.map((row) => row.uniprot) }
})
after(async () => {
  await dispose()
})

const quiet = () => {
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("data_structure\nHEADER    MODEL\nATOM  1\n", {
        status: 200,
        headers: { "Content-Type": "chemical/x-cif" },
      }),
  )
}

// One request through the real Worker.
async function call(path, { method = "GET", cookie, sessions, body } = {}) {
  quiet()
  try {
    const harness = geneguessrWorkerEnv(meteredDb(db), { sessions })
    const response = await worker.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          Cookie: `geneguessr_session=${cookie}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      harness.env,
      { waitUntil() {} },
    )
    const text = await response.text()
    return { status: response.status, text, payload: JSON.parse(text) }
  } finally {
    mock.restoreAll()
  }
}

async function startGame(cookie) {
  const sessions = new Map()
  const start = await call("/api/game/practice/start?practice=1", {
    method: "POST",
    cookie,
    sessions,
    body: { uniprots: [TP53.uniprot] },
  })
  assert.equal(start.status, 200)
  const game = (path, options = {}) => call(path, { cookie, sessions, ...options })
  return {
    bootstrap: () => game("/api/game/bootstrap?practice=1"),
    guess: (uniprot) => game("/api/game/guess?practice=1", { method: "POST", body: { uniprot } }),
    buy: (hintId) => game("/api/game/reveal-hint?practice=1", { method: "POST", body: { hintId } }),
  }
}

const items = (payload) =>
  payload.clue.sections.flatMap((section) => section.items.map((item) => ({ ...item, section })))
const leaks = (text, allowed = []) =>
  SECRET_TEXT.filter(
    (secret) =>
      text.includes(secret) &&
      !allowed.some((permitted) => permitted.includes(secret) || secret.includes(permitted)),
  )

test("X1: the bootstrap of a running game carries no clue text, no identity and no scalar fact", async () => {
  const game = await startGame("secrecy-x1")
  const { status, text, payload } = await game.bootstrap()
  assert.equal(status, 200)

  assert.deepEqual(leaks(text), [], "text of the target reached the wire")
  assert.equal(payload.status.targetId, undefined, "no targetId before the end")
  assert.equal(payload.targetReveal, null)
  assert.equal(payload.targetRevealSections, null)
  assert.deepEqual(
    {
      uniprot: payload.clueTarget.uniprot,
      hgnc: payload.clueTarget.hgnc,
      full_name: payload.clueTarget.full_name,
      length: payload.clueTarget.length,
      tmh: payload.clueTarget.tmh,
      secreted: payload.clueTarget.secreted,
      tissue: payload.clueTarget.tissue,
      domains: payload.clueTarget.domain_names,
      synonyms: payload.clueTarget.synonyms,
      goTerms: payload.clueTarget.go_terms_named,
      pathways: payload.clueTarget.reactome_pathways,
      summary: payload.clueTarget.gene_summary,
    },
    {
      uniprot: null,
      hgnc: null,
      full_name: null,
      length: null,
      tmh: null,
      secreted: null,
      tissue: { label: "unknown", score: null },
      domains: [],
      synonyms: [],
      goTerms: {},
      pathways: [],
      summary: null,
    },
  )

  // What the page does get: a redaction bar per clue, sized by the words, and no text.
  const clues = items(payload).filter((item) => item.id)
  assert.ok(clues.length >= 10, `the clues are there (${clues.length})`)
  for (const clue of clues) {
    assert.equal(clue.text, null, `${clue.id} carries text`)
    assert.equal(clue.revealed, false, `${clue.id} is revealed`)
    assert.ok(Number(clue.maskLength) > 0, `${clue.id} has a mask`)
    assert.ok(Array.isArray(clue.wordLengths), `${clue.id} has word lengths`)
    assert.equal("fullText" in clue, false, `${clue.id} ships its full text`)
  }
  assert.ok(
    clues.some((clue) => clue.locked),
    "the clues that name the gene are locked",
  )
})

test("X2: a guess that shares one domain and one GO term reveals those two clues and no others", async () => {
  const game = await startGame("secrecy-x2")
  const guess = await game.guess(guesses.sharing)
  assert.equal(guess.status, 200)
  const shared = ["P53 tetramerisation motif", "apoptotic process"]
  assert.deepEqual(leaks(guess.text, shared), [], "the guess response carries other clue text")

  const { text, payload } = await game.bootstrap()
  assert.deepEqual(leaks(text, shared), [], "the bootstrap carries other clue text")
  const revealed = items(payload).filter((item) => item.revealed && item.id)
  const revealedText = revealed.map((item) => item.text)
  assert.ok(revealedText.includes("P53 tetramerisation motif"))
  assert.ok(revealedText.includes("apoptotic process"))
  for (const clue of revealed) {
    assert.ok(
      shared.includes(clue.text),
      `${clue.id} was revealed by a guess that did not share it`,
    )
  }
  assert.equal(payload.targetReveal, null, "a wrong guess does not end the game")
})

test("X3, X4: a locked clue cannot be bought; an unlocked one can, and only that one arrives", async () => {
  const game = await startGame("secrecy-x3")
  const { payload } = await game.bootstrap()
  const locked = items(payload).find((item) => item.id && item.locked)
  const open = items(payload).find((item) => item.id && !item.locked)
  assert.ok(locked && open, "the game has a locked and an unlocked clue")

  const refused = await game.buy(locked.id)
  assert.equal(refused.status, 200)
  assert.deepEqual(leaks(refused.text), [], "the refusal carries clue text")
  assert.equal(refused.payload.revealedHint, undefined)
  assert.deepEqual(refused.payload.lockedHint, { id: locked.id, locked: true })
  assert.equal(refused.payload.status.hintBalance, 1, "a locked clue costs nothing")
  assert.deepEqual(refused.payload.status.revealedHints, [])

  const bought = await game.buy(open.id)
  assert.equal(bought.status, 200)
  assert.equal(bought.payload.revealedHint.id, open.id)
  assert.ok(bought.payload.revealedHint.text, "the bought clue's text arrives")
  assert.equal(bought.payload.status.hintBalance, 0)

  const after = await game.bootstrap()
  const arrived = items(after.payload).filter((item) => item.id && item.revealed)
  assert.deepEqual(
    arrived.map((item) => item.id),
    [open.id],
    "the bought clue is the only revealed one",
  )
  assert.equal(arrived[0].text, bought.payload.revealedHint.text)
  assert.equal(arrived[0].maskLength, undefined, "a bought clue drops its mask")
  assert.equal(arrived[0].wordLengths, undefined, "a bought clue drops its word lengths")
  assert.deepEqual(leaks(after.text, [bought.payload.revealedHint.text]), [])

  const broke = await game.buy(
    items(after.payload).find((item) => item.id && !item.locked && !item.revealed).id,
  )
  assert.equal(broke.status, 402, "with no hint left a second clue is refused")
  assert.deepEqual(leaks(broke.text), [])
})

test("X5: a correct guess reveals the whole record, and nothing before it does", async () => {
  const game = await startGame("secrecy-x5-win")
  const wrong = await game.guess(guesses.others[0])
  assert.equal(wrong.payload.status?.won ?? false, false)
  const win = await game.guess(TP53.uniprot)
  assert.equal(win.status, 200)
  const { payload } = await game.bootstrap()

  assert.equal(payload.status.won, true)
  assert.equal(payload.status.targetId, TP53.uniprot)
  assert.equal(payload.clueTarget.uniprot, TP53.uniprot)
  assert.equal(payload.clueTarget.hgnc, TP53.gene)
  assert.equal(payload.clueTarget.full_name, TP53.full_name)
  assert.equal(payload.clueTarget.length, TP53.length)
  assert.equal(payload.clueTarget.tmh, false)
  assert.equal(payload.clueTarget.secreted, false)
  assert.equal(payload.clueTarget.tissue.label, TP53.tissue_label)
  assert.deepEqual(payload.clueTarget.domain_names, TP53.domains)
  assert.deepEqual(payload.clueTarget.go_terms_named.bp, TP53.go_bp)
  assert.deepEqual(payload.clueTarget.reactome_pathways, TP53.pathways)
  assert.equal(payload.targetReveal.hgnc, TP53.gene)
})

test("X5: a game lost on the tenth guess reveals the whole record, the ninth does not", async () => {
  const game = await startGame("secrecy-x5-lose")
  for (let index = 0; index < MAX_GUESSES - 1; index += 1) {
    const wrong = await game.guess(guesses.others[index])
    assert.equal(wrong.status, 200)
    if (index === MAX_GUESSES - 2) {
      assert.equal(wrong.payload.targetReveal, null, "nine guesses do not end the game")
    }
  }
  const nine = await game.bootstrap()
  assert.equal(nine.payload.targetReveal, null)
  assert.equal(nine.payload.status.targetId, undefined)

  const last = await game.guess(guesses.others[MAX_GUESSES - 1])
  assert.equal(last.status, 200)
  const { payload } = await game.bootstrap()
  assert.equal(payload.status.lost, true)
  assert.equal(payload.status.targetId, TP53.uniprot)
  assert.equal(payload.targetReveal.hgnc, TP53.gene)
  assert.equal(payload.clueTarget.full_name, TP53.full_name)
})
