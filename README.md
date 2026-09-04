# Brinedew Website

This repo owns the deployed Brinedew sites and the Iconoplasm distribution
plane: public gene dossiers, personal discovery shelf, voting/governance,
published card artifacts, APIs, extension packaging, and Cloudflare runtime.

Before changing Iconoplasm behavior, read:

1. [Product operating model](docs/ICONOPLASM_PRODUCT_OPERATING_MODEL.md)
2. [First-principles capacity model](docs/ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md)
3. [Capacity and background-work runbook](docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md)
4. [Publication aliases](docs/ICONOPLASM_PUBLICATION_ALIASES.md)

The product is a mnemonic world for life-science readers, not a generic gene
database. User-facing changes must preserve the recognition → discovery →
dossier → vote → coherent publication loop.

## Local verification

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
