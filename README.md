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

## license

Code (Quartz framework, workers/, scripts/): MIT. Content: CC BY-NC-ND 4.0. See [LICENSE](LICENSE) for details.
