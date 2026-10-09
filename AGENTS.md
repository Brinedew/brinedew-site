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

## Pull requests from feature worktrees

**Before and after every push.** The repository's pre-push hook (`.githooks/pre-push`) runs the two cheap checks CI's `build-and-test` runs first: `pnpm run check:format` (Prettier) and `pnpm run check:stamps` (module stamps). It runs on every branch, plus the full `pnpm check` on `main`. Enable it once per clone with `git config core.hooksPath .githooks`; worktrees share the setting. After pushing, watch the PR's `build-and-test` until it passes before calling the work ready. On 2026-10-04, #497 and #498 failed on Prettier alone and sat red for about six hours, with hooks off, while they were described as proven. Had it run on, B-977's merge night would have been lost.

From a feature worktree, merge with `gh pr merge <number> --squash` and clean up the local worktree separately. GitHub CLI's `--delete-branch` can complete the remote merge and then exit with a local checkout error because `main` is in the primary worktree. After any uncertain merge result, read `gh pr view <number> --json state,mergeCommit` before retrying or reporting failure; `MERGED` and the merge commit are the source of truth.

## Worker routes: Hono, Zod and Drizzle

The internal Worker's front door is a Hono app (`workers/iconoplasm/app.js`,
B-1063). Hono answers the routes it knows; every other request falls through
to the legacy handler, the 30,000-line `if` chain in the stateful runtime.

- **New routes go in Hono**, never in the `if` chain. Validate bodies with
  Zod (`@hono/zod-validator`) and use Drizzle for D1. A table's Drizzle
  definition (`workers/iconoplasm/db/schema.js`) is added with its first
  Hono route; the SQL migrations stay the schema of record.
- **Attach auth to each route**, never to a path prefix. The legacy admin
  routes behind the fall-through keep their own checks (admin sessions, the
  `X-Iconoplasm-Admin-Token` header). The factory's routes take the admin
  token as a standard bearer token (`hono/bearer-auth`).
- **When a step touches a legacy route, move it to Hono.** The aim is an
  empty `if` chain.

## Architecture fence registry

The executable registry is `architecture-fences.json`: every entry carries its full decision, reason, change control, linked runbook and required markers, and `scripts/architecture-fences.test.js` enforces those markers across instructions, runbooks, source, tests and deploy. Read the registry entry and the runbook it names before changing a fence's domain; replace a fence only by an explicit migration that updates every enforcement point together.

**ARCHITECTURE FENCE [IPD-001]** — Bunny is Iconoplasm's healthy-path portrait accelerator; direct delivery avoids charging each image to the Worker budget, and a failed probe changes only that tab. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-003]** — Iconoplasm gene discovery is one atomic published-catalog contract: every deploy builds the static sitemap and one document per gene from the catalog object, and eligibility follows the one stable gene object and the one catalog object. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-004]** — Iconoplasm Queue messages are due-time wakeups for durable ledgers, never polling tokens; unfinished work waits for its ledger due time. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-005]** — The primary Iconoplasm D1 is bounded operational state with a 500 MB per-database wall; no history or body payloads. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-012]** — The Website is the sole command authority for caretaker manifestation history and canonical selection; prose and Tags bodies live as plain-text objects in the private Bunny zone, and authoring D1 holds their hashes. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

Before any Iconoplasm visual or UX design work (a mockup, a restyle, a new panel), read the "Before designing" section at the top of `docs/iconoplasm-design-system/README.md`. Its rules below that section are evidence from earlier agents, not law.

Before changing manifestation prose, its size limit, the seed texts or the caretaker editor, read `docs/CARETAKER_MANIFESTATION_AUTHORITY.md`. It says which system owns the text, where the seeds came from (cut at 4,000 characters at import) and where the full originals are.

Caretaker autosave creates the caretaker's own version; new image requests use the selected canonical version. The caretaker editor shows when those differ and offers the existing canonical-selection action. Do not assume “Saved” means the next image uses that edit, or add a second generation-source path.

Off-Cloudflare recovery for every D1 database is the nightly dump from `scripts/backup-d1-rotation.mjs` (B-830). The authoring D1 tables `icono_manifestation_cutover_backup_*` hold an abandoned backup whose status reads `building`; no code reads or resumes it, and nothing should.

**ARCHITECTURE FENCE [IPD-006]** — One completed workstation publication yields one bounded receipt per recipient and gene; never infer groups. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_FULFILLMENT_NOTIFICATION_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-007]** — Iconoplasm anonymous documents use one Static Assets SPA shell; healthy portrait reads go directly to Bunny. The stable first-party `/blot/{symbol}.webp` route enters the existing Worker to read the gene's stable object. Canonical first-party `/portraits/*` URLs enter that Worker only as the Bunny-backed fallback; never redirect them to a static placeholder. Explicit mutation/admin APIs use the same Worker. Never enable Workers Cache as a quota workaround. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-008]** — Anonymous startup and extension hover read the two published objects (the stable gene object `genes/v3/<SYMBOL>.json` from the CDN and the catalog object `catalog/v3/index.json`); a guest page never probes identity or D1. Registry: `architecture-fences.json`; runbooks: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`, `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`.

**ARCHITECTURE FENCE [IPD-009]** — Anonymous gene, search, gallery, crawler, and passive-vote reads use Static Assets plus the two published Bunny objects. Healthy portraits load from Bunny; first-party portrait fallback uses the existing Worker and its single storage adapter. The stable blot route and every card reader resolve the one stable gene object through that Worker, never D1, a session, or a second mutable truth. Authenticated mutations remain inside the Worker. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_REQUEST_LIFECYCLE.md`.

**ARCHITECTURE FENCE [IPD-010]** — Routine publication is per gene and bounded: `publishIconoplasmGeneStableObject` rewrites one stable object per changed gene, and the catalog object is rebuilt in GitHub Actions, never inside a Worker request or cron tick. Registry: `architecture-fences.json`; runbook: `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md`.

**ARCHITECTURE FENCE [IPD-011]** — The canonical public machine image is the Iconoplasm gene blot. Every public canonical blot, gene record, catalog row, passive candidate summary, and shared vote total comes from the one stable gene object (`genes/v3/<SYMBOL>.json`) or the one catalog object (`catalog/v3/index.json`). The source portrait remains available as subordinate source material. On any healthy network, website readers use Bunny; failure is a visible reader error and never reconstructs from state. Registry: `architecture-fences.json`; runbooks: `docs/ICONOPLASM_HOME_PERFORMANCE.md`, `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`, `docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md`.

The **only canonical blot publication path** is `publishIconoplasmGeneStableObject` in the stateful runtime (B-898): it reads the gene's rows in one D1 batch plus its canonical text, builds the card with `buildGeneCard` (`workers/lib/iconoplasm-stable-gene-object.js`, the one place the card's shape and the winner rule live) and writes it with a verified read-back. The 60 s edge rule, not a purge, bounds how long the CDN serves the previous card (B-1063). The existing Worker resolves the stable first-party `/blot/{symbol}.webp` route from that object; no other writer of gene or blot objects exists.

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
   **Reusable live visitor check:** run `scripts/the-only-iconoplasm-live-journey-do-not-duplicate.js` through Playwright MCP's `browser_run_code_unsafe({ filename: "Website/scripts/the-only-iconoplasm-live-journey-do-not-duplicate.js" })`. It checks installed-extension hover and click, SOX11/TP53 gene pages, loaded images, and public blots; it does not vote or generate, but normal discovery syncing can write.
6. **Cost both delivery paths.** First-party fallback is intentional for affected networks, not a reason to route every healthy reader through Cloudflare. Changes must preserve correctness and show request, storage, CPU, and publication costs, including failure paths.
7. **Use the requested desktop session.** If the owner has Edge/Firefox and a VPN/provider dashboard open, read the installed Computer Use skill and inspect that actual window before declaring browser access blocked. A missing Chrome bridge add-on says nothing about desktop Computer Use availability. Refresh window identity after tab detachment and refresh observed state after user input. Never install an unrequested bridge or change providers to bypass this check.

**ARCHITECTURE FENCE [IPD-008] metadata transport:** read
`docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md` ("Current publication contract")
before changing publication or reloads. Hover detail is one stable object per
gene on the CDN (`genes/v3/<SYMBOL>.json`), rewritten in place and purged on
every publication; the catalog manifest and scanner artifact stay the
extension's release contract. No bulk card payloads enter the extension, no
reader writes occur, no D1 fallback elects canon, and private/mutation traffic
never enters the CDN. The 0.5.8 compatibility window still reads
`GET /api/public/v1/card-snapshots/:snapshot/{genes|portraits}/:symbol`, which
resolve the same stable object for any snapshot token; those routes and the
manifest's `card_snapshot_version` field stay until that window closes. A
validation package can retain the released version number while containing
newer code: compare package/runtime hashes, not only the displayed version.
Verify Wikipedia-to-paper navigation and background restart without
reinstalling the extension, clearing storage, or disabling browser caching.

## Factory recipes

Before changing factory catalog status, model versions, or recipe admission,
read `docs/ICONOPLASM_FACTORY_RETIREMENT.md`. Retired letters remain valid for
historical identity but cannot admit new generation, activation, or diagnostics.

Before changing Factory output belts, read `docs/ICONOPLASM_FACTORY_BELTS.md`.
Keep exact qualified lineage, bounded indexed newest-six reads, stable inspection,
and the existing shared PhotoSwipe viewer. Belt pins never select canonical images.

## Local development overrides

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
