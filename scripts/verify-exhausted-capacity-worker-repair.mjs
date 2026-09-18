import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const B749_WORKER_REPAIR_FILES = Object.freeze([
  ".github/workflows/deploy-quartz.yml",
  "scripts/verify-exhausted-capacity-worker-repair.mjs",
  "scripts/verify-exhausted-capacity-worker-repair.test.js",
  "scripts/verify-exhausted-capacity-worker-state.mjs",
  "workers/generated/operation-cost-identities.js",
  "workers/iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js",
  "workers/iconoplasm-gene-card-materialization.test.js",
  "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
])

export const CARD_PUBLICATION_WORKER_REPAIR_FILES = Object.freeze([
  ".github/workflows/deploy-quartz.yml",
  "scripts/verify-exhausted-capacity-worker-repair.mjs",
  "scripts/verify-exhausted-capacity-worker-repair.test.js",
  "workers/generated/operation-cost-identities.js",
  "workers/iconoplasm-card-publication.test.js",
  "workers/iconoplasm-gene-card-materialization.test.js",
  "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  "workers/lib/iconoplasm-card-publication.js",
])

// The committed scoped-finalization repair (PR #153, merged as 0d78a912) plus
// its admission change. It contains the stateful runtime handoff, the
// read-model route guard, the retired legacy repair, their regression suites,
// the regenerated operation-cost identity and the verification/retirement
// records. No migration, seed or data file appears in the envelope.
export const SCOPED_FINALIZATION_WORKER_REPAIR_FILES = Object.freeze([
  ".github/workflows/ci.yaml",
  "docs/ICONOPLASM_OPERATIONS.md",
  "plans/B-749-SCOPED-HANDOFF-VERIFICATION-20260917.md",
  "plans/B-762-DELETION-INVENTORY.md",
  "scripts/repair-iconoplasm-newer-tie-canon.mjs",
  "scripts/repair-iconoplasm-newer-tie-canon.test.mjs",
  "scripts/verify-exhausted-capacity-worker-repair.mjs",
  "scripts/verify-exhausted-capacity-worker-repair.test.js",
  "workers/generated/operation-cost-identities.js",
  "workers/iconoplasm-admin-read-model-routes.js",
  "workers/iconoplasm-admin-read-model-routes.test.js",
  "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  "workers/iconoplasm.b749-scoped-reset.test.js",
  "workers/iconoplasm.daily-budget-kill-switch.test.js",
  "workers/iconoplasm.finalization-reset-alarm.test.js",
  "workers/iconoplasm.read-model-sync.test.js",
  "workers/iconoplasm.sync-finalization-queue.test.js",
  "workers/iconoplasm.vote-authority-demand-handover.test.js",
  "workers/iconoplasm.vote-authority-handoff.test.js",
  "workers/iconoplasm.vote-reset-wake.test.js",
  "workers/iconoplasm/sync-finalization-publication.cost.test.js",
  "workers/iconoplasm/sync-finalization-publication.js",
  "workers/iconoplasm/sync-finalization-publication.test.js",
  "workers/iconoplasm/sync-finalization-scoped-core.test.js",
])

// The pending schema-free diff from installed base 0059139d to 3a3d838c:
// the discovery read-burn repair (PR #159, merged as 8e135878) that removes
// the full-catalog alias scan and the ordinal ORDER BY, the hourly statement
// burn watch (PR #160, merged as 3a3d838c), and two documentation banners
// (PR #158). No migration, seed or data file appears in the envelope.
export const DISCOVERY_READ_BURN_WORKER_REPAIR_FILES = Object.freeze([
  ".github/workflows/iconoplasm-d1-statement-burn-watch.yml",
  "docs/B742_RECOVERY_HANDOFF.md",
  "docs/RECOVERY_RESUME_CHECKLIST.md",
  "plans/B-762-SYSOP-V2-HANDOFF.md",
  "scripts/architecture-fences.test.js",
  "scripts/check-iconoplasm-d1-statement-burns.mjs",
  "scripts/check-iconoplasm-d1-statement-burns.test.js",
  "scripts/verify-exhausted-capacity-worker-repair.mjs",
  "scripts/verify-exhausted-capacity-worker-repair.test.js",
  "workers/generated/operation-cost-identities.js",
  "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  "workers/iconoplasm/discovery-ordinal-store.js",
  "workers/iconoplasm/discovery-ordinal-store.test.js",
])

const WORKER_REPAIR_ENVELOPES = Object.freeze([
  {
    allowed: B749_WORKER_REPAIR_FILES,
    required: [
      "workers/iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js",
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    ],
  },
  {
    allowed: CARD_PUBLICATION_WORKER_REPAIR_FILES,
    required: [
      "workers/generated/operation-cost-identities.js",
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      "workers/lib/iconoplasm-card-publication.js",
    ],
  },
  {
    allowed: SCOPED_FINALIZATION_WORKER_REPAIR_FILES,
    required: [
      "workers/generated/operation-cost-identities.js",
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      "workers/iconoplasm/sync-finalization-publication.js",
    ],
  },
  {
    allowed: DISCOVERY_READ_BURN_WORKER_REPAIR_FILES,
    required: [
      "workers/generated/operation-cost-identities.js",
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      "workers/iconoplasm/discovery-ordinal-store.js",
    ],
  },
])

export function verifyWorkerRepairPaths(paths) {
  const actual = [
    ...new Set(paths.map((value) => String(value || "").trim()).filter(Boolean)),
  ].sort()
  const accepted = WORKER_REPAIR_ENVELOPES.some(({ allowed, required }) => {
    const allowedSet = new Set(allowed)
    return (
      actual.length &&
      actual.every((path) => allowedSet.has(path)) &&
      required.every((path) => actual.includes(path))
    )
  })
  if (!accepted) throw new Error("COST_WORKER_REPAIR_SCOPE_REFUSED")
  return actual
}

function main() {
  const baseSha = String(process.env.ICONOPLASM_WORKER_REPAIR_BASE_SHA || "").trim()
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("COST_WORKER_REPAIR_BASE_REQUIRED")
  execFileSync("git", ["merge-base", "--is-ancestor", baseSha, "HEAD"], { stdio: "ignore" })
  const paths = execFileSync("git", ["diff", "--name-only", `${baseSha}..HEAD`], {
    encoding: "utf8",
  }).split(/\r?\n/)
  console.log(JSON.stringify({ base_sha: baseSha, paths: verifyWorkerRepairPaths(paths) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(String(error?.message || "COST_WORKER_REPAIR_SCOPE_REFUSED"))
    process.exitCode = 1
  }
}
