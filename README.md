# brinedew.bio

Source for my personal site. Wet lab biologist, interested in aging and cancer, trying to learn the computational side.

**Live site:** https://brinedew.bio

## what's in here

- `content/` - wiki pages on genes, proteins, aging theories. Blog posts. A protein guessing game.
- `quartz/` - the static site framework (forked from Quartz)
- `workers/` - Cloudflare backend for GeneGuessr
- `scripts/` - protein enrichment pipelines, data processing

## Iconoplasm note

For Iconoplasm specifically, this repo is the website/runtime side, not the local authoring workstation. If published catalog data, alias export, or Website Ops payloads look wrong, start in `d:\Coding\Datasets\iconoplasm` first. That sibling repo is the control plane that publishes what this website and the browser extension consume.

## how it works

Obsidian vault in `content/`, Quartz builds static HTML, Cloudflare Pages serves static assets, and the Cloudflare Worker handles API + cron.

- Static origin (prod): `https://brinedew-bio.pages.dev`
- Static origin (staging): `https://brinedew-bio-staging.pages.dev`
- Runtime daily recap posting is Worker cron-based (no local machine dependency).

## GeneGuessr dev

**Staging**: Deploy the site from the `staging` branch.

- Target domain: `staging.brinedew.bio` (pending DNS/custom-domain hookup).
- Current fallback: `https://brinedew-bio-staging.pages.dev/` (Pages).
- API: staging pages hosts default to `https://geneguessr-api-staging.decap.workers.dev` (no `gg_api` needed).

**Local dev**:

- Run `npx wrangler dev --env staging --remote --port 8787` for the API.
- Run `npm run dev` for the frontend.
- Open `http://localhost:<quartz-port>/apps/geneguessr/?gg_api=http://127.0.0.1:8787`.

The `?gg_api=<url>` override is for local dev only. It persists in localStorage; clear with `?gg_api=clear`.

## deployment

Production deploys through one path only: the `Deploy Production (Cloudflare Pages + Worker)` GitHub Actions workflow.

- Normal release: push `main`
- Manual re-run of the same path: `powershell -File scripts/deploy-cloudflare-prod.ps1`

Direct local `wrangler pages deploy` / `wrangler deploy` production releases are intentionally not part of the supported flow.

## license

Code (Quartz framework, workers/, scripts/): MIT. Content: CC BY-NC-ND 4.0. See [LICENSE](LICENSE) for details.
