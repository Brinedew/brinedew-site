# Iconoplasm portrait storage refactor

Read this before proposing any "simple" portrait-storage fix.

## the actual problem

There are two separate problems, and treating them like one is how you get fake solutions.

### 1. public serving must be always-on

The public Iconoplasm site has to keep serving portraits even when the laptop is off.

That means the workstation at `d:\Coding\Datasets\iconoplasm` cannot remain part of the serving path, the publication authority for live public reads, or the thing we need to wake up in order to repair normal portrait delivery.

The workstation can stay an authoring tool. It cannot stay the thing the public runtime secretly depends on.

### 2. the budget ceiling is tiny

The working budget constraint for portrait storage/delivery is:

- **target: no more than $5/month**

That rules out any architecture that depends on casual full-table rereads, per-isolate cache misses, or storage products that require paid activation before they even exist.

## the fence people keep trying to step over

### r2 is not the answer right now

Do not propose "just use R2" as the storage fix.

Why:

- the current Cloudflare account state does **not** allow us to rely on R2
- the account's billing/card path is blocked, and that blocks the storage path we would need
- this is why the R2 bindings are commented out in Wrangler instead of merely being unused

So "turn R2 back on" is not a refactor plan. It is ignoring the current operating constraint.

Even if R2 were available tomorrow, that still would not solve the deeper architecture problem below.

## the deeper architecture problem

The current system still smells like this:

- workstation is the rich control plane
- website is mostly a read model
- local generation keeps too much historical image material around
- publication/sync has to translate local state into the website runtime
- people are tempted to patch around the boundary instead of changing the boundary

That is the real reason small fixes keep making the situation worse.

If the workstation remains the practical source of truth for public portrait state, then the system will keep drifting back toward:

- local disk bloat
- awkward sync semantics
- unclear deletion/retention rules
- public/runtime behavior that is harder to reason about than it should be

## what the refactor must accomplish

Any real portrait-storage refactor has to satisfy all of these:

1. **always-on public serving**
   - public portrait reads work when the laptop is off

2. **cheap enough to live with**
   - target cost stays under $5/month

3. **bounded storage growth**
   - old generations, stale candidates, and obsolete renditions do not accumulate forever without an explicit retention reason

4. **clear authority boundary**
   - the workstation is an authoring client
   - the public runtime owns public serving state

5. **cheap hot paths**
   - public and first-party reads do not depend on repeat whole-inventory D1 scans
   - the D1 cost barrier remains intact

6. **deletion and retention are real, not theatrical**
   - when an asset is no longer needed publicly, the system has a defined lifecycle for metadata removal, blob removal, or archival

## what does not count as a solution

These are non-solutions unless they are part of a larger boundary change:

- re-enabling R2 and calling it done
- pruning a few local folders while the laptop still acts like hidden infrastructure
- adding more local caches
- adding more sync stages without changing who owns live public portrait state
- moving the same architecture to a different bucket vendor and pretending that changed the architecture

## the practical design direction

The public runtime should own a small, durable, always-on portrait store for the assets it actually serves.

That means:

- workstation generates and proposes assets
- publication uploads/promotes assets into the public runtime's storage model
- public runtime serves only what it needs for live/public behavior
- candidate retention is explicit and bounded
- historical or local generation junk does not automatically become public infrastructure

In other words:

- **make the website/runtime the serving system**
- **make the workstation a producer/editor**
- **stop pretending the boundary is temporary**

## documentation rule for future editors

If you mention that R2 is disabled, also mention **why** that matters:

- it is not just a commented-out feature
- it is a signal that the current billing/account state blocks that path
- therefore any proposed refactor that depends on R2 or Cloudflare Images must explicitly explain how it survives that constraint, or it is not a serious proposal

## success test

This refactor is only done if all of the following are true:

- portraits still serve when the laptop is off
- the monthly cost target is plausibly below $5
- public reads do not rely on dangerous D1 inventory scans
- the workstation is no longer the hidden serving authority
- retention/deletion rules are explicit enough that storage stops creeping forever
