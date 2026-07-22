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
its one-to-one hidden semantic equivalent. Crawler discovery belongs in the
existing non-visual homepage description, not as new chrome in the immersive
Archive/Clans switcher; feed skip links stay clipped until keyboard focus. Read
`docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md` before changing the renderer,
gene HTML, range map, robots metadata, archive, sitemap, or `llms.txt`.

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
