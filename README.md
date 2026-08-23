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
