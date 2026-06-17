# Iconoplasm Newer Tie Canonical Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic Iconoplasm canonical blot selection promote the newer eligible blot when vote totals tie, while preserving admin overrides and Cloudflare budget guardrails.

**Architecture:** D1 publish state remains the source of truth, the per-gene VoteCoordinator remains the vote writer, and Cloudflare Queue projection remains the only automatic promotion path. The intervention changes the canonical candidate comparator and its read-model mirrors; it does not add public hot-path reads, vote-triggered KV catalog publishes, or direct request-path promotion.

**Tech Stack:** Cloudflare Workers, D1, Durable Objects, Queues, KV coarse catalog snapshots, Node test runner, pnpm.

---

## Context Learned Before Planning

- Linear B-365 says website admin owns live canon governance, `admin_override`, vote-aware review, and explicit "Set live canon" / "Return to auto" actions.
- Linear B-520 says vote projection must not publish the full KV card catalog per vote; D1/detail is the per-gene freshness source, KV catalog is coarse browse snapshot, and PRL-style split-brain protection must remain.
- Code comments around `autoPromoteTopVotedPortrait` and `autoPromoteTopVotedPortraitFromCoordinatorState` warn that D1 can move ahead of public artifacts if projection is interrupted.
- Tests already guard that vote requests enqueue projection and do not mutate canonical state directly.
- The current comparator is inconsistent with the desired product rule because it ranks "already current" before `created_at DESC`.
- Production check found existing misses:
  - all same-vote ties, including zero-vote batches: 12,660 genes, 13,229 later candidates;
  - ties where both sides have actual votes: 3 genes, 4 later candidates.

## Files

- Modify: `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
  - `compareAdminLeaderRows`
  - SQL ranking blocks in bulk and bootstrap admin gene rollup rebuilds
  - `autoPromoteTopVotedPortrait` SQL ordering
- Modify: `workers/iconoplasm.vote-coordinator-routing.test.js`
  - add projection tests for same-vote newer tie promotion and admin override preservation
- Modify: `workers/iconoplasm.d1-hot-query-guard.test.js`
  - add guard that auto-promotion ranks `created_at` before "already current"
  - keep existing Queue/KV/D1 hot-path guards
- Modify: `workers/iconoplasm.admin-reconcile.test.js` or create a focused admin rollup test in the existing worker test style
  - verify admin read-model `leader_asset_sha256` matches the newer tied candidate
- Modify: `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`
  - document the tie-breaker and the backfill policy

## Comparator Contract

The canonical automatic ranking must become:

1. highest `score`
2. non-legacy before legacy
3. highest `upvotes`
4. newest `created_at`
5. current asset only as a final stability fallback for indistinguishable rows
6. lowest `asset_sha256` as deterministic fallback

Admin override remains absolute. Rejected, stale, non-renderable, and autopick-ineligible assets remain excluded.

## Task 1: Lock the Desired Comparator With Unit-Level Projection Tests

**Files:**

- Modify: `workers/iconoplasm.vote-coordinator-routing.test.js`

- [ ] **Step 1: Add a failing Queue projection test for same-vote newer tie**

Add this test near the existing vote projection tests:

```js
test("vote projection promotes newer asset when score and upvotes tie", async () => {
  const oldAssetSha = "a".repeat(64)
  const newAssetSha = "b".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "SLC11A2",
        asset_summaries: [
          {
            asset_sha256: oldAssetSha,
            candidate_ref: `a:SLC11A2|${oldAssetSha}`,
            vision_id: "anima-v1-old",
            candidate_image_id: 10,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
          {
            asset_sha256: newAssetSha,
            candidate_ref: `a:SLC11A2|${newAssetSha}`,
            vision_id: "anima-v1-new",
            candidate_image_id: 11,
            upvotes: 1,
            downvotes: 0,
            score: 1,
            vote_count: 1,
          },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "SLC11A2",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 0 }],
    ],
    allResults: [
      [
        "FROM icono_portrait_assets pa",
        [
          {
            asset_sha256: oldAssetSha,
            status: "approved",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-old",
            candidate_image_id: 10,
            created_at: "2026-05-21T15:25:49.000Z",
          },
          {
            asset_sha256: newAssetSha,
            status: "draft",
            autopick_eligible: 1,
            is_stale: 0,
            is_legacy: 0,
            vision_id: "anima-v1-new",
            candidate_image_id: 11,
            created_at: "2026-05-26T19:33:46.000Z",
          },
        ],
      ],
      [
        "FROM icono_gene_catalog gc",
        [
          {
            gene_symbol: "SLC11A2",
            catalog_full_name: "solute carrier family 11 member 2",
            color_hex: "#77aadd",
            asset_sha256: newAssetSha,
            width: 1024,
            height: 1024,
            vision_id: "anima-v1-new",
            candidate_image_id: 11,
          },
        ],
      ],
    ],
  })
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_COORDINATORS: coordinator,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: fakeQueue(),
    GAME_SESSIONS: fakeSessions(),
    KV: fakeKv(),
  }
  const ctx = waitUntilRecorder()

  await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "SLC11A2",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    env,
    ctx,
  )

  const promotion = db.calls.find(
    (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
  )
  assert.ok(promotion)
  assert.equal(promotion.args[1], newAssetSha)
  assert.equal(env.KV.calls.length, 0, "tie promotion must not publish the broad KV catalog")
})
```

- [ ] **Step 2: Add an admin override tie test**

Add this test in the same file:

```js
test("vote projection does not promote newer tied asset when admin override is active", async () => {
  const oldAssetSha = "c".repeat(64)
  const newAssetSha = "d".repeat(64)
  const coordinator = new FakeVoteCoordinatorBinding({
    "/state": () =>
      Response.json({
        ok: true,
        symbol: "GLYAT",
        asset_summaries: [
          { asset_sha256: oldAssetSha, upvotes: 1, downvotes: 0, score: 1, vote_count: 1 },
          { asset_sha256: newAssetSha, upvotes: 1, downvotes: 0, score: 1, vote_count: 1 },
        ],
      }),
  })
  const db = new RecordingDb({
    firstResults: [
      [
        "FROM icono_vote_projection_refresh_jobs",
        {
          gene_symbol: "GLYAT",
          actor_id: "user_123",
          reason: "vote_auto_promote",
          attempts: 0,
          next_attempt_at: "2000-01-01T00:00:00.000Z",
        },
      ],
      ["FROM icono_publish_state", { current_asset_sha256: oldAssetSha, admin_override: 1 }],
    ],
  })
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_COORDINATORS: coordinator,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: fakeQueue(),
    GAME_SESSIONS: fakeSessions(),
    KV: fakeKv(),
  }

  await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: {
            kind: "process_vote_projection_refresh",
            symbol: "GLYAT",
            actor_id: "user_123",
            reason: "vote_auto_promote",
          },
          ack() {},
          retry() {},
        },
      ],
    },
    env,
    waitUntilRecorder(),
  )

  assert.equal(
    db.calls.some(
      (call) => call.type === "run" && /INSERT INTO icono_publish_state/i.test(call.sql),
    ),
    false,
  )
})
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```powershell
pnpm exec node --test workers/iconoplasm.vote-coordinator-routing.test.js
```

Expected before implementation: the first new test fails because the current asset wins before `created_at`.

## Task 2: Change the JavaScript Comparator Used by Queue Projection

**Files:**

- Modify: `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`

- [ ] **Step 1: Update `compareAdminLeaderRows`**

Change the comparator to place `created_at` before currentness:

```js
function compareAdminLeaderRows(left, right, currentAssetSha = null) {
  return (
    Number(right?.score || 0) - Number(left?.score || 0) ||
    Number(left?.is_legacy || 0) - Number(right?.is_legacy || 0) ||
    Number(right?.upvotes || 0) - Number(left?.upvotes || 0) ||
    compareNullableTextDesc(left?.created_at || "", right?.created_at || "") ||
    Number(normalizeSha256(right?.asset_sha256 || "") === normalizeSha256(currentAssetSha || "")) -
      Number(
        normalizeSha256(left?.asset_sha256 || "") === normalizeSha256(currentAssetSha || ""),
      ) ||
    compareNullableTextAsc(left?.asset_sha256 || "", right?.asset_sha256 || "")
  )
}
```

- [ ] **Step 2: Re-run the focused projection test**

Run:

```powershell
pnpm exec node --test workers/iconoplasm.vote-coordinator-routing.test.js
```

Expected: the new projection tie test passes, existing rollback/Queue/no-KV tests still pass.

## Task 3: Align D1 SQL Ranking Used by Auto-Promotion and Read Models

**Files:**

- Modify: `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`

- [ ] **Step 1: Update `autoPromoteTopVotedPortrait` SQL ordering**

In the SQL `ORDER BY` inside `autoPromoteTopVotedPortrait`, change the order from:

```sql
COALESCE(vs.score, 0) DESC,
CASE WHEN COALESCE(pa.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
COALESCE(vs.upvotes, 0) DESC,
CASE WHEN pa.asset_sha256 = ? THEN 1 ELSE 0 END DESC,
pa.created_at DESC,
pa.asset_sha256 ASC
```

to:

```sql
COALESCE(vs.score, 0) DESC,
CASE WHEN COALESCE(pa.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
COALESCE(vs.upvotes, 0) DESC,
COALESCE(pa.created_at, '') DESC,
CASE WHEN pa.asset_sha256 = ? THEN 1 ELSE 0 END DESC,
pa.asset_sha256 ASC
```

- [ ] **Step 2: Update every `ranked_candidates` SQL block feeding `leader_asset`**

For the bulk and bootstrap admin gene rollup rebuild SQL blocks, change:

```sql
COALESCE(ab.score, 0) DESC,
CASE WHEN COALESCE(ab.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
COALESCE(ab.upvotes, 0) DESC,
CASE WHEN pi.current_asset_sha256 = ab.asset_sha256 THEN 1 ELSE 0 END DESC,
COALESCE(ab.created_at, '') DESC,
ab.asset_sha256 ASC
```

to:

```sql
COALESCE(ab.score, 0) DESC,
CASE WHEN COALESCE(ab.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
COALESCE(ab.upvotes, 0) DESC,
COALESCE(ab.created_at, '') DESC,
CASE WHEN pi.current_asset_sha256 = ab.asset_sha256 THEN 1 ELSE 0 END DESC,
ab.asset_sha256 ASC
```

- [ ] **Step 3: Deliberately do not change preview-only ranking without a separate reason**

Do not change request-option and vision-preview SQL that ranks current assets first for preview thumbnails. Those are presentation previews, not canonical auto-selection. If a later review says the preview should mirror canonical leader ordering, make a separate issue; do not bundle it into this intervention.

## Task 4: Add Guard Tests So the Rule Cannot Regress Silently

**Files:**

- Modify: `workers/iconoplasm.d1-hot-query-guard.test.js`

- [ ] **Step 1: Add a source guard for ranking order**

Add this test near the existing auto-promotion guard:

```js
test("DO NOT DELETE: automatic canon tie-break ranks newer asset before existing current asset", () => {
  const compareFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function compareAdminLeaderRows",
    "async function listAdminReadModelSymbols",
  )
  assert.match(
    compareFn,
    /compareNullableTextDesc\(left\?\.created_at \|\| "", right\?\.created_at \|\| ""\)/,
  )
  assert.match(compareFn, /normalizeSha256\(right\?\.asset_sha256/)
  assert.ok(
    compareFn.indexOf("compareNullableTextDesc(left?.created_at") <
      compareFn.indexOf("normalizeSha256(right?.asset_sha256"),
    "created_at must outrank current-asset inertia in automatic tie-breaks",
  )

  const autoPromoteFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function autoPromoteTopVotedPortrait",
    "async function getArtistStyleBlacklistRow",
  )
  assert.ok(
    autoPromoteFn.indexOf("COALESCE(pa.created_at, '') DESC") <
      autoPromoteFn.indexOf("WHEN pa.asset_sha256 = ?"),
    "SQL auto-promotion must rank newest tied assets before existing-current stability",
  )
})
```

- [ ] **Step 2: Run the hot-query guard**

Run:

```powershell
pnpm exec node --test workers/iconoplasm.d1-hot-query-guard.test.js
```

Expected: pass. Existing guards for Queue-backed projection, no broad KV catalog publish, and raw asset-key predicates must still pass.

## Task 5: Verify Admin Read-Model Leader Matches the New Rule

**Files:**

- Modify: `workers/iconoplasm.admin-reconcile.test.js` or add to the nearest existing admin read-model test file

- [ ] **Step 1: Add a read-model test**

Use the existing fake D1 style to feed one gene with an older current asset and a newer tied candidate, then call the read-model rebuild function or admin sync route currently exercised by that test file. Assert that `leader_asset_sha256` is the newer asset and `admin_override` is preserved.

The expected assertion shape is:

```js
assert.equal(insertedRollup.leader_asset_sha256, newAssetSha)
assert.equal(insertedRollup.current_asset_sha256, oldAssetSha)
assert.equal(insertedRollup.admin_override, 0)
```

- [ ] **Step 2: Run the admin read-model test file**

Run:

```powershell
pnpm exec node --test workers/iconoplasm.admin-reconcile.test.js
```

Expected: pass after SQL ranking blocks are aligned.

## Task 6: Document the Rule and the Budget Boundary

**Files:**

- Modify: `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`

- [ ] **Step 1: Add a short canonical selection section**

Add:

```md
## Automatic Canonical Tie-Breaker

When `admin_override` is off, automatic canonical selection ranks eligible blot assets by vote score, non-legacy status, upvotes, newest upload time, current-asset stability fallback, and finally asset SHA for deterministic ordering.

The current asset is not protected ahead of upload time. If two eligible blots have the same vote totals and the same legacy class, the newer blot is the automatic winner.

This rule only runs inside Queue/admin projection and repair paths. Public card endpoints and vote request handlers must not perform live D1 scans to answer this rule.
```

- [ ] **Step 2: Run documentation-adjacent checks if touched-file Prettier applies**

Run:

```powershell
pnpm exec prettier docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md --check
```

Expected: pass.

## Task 7: Decide and Execute Historical Backfill Separately

**Files:**

- No code change unless creating a dedicated one-off script under `scripts/`.

- [ ] **Step 1: Do not use `repairCanonInvariants` blindly**

Reason: the current production count includes 12,660 zero-vote ties. Running a generic repair over all of them could create large visible churn and many D1 writes. It also risks accidentally using a path that invalidates broad gallery artifacts, depending on the current implementation.

- [ ] **Step 2: First backfill only nonzero-vote misses if product wants immediate correction**

The current measured nonzero-vote miss set is small: 3 genes, 4 later candidates. If immediate repair is desired, repair those first through the existing admin/manual canonical path or a tiny bounded script that:

```sql
SELECT ...
WHERE current_vote_count > 0
  AND later_vote_count > 0
  AND later_score = current_score
  AND later_upvotes = current_upvotes
  AND later_downvotes = current_downvotes
  AND later_created_at > current_created_at
LIMIT 25;
```

Then update one gene at a time, sync only that gene's D1 read models, and verify gene detail. Do not publish the full KV catalog.

- [ ] **Step 3: Treat zero-vote bulk backfill as a product migration, not a bug hotfix**

Before zero-vote bulk migration, estimate:

- D1 writes: publish state update + publish event + status update per changed gene.
- D1 read-model writes: per-gene rollup refresh.
- Worker requests/CPU: one admin repair invocation per tranche.
- Queue ops: zero if done by admin batch, nonzero if enqueued per gene.
- KV writes/lists: must remain zero for vote-triggered repair; any broad catalog publish requires an explicit separate budget decision.

Use tranches of at most 250 genes and stop if D1 rows written, CPU, or error rate moves unexpectedly.

## Task 8: Final Verification Before Deploy

**Files:**

- No additional edits.

- [ ] **Step 1: Run focused Worker tests**

Run:

```powershell
pnpm exec node --test workers/iconoplasm.vote-coordinator-routing.test.js workers/iconoplasm.d1-hot-query-guard.test.js workers/iconoplasm.admin-reconcile.test.js
```

Expected: pass.

- [ ] **Step 2: Run cost guard suite**

Run:

```powershell
pnpm exec node --test workers/iconoplasm.d1-cost-barrier.test.js workers/iconoplasm.d1-hot-query-guard.test.js workers/iconoplasm.do-not-delete-cost-guards.test.js workers/iconoplasm.card-catalog-budget-preflight.test.js workers/iconoplasm.mobile-card-manifest.test.js
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
pnpm exec tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Run build only after tests pass**

Run:

```powershell
pnpm run build
```

Expected: pass.

## Task 9: Deploy and Live-Verify Without Spending the Budget Accidentally

**Files:**

- No code edits.

- [ ] **Step 1: Deploy through the normal internal stateful Worker pipeline**

Use the existing Wrangler config for the only allowed internal stateful Worker. Do not deploy a duplicate Worker and do not bind D1 to a public Worker.

- [ ] **Step 2: Live verify with bounded reads**

Use one D1 count query after deploy to verify the nonzero-vote miss count no longer grows for future votes. Do not crawl the public gallery, do not loop over all genes through public endpoints, and do not call any admin route that publishes the full card catalog unless the budget cockpit explicitly says it is safe.

- [ ] **Step 3: Post Linear update**

Post a concise B-520 or new issue comment with:

- comparator rule changed;
- tests run;
- deploy version;
- whether historical nonzero-vote misses were backfilled;
- explicit statement that no KV catalog publish was added to vote projection.

## Self-Review

- Spec coverage: plan changes the canonical tie rule, preserves admin override, preserves Queue projection, and isolates historical backfill.
- Placeholder scan: clean.
- Type consistency: names match observed code (`compareAdminLeaderRows`, `autoPromoteTopVotedPortrait`, `autoPromoteTopVotedPortraitFromCoordinatorState`, `leader_asset_sha256`, `admin_override`).
