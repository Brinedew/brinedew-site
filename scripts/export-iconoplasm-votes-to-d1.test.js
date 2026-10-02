import assert from "node:assert/strict"
import test from "node:test"

import {
  CUTOVER_VOTES_SQL,
  assertNoVotesSinceCutover,
  replayItems,
  timestampMs,
} from "./export-iconoplasm-votes-to-d1.mjs"

// B-898 Stage 2: the vote export and the cutover replay. Failure modes:
// 1. After a rollback, a "safety" --write export runs against a D1 that has
//    taken votes since the cutover and replaces them with the coordinators'
//    older state.
// 2. The guard passes when D1 cannot answer (a network error, a bad token),
//    so a broken check still lets the export write.
// 3. The guard refuses the one legitimate run: before the cutover, when
//    migration 0113 has not created icono_gene_vote_version yet.
// 4. The replay re-applies a coordinator vote cast before the export (the
//    export already copied it), or one D1 has since overwritten or cleared.
// 5. The replay misses a coordinator vote cast between the export and the
//    cutover, or a vote the coordinator cleared in that window.
// 6. The two timestamp formats on the two sides (SQLite CURRENT_TIMESTAMP and
//    ISO) compare wrongly.

test("--write refuses once D1 holds a vote version, and when D1 cannot answer", async () => {
  const asked = []
  const answer = (rows) => async (sql) => {
    asked.push(sql)
    return rows
  }
  await assert.rejects(
    assertNoVotesSinceCutover(answer([{ n: 1 }])),
    /icono_gene_vote_version has rows/,
  )
  assert.deepEqual(asked, [CUTOVER_VOTES_SQL])
  assert.match(CUTOVER_VOTES_SQL, /LIMIT 1/, "the check reads at most one row")
  await assert.rejects(
    assertNoVotesSinceCutover(async () => {
      throw new Error("Cloudflare API /d1/database/x/query failed (403): auth")
    }),
    /could not show that it holds no votes/,
  )
  assert.deepEqual(await assertNoVotesSinceCutover(answer([{ n: 0 }])), { table: true })
  assert.deepEqual(
    await assertNoVotesSinceCutover(async () => {
      throw new Error("D1_ERROR: no such table: icono_gene_vote_version: SQLITE_ERROR")
    }),
    { table: false },
    "before the cutover the table does not exist and the export may run",
  )
})

test("both timestamp formats compare on one clock", () => {
  assert.equal(timestampMs("2026-10-03 21:00:00"), Date.parse("2026-10-03T21:00:00Z"))
  assert.equal(timestampMs("2026-10-03T21:00:00.000Z"), Date.parse("2026-10-03T21:00:00Z"))
  assert.ok(Number.isNaN(timestampMs("")))
})

test("the replay takes only what the cutover missed", () => {
  const since = "2026-10-03T21:00:00.000Z"
  const sha = (char) => char.repeat(64)
  const results = [
    {
      ok: true,
      compared: true,
      symbol: "TP53",
      samples: {
        missing_in_d1: [
          // Cast after the export started: replay.
          {
            asset_sha256: sha("a"),
            user_id: "late",
            coordinator: { value: 1, vision_id: "anima-v1-2", updated_at: "2026-10-03 21:04:00" },
            d1_last_event_at: null,
          },
          // Cast before the export: the export copied it; D1 lost it since.
          {
            asset_sha256: sha("a"),
            user_id: "early",
            coordinator: { value: 1, vision_id: "", updated_at: "2026-10-03 20:00:00" },
            d1_last_event_at: "2026-10-03 22:00:00",
          },
          // Cast after the export, then cleared by the user in D1 later.
          {
            asset_sha256: sha("a"),
            user_id: "cleared-later",
            coordinator: { value: 1, vision_id: "", updated_at: "2026-10-03 21:02:00" },
            d1_last_event_at: "2026-10-03 22:10:00",
          },
        ],
        value_differs: [
          // Flipped in the coordinator after the export; D1's row is older.
          {
            asset_sha256: sha("b"),
            user_id: "flipped",
            coordinator: { value: -1, vision_id: "", updated_at: "2026-10-03 21:03:00" },
            d1: { value: 1, vision_id: "", updated_at: "2026-10-03 19:00:00" },
          },
          // D1 holds a newer vote by the same user: keep it.
          {
            asset_sha256: sha("b"),
            user_id: "revoted",
            coordinator: { value: -1, vision_id: "", updated_at: "2026-10-03 21:03:00" },
            d1: { value: 1, vision_id: "", updated_at: "2026-10-03 22:30:00" },
          },
        ],
        only_in_d1: [
          // Exported, then cleared in the coordinator before the cutover.
          {
            asset_sha256: sha("c"),
            user_id: "cleared-in-coordinator",
            d1: { value: 1, vision_id: "", updated_at: "2026-10-03 18:00:00" },
          },
          // A vote cast after the cutover: D1's own.
          {
            asset_sha256: sha("c"),
            user_id: "after-cutover",
            d1: { value: 1, vision_id: "", updated_at: "2026-10-03 22:45:00" },
          },
        ],
      },
    },
    { ok: true, compared: false, symbol: "LEGACY1", samples: {} },
    { ok: false, object_id: "f".repeat(64), error: "timeout" },
  ]
  const { items, skipped } = replayItems(results, since)
  assert.deepEqual(items, [
    {
      symbol: "TP53",
      asset_sha256: sha("a"),
      user_id: "late",
      vote_value: 1,
      vision_id: "anima-v1-2",
    },
    { symbol: "TP53", asset_sha256: sha("b"), user_id: "flipped", vote_value: -1 },
    { symbol: "TP53", asset_sha256: sha("c"), user_id: "cleared-in-coordinator", vote_value: 0 },
  ])
  assert.deepEqual(
    skipped.map((row) => row.user_id),
    ["early", "cleared-later", "revoted"],
  )
  assert.throws(() => replayItems(results, "yesterday"), /needs an ISO time/)
})
