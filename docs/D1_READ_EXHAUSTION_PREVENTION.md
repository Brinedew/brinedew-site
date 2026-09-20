# Preventing D1 exhaustion

This is an engineering guide for D1 work. It is not a recovery chronology.

## Why D1 exhaustion happens

D1 meters rows touched, not merely rows returned. A request that returns one
record can still consume a large part of the daily allowance when it scans a
table, updates several indexes, retries blindly, or repeats work that should
have been published once.

Free-plan enforcement is a hard operating boundary. Enforcement lag is not
extra capacity.

## Required shape of D1 work

Every production D1 operation must be:

- owned by one named capability;
- bounded independently of corpus growth;
- indexed for its actual predicates and ordering;
- admitted before execution;
- identified idempotently across retries;
- measured from provider receipts;
- safe when the outcome is uncertain.

Unknown cost or unavailable authority means the operation does not start.

## Reads

A routine read must use an exact key, a bounded indexed range, or a bounded
cursor. A LIMIT does not make an unindexed scan bounded.

Public anonymous reading must use published immutable artifacts rather than D1.
D1 is for explicit private, mutation, authoring, and operational state.

Before accepting a query shape, prove its row cost against both:

- ordinary data distribution; and
- a hostile concentrated history where many rows share the queried key.

## Writes

Count table rows, index maintenance, triggers, and retries. Product actions do
not own a fixed write count: schemas and indexes may change.

Prefer one compact durable representation over one row per encounter when the
product only needs membership, counters, or bounded chronology. Coalesce
derived work and publish it asynchronously. Do not weaken durability to save
writes.

## Admission

The shared operation-cost authority owns reservation and settlement.

1. Predict a reviewed worst case.
2. Reserve before dispatch.
3. Execute once with an idempotent identity.
4. Settle from a trustworthy receipt.
5. Retain the reservation if completion is uncertain.

Never refund on timeout, reuse an identity for different work, increase an
allowance to admit a repair, or create an unregistered side path.

## Diagnosis

Use provider analytics and statement receipts to find the responsible operation.
Do not diagnose exhausted read capacity by issuing more application D1 reads.

A useful diagnosis states:

- the UTC day and account scope;
- the statement or operation identity;
- rows read and written;
- invocation count;
- expected versus observed bound;
- whether the excess came from traffic or amplification.

## Repair

Fix the cause in the existing owner:

- add or change an index when the access path is wrong;
- replace a scan with an exact locator or bounded cursor;
- compact write-amplified state;
- coalesce duplicate work;
- remove blind retries or duplicate schedulers;
- move anonymous reads to the published plane;
- split large durable work into resumable admitted units.

Do not create a hidden vendor control, second scheduler, alternate authority, or
temporary bypass with no checked-in owner.

## Verification

A repair is complete only when:

1. a focused test reproduces the former cost shape and proves the new bound;
2. architecture and operation identities pass their executable checks;
3. the deployed revision is active;
4. fresh provider telemetry agrees with the expected operation cost;
5. the original user operation succeeds;
6. repeated normal operation retains protected headroom.

A quota reset, green CI, or a successful deployment alone is not completion.

## Recovery ownership

RECOVERY-001 applies whenever an exhaustion incident recurs: the executor owns
delivery through a verified user operation. Containment protects the system
while the repair ships; it does not replace the repair.

Historical incident evidence is available in Git and closed Linear issues. Do
not append it to this guide.
