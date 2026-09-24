# Brinedew Website

This repo owns the deployed Brinedew sites and the Iconoplasm distribution
plane: public gene dossiers, personal discovery shelf, voting/governance,
published card artifacts, APIs, extension packaging, and Cloudflare runtime.

The product is a mnemonic world for life-science readers, not a generic gene
database. User-facing changes must preserve the recognition → discovery →
dossier → vote → coherent publication loop.

Start with the journey you are changing: open the live reader page or game,
then trace that action into its owner. The [product operating model](docs/ICONOPLASM_PRODUCT_OPERATING_MODEL.md)
describes the reader's job. `quartz/static/iconoplasm/` owns the public
Iconoplasm browser code; `quartz/static/geneguessr/` owns the game browser code.
`workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js`
owns authenticated mutations, and `.github/workflows/deploy-quartz.yml` owns
production deployment. Read the [capacity runbook](docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md)
for capacity or background work, or [publication aliases](docs/ICONOPLASM_PUBLICATION_ALIASES.md)
for alias changes. Historical plans and synthetic load models do not set a
visitor target or a release requirement.

## Local verification

In a fresh checkout, run `pnpm install --frozen-lockfile`, then
`pnpm run install-plugins`, then `pnpm run check`. The plugin command installs
only enabled plugins at checked-in lockfile commits, like production CI.
Use the explicit Quartz `plugin install --from-config` command only when
deliberately changing the plugin set and reviewing the lockfile diff.

`pnpm run dev` serves content from `public-preview`; `pnpm run docs` uses
`public-docs-preview`. Production builds own `public` and `public-iconoplasm-edge`,
so a preview rebuild cannot delete the deployment output. For direct Quartz CLI
previews, always pass a separate `-o` output directory. Confirm the expected page
identity before treating a listening port as a ready preview.

`pnpm run sync:iconoplasm-shared` updates Studio import URLs from dependency
content hashes, from the X6 runtime and document model through Studio to the app.
Run it after editing these modules; the normal dev/build commands already do so.
The graph regression checks published source bytes, not matching manual dates.

When adding a dependency to this workspace root, use `pnpm add -w <package>`
(or `pnpm add -Dw <package>` for a development dependency).

Use the repository commands below instead of guessing test paths or invoking a
package-manager shim from a custom PowerShell pipeline:

- `pnpm run test:architecture-fences` runs the canonical cross-system
  architecture fence test. The test lives under `scripts/`, not `workers/`.
- `pnpm run check:format` checks all formatter-owned files.
- `pnpm run check:format:changed` checks only changed and untracked files.
- `pnpm run format:changed` formats only changed and untracked files.
- `pnpm run check` runs the full type and formatting gate; `pnpm test` runs the
  full repository test suite.

The formatting wrapper calls the pinned local Prettier directly, preserves
spaces in changed filenames, honors `.prettierignore`, and skips unsupported
file types such as SQL migrations.

`scripts/deploy-cloudflare-prod.ps1` dispatches the GitHub Actions production
workflow only after fetching and verifying that `HEAD` equals `origin/main`.
It accepts a detached checkout or unrelated uncommitted work because the
workflow consumes remote source, never local files. Push the intended commit
first; the helper refuses a local-only or mismatched commit.

## Bounded live Worker diagnostics

Use the account-owned `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
environment variables, then run:

```powershell
node scripts/capture-worker-tail.mjs --worker geneguessr-api --seconds 15 --max-events 20
```

The helper uses Cloudflare's supported tail API and the existing WebSocket
dependency. It streams compact JSON containing route path, outcome, CPU/wall
time, status, and exception names. Query strings, headers, console logs, and
exception messages are excluded. Missing timings remain null. Output is capped
at 16 KiB, incoming frames at 1 MiB, and captures at 60 seconds. An optional
`--sampling-rate 0.99` applies the server-side sampling filter.

A planned deadline is successful only after connection and remote tail deletion;
an empty connected capture is explicitly reported as zero events. Early
disconnects, malformed data, and cleanup failures return nonzero. Setup and
cleanup each have their own deadlines; allow 90 seconds when using the shared
outer command deadline. This avoids Wrangler's Windows streaming lifecycle
without changing the Worker, account limits, or authentication source.

## Upstream framework

The site is built on Quartz v5.

> “[One] who works with the door open gets all kinds of interruptions, but [they] also occasionally gets clues as to what the world is and what might be important.” — Richard Hamming

Quartz is a set of tools that helps you publish your [digital garden](https://jzhao.xyz/posts/networked-thought) and notes as a website for free.

🔗 Read the documentation and get started: https://quartz.jzhao.xyz/

[Join the Discord Community](https://discord.gg/cRFFHYye7t)

## Sponsors

<p align="center">
  <a href="https://github.com/sponsors/jackyzha0">
    <img src="https://cdn.jsdelivr.net/gh/jackyzha0/jackyzha0/sponsorkit/sponsors.svg" />
  </a>
</p>
