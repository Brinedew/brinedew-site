import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  electAndProjectGeneWinner,
  readGeneVoteSnapshots,
  setGeneVote,
} from "./votes/gene-votes.js"
import {
  caretakerSupervoteRequestSha256,
  projectCaretakerAssignmentInD1,
  setCaretakerSupervoteInD1,
} from "./caretaker/caretaker-supervote.js"
import { VOTE_DAILY_LIMIT } from "./votes/vote-guards.js"
import { createOperationCostD1Meter } from "./operation-cost-d1-meter.js"

// The most rows one admitted vote-budget unit writes, measured below.
const VOTE_WORST_CASE_ROWS_WRITTEN = 21

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
      // The budget statement, the vote row and its index entries, a new
      // summary row and its index entries, the vote event with its index
      // entries and AUTOINCREMENT counter, the version row. The worst case of
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

      await projectCaretakerAssignmentInD1(db, {
        event_id: "evt-TP53-1",
        event_sequence: 1,
        gene: { gene_id: "gene-TP53", canonical_symbol: "TP53" },
        assignment: {
          caretaker_assignment_id: "assign-TP53",
          account_id: "acct_owner",
          status: "active",
          assignment_version: 1,
        },
      })
      const command = {
        command_id: "cmd_cost",
        gene_symbol: "TP53",
        caretaker_account_id: "acct_owner",
        asset_sha256: asset(3),
        direction: 1,
        expected_assignment_version: 1,
        expected_supervote_version: 0,
      }
      const requestSha256 = await caretakerSupervoteRequestSha256(command)
      const supervote = await measure("caretaker supervote", (metered) =>
        setCaretakerSupervoteInD1(metered, {
          symbol: "TP53",
          accountId: "acct_owner",
          assetSha256: asset(3),
          direction: 1,
          commandId: "cmd_cost",
          requestSha256,
          expectedAssignmentVersion: 1,
          expectedSupervoteVersion: 0,
        }),
      )
      assert.equal(supervote.result.ok, true)
      assert.ok(
        supervote.actual.rows_written <= VOTE_WORST_CASE_ROWS_WRITTEN,
        JSON.stringify(supervote.actual),
      )

      const election = await measure("election and projection", (metered) =>
        electAndProjectGeneWinner(metered, "TP53", { actor: "vote_authority" }),
      )
      assert.equal(election.result.projection.code, "PROMOTED")
      // The gene's 20 candidates and their summaries plus a few point reads;
      // a winner change writes the state row, its event and the approval, with
      // their triggers (measured 2026-10-02: 40 read, 18 written).
      assert.ok(election.actual.rows_read <= 48, JSON.stringify(election.actual))
      assert.ok(election.actual.rows_written <= 20, JSON.stringify(election.actual))
      // The daily vote budget (vote-guards.js) holds a full day of admitted
      // votes at the worst case measured above, plus a winner change for one
      // vote in ten, to 40% of D1's free 100,000 rows written.
      assert.ok(
        VOTE_DAILY_LIMIT * VOTE_WORST_CASE_ROWS_WRITTEN +
          Math.ceil(VOTE_DAILY_LIMIT / 10) * election.actual.rows_written <=
          40_000,
        `${VOTE_DAILY_LIMIT} votes`,
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
        20002,
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
