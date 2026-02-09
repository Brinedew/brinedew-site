# brinedew.bio

Source for my personal site. Wet lab biologist, interested in aging and cancer, trying to learn the computational side.

**Live site:** https://brinedew.bio

## what's in here

- `content/` - wiki pages on genes, proteins, aging theories. Blog posts. A protein guessing game.
- `quartz/` - the static site framework (forked from Quartz)
- `workers/` - Cloudflare backend for GeneGuessr
- `scripts/` - protein enrichment pipelines, data processing

## how it works

Obsidian vault in `content/`, push to GitHub, Quartz builds static HTML, GitHub Pages serves it. About 60 seconds from commit to live.

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

## license

Code (Quartz framework, workers/, scripts/): MIT. Content: CC BY-NC-ND 4.0. See [LICENSE](LICENSE) for details.
