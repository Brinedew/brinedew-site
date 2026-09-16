# Native check of the proposed 19,023-gene batched transfer

Application revision: d00ae8e39bb5c2115c5a70d42a8ca76fc84127ce (PR #142, merged September 16 at 09:47:50 UTC).
Run: https://github.com/Brinedew/brinedew-site/actions/runs/35083531493
Job: 104752893602. Executed September 16, 2026 at 10:10 UTC.
Artifact: 10440643381, v2-transfer-batch-cost.
Artifact SHA-256: 67610eaf596724f294f56a0626cde8443cc49eed66c78a86df8266c56c943d16.
Script-only commit: 3f00b57a64dc45aa02c02a160ab92f429e79c400.
Script: scripts/v2-transfer-batch-cost-audit.mjs.

The workflow verified unchanged application source. The test uses the actual candidate-import and activation request handlers inside native workerd with a real SQLite Durable Object. It does not deploy or use production credentials. Both diagnostic cases passed; that means they captured the behaviors below, not that a full transfer fits its budget.

## Measured operation

A warm legacy coordinator already contains symbol, bootstrapped marker, published asset, admin policy and one asset-summary row. Those setup costs are excluded. Its new candidate-authority table and new publication state are initially empty. One approved eligible candidate is imported, then authority is activated with a structurally valid previously-published reference.

D1 is deliberately absent from this favorable fixture. The production activation's D1 source-vote verification is therefore excluded, along with any actual source-vote import. No network object fetch is performed and this test does not prove a production public artifact exists. The unchanged DO storage work is measured directly from native SQL cursor counters.

| Actual route | DO SQL reads | DO SQL writes |
| --- | ---: | ---: |
| POST /authority/candidates | 10 | 4 |
| POST /authority/activate | 32 | 5 |
| Total first transfer | 42 | 9 |
| Repeat candidate call | 24 | 0 |
| Repeat activation | 14 | 0 |

The candidate call spends two writes inserting its indexed candidate row and two inserting the candidate-boundary metadata. Activation spends one inserting publication state, one rewriting the existing published-asset value, one rewriting the existing administrator policy, and two inserting the authority-epoch metadata. Alarm writes were zero.

Conditional arithmetic for 19,023 genes each requiring this same first-transfer work:

- 19,023 multiplied by nine = 171,207 DO SQL writes.
- With the agent's quoted 70,000-write allowance, this takes at least three daily allocations, before all excluded work.
- Even activation alone at five writes for each gene is 95,115 writes, exceeding the quoted 70,000.
- External request batching does not change these internal statements. A batch wrapper around the same per-gene calls preserves this storage cost.

This is not a live inventory or proof that every production gene has this exact state. Genes already transferred, genes with different candidate histories, and genes with no eligible winner need separate accounting. The user-facing full membership remains 19,023 unless authoritative evidence changes its definition; accounting must cover every member's legitimate outcome rather than silently drop expensive or empty entries.

Cloudflare's published Free SQLite DO storage allowance is 100,000 writes per day; the agent's 70,000 values appear in this repository's deployment-headroom checks. Those checks are negative readiness thresholds, not a measured execution rate or proof of a separately reserved transfer budget. Neither number establishes how fast operations run. No change to the daily limits is authorized by this diagnostic.

## Empty-candidate behavior

A separate warm object accepts an empty candidate list with zero writes. Activation then returns HTTP 409, NO_AUTHORITY_WINNER, with 13 reads and zero writes. Therefore a catalog-sized loop needs explicit supported behavior for any such members. This test does not establish their production count. It should not be used as permission to omit them from the complete product scope.

## What batching changes

The agent's arithmetic 38,046 external requests divided by 2,500 per day rounds up to 16 daily allocations, under its two-requests-per-gene assumption and before other operator traffic. That is a calculation for a particular unbatched client design.

For illustration, two external requests for each block of 100 genes would be 382 external requests. Forwarding to the same two per-gene internal handlers would still make 38,046 internal DO calls and perform their storage operations. The actual batch design may change that work too, but must demonstrate it. Per-invocation subrequests, CPU, payload and response limits also require accounting. The daily total is not a throughput limit.

## Immediate engineering consequence

Continue implementing the transfer now. Price and reduce the whole proposed operation before assigning its finishing clock time. Request batching alone has not established one-day feasibility. Inventory authoritative pending state by meaningful cases and count candidate, vote, metadata, publication and progress writes across the complete intended membership. Include unchanged-value rewrites in the cost-reduction work; merely skipping the two measured unchanged metadata updates still leaves seven writes for the first-transfer fixture, so it is not by itself a sufficient complete fix at the quoted allocation.

The primary options to investigate are reducing materialized state and redundant mutations, reusing verified existing authority where appropriate, or a correct on-demand transfer that restores all supported user operations without first materializing every idle gene. Any chosen design must preserve accepted work, exact authority, supported reader behavior and safe first mutation for every member. This report does not prescribe untested lazy migration, authorize a smaller user scope, or claim the 171,207-write synthetic total is the production total.

Finish the executable batching/transfer and connected rehearsal in the existing workflow. Reuse the existing tests; no new approval layer is requested. Separate the fixed UTC reset opportunity from measured execution duration and from the full-day acceptance interval.

The reference to credential rotation in the agent's message has no supplied cause or affected credential identity. Verify the actual credential requirement locally without exposing secrets. Human action needs a concrete reason and an order consistent with the registered executor; it must not be inserted as an unexplained completion dependency.

No production implementation, local executor, credential, budget or deployed state was changed by this test.
