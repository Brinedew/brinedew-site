# B-749 scoped finalization handoff: local verification, 17 September 2026

> Integration note: this record describes the handoff session that produced the
> package. It was applied to the existing PR #153 branch afterwards; see
> "Integration update" at the end for the executed integration checks. The
> delivery state below describes the handoff session, not the current branch.

## Delivery state

This is a locally implemented patch for existing PR #153 in Brinedew/brinedew-site.
It has not been pushed, merged, deployed, or recorded in Linear by this session.
The available GitHub and Linear connector actions in this session were read-only.
No production database, queue, schedule, saved output, or user state was changed.

The patch targets remote PR head `63afeca9010356f41f09669403cf2ca52cd17c5a`.
Work began from the exact source-export artifact for `930448c9b99056561f9a4a1dc40192c276ebdeb4`.
Two remote commits arrived during the work. Their two changed files were imported
and checked against GitHub's Git blob hashes:

- `workers/iconoplasm/sync-finalization-publication.js`: `1d0f4ddb9e8820d47e794ddcdceab257352dfabb`.
- `workers/iconoplasm/sync-finalization-scoped-core.test.js`: `64debfb68ca271d704eed08b32646a33ae12ea61`.

Those remote changes remain intact. In particular, the newer scoped remainder
query and its superseding-version tests are retained. The local git baseline is
an archive-derived working copy, not a fetched remote commit object. The supplied
patch and per-file preimage hashes establish applicability without representing
that local commit as the remote commit.

## Implemented changes

The candidate runtime change previously encoded in temporary CI payloads is
integrated into ordinary source. Completed finalization jobs hand over their
explicit genes to the existing V2 coordinator. Only a matching successful V2
receipt permits the version-fenced completion acknowledgement. Missing scope
fails before global work. Queue replacements and reset wakes retain their exact
run and symbol membership. The temporary payloads and four temporary CI workflows
are removed; normal CI and production workflows are not disabled or bypassed.

Additional regression-driven fixes preserve accepted reset work when a new scope
arrives during a queue send, when only part of a send sequence succeeds, and when
the capacity day changes. The eight-scope limit rejects additional work without
replacing retained records. A completion-ready row whose publisher deferred it
remains reported as pending, while the queue follows the earliest retry deadline.
The receipt check rejects a wrong gene, a V1 epoch, or an unsuccessful response
that claims acceptance.

The real coordinator handler is covered with SQLite-backed state, including an
accepted vote for a newly imported candidate, durable publication intent, restart
and identical replay. Candidate-source change, overflow and transport failure
preserve prior authority. Two further failing tests exposed malformed or explicitly
failed source responses being interpreted as a valid empty candidate set. The
bounded source reader now rejects those responses before candidate replacement.
A valid array, including an empty array, retains the established empty-state rules.

The operation-cost implementation identity was regenerated. Existing native
Cloudflare cost/migration coverage was retained in a separate automatically
discovered `.cost.test.js` file so pure SQLite tests can execute independently.
The migration refusal assertion and large retained-history fixture remain.

## Executed verification

Node `v22.16.0`, matching the repository's `.node-version`.

The final focused command executed 18 test files: **153 tests passed, zero failed,
zero skipped**. Coverage includes routes, read-model sync, queue finalization,
reset recovery, the new remote scoped core, vote-authority handover and reader
handoffs, immutable delta/readers/materialization, repair-script retirement,
identity generation, and architecture fences.

The initial focused baseline had 53 passes and seven failures. Separate red/green
logs retain four reset-loss cases, a retry-deadline failure, three inconsistent
receipt cases, and two malformed-source cases. The retry test was reproduced
again after importing the newer remote module before correcting the scheduling
consumer. The newer remote scoped-core file also passed its eight tests unchanged.

Executed checks also passed:

- Syntax checks on all ten changed JavaScript files, including the new cost test.
- `node scripts/generate-operation-cost-identities.mjs --check`.
- `node scripts/generate-operation-cost-migrations.mjs --check`.
- `git diff HEAD --check`.

The supplied evidence directory contains the complete final output, reproducible
file list and command, red/green logs, and the failed attempts listed below.

## Verification limits

The focused command used an external, test-only import loader for unavailable
`@cloudflare/puppeteer` and `hsluv`. Both shims throw if invoked. All other imports
resolve normally. Browser rendering and color conversion were not exercised; the
loader is evidence tooling outside the production patch.

Full repository testing was attempted and stopped before execution because
`node_modules/tsx/dist/cli.mjs` is absent. The native Cloudflare cost test could not
start because `wrangler/package.json` is absent. Type/style checking could not
start because pnpm is unavailable. Dependency download attempts failed in this
container. No full-CI, Prettier, TypeScript, build, workerd-cost or live acceptance
success is claimed. The exact changed-file set still needs the pinned formatter
and normal repository checks in a dependency-complete environment.

## Remaining acceptance

The generic `syncAdminReadModelsAndPublishIconoplasmGalleryDirtyShards` wrapper
still calls the generic gallery publisher without forwarding exact membership.
This patch moves the finalization consumer onto V2; it does not certify every
ordinary publication caller. Complete-path cost and matching original/repeat
workstation receipts remain unproved.

No complete manifestation/caretaker-authority migration, workstation conversion,
queue unbinding, launcher retirement, extension release, or enabled UTC day was
performed. IPD-004/IPD-010 requirements and remaining retirement inventory continue
to apply. B-725, B-726, B-749, B-764, B-771 and B-742 cannot be closed from this
source-level result alone. Keep accepted obligations and the existing production
hold intact while integrating and verifying this patch.

## Integration update: existing PR #153

The package was integrated into the branch head after
`4e96fad47b814e72a4f5532686940034fedf51f6` rather than restarted, preserving the
newer concurrent work: the scoped remainder query and its superseding-version
tests, the stateful runtime's durable job-version receipt, candidate-authority
mutation fences, and the demand-driven handover tests. The temporary payloads and
CI-only transformation workflows remain deleted. The operation-cost implementation
identity was regenerated for the reconciled source.

Executed in this dependency-complete checkout with the frozen lockfile:

- `node scripts/run-prettier.mjs --write --changed` and `--check` pass with the
  repository-pinned Prettier.
- `pnpm run check` (TypeScript root and components, components Prettier,
  repository format check) passes on Node `v22.16.0`.
- `node scripts/generate-operation-cost-identities.mjs --check` and
  `node scripts/generate-operation-cost-migrations.mjs --check` pass.
- Complete repository suite on Node `v25.9.0` (`pnpm test`): **2,301 tests
  passed, zero failed, zero skipped**, plus the Obsidian prose checker
  (26 tests). The same complete run on Node `v22.16.0` reports 2,289 passed and
  the same 12 `ERR_SQLITE_ERROR: column index out of range` failures in untouched
  caretaker, asset-summary, quota and global-selection fixtures; those 12
  reproduce identically at the previous branch head `4e96fad4` and are not caused
  by this integration.
- Native Cloudflare cost/workerd suites execute inside the complete run,
  including `workers/iconoplasm/sync-finalization-publication.cost.test.js`
  against local Miniflare D1 (migration and bounded page cost).
- `pnpm run build` succeeds (Quartz v5.0.0, 214 content files; edge asset bundle
  2,598 files / 52,324,593 bytes).
- `node scripts/verify-iconoplasm-release-history.mjs` and its
  `--verify-new-package` mode pass against the PR base.

A source push is not deployment or issue closure. Production D1, queue bindings,
schedules, publication retries and the retired global executor remain untouched;
B-742's enabled-day proof and live acceptance remain outstanding. The actual
commit and check results are recorded in Linear B-749 and B-771.
