# Website project rules

This `AGENTS.md` is loaded automatically when work happens inside `D:\Coding\Website\`. Root `D:\Coding\AGENTS.md` rules still apply — these are project-specific additions.

## Architecture fence registry

Before changing a non-obvious cost, ownership, fallback, or release decision,
read `architecture-fences.json` and `docs/ARCHITECTURE_FENCES.md`. Registered
fences are deliberately enforced in instructions, runbooks, source,
configuration, tests, and deployment. A fence may be replaced, but only by an
explicit migration that updates all registered enforcement points together.

**ARCHITECTURE FENCE [IPD-001]** — Bunny is Iconoplasm's healthy-path portrait
accelerator because direct delivery avoids charging each image to the
Cloudflare Worker budget. The first real image probes once per tab; a regional
DNS failure selects the canonical first-party fallback for that tab. Never turn
one network's DNS result into a global accelerator disable. Read
`docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` before changing portrait policy,
storage, CDN configuration, preconnects, or fallback behavior.

**ARCHITECTURE FENCE [IPD-003]** — Iconoplasm gene discovery is one atomic
published-catalog contract. Complete canonical profiles are indexable; aliases
redirect permanently; incomplete profiles stay noindex; unknown symbols are
real 404s. The `/genes` archive uses frozen, self-locating prefix ranges—never
numeric pagination or automatic count rebalancing. Preserve the visual card and
its one-to-one hidden semantic equivalent. Printed selector alternatives are
visual ink, not controls or peer facts: their accessibility representation must
name the resolved molecular value and mapped character value while hiding the
unused printed alternatives. Render those alternative words as CSS ink, not DOM
text, because browsing agents may flatten DOM content without honoring ARIA.
Crawler discovery belongs in the
existing non-visual homepage description, not as new chrome in the immersive
Archive/Clans switcher; feed skip links stay clipped until keyboard focus. Read
`docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md` before changing the renderer,
gene HTML, range map, robots metadata, archive, sitemap, or `llms.txt`.
Model-training crawlers are not the search contract: GPTBot and ClaudeBot are
blocked by a project-owned WAF rule before Worker execution, while OpenAI,
Anthropic, and Perplexity search/user agents remain allowed. The WAF policy,
robots.txt, deploy reconciliation, documentation, and tests must change
together.

**ARCHITECTURE FENCE [IPD-004]** — Iconoplasm Queue messages are due-time
wakeups for durable ledgers, not polling tokens. Unfinished future work must be
delayed until its ledger `next_attempt_at`; never immediately replace a message
merely because `remaining > 0`, and never cap a long durable backoff to a short
retry loop. Read `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` before
changing Queue consumers, retry delays, ledger status counts, or self-draining
background work.

**ARCHITECTURE FENCE [IPD-005]** — the primary Iconoplasm D1 is bounded
operational state. Its Free-plan wall is 500,000,000 bytes per database, not the
5 GB account allowance. Keep manifestation prose authoritative only in gene
essence, keep the admin rollup copy empty, and archive publish events older than
30 days to the cold audit D1 only after ID verification. Read
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` before adding large
columns, materialized payloads, append-only ledgers, retention jobs, D1 bindings,
capacity charts, or bulk reconciliation paths.

**ARCHITECTURE FENCE [IPD-006]** — a Free Queue action is the Discord delivery
unit, partitioned by gene. Persist `request_batch_id`; never infer a batch from
timestamps, adjacent IDs, or whichever fulfillments happen to share a cron run.
Wait until every request in that batch-and-gene is ready, then send one receipt
with at most ten full-resolution preview attachments and the authoritative
gene-page link. A hundred candidates still means one receipt, not ten DMs and
not a hundred-image contact sheet. Read
`docs/ICONOPLASM_FULFILLMENT_NOTIFICATION_RUNBOOK.md` before changing request
creation, fulfillment triggers, Discord delivery, attachment limits, or
delivery reconciliation.

**ARCHITECTURE FENCE [IPD-007]** — Iconoplasm is static-first and has one
dynamic Worker invocation. Matching files on `iconoplasm.brinedew.bio` must be
served by Workers Static Assets before Worker execution; dynamic misses route
directly to the existing stateful Worker, never through the shared public
proxy. Rate limits live on that route owner. Read
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` (including the
canonical gene cold-path contract) and Linear B-670 before changing Iconoplasm
route ownership, asset bindings, bundle generation, rate-limit placement, or
production deploy order. Preserve the loud protected entrypoint and config
names; an internal extraction may add descriptive responsibility segments only
inside that boundary and must not create a second Worker or state owner. This
fence records evidence, not tradition: replace it when a fully costed
alternative proves better and updates every enforcement point atomically.

**ARCHITECTURE FENCE [IPD-008]** — anonymous Iconoplasm startup and extension
hover detail use the published read plane. A guest homepage must not probe
authentication, settings, discoveries, inventory statistics, admin state, or
D1. The readable shared-session marker carries no identity or authority; it may
only gate one direct authenticated-user lookup, while the HttpOnly session
cookie remains the credential. Extension detail batches project immutable
published card artifacts and persist a bounded cache keyed by the card snapshot
version; they must not compose public hover cards from D1 or turn transient
failures into durable “missing gene” records. Read
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` and Linear B-671
before changing anonymous bootstrap, the session-presence hint, catalog/card
publication metadata, public batch reads, or extension detail caching.

**ARCHITECTURE FENCE [IPD-009]** — canonical Iconoplasm gene first paint is
cold-safe: a tiny publication-owned D1 identity index resolves an exact symbol
without KV or full-catalog reads, the current D1 detail ETag is probed before
the HTML cache, and cache hits return before JSON parsing or shell rendering.
The route index stores no portrait or vote state. The existing loudly named
stateful Worker and direct route remain the only owner. Never replace the
protective prefix/suffix naming pattern with shorter responsibility-only names;
descriptive responsibility segments are allowed only inside that full pattern
for extracted modules below the boundary. Do not create `iconoplasm-web`, a
public proxy, or a second state owner. Read `docs/ICONOPLASM_REQUEST_LIFECYCLE.md`,
`docs/SITE.md`, and `cloudflare/deployment-topology.json` before changing the
gene document path, Worker split, deployment order, or module names.

**ARCHITECTURE FENCE [IPD-010]** — routine Iconoplasm gallery publication is
dirty-shard-only. A vote or canonical publish event updates the shard ranges
that contain those symbols and atomically flips the manifest when they are all
ready. The scheduled route processes one bounded step and cannot request more.
Cold bootstrap, storage-format conversion, and card-mapping revision changes
must fail explicitly in this path; never reinterpret them as permission to scan
or rebuild all 19,023 genes. A missing shard may be repaired only from its own
recorded range. Keep the `dirty_shard`, `baseline`, `publication`, and
`schema_migration_required` vocabulary: generic `rebuild`, `refresh`, `warm`,
or responsibility-only names hide cost and have already caused regressions.
Read `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` and Linear B-695
before changing gallery publication, its cron route, KV accounting, or mapper
revision behavior.

**ARCHITECTURE FENCE [IPD-011]** — every homepage portrait in a signed-in
account window is projected from the exact versioned published card artifact
selected by `KV_GALLERY_VERSION`. Discovery rows decide membership and order;
they do not decide portrait identity. The image-only account view is a compact
projection of the same card VM used by the ordinary account view, not a second
portrait read plane. Never restore `publishedPortraitRefs(...)`, discovery-row
`asset_sha256`, a browser-local portrait cache, or any other parallel snapshot
as the image-only source. That split caused B-700: logged-in Edge showed the
old light-purple ZNF25 on the homepage while the same session's gene page showed
the current dark-gray canonical. Read `docs/ICONOPLASM_HOME_PERFORMANCE.md` and
the B-700 section of `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md` before
changing account-gallery card composition, `view=image-only`, or portrait
freshness behavior. Any replacement must preserve one portrait authority and
must pass a same-session visual comparison of the homepage and gene page.

**ARCHITECTURE FENCE [GG-001]** — automatic GeneGuessr daily selection gives
each normalized gene surname exactly one lottery slot. It first chooses a
surname, then a deterministic daily representative inside that surname;
structure and AlphaFold fallback may advance only through the remaining
one-representative-per-surname sequence. Manual overrides remain explicit
exceptions. Never hash across the flat protein table or let a large family gain
more automatic slots because it has more members. Read
`docs/GENEGUESSR_DAILY_SELECTION_RUNBOOK.md` before changing the daily pool,
daily hash, target availability fallback, schedule cache, or pre-warm selection.

## "Site is broken" runbook

When a user reports "site broken" or "images not loading" or any visual regression, the first 30 minutes are dominated by the wrong kind of investigation (DNS-layer forensics, status-page checks, Git blame) when the actual answer is almost always on the user's network or in a project-owned fallback that already exists. The pattern that wastes hours is:

- probing public resolvers / external CDNs to "prove they're not the cause" (they almost never are)
- reading the architecture doc only after exhausting the codebase
- assuming the user wants a code change when the user actually wants the right diagnosis
- proposing a project-side "fix" that costs the project's budget when the bug is on a third party

Concrete rules:

1. **If the project has a runbook for the bug, read it first.** `D:\Coding\Website\docs\` has `ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` for "portraits broken on iconoplasm.brinedew.bio." Read it before touching the codebase. If a runbook does not exist, the user can tell you, and that is fine — but check for one before assuming there isn't.
2. **If the user says "fine yesterday, broken today," the question is not "what changed in our project"** (the project almost certainly did not change). The question is "what changed in the user's network path to the third party." Public resolvers will almost always say "fine" because the breakage is on a subset of consumer resolvers. The right diagnostic is the _user's actual recursive resolver_, not 8.8.8.8.
3. **If the user rejects a "fix" twice, the user is telling you the fix is the wrong shape.** Stop proposing that fix. Ask what the user wants, or say "I do not have a fix that does not cost the project budget, and I am not going to keep proposing ones."
4. **When the architecture doc already names the durable fix and the durable fix is blocked by an account-level state (e.g. R2 disabled because billing/card path is broken), the right move is to surface the unblocker, not to invent a project-side workaround.** The unblocker is a user action on the third-party dashboard, not a code change.
5. **The Playwright browser is already logged into brinedew.bio.** For "what is the live state of X" questions, navigate to `https://brinedew.bio/admin/iconoplasm#costs` (or the relevant admin page) and read the rendered tables. Do not probe external APIs with auth tokens you don't have when the browser session already has the access you need.
6. **Do not propose a code change as a band-aid** that converts a third-party cost into a project cost. The user has rejected this pattern four times in a row when it was proposed in the 2026-06-26 incident. Read the room.

## Local development overrides

- **Local API override:** `?gg_api=http://127.0.0.1:8787` for local dev only. Persists in localStorage; clear with `?gg_api=clear`.
- **Staging on Cloudflare:** `brinedew-bio-staging` Pages project and three workers (`the-only-allowed-public-edge-worker-that-must-not-touch-state-staging`, `geneguessr-api-staging`, `geneguessr-benchmark-staging`) are live on the dashboard. `staging.brinedew.bio` resolves. **Production deploys do not update staging.** Staging serves whatever was last manually dispatched to it. Trust `brinedew.bio` for "is the live site correct"; do not trust `staging.brinedew.bio` as a preview of production.

## Iconoplasm publication aliases

Before changing gene-label recognition, the catalog manifest, or extension alias caching, read `docs/ICONOPLASM_PUBLICATION_ALIASES.md`. Curated page labels are owned by `workers/iconoplasm-publication-aliases.js` and ship through a normal Website deployment. Generated biological synonyms and portraits remain workstation-owned. The architecture document defines the decision rule, invariants, tests, rollback, and the cases that require an extension protocol release.

## Verify live infrastructure — project-specific cases

The general principle (Playwright first, then code) is in root `AGENTS.md`. These are the project-specific failures that must not recur:

- **Don't conclude a third-party service is missing from the codebase without checking the third-party dashboard.** Example: Boosty integration is a Discord bot configured in Discord's Server Settings → Integrations, not in the worker code. The codebase only handles the website auth tier detection piece. Before concluding a third-party integration is absent, check the actual service dashboard, the Discord server's Integrations page, and Cloudflare Workers secrets — not just code references.
- **Don't assume you can't access a service the user has access to.** Example: the user's Discord session was already available in the Playwright browser — wrong initial URL (`/app` instead of the guild directly) does not mean the session is missing. Try navigating directly in Playwright first. If you get a login page, the user may need to log in, but don't assume that without trying.
- **Don't argue with the user about something they can verify in one click.** Example: when told the Boosty bot is on the server, _check_ it instead of saying "I don't know." The user can verify; verify with them.
- **Don't run adversarial "debate" subagents on pre-digested premises.** Each agent must independently read the codebase and check live infrastructure before arguing. If they can't find data, they say so. Otherwise it is LLM theater, not a debate.
