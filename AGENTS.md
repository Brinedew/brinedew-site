# Website project rules

## Recovery ownership fence: RECOVERY-001

The executor owns delivery through a verified user operation. Refusal is
containment evidence, not restoration: keep a tested repair path under every
safeguard, continue source publication and isolated tests while D1 is
exhausted, and give deferred work an inspected executor, wake condition and
failure destination. Change a deadlocking guard through explicit change
control. Canonical: the RECOVERY-001 rule in the root `AGENTS.md`.

## Agent operating rule: do not build the wall you then blame

Read the canonical [Agent operating rule](https://linear.app/brinedew/document/agent-operating-rule-do-not-build-the-wall-you-then-blame-941bbcb71b75).
Before reporting "can't", "blocked" or "fine": if the guard, contract, admission
gate or migration tooling stopping you was written by us, it is changeable —
change it through its own change-control and continue. A safeguard protects a
resource, not itself. Never report "fine" while the requested outcome is
unverified; separate "safe" from "fixed". If the only reason to stop is our own
process, say you chose to stop. Escalate only genuine external blockers
(provider hard limits, missing credentials, human-only approval).

## Extension release integrity

Read `docs/ICONOPLASM_RELEASE_INTEGRITY.md` before changing extension packaging,
release identity, store workflows or published download files. Validation builds
must visibly say DEV and carry their content fingerprint. Tests use disposable
output roots and never replace real release artifacts. Store submission consumes
the verified immutable bundle for one exact tagged commit; it must not rebuild
current `main` under an already approved version. Preserve the human GUI gate.

This `AGENTS.md` is loaded automatically when work happens inside `D:\Coding\Website\`. Root `D:\Coding\AGENTS.md` rules still apply — these are project-specific additions.

## Architecture fence registry

The executable registry is `architecture-fences.json`: every entry carries its full decision, reason, change control, linked runbook and required markers, and `scripts/architecture-fences.test.js` enforces those markers across instructions, runbooks, source, tests and deploy. Read the registry entry and the runbook it names before changing a fence's domain; replace a fence only by an explicit migration that updates every enforcement point together.

**ARCHITECTURE FENCE [BPC-001]** — Brinedew Prose Checker has one local lane and one explicit remote lane: remote checks run only after an explicit user command against an immutable document snapshot on the free Zen model; absence of that model stops the run. Registry: `architecture-fences.json`; runbook: `docs/OBSIDIAN_PROSE_CHECKER_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-001]** — Bunny is Iconoplasm's healthy-path portrait accelerator; direct delivery avoids charging each image to the Worker budget, and a failed probe changes only that tab. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-003]** — Iconoplasm gene discovery is one atomic published-catalog contract with frozen archive ranges; eligibility follows the exact published card. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-004]** — Iconoplasm Queue messages are due-time wakeups for durable ledgers, never polling tokens; unfinished work waits for its ledger due time. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-005]** — The primary Iconoplasm D1 is bounded operational state with a 500 MB per-database wall; no history or body payloads. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-012]** — The Website is the sole command authority for caretaker manifestation history and canonical selection; prose bodies live as encrypted Bunny objects with wrapped keys in authoring D1. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-006]** — One completed workstation publication yields one bounded receipt per recipient and gene; never infer groups. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_FULFILLMENT_NOTIFICATION_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-007]** — Iconoplasm anonymous documents use one Static Assets SPA shell; healthy portrait reads go directly to Bunny. The mutable `/blot/{symbol}.webp` alias enters the existing Worker to resolve the exact published card. Canonical first-party `/portraits/*` URLs enter that Worker only as the Bunny-backed fallback; never restore a static placeholder redirect for them. Explicit mutation/admin APIs use the same Worker. Never enable Workers Cache as a quota workaround. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-008]** — Anonymous startup and extension hover read the published plane; a guest page never probes identity or D1. Registry: `architecture-fences.json`; runbooks: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`, `docs/ICONOPLASM_CARD_PUBLICATION_V2.md`.

**ARCHITECTURE FENCE [IPD-009]** — Anonymous gene, search, gallery, crawler, and passive-vote reads use Static Assets plus immutable Sysop V2 Bunny artifacts. Healthy portraits load from Bunny; first-party portrait fallback uses the existing Worker and its single storage adapter. The stable blot alias uses the same published-card authority through that Worker, never D1, a session, or a second mutable truth. Authenticated mutations remain inside the Worker. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_REQUEST_LIFECYCLE.md`.

**ARCHITECTURE FENCE [IPD-010]** — Routine gallery publication is dirty-shard-only; a scheduled step is bounded and never rebuilds the corpus. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-011]** — The canonical public machine image is the Iconoplasm gene blot. Every public canonical blot, gene record, compact catalog page, passive candidate summary, and shared vote total comes from the one exact published card artifact. The source portrait remains available as subordinate source material. On any healthy network, website readers use Bunny's content-addressed bytes; failure retains a coherent prior artifact or static placeholder and never reconstructs from state. Registry: `architecture-fences.json`; runbooks: `docs/ICONOPLASM_HOME_PERFORMANCE.md`, `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`, `docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md`.

**ARCHITECTURE FENCE [GG-001]** — Automatic GeneGuessr daily selection gives each normalized surname exactly one lottery slot. Registry: `architecture-fences.json`; runbook: `docs/GENEGUESSR_DAILY_SELECTION_RUNBOOK.md`.

**ARCHITECTURE FENCE [GG-002]** — A GeneGuessr recap image requires molecule pixels and exact stored-byte read-back before it is usable. Registry: `architecture-fences.json`; runbook: `docs/DISCORD_INTEGRATION.md`.

## "Site is broken" runbook

When a user reports "site broken", missing images, or a visual regression, do
not preselect either the network or our code as the cause. Write competing
hypotheses and disproof tests. Check the actual installed version and affected
browser, the published payload and exact image identity, source delivery, and
local rendering. A healthy alternate region cannot disprove the user's failure;
a failed local resolver cannot prove a global provider outage. Separate observed
facts from inferred causes, and read the relevant runbook before changing policy.

Concrete rules:

1. **If the project has a runbook for the bug, read it first.** `D:\Coding\Website\docs\` has `ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` for "portraits broken on iconoplasm.brinedew.bio." Read it before touching the codebase. If a runbook does not exist, the user can tell you, and that is fine — but check for one before assuming there isn't.
2. **"Fine yesterday, broken today" is not a cause.** Check deployed/installed changes, publication freshness, quotas, and the user's actual network. Use public resolvers only as contrasting evidence, not as a substitute for the affected path.
3. **If the user rejects a fix twice, revisit its premises.** Show which hypotheses were disproved and which remain. Do not repeat a rejected architecture or disguise its costs with new names.
4. **Verify the owner's actual provider choice before calling account state a blocker.** Iconoplasm uses already-paid Bunny because R2 billing is unavailable. R2 enablement is not this product's unblocker. Test Bunny's healthy path and the affected tab's first-party fallback separately; preserve both. If Bunny administration itself is inaccessible, report that exact access failure instead of silently changing providers.
5. **The Playwright browser is already logged into brinedew.bio.** For "what is the live state of X" questions, navigate to `https://iconoplasm.brinedew.bio/admin#costs` (or the relevant admin page) and read the rendered tables. Do not probe external APIs with auth tokens you don't have when the browser session already has the access you need.
   **Browser-selection fence (B-713):** an explicit request for Playwright MCP means the actual `mcp__playwright__*` tools. Discover and call those tools before reporting a browser or authentication blocker. A signed-out Codex in-app browser, missing Chrome bridge, or Firefox Computer Use refusal says nothing about the Playwright session. Do not substitute those backends or install an unrequested bridge. The separate desktop-session rule below applies when the user asks to inspect that desktop session, not when they explicitly select Playwright MCP.
6. **Cost both delivery paths.** First-party fallback is intentional for affected networks, not a reason to route every healthy reader through Cloudflare. Changes must preserve correctness and show request, storage, CPU, and publication costs, including failure paths.
7. **Use the requested desktop session.** If the owner has Edge/Firefox and a VPN/provider dashboard open, read the installed Computer Use skill and inspect that actual window before declaring browser access blocked. A missing Chrome bridge add-on says nothing about desktop Computer Use availability. Refresh window identity after tab detachment and refresh observed state after user input. Never install an unrequested bridge or change providers to bypass this check.

**ARCHITECTURE FENCE [IPD-008] metadata transport:** read
`docs/ICONOPLASM_CARD_PUBLICATION_V2.md` before changing publication or reloads.
The on-demand hash directories map a named snapshot to per-gene content hashes. Immutable per-symbol
detail and portrait projections may use Bunny; they are not another publisher.
Unchanged hashes retain their URLs across votes; changed hashes get new URLs.
No whole-card shards enter the extension, no reader writes occur, no D1 fallback
elects canon, and private/mutation traffic never enters the CDN. Keep separate
hover lanes, deadlines, bounded caches and per-tab network decisions. Test cold
CDN fills, blocked networks, concurrent lanes and publication changes together.
Storage migrations must also keep the released client's delivery-index and v1
content envelope working. A validation package can retain the released version
number while containing newer code: compare package/runtime hashes, not only the
displayed version. V2 compatibility reads one directory plus the exact lane
object; never load its packed shard or make portraits wait on rich-card bytes.
Persist exact card responses and immutable portrait bytes in extension-origin
background IndexedDB with byte-bounded LRU retention. Foreground requests look up one exact record, never
wait for a multi-megabyte content-store hydration or bypass local reuse. The
background applies the shared source plan only on a byte-cache miss; it keeps
Bunny primary with the same bounded hedge. Decode the returned data URL in the
persistent card frame or simple host renderer. No second HTTPS image transfer.
Verify Wikipedia-to-paper navigation and background restart without reinstalling
the extension, clearing storage, or disabling browser caching.

## Local development overrides

Before changing factory catalog status, model versions, or recipe admission,
read `docs/ICONOPLASM_FACTORY_RETIREMENT.md`. Retired letters remain valid for
historical identity but cannot admit new generation, activation, or diagnostics.

Before changing Factory output belts, read `docs/ICONOPLASM_FACTORY_BELTS.md`.
Keep exact qualified lineage, bounded indexed newest-six reads, stable inspection,
and the existing shared PhotoSwipe viewer. Belt pins never select canonical images.

- **Local API override:** `?gg_api=http://127.0.0.1:8787` for local dev only. Persists in localStorage; clear with `?gg_api=clear`.
- **Staging on Cloudflare:** `brinedew-bio-staging` Pages project and three workers (`the-only-allowed-public-edge-worker-that-must-not-touch-state-staging`, `geneguessr-api-staging`, `geneguessr-benchmark-staging`) are live on the dashboard. `staging.brinedew.bio` resolves. **Production deploys do not update staging.** Staging serves whatever was last manually dispatched to it. Trust `brinedew.bio` for "is the live site correct"; do not trust `staging.brinedew.bio` as a preview of production.

## Iconoplasm publication aliases

Before changing gene-label recognition, the catalog manifest, or extension
alias caching, read `docs/ICONOPLASM_PUBLICATION_ALIASES.md`. Administrators own
the curated desired policy in D1; bounded individual KV revisions stage it for
one atomic alias/blocklist recognition-pair bundle, which alone serves the
anonymous read plane. `workers/iconoplasm-publication-aliases.js` is the
bootstrap seed and shared normalization contract, not the routine editing surface.
Generated biological synonyms and portraits remain workstation-owned. Preserve
cross-policy alias/blocklist revision dependencies, the unchanged manifest
shape, the 4 KiB ceiling, and anonymous no-D1 reads.

## Verify live infrastructure — project-specific cases

The general principle (Playwright first, then code) is in root `AGENTS.md`. These are the project-specific failures that must not recur:

- **Don't conclude a third-party service is missing from the codebase without checking the third-party dashboard.** Example: Boosty integration is a Discord bot configured in Discord's Server Settings → Integrations, not in the worker code. The codebase only handles the website auth tier detection piece. Before concluding a third-party integration is absent, check the actual service dashboard, the Discord server's Integrations page, and Cloudflare Workers secrets — not just code references.
- **Don't assume you can't access a service the user has access to.** Example: the user's Discord session was already available in the Playwright browser — wrong initial URL (`/app` instead of the guild directly) does not mean the session is missing. Try navigating directly in Playwright first. If you get a login page, the user may need to log in, but don't assume that without trying.
- **Don't argue with the user about something they can verify in one click.** Example: when told the Boosty bot is on the server, _check_ it instead of saying "I don't know." The user can verify; verify with them.
- **Don't run adversarial "debate" subagents on pre-digested premises.** Each agent must independently read the codebase and check live infrastructure before arguing. If they can't find data, they say so. Otherwise it is LLM theater, not a debate.
