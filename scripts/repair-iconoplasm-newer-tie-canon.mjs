#!/usr/bin/env node
// B-749 / B-771: the historical May 2026 repair bypassed per-gene authority
// and ended in global publication. Preserve its history in git, not as a
// selectable production writer. No flags or environment settings revive it.
console.error(
  JSON.stringify({
    ok: false,
    code: "LEGACY_GLOBAL_REPAIR_RETIRED",
    error:
      "The legacy newer-tie repair is retired. Preserve saved artifacts and receipts; use the verified per-gene V2 authority and publication recovery path tracked by B-726 and B-749.",
  }),
)
process.exitCode = 1
