# Independent audit of the September 17 v2 reset plan

Reviewed implementation: `25625563e479d0ad2354953b1d3c9e909b35bb89` (PR #135 merge).
Execution: GitHub Actions run `35070814275`, job `104711627856`, September 16, 2026 at 07:53 UTC.
Run: https://github.com/Brinedew/brinedew-site/actions/runs/35070814275
Importable test-only commit: `2be75d329ecbfd1cf7252fca3cc185b63aee03ab`.
Test: `scripts/v2-reset-chain-independent-audit.mjs`.
Command: `node --test scripts/v2-reset-chain-independent-audit.mjs`.
Artifact: `v2-reset-chain-independent-evidence`, id `10436410934`.

The isolated workflow verified that application source, shared code, migrations and the admission plan were unchanged from the reviewed merge. It used the repository's locked Node/Wrangler test runtime and no production credentials. No production deployment, database operation, local task change or budget change was performed.

## Executed results

Five checks ran with none skipped: two passed and three failed. One passing check is the all-applied inventory positive control; the other records source references. The three failing checks establish two concrete delivery defects rather than three independent root causes.

### 1. The new migration is missing from canonical release admission

The test invokes the actual `runAdmittedMigrations` function with the actual on-disk migration filenames and actual checked-in manifest. A controlled server inventory marks every migration applied except `iconoplasm/0106_compact_discovery_state_v2.sql`. It fails:

`COST_MIGRATION_NOT_REVIEWED: iconoplasm/0106_compact_discovery_state_v2.sql`

Zero DDL calls occur. The positive control with every migration already applied succeeds with three inventory calls. The actual migration-adapter registry also has no `0106` adapter; the corresponding registration check fails.

Sources: `scripts/run-admitted-d1-migrations.mjs:133`, `cloudflare/operation-cost-migration-plan.json`, `workers/iconoplasm/operation-cost-migration-adapters.js`.

Scope: this reproduces a first-application release failure when 0106 is pending. It does not read the live migration journal. If production already contains this migration through some separately recorded action, that requires an actual journal/identity receipt.

The existing release-test harness generates its simulated filenames from the manifest's own keys. Consequently a real SQL file omitted from that manifest is absent from that simulated inventory too. Its check that each manifest entry names a real file only tests the opposite direction. The new regression uses the real repository directories.

### 2. The committed migration exceeds the entire application write allocation

Native workerd/D1 execution applied the committed 0106 SQL after the real legacy discovery/catalog schemas, with 19,023 synthetic catalog genes and zero historical discovery rows. Fixture setup is excluded from migration costs.

- All 19,023 ordinals were successfully created.
- Migration execution: **57,092 D1 rows read and 38,066 rows written**.
- The single catalog-to-ordinal `INSERT ... SELECT`: **57,070 reads and 38,046 writes**.
- Compared allocation: **20,000 application writes per UTC day**, before its tighter operating target or any other workload.
- Migration journal, admission overhead, user-state transfer, existing discovery history, background work and ordinary traffic are excluded.

Thus merely adding the missing manifest entry and adapter will not make this current migration fit the unchanged daily allocation. Even the one catalog-seeding SQL statement exceeds the allocation. Smaller pages can bound individual work but do not reduce cumulative daily writes; any staged solution must account for the complete transfer and preserve usable service. A redesigned cheaper representation must retain its lookup, identity and data-preservation guarantees.

The existing `discovery-compact-migration.workerd.test.js` seeds two catalog genes plus one retired historical symbol and applies the SQL directly. It verifies schema/content behavior, while omitting production-sized cost and the canonical release-admission path. Its passing result is compatible with these failures.

## The claimed unattended transfer still needs an executable handoff

The published reset dispatcher `scripts/dispatch-production-in-reset-window.mjs` follows the canonical deployment to full-release evidence. It contains no per-gene authority-transfer step. The agent's own report says the new per-gene authority endpoints have no production caller. No executable registered transfer leg or terminal transfer receipt was supplied to this audit.

A scan of tracked production source found the literal `/authority/candidates` and `/authority/activate` references only in their internal coordinator request handlers. This scan cannot exclude a dynamic caller or unpushed local code. The separate manifestation-authority cutover script operates a different authority and is not evidence that per-gene vote authority has transferred.

The actual runtime explicitly continues legacy voting while per-gene `authority_epoch` is not `v2` (`applyAuthoritativeVoteMutation`, around line 17632). Per-gene publication returns `legacy_epoch` before activation (around line 17736). Therefore a required server SHA and successful deployment alone do not establish that the next sync reaches activated v2. The executor needs a verified transfer result tied to the intended gene set before proceeding.

The Windows task, local commit `574a307`, live Prefect state and claimed local `recovery-state-20260916.json` were not independently accessible here. Their truth is not inferred from GitHub.

## Further conditions to verify without restoring obsolete v1 work

Source still contains server-side scheduled work and durable finalization/vote reset alarms. Pausing the workstation Drain does not demonstrate containment of those independent producers. Inspect their actual installed state and retain accepted work while preventing old producers from taking the fresh budget before the compatible repair is active. Do not re-enable a retired v1 pipeline merely to satisfy an obsolete acceptance procedure.

The earlier `7fc593a1...` scope identity must not be imposed if it belongs to an empty preparation record. Freeze the actual nonempty intended membership independently before execution, then compare both terminal receipts to that membership and fingerprint. Learning an expected scope solely from a run's returned scope would be circular evidence; a full-membership comparison from retained authoritative inputs resolves that.

## Required follow-through

Finish the v2 delivery defects now: register and implement its real admitted migration, reduce or explicitly stage its measured total cost within unchanged budgets, and connect the existing executor to safe per-gene authority transfer. Preserve accepted votes, saved images and request obligations. Test a green deployment with legacy authority still present: the ordinary sync must remain blocked until the intended transfer is verified. Reconcile unknown outcomes without new identities or refunds.

The test-only commit can be imported without the diagnostic workflow. Preserve the behavioral requirements when replacing the migration protocol; a valid resumable replacement should be tested through its actual admitted entrypoint rather than forced back into the defective monolithic SQL shape. Passing these focused repairs does not, by itself, certify every remaining user operation or a full enabled day.
