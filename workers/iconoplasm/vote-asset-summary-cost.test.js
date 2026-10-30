import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  electAndProjectGeneWinner,
  importGeneVotes,
  readGeneVoteSnapshots,
  readReaderVotes,
  setGeneVote,
} from "./votes/gene-votes.js"
import { setCaretakerSupervote } from "./caretaker/caretaker-supervote.js"
import { IMAGE_EDIT_INHERITED_UPVOTE_LIMIT, VOTE_PERSON_DAILY_LIMIT } from "./votes/vote-guards.js"
import { createOperationCostD1Meter } from "../test-helpers/d1-row-meter.js"
import { sweepDeferredElections } from "./votes/deferred-elections.js"
import { ADMISSION_COST, priceOf } from "./batch-admission.js"

// The most rows one admitted vote-budget unit writes, measured below (6 on
// 2026-10-30, a first vote on a portrait; 21 before B-1188 and B-1147).
const VOTE_WORST_CASE_ROWS_WRITTEN = 6
// The most rows one image-edit publish writes (25 inherited votes and the
// publisher's own, one import), measured below (81 on 2026-10-30).
const IMAGE_EDIT_PUBLISH_WORST_CASE_ROWS_WRITTEN = 100

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

// B-898 Stage 2: the D1 meters of one vote, measured by the provider's own
// receipts on the complete migrated schema (every index and trigger). The gene
// already holds 1000 votes and sits beside 20,000 other genes: a vote must cost
// what a vote on an empty gene costs, because nothing reads the vote history.
// Failure modes:
// 1. A vote's rows written grow with the gene's vote history.
// 2. An admitted write (vote, first vote on a fresh asset, flip, supervote)
//    writes more rows than the daily vote budget in vote-guards.js was sized
//    for, so the budget's 40% share of D1's daily writes is a fiction.
// 3. An identical retry writes anything or spends budget.
test(
  "one vote on a gene with 1000 votes costs a fixed handful of D1 rows",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vote cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((name) => name.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      const asset = (n) => n.toString(16).padStart(64, "0")
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_vote_asset_summary(gene_symbol,asset_sha256,candidate_ref,score)
      SELECT 'G'||n,printf('%064x',n),'G'||n||':'||printf('%064x',n),9 FROM ids`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20)
      INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_medium,r2_key_thumb,status,created_at)
      SELECT 'TP53',printf('%064x',n),'f','m','t','draft','2026-01-01 00:00:00' FROM ids`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<1000)
      INSERT INTO icono_image_votes(candidate_ref,gene_symbol,asset_sha256,vision_id,user_id,vote_value)
      SELECT 'a:TP53|'||printf('%064x',1),'TP53',printf('%064x',1),'','voter'||n,1 FROM ids`,
        )
        .run()
      await db
        .prepare(
          `INSERT INTO icono_vote_asset_summary(gene_symbol,asset_sha256,candidate_ref,upvotes,score,vote_count)
           VALUES ('TP53', ?, ?, 1000, 1000, 1000)`,
        )
        .bind(asset(1), `a:TP53|${asset(1)}`)
        .run()

      const measure = async (label, action) => {
        const meter = createOperationCostD1Meter(db)
        const result = await action(meter.db)
        const actual = meter.finish()
        t.diagnostic(JSON.stringify({ [label]: actual }))
        return { result, actual }
      }

      const first = await measure("new vote", (metered) =>
        setGeneVote(metered, {
          symbol: "TP53",
          assetSha256: asset(2),
          userId: "reader",
          voteValue: 1,
        }),
      )
      assert.equal(first.result.changed, true)
      // The allowance row, the vote row and its user index entry, a new
      // summary row, the version row. The worst case of
      // VOTE_WORST_CASE_ROWS_WRITTEN below.
      assert.ok(first.actual.rows_read <= 6, JSON.stringify(first.actual))
      assert.ok(
        first.actual.rows_written <= VOTE_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(first.actual),
      )

      const onVotedAsset = await measure("new vote on an asset with votes", (metered) =>
        setGeneVote(metered, {
          symbol: "TP53",
          assetSha256: asset(1),
          userId: "reader",
          voteValue: 1,
        }),
      )
      assert.equal(onVotedAsset.result.changed, true)
      assert.ok(
        onVotedAsset.actual.rows_written <= VOTE_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(onVotedAsset.actual),
      )

      const flip = await measure("flipped vote", (metered) =>
        setGeneVote(metered, {
          symbol: "TP53",
          assetSha256: asset(2),
          userId: "reader",
          voteValue: -1,
        }),
      )
      assert.ok(flip.actual.rows_read <= 12, JSON.stringify(flip.actual))
      assert.ok(
        flip.actual.rows_written <= VOTE_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(flip.actual),
      )

      const retry = await measure("identical retry", (metered) =>
        setGeneVote(metered, {
          symbol: "TP53",
          assetSha256: asset(2),
          userId: "reader",
          voteValue: -1,
        }),
      )
      assert.equal(retry.result.changed, false)
      assert.equal(retry.actual.rows_written, 0)
      assert.ok(retry.actual.rows_read <= 2, JSON.stringify(retry.actual))

      await db
        .prepare(
          `INSERT INTO icono_caretaker_assignments
             (caretaker_assignment_id, gene_symbol, account_id, status, terms_accepted_at,
              relinquish_policy, invited_by_account_id, started_at)
           VALUES ('assign-TP53', 'TP53', 'acct_owner', 'active', '2026-10-01', 'retain',
                   'acct_owner', '2026-10-01')`,
        )
        .run()
      const supervote = await measure("caretaker supervote", (metered) =>
        setCaretakerSupervote(metered, {
          symbol: "TP53",
          accountId: "acct_owner",
          assetSha256: asset(3),
          direction: 1,
          commandId: "cmd_cost",
          expectedAssignmentVersion: 1,
          expectedSupervoteVersion: 0,
        }),
      )
      assert.equal(supervote.result.ok, true)
      assert.ok(
        supervote.actual.rows_written <= VOTE_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(supervote.actual),
      )

      // One image-edit publish: the inherited upvotes of synthetic voters and
      // the publisher's own, all on a fresh asset, in one admitted import.
      const editVotes = Array.from(
        { length: IMAGE_EDIT_INHERITED_UPVOTE_LIMIT + 1 },
        (_, index) => ({
          symbol: "TP53",
          asset_sha256: asset(10),
          user_id: `__system_image_edit_inherit__:job:${index + 1}`,
          vote_value: 1,
        }),
      )
      const publisherChanges = async () =>
        Number(
          (
            await db
              .prepare(
                "SELECT changes FROM icono_vote_person_day WHERE user_id = 'publisher' AND day = date('now')",
              )
              .first()
          )?.changes || 0,
        )
      const budgetBefore = await publisherChanges()
      const editPublish = await measure("image edit publish, 26 votes", (metered) =>
        importGeneVotes(metered, editVotes, { chargeTo: "publisher" }),
      )
      assert.equal(editPublish.result.results.filter((row) => row.changed).length, 26)
      assert.equal(
        (await publisherChanges()) - budgetBefore,
        26,
        "26 votes spend exactly 26 of the publisher's allowance",
      )
      // 81 rows measured on 2026-10-30: one budget row and one version row for
      // the whole import, then about 3 rows per vote.
      assert.ok(
        editPublish.actual.rows_written <= IMAGE_EDIT_PUBLISH_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(editPublish.actual),
      )
      assert.ok(
        editPublish.actual.rows_written <= 26 * VOTE_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(editPublish.actual),
      )

      const election = await measure("election and projection", (metered) =>
        electAndProjectGeneWinner(metered, "TP53", { actor: "vote_authority" }),
      )
      assert.equal(election.result.projection.code, "PROMOTED")
      // The gene's 20 candidates and their summaries plus a few point reads;
      // a winner change writes the state row and its event, with their indexes
      // (measured 2026-10-02: 40 read, 18 written, when it also marked the winner
      // "approved"; that label cost 17 rows a time on the live account and went on
      // 2026-10-09; 6 written on 2026-10-30 for portraits without a style, 9 with
      // one, below).
      assert.ok(election.actual.rows_read <= 48, JSON.stringify(election.actual))
      assert.ok(election.actual.rows_written <= 6, JSON.stringify(election.actual))
      // One person's daily allowance (vote-guards.js) at the worst-case bound
      // above, plus a winner change for one vote in ten, stays within 5% of D1's
      // free 100,000 rows written: a scripted account can't spend the day.
      assert.ok(
        VOTE_PERSON_DAILY_LIMIT * VOTE_WORST_CASE_ROWS_WRITTEN +
          Math.ceil(VOTE_PERSON_DAILY_LIMIT / 10) * election.actual.rows_written <=
          5_000,
        `${VOTE_PERSON_DAILY_LIMIT} votes`,
      )

      const steady = await measure("election without a winner change", (metered) =>
        electAndProjectGeneWinner(metered, "TP53", { actor: "vote_authority" }),
      )
      assert.equal(steady.result.projection.code, "UNCHANGED")
      assert.equal(steady.actual.rows_written, 0)
      assert.ok(steady.actual.rows_read <= 48, JSON.stringify(steady.actual))

      const snapshot = await measure("snapshot", (metered) =>
        readGeneVoteSnapshots(metered, {
          userId: "reader",
          items: [{ symbol: "TP53", asset_sha256: asset(2) }],
        }),
      )
      assert.equal(snapshot.result[0].snapshot.user_vote, -1)
      assert.equal(snapshot.result[0].snapshot.image_downvotes, 1)
      assert.ok(snapshot.actual.rows_read <= 10, JSON.stringify(snapshot.actual))
      assert.equal(snapshot.actual.rows_written, 0)

      const summary = await db
        .prepare(
          "SELECT upvotes, score, vote_count FROM icono_vote_asset_summary WHERE gene_symbol = 'TP53' AND asset_sha256 = ?",
        )
        .bind(asset(1))
        .first()
      // The 1000 seeded votes plus the reader's, moved by its exact delta.
      assert.deepEqual({ ...summary }, { upvotes: 1001, score: 1001, vote_count: 1001 })
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM icono_vote_asset_summary").first()).n,
        20003,
      )

      // A signed-in reader opens TP53 and the page asks for their own votes on
      // all 72 portraits it shows (TP53 is the heaviest real gene). The reader
      // has 2000 older votes on other genes, and portrait 1 carries 1001 votes.
      // Failure modes:
      // 1. The planner walks the reader's (user_id, updated_at) index and reads
      //    their whole history once per portrait: 144,000 rows.
      // 2. A probe reads every vote on portrait 1: 1001 rows.
      // 3. A guest reads anything.
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<2000)
      INSERT INTO icono_image_votes(candidate_ref,gene_symbol,asset_sha256,vision_id,user_id,vote_value)
      SELECT 'a:G'||n||'|'||printf('%064x',n),'G'||n,printf('%064x',n),'','reader',1 FROM ids`,
        )
        .run()
      const shown = Array.from({ length: 72 }, (_, index) => ({
        symbol: "TP53",
        asset_sha256: asset(index + 1),
      }))
      const mine = await measure("reader's own votes on 72 portraits", (metered) =>
        readReaderVotes(metered, { userId: "reader", items: shown }),
      )
      assert.deepEqual(mine.result.map((row) => [row.asset_sha256, row.vote]).sort(), [
        [asset(1), 1],
        [asset(2), -1],
      ])
      // 74 measured on 2026-10-31: one index probe per portrait, plus the two
      // rows that hold the reader's votes.
      assert.ok(mine.actual.rows_read <= 2 * shown.length, JSON.stringify(mine.actual))
      assert.equal(mine.actual.rows_written, 0)
      const guest = await measure("guest's own votes", (metered) =>
        readReaderVotes(metered, { userId: "", items: shown }),
      )
      assert.deepEqual(guest.result, [])
      assert.equal(guest.actual.rows_read, 0)
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)

// B-1147: what a vote and a winner change write once migration 0149 trimmed
// them, on portraits that carry styles (the style cards' triggers, 0144), and
// what shedding a winner change and sweeping it later cost.
// Failure modes:
// 1. An index or trigger comes back on the vote or winner-change path, and a
//    vote day holds fewer votes than the capacity runbook says.
// 2. A shed day's election spends more than marking its gene due.
// 3. The sweep spends more than the price it is admitted by.
test(
  "a vote writes 4 to 6 rows, a winner change 9, a shed election 1, and a sweep its price",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vote cost')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const directory = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(directory)
        .filter((name) => name.endsWith(".sql"))
        .sort())
        schema.exec(readFileSync(new URL(file, directory), "utf8"))
      const db = await runtime.getD1Database("DB")
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (let offset = 0; offset < definitions.length; offset += 20)
        await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
      const asset = (n) => n.toString(16).padStart(64, "0")
      await db
        .prepare(
          "INSERT OR IGNORE INTO icono_asset_summary_counts (summary_key) VALUES ('default')",
        )
        .run()
      for (const symbol of ["TP53", "KRAS"]) {
        await db
          .prepare("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)")
          .bind(symbol, symbol)
          .run()
        // Portrait 1 in style 3, portraits 2 and 3 in style 5, 4 to 20 in style 7.
        await db
          .prepare(
            `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20)
             INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_medium,r2_key_thumb,status,created_at,emulsion_id)
             SELECT ?1,printf('%064x',n),'f','m','t','draft','2026-01-01 00:00:00',
                    CASE WHEN n=1 THEN 'em-3' WHEN n<=3 THEN 'em-5' ELSE 'em-7' END FROM ids`,
          )
          .bind(symbol)
          .run()
        await db
          .prepare(
            "INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by) VALUES (?, ?, 'seed')",
          )
          .bind(symbol, asset(1))
          .run()
      }
      const seedScore = (symbol, n, score) =>
        db
          .prepare(
            `INSERT INTO icono_vote_asset_summary (gene_symbol, asset_sha256, candidate_ref, upvotes, score, vote_count)
             VALUES (?1, ?2, 'a:' || ?1 || '|' || ?2, ?3, ?3, ?3)
             ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET upvotes = ?3, score = ?3, vote_count = ?3`,
          )
          .bind(symbol, asset(n), score)
          .run()
      for (const symbol of ["TP53", "KRAS"]) await seedScore(symbol, 1, 5)

      const measure = async (label, action) => {
        const meter = createOperationCostD1Meter(db)
        const result = await action(meter.db)
        const actual = meter.finish()
        t.diagnostic(JSON.stringify({ [label]: actual }))
        return { result, actual }
      }
      const vote =
        (symbol, n, value, userId = "reader") =>
        (metered) =>
          setGeneVote(metered, { symbol, assetSha256: asset(n), userId, voteValue: value })
      const elect =
        (symbol, options = {}) =>
        (metered) =>
          electAndProjectGeneWinner(metered, symbol, { actor: "vote_authority", ...options })

      // Each vote: the allowance row, the vote row and the gene's version; a
      // first vote on a portrait also creates its summary row.
      const fresh = await measure("first vote on a portrait", vote("TP53", 4, 1))
      assert.ok(fresh.actual.rows_written <= 6, JSON.stringify(fresh.actual))
      const again = await measure("vote on a portrait with votes", vote("TP53", 4, 1, "reader2"))
      assert.ok(again.actual.rows_written <= 5, JSON.stringify(again.actual))
      const flip = await measure("flipped vote", vote("TP53", 4, -1))
      assert.ok(flip.actual.rows_written <= 4, JSON.stringify(flip.actual))

      const steady = await measure("election, winner held", elect("TP53"))
      assert.equal(steady.result.projection.code, "UNCHANGED")
      assert.equal(steady.actual.rows_written, 0)

      // A winner change across styles: the state row, its event (row, indexes,
      // AUTOINCREMENT counter) and both style cards.
      await seedScore("TP53", 2, 5)
      await vote("TP53", 2, 1)(db)
      const across = await measure("winner change across styles", elect("TP53"))
      assert.equal(across.result.projection.code, "PROMOTED")
      assert.ok(across.actual.rows_written <= 9, JSON.stringify(across.actual))
      await seedScore("TP53", 3, 6)
      await vote("TP53", 3, 1)(db)
      const within = await measure("winner change within a style", elect("TP53"))
      assert.equal(within.result.projection.code, "PROMOTED")
      assert.ok(within.actual.rows_written <= 9, JSON.stringify(within.actual))

      // A shed day: an election that keeps the winner writes nothing, and a
      // winner change marks its gene due instead of projecting.
      await db
        .prepare(
          "INSERT INTO icono_publication_shed_days (day, meter, projected, stop) VALUES (date('now'), 'rows_written', 86000, 85000)",
        )
        .run()
      const held = await measure("shed day, winner held", elect("KRAS", { shedable: true }))
      assert.equal(held.result.projection.code, "UNCHANGED")
      assert.equal(held.actual.rows_written, 0)
      await seedScore("KRAS", 2, 5)
      await vote("KRAS", 2, 1)(db)
      const shed = await measure("shed election", elect("KRAS", { shedable: true }))
      assert.equal(shed.result.projection.code, "SHED")
      assert.equal(shed.actual.rows_written, 1)
      const shedAgain = await measure(
        "shed election, gene already due",
        elect("KRAS", { shedable: true }),
      )
      assert.equal(shedAgain.actual.rows_written, 0)

      // The sweep after the reset: one gene, a winner change, within its price.
      const after = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:07:00Z`) + 86_400_000
      const swept = await measure("sweep of one due gene", (metered) =>
        sweepDeferredElections(metered, {
          usage: {
            day: new Date(after).toISOString().slice(0, 10),
            measured_at: after,
            meter_counted_before: new Date(after).toISOString(),
            rows_read: 0,
            rows_written: 0,
            requests: 0,
          },
          now: after,
        }),
      )
      assert.deepEqual(
        { elected: swept.result.elected, promoted: swept.result.promoted },
        { elected: 1, promoted: 1 },
      )
      // The run's own reads (the admission ledger, the shed day, the due list)
      // fit inside the gene's read price; its admission row is ADMISSION_COST.
      const price = priceOf("vote_election", 1)
      for (const meter of ["rows_written", "rows_read"])
        assert.ok(
          swept.actual[meter] <= price[meter] + ADMISSION_COST[meter],
          `${meter}: ${JSON.stringify(swept.actual)}`,
        )

      // Clearing a vote on a portrait whose row is gone takes the vote out of
      // the summary row it has and creates none.
      await vote("KRAS", 6, 1)(db)
      await db
        .prepare(
          "DELETE FROM icono_portrait_assets WHERE gene_symbol = 'KRAS' AND asset_sha256 = ?",
        )
        .bind(asset(6))
        .run()
      const cleared = await measure("clear on a removed portrait", vote("KRAS", 6, 0))
      assert.equal(cleared.result.ok, true)
      assert.ok(cleared.actual.rows_written <= 4, JSON.stringify(cleared.actual))
      const summary = await db
        .prepare(
          "SELECT upvotes, downvotes, score, vote_count FROM icono_vote_asset_summary WHERE gene_symbol = 'KRAS' AND asset_sha256 = ?",
        )
        .bind(asset(6))
        .first()
      assert.deepEqual({ ...summary }, { upvotes: 0, downvotes: 0, score: 0, vote_count: 0 })
      await db
        .prepare(
          "DELETE FROM icono_portrait_assets WHERE gene_symbol = 'KRAS' AND asset_sha256 = ?",
        )
        .bind(asset(7))
        .run()
      assert.equal((await vote("KRAS", 7, 0)(db)).ok, true)
      const created = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM icono_vote_asset_summary WHERE gene_symbol = 'KRAS' AND asset_sha256 = ?",
        )
        .bind(asset(7))
        .first()
      assert.equal(created.n, 0)
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
