# Viral-load-safe Iconoplasm architecture implementation plan

## Objective

Replace the recovery-only architecture with one that certifies full functionality for 10,000 daily readers, keeps anonymous reading complete during a 100,000-reader viral day, and keeps reading complete while safely shedding personalized writes during a one-million-reader nightmare day.

The non-negotiable public-read invariant is: an anonymous page load, search, gallery, gene dossier, portrait, blot, sitemap, crawler request, immutable publication read, or passive vote display performs zero D1 operations, zero Durable Object requests, zero Queue operations, zero KV writes, zero session reads, and zero internal stateful-service calls. A single publication authority remains responsible for writes; browser readers consume its immutable Bunny artifacts and bounded public projection only.

## Global constraints

- Work from an isolated Website worktree based on current `origin/main`; preserve the dirty Iconoplasm checkout.
- Follow strict test-driven development: each production behavior starts with a focused test that fails for the intended missing behavior, then the smallest implementation makes it pass.
- Keep one named stateful Worker and one publication authority. Do not create another Worker, proxy, queue, Durable Object, vendor-side switch, or undocumented control.
- Public-route failure may return a coherent previous immutable artifact, a bundled placeholder, 404, or a bounded retryable response. It must never fall back to D1, a Durable Object, Queue, portrait Worker, session lookup, or internal stateful service.
- Static application shell ownership must not require 19,023 generated HTML files. Gene routes must resolve through one static shell or equivalent asset-layer route.
- Current-version publication remains a replica of the single coordinator. The public path may perform only a reviewed bounded KV read for an origin cache fill; it may never query the coordinator. The planned ceiling is two KV reads per 30-second origin fill, or 1,440 reads over six hours, subject to provider-log proof.
- Personalized discovery writes are compact, batched per user, and never written per hover. Vote commands require explicit authenticated intent. Passive vote display comes from the immutable public artifact.
- Vote projection is coalesced by dirty gene/publication window. No one-vote/one-Queue-message path may remain.
- Capacity admission fails closed before dispatch when evidence is unknown, stale, or exhausted. Accepted action identities and uncertain reservations survive retries. Thirty percent of every mutation allowance stays reserved across publication, recovery/finalization, and laptop delivery; those reservations do not borrow from one another.
- Keep B-780, B-781, B-775, B-776, B-779, and B-764 as the active ownership issues. Keep B-742 and B-716 canceled; move valid workload evidence into executable tests rather than reopening forever-issue prose.
- Use `pnpm` with `minimumReleaseAge=1440`. Use bounded commands and the repository deployment pipeline. Source push, CI, production deployment, route activation, CDN propagation, laptop synchronization, and verified user operations are separate gates.
- Anonymous browser certification must use the authenticated Playwright MCP after its scoped session is available. Code inspection cannot substitute for browser proof.

## Task 1: Stop the queue burn and make provider health truthful

**Behavioral break to catch:** an unhealthy or unknown provider observation is rewritten as healthy, grants a minimum permit of one, and reschedules the same durable work every 30 seconds even though no useful attempt can begin.

1. Add focused tests around the sync governor and queue consumer proving unhealthy, unknown, stale, or exhausted capacity grants zero permits, preserves the exact durable request identity, records an honest bottleneck, and schedules no transport retry before the owned next-admission time.
2. Run the focused tests and record the expected failures.
3. Implement the smallest governor/consumer change that removes the forced healthy rewrite and the forced minimum permit, while preserving a deterministic repair wake path and B-779 desired pause state.
4. Prove queue reconciliation does not overwrite intentional pause state and that GAB1 can progress automatically once admission becomes healthy.
5. Update B-780 and B-781 with the cause, exact tests, ownership, rollback/undo behavior, and current provider truth.

## Task 2: Enforce the zero-state anonymous read contract

**Behavioral break to catch:** a future change can make a public reader touch `ICONOPLASM_DB`, another D1 binding, a Durable Object, Queue, KV write, browser binding, session resolver, or `THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE` without failing CI.

1. Add a reusable throwing-bindings harness and exercise homepage, search, gallery, gene dossier, portrait, blot, sitemap, robots/crawler, and immutable artifact paths as real requests. The tests must fail on the current stateful gene/search/gallery paths.
2. Add route-topology tests proving gene page shell routes bypass Worker execution and remain one static shell rather than per-gene files.
3. Run the focused tests and record the expected failures.
4. Replace anonymous gene detail, public search, gallery browsing, portraits, blots, sitemap/crawler, and passive vote reads with immutable publication artifacts or static assets. Extend Sysop V2 only through its existing publisher authority and content-addressed Bunny objects. Personal state loads only after explicit authenticated interaction.
5. Remove `/gene/*` and every now-static public path from `run_worker_first`; retain mutation/admin API routing through the one stateful Worker.
6. Prove Bunny/artifact failure serves a coherent prior artifact or static placeholder without entering state. Update IPD-007/IPD-008/IPD-009/IPD-011 fence text, enforcement markers, topology, and runbooks together where the old fence required stateful public reads.

## Task 3: Activate bounded compact discovery and coalesced vote publication

**Behavioral break to catch:** hover or page browsing can emit one remote discovery write per encounter, a membership read scans the whole legacy set, or every vote emits its own Queue message/projection.

1. Add operation-count tests using real local SQLite/D1-compatible schemas, indexes, and triggers. The tests must measure rows/operations rather than restating source constants.
2. Run them against the current implementation and record any failing bound.
3. Permanently retire the legacy per-hover discovery writer and whole-membership reader. Sync encounters as one compact authoritative user-record batch with durable local pending state.
4. Coalesce vote publication by gene and publication window using the existing durable compact outbox/owner. One dirty gene has at most one pending projection wake regardless of vote count; winner publication costs one bounded operation per changed gene.
5. Enforce separate admission reservations for user actions, publication, finalization/recovery, and laptop delivery, with 30% total headroom and no cross-borrowing.
6. Prove overload returns pending/refused honestly, never acknowledges a lost action, and never changes anonymous read behavior. Update B-764 and related active issues with measured operation counts.

## Task 4: Turn the capacity model and hostile load cases into release gates

**Behavioral break to catch:** a change can pass unit tests while exceeding Free-plan daily limits or reconnecting reader count to stateful work.

1. Extend the action-derived model for 10,000, 100,000, and one million readers using five article loads per reader, 20% of readers retaining ten discoveries, 5% casting two votes, 20% of votes changing a winner, and portrait fallback at both 2% and 10%.
2. Require the 10,000-reader action mix to fit all mutation budgets with at least 30% headroom.
3. Add a 100,000-journey replay against the built static/CDN topology. It must report zero stateful Worker-route events and zero D1/DO/Queue operations for anonymous journeys.
4. Add the hostile all-TP53 staging profile: 100 authenticated vote commands per second for ten minutes. Correct command identity and bounded capacity responses are mandatory; static reading is checked concurrently.
5. Add failure profiles for stale publication pointers, Bunny outage, expired artifacts, laptop-off accumulation, D1 exhaustion, Queue exhaustion, and delayed projection.
6. Produce a machine-readable attribution report. Provider meters before/after must be reconciled to at least 95% of non-static work; unexplained work blocks release.

## Task 5: Release, activate, and prove the complete user operation

1. Run focused tests, topology validation, architecture fences, the full `pnpm test`, type/format checks, production builds, and Wrangler dry runs under hard deadlines. Fix attributable failures.
2. Run a final whole-branch review and resolve every critical/important issue.
3. Commit and push the verified branch. Create/attach the pull request and wait for protected CI. Merge only after every release fence is current and green.
4. Deploy through the normal pipeline. Verify the deployed revision, activated routing, CDN propagation, and Bunny cache behavior independently.
5. Restore the scoped Playwright MCP session according to `docs/agent-operations.md`. Replay anonymous journeys and verify two fresh gene pages plus the gallery from Vietnam and two independent hosted regions. Prove origin requests flatten by cache windows rather than readers and replace the 30 KB portrait planning sample with measured p50/p95 bytes and disclosed Bunny transfer cost.
6. Execute and verify a real discovery, vote, generation request, laptop drain, publication, and fresh reader. Record source push, CI, deploy, activation, propagation, laptop sync, and user-operation timestamps separately.
7. Update the active Linear issues and project status with evidence. Any ten-minute deadline slip names the failed gate, evidence, owner, next action, and revised ICT deadline.

## Release acceptance

- The 10,000-reader modeled workload completes with at least 30% mutation headroom.
- The 100,000-reader viral read plane does not depend on Worker, D1, DO, or Queue allowances.
- The one-million-reader nightmare keeps public reading complete while personalized actions shed safely.
- All anonymous public-route throwing-binding tests and topology tests pass.
- Provider attribution explains at least 95% of measured non-static work.
- Two fresh gene pages and the gallery are browser-verified after deployment.
- One discovery, vote, generation request, laptop drain, publication, and fresh-reader chain completes on the activated architecture.
- No acceptance claim relies on a quiet day, code inspection alone, or a canceled forever issue.
