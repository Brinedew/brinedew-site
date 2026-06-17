# Iconoplasm onboarding

If you are new to Iconoplasm, start here.

This is the short version of how the system is split up, what the homepage is supposed to do, and which mistakes not to repeat.

## what lives where

Iconoplasm is not one codebase pretending to be many things. It is two real systems with a browser extension attached.

### 1. the workstation / control plane

Path: `d:\Coding\Datasets\iconoplasm`

This is where local authoring happens.

It owns things like:

- candidate generation
- workstation sync
- local reconcile batching
- publish/export logic before the website sees it
- Website Ops payload generation

If something looks wrong before it reaches the live site, start there.

### 2. the website / runtime

Path: `d:\Coding\Website`

This repo is the public runtime.

It owns things like:

- the public Iconoplasm homepage and gene pages
- the caller-side Cloudflare Worker boundary in `workers/iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js`
- the only-allowed internal stateful runtime in `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
- the production D1 runtime tables
- the shared settings/auth bridge that connects `brinedew.bio` and `iconoplasm.brinedew.bio`

If the question is “what does the live site know right now?”, stay in this repo and query remote D1.

For canonical portrait changes and vote auto-promotion, also read `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`. That document explains why D1 publish state and the public card-catalog artifact must advance together.

### 3. the browser extension

The extension produces discovery events. The website displays the resulting shelf.

Important consequence: if discovery behavior looks wrong on the site, do not assume it is only a frontend problem. The contract between extension, worker, and homepage matters.

## the homepage has two real modes

This is the architectural rule that caused the biggest confusion.

## there is no single gallery order

Do not model Iconoplasm as one long gallery feed with one obvious "next group of genes."

That is not the product. Users can see gene cards through several different paths, and those paths do not share one universal order:

- signed-in personal shelf, driven by the user's discovered genes
- admin classic full gallery, driven by the public catalog
- account gallery window, used only for signed-in orders that have a bounded server-side index
- client-side ordering of already loaded discovered genes
- classic public gallery orders like votes, random, uniqueness, heaviest, lightest, youngest, oldest, newest, shortest, and A-Z

The forbidden assumption is:

> "We can know the next genes the user will see, so cache warming, pagination, or preloading can be designed around that one future sequence."

That assumption is false. A user can switch mode, switch sort, arrive from restored scroll state, use a personal discovery shelf, or use admin classic gallery mode. A cache design that depends on a single predicted next sequence will break one of those paths.

The product rule is simpler:

**A catalog gene must remain reachable even when rich card data is missing.**

Precomputed rich card data is allowed to make cards faster or nicer. It is not allowed to decide whether a gene exists. The runtime card path is one published card-catalog artifact for the live gallery version. Publication must fail before the live version flips if that artifact does not cover every catalog gene; runtime browsing must not probe per-gene KV objects or compose ad hoc fallback cards.

### personal shelf / pokedex mode

Who gets it:

- every normal signed-in user
- admins when the admin toggle is off

What it shows:

- the signed-in user's own discovered genes

What API drives it:

- `GET /api/iconoplasm/discoveries/me`

What it is **not**:

- not the full catalog
- not a fake "every gene is discovered" shelf

### classic full gallery mode

Who gets it:

- admins only, when the browser setting `showAllGenes` is on

What it shows:

- the old full-catalog gallery

What API drives it:

- `GET /api/public/v1/gallery`

What it is **not**:

- not `discoveries/me?show_all=1` with a giant payload pretending the full catalog is a discovered shelf

If you are debugging the homepage, figure out which of these two modes should be active **before** touching code.

## starter genes are part of the contract

There is a starter trio:

- `INS`
- `LEP`
- `GCG`

### signed-out visitors

Guests can be shown the starter trio as a lightweight, browser-only introduction to the shelf idea.

### signed-in users

Signed-in users must never have a true zero-state shelf.

That means the starter trio must exist as real discovery rows for an authenticated user. If the live homepage shows an authenticated user with `0` discovered genes, treat that as a bug.

Do **not** fix that by painting different text in the browser while leaving the API empty. The worker must uphold the contract.

## which route should fire

When the homepage loads, check this table first.

| situation                            | expected route                           |
| ------------------------------------ | ---------------------------------------- |
| signed out                           | public gallery counts + guest starter UI |
| signed in, normal user               | `/api/iconoplasm/discoveries/me`         |
| signed in, admin, classic toggle off | `/api/iconoplasm/discoveries/me`         |
| signed in, admin, classic toggle on  | `/api/public/v1/gallery`                 |

If the wrong route is firing, you are debugging the wrong problem.

## the settings bridge matters

The canonical site settings live on `brinedew.bio`, but Iconoplasm runs on `iconoplasm.brinedew.bio`.

So the homepage has to wait for the shared settings bridge before it decides which mode to load.

Why this matters:

- admin-only settings like classic gallery mode live in that shared settings state
- if the homepage races ahead before the bridge resolves, it can silently load the wrong mode

In practice: if admin mode seems ignored on first load, inspect the settings bridge before blaming the gallery API.

## debugging checklist

Do these in order.

1. **Figure out which system owns the bug.**
   - workstation/control-plane problem → `d:\Coding\Datasets\iconoplasm`
   - live runtime problem → `d:\Coding\Website`

2. **Figure out which homepage mode should be active.**
   - personal shelf or classic gallery

3. **Check auth state.**
   - signed out and signed in are different products here, not just different copy

4. **Check the real route being called in the browser.**
   - do not infer from the UI text alone

5. **Query remote D1 if the question is about production data.**
   - use `--remote`
   - do not assume local dev data matches prod

6. **Check Git history before redesigning behavior.**
   - if something “used to work,” look at the recent commits first
   - do not reinvent an older working behavior because you forgot to look at Git

7. **Fix the root cause.**
   - do not add timeouts or fallbacks that hide architectural mistakes

## operational rules that are easy to get wrong

### do not guess from frontend state

If the question is about what production knows, query remote D1.

### do not turn indexed joins into scans

`icono_gene_catalog`, `icono_gene_essence`, and `icono_gene_discoveries` already store canonical uppercase `gene_symbol` keys.

That means joins should look like this:

```sql
ON ge.gene_symbol = d.gene_symbol
```

Not this:

```sql
ON upper(ge.gene_symbol) = upper(d.gene_symbol)
```

Wrapping both sides in `upper(...)` looks harmless, but it can blow away index use and make the homepage feel hung.

### the Cloudflare cost barriers are sacred

This is the most important runtime barrier in Iconoplasm, and it is not only a D1 budget. The live admin cost cockpit at `/admin#costs` tracks the free-plan pressure points across D1, Workers, Durable Objects, KV, Queues, R2, Pages Functions, and Workers observability.

The current card-catalog publication preflight checks these failure names:

- `kv_reads`
- `kv_writes`
- `kv_lists`
- `d1_rows_read`
- `d1_rows_written`
- `queue_operations`
- `worker_requests`
- `worker_cpu_ms`
- `durable_object_requests`
- `durable_object_rows_written`
- `logs_events`
- `r2_available`

If the admin cockpit or worker code adds another Cloudflare meter, update this note and `workers/iconoplasm.card-catalog-budget-preflight.test.js` in the same change.

D1 row-read blowups are still the easiest budget wall to hit accidentally.

The site has roughly 20k genes. That means one "small" full-table read is not small anymore, and one full-table read hidden behind a per-isolate cache can multiply into a catastrophic Cloudflare bill.

The failure mode to remember is this:

- a helper looks cached in JavaScript memory
- but Cloudflare spins up many isolates across colos
- each isolate misses independently
- each miss rereads the same 20k-row snapshot from D1
- the bill explodes while every individual request still looks "pretty fast"

So the rule is:

**If a public or first-party route needs an O(N) snapshot of portraits, gallery rows, or other whole-inventory state, it must use a versioned shared cache in KV (or another truly shared store), not only a module-level JS object.**

In `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`, treat these functions as the cost barrier:

- `publishedPortraitRefs(...)`
- `publishedPortraitFingerprint(...)`
- `galleryPublishedRows(...)`
- `galleryUniquenessRows(...)`
- `warmCatalogCache(...)`
- `gallerySnapshot(...)`

If you change them, you are touching the thing that keeps the site from quietly burning money.

### canonical portraits have a second barrier

`icono_publish_state` is the D1 source of truth for the current portrait, but logged-out/public card traffic does not read that table directly. It reads the versioned full-catalog card artifact in KV through `KV_GALLERY_VERSION`.

That means a canonical portrait update is only really live when both of these are true:

- D1 says the gene's `current_asset_sha256` changed.
- the full public card-catalog artifact was republished and the shared version barrier advanced.

If D1 changes first and artifact publication fails, signed-in/gene-detail views can show the new portrait while logged-out/home/extension card views keep showing the old one. That is the PRL failure from 2026-05-20.

Do not "fix" that split by adding a D1 fallback to `/api/iconoplasm/cards/:symbol`; that would put public card traffic back on the expensive path. The correct fix is in the projection pipeline:

- run the card-catalog budget preflight before canonical mutation
- roll back a vote auto-promotion if artifact publication fails afterward
- republish through the authenticated admin read-model sync path when repairing existing split-brain data
- purge only the stale symbol API URL if the outer Cloudflare CDN still has the old response

Non-negotiable rules:

1. **Per-isolate memory is a speed hint, not a billing guard.**
   - local JS caches are fine as a first layer
   - they are not enough on their own

2. **Versioned shared caches come first for full-table public reads.**
   - use `KV_GALLERY_VERSION`-keyed snapshots
   - on invalidate, bump the version and let old snapshots die

3. **Hot-path primary keys stay raw.**
   - if `gene_symbol` is already canonical, do not wrap it in `upper(...)`
   - if `asset_sha256` is already normalized, do not wrap it in `lower(...)`

4. **Do not rehydrate immutable public artifacts from D1 on hot paths unless there is a shared cache barrier in front of that read.**

5. **Regression tests are mandatory.**
   - the worker exports `resetIconoplasmRuntimeCachesForTest()` specifically so tests can simulate a fresh isolate
   - if you touch the cost barrier, run the cost tests and make them stricter, not weaker

### do not delete the alarms

Some files exist specifically to annoy the future editor before they can repeat the billing incident.

Treat these as protected alarms, not cleanup fodder:

- `workers/iconoplasm.d1-cost-barrier.test.js`
- `workers/iconoplasm.d1-hot-query-guard.test.js`
- `workers/iconoplasm.do-not-delete-cost-guards.test.js`
- `.github/hooks/iconoplasm-d1-guardrails.json`
- `.github/hooks/iconoplasm-d1-guardrails.ps1`
- `CLAUDE.md`
- `.github/instructions/iconoplasm-d1-cost-barrier.instructions.md`
- `.github/workflows/deploy-quartz.yml`
- `scripts/assert-iconoplasm-worker-budget-guards.mjs`

If one of those tests fails, your first assumption should be that code drifted into a dangerous shape.

Do **not** do any of these:

- delete the test because it is inconvenient
- rename the test so nobody notices what it was guarding
- remove the warning comments from `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
- strip the docs/instruction text because it feels repetitive

If you genuinely need to replace one of these guards, the replacement has to land in the same change, be stricter or clearer, and say in comments why the old guard was no longer the right one.

Verified test command:

```text
pnpm test -- workers/iconoplasm.d1-cost-barrier.test.js workers/iconoplasm.d1-hot-query-guard.test.js workers/iconoplasm.do-not-delete-cost-guards.test.js workers/iconoplasm.sync-finalization-queue.test.js workers/iconoplasm.card-catalog-budget-preflight.test.js
```

If that suite stops proving fresh-isolate reuse of shared snapshots, assume you are one edit away from another billing incident.

### the only allowed internal stateful worker is intentionally a ridiculous name

If you see `THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE` in Wrangler or `wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml` in the repo, that is not a joke that got out of hand. It is part of the guardrail.

The point is to make the safe path embarrassing to rename and hard to ignore:

- the routed public workers should call the one internal stateful worker
- the internal stateful worker is the only worker in the repo that is allowed to hold D1/KV/R2/session capability
- if you are about to add `binding = "DB"` or `binding = "ICONOPLASM_DB"` back into `Website/wrangler.toml` or `Website/workers/benchmark/wrangler.toml`, you have not found a shortcut; you have undone the architecture on purpose
- if you are about to make the internal stateful worker public with workers.dev/preview URLs again, you are taking the one worker with the dangerous capability and making it easier to hit from outside
- if you are about to add a new app worker with direct state bindings instead of the loud service binding, you are recreating the exact class of mistake that caused the billing incident

Treat that name like a warning label on industrial equipment. Ugly is fine here. Quietly “cleaning it up” is not.

### do not build giant fake shelf payloads

If you try to represent the full catalog as one huge discovered shelf response, you can hit size problems like `SQLITE_TOOBIG` or just make the route painfully slow.

Use the right mode and the right route instead.

### do not “fix” the product with fallbacks

If personal shelf mode is broken, fix personal shelf mode.

If classic gallery mode is broken, fix classic gallery mode.

Do not quietly switch users to some other mode and call it done.

## deployment and validation

### normal release

- commit the fix
- push `main`
- let the production workflow deploy

### worker-only hotfix or live debugging

There is also a verified manual worker path from this repo:

- from `d:\Coding\Website`, run `npx wrangler deploy --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml`
- then run `npx wrangler deploy`
- or use the VS Code task `Deploy iconoplasm worker now`

If you do that, still commit and push right away so Git and production do not drift apart.

### always validate on the real page

Do not stop at “tests passed.”

For homepage bugs, validate the actual DOM on `https://iconoplasm.brinedew.bio/` and confirm the expected route/mode/counts are real.

## sample labels on blots

Public UI says **sample**, not manifestation. A sample is the generated character-description text for a gene. The workstation code may still use the internal name `manifestation`, but public copy, public API fields, and user-facing docs should use `sample`.

Sample labels such as `TTN-1` and `TTN-2` belong to the sample text record, not to the gene and not to the image order. A gene has one latest sample. A blot records which sample produced it. Users do not pick a sample when requesting a blot; generation uses the latest sample for that gene.

Pipeline:

- Workstation `prompts.db`: `manifestation_samples` owns `sample_number`, `sample_label`, and `sample_text_hash`.
- Workstation `control_plane.db`: `candidate_images` stores the sample label/hash copied at generation time.
- Website sync sends `sample_label`, `sample_number`, and `sample_text_hash` with each portrait asset.
- Production D1 `icono_portrait_assets` stores the sample provenance columns.
- Public gene payloads expose the label on `portrait` and `portrait_candidates`.
- The gene page shows the label under Candidate blots so old blots with old samples are understandable without making samples selectable.

## if you only remember five things

1. Workstation problems and live-site problems are not the same repo.
2. Personal shelf mode and classic gallery mode are not the same product path.
3. Signed-in users should never have a real zero-state shelf.
4. Remote D1 answers production questions; local assumptions do not.
5. Check Git before reinventing behavior that already existed.
