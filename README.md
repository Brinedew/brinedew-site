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

## GeneGuessr dev (don’t hit prod by accident)

GeneGuessr’s frontend can be pointed at a non-prod API worker via a URL override:
- Set API base for this browser: add `?gg_api=https://<your-worker-host>` to the GeneGuessr URL once (it persists in `localStorage`).
- Clear the override: `?gg_api=clear`.

Recommended flows:
- Local API dev:
  - Run `npx wrangler dev --env staging --remote --port 8787`.
  - In another terminal, run `npm run dev`.
  - Open `http://localhost:<quartz-port>/apps/geneguessr/?gg_api=http://127.0.0.1:8787`.
- Online staging: deploy the staging worker and open GeneGuessr with `?gg_api=https://<staging-worker>.workers.dev`.

## license

Code (Quartz framework, workers/, scripts/): MIT. Content: CC BY-NC-ND 4.0. See [LICENSE](LICENSE) for details.
