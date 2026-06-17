# Google AI Search optimization guide — local implementation notes

Source read: <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>
Source last-updated line observed: 2026-05-15 UTC.
Implementation date: 2026-05-16.

## Extracted lessons worth acting on

1. The central ranking-resistant lesson is not an AI hack: make content that is unique, useful, reliable, people-first, and non-commodity.
2. Do not create a separate "AI SEO" writing style. Avoid fan-out pages, long-tail keyword variants, artificial mentions, forced chunking, or special AI markup.
3. Keep ordinary technical SEO clean: crawlable pages, canonical URLs, snippets, accessible semantic structure, good page experience, low duplicate content.
4. Structured data is not required for generative AI search and has no special AI schema, but ordinary schema.org metadata remains useful for rich results and technical clarity.
5. Do not add `llms.txt` or machine-only AI files for Google Search; Google says they are unnecessary for generative AI features.
6. Agentic experiences matter where relevant: browser agents inspect DOM, rendered pages, screenshots, and the accessibility tree. The practical local version is to keep pages semantically clear and metadata derived from real human-facing content.

## Local implementation

Added a small ordinary JSON-LD layer to Quartz pages:

- `quartz/util/aiSearchMetadata.ts` derives schema.org JSON-LD from existing frontmatter and canonical URL rules.
- `quartz/components/Head.tsx` emits it only for indexable pages.
- `quartz/util/aiSearchMetadata.test.ts` covers page type classification, metadata extraction, and omission of absent metadata.

This is intentionally boring SEO, not GEO/AEO theater:

- No `llms.txt`.
- No AI-only content files.
- No keyword fan-out pages.
- No inauthentic mention scheme.
- No fake dates: JSON-LD dates come only from frontmatter, not build/filesystem fallback timestamps.

## Verification

```bash
corepack pnpm@10.15.1 exec tsx --test quartz/util/aiSearchMetadata.test.ts
# 3 pass

node ./scripts/sync-iconoplasm-shared.mjs && node ./quartz/bootstrap-cli.mjs build -d content
# build succeeded; existing invalid-date warnings remain in old content files
```

Generated spot checks found `application/ld+json` on:

- `public/index.html` as `WebSite`
- `public/apps/iconoplasm/index.html` as `SoftwareApplication`

Known local environment note: the repo declares Node >=22 and `.npmrc` has `engine-strict=true`; this WSL runtime has Node v20.19.2. Direct `pnpm run build` refuses on the engine gate, so the verified build command bypassed pnpm and invoked the underlying node scripts directly. That did not require deploy or public effect.

## 2026-05-16 11:06 follow-up: remove fake invalid-date noise

The first build verification exposed many warnings of the form `Warning: found invalid date "0"`. That noise came from missing/zero filesystem birth times in this runtime, not from explicit human-authored frontmatter dates. It was still bad for this exact Google lesson: reliable metadata should not be surrounded by fake date warnings.

Follow-up changes:

- `quartz/plugins/transformers/lastmod.ts` now ignores non-positive filesystem timestamps before coercing dates.
- `quartz/plugins/transformers/lastmod.test.ts` covers zero/negative/NaN filesystem timestamps and positive timestamp preservation.

Verification:

```bash
corepack pnpm@10.15.1 exec tsx --test quartz/util/aiSearchMetadata.test.ts quartz/plugins/transformers/lastmod.test.ts
# 5 pass

node ./scripts/sync-iconoplasm-shared.mjs && node ./quartz/bootstrap-cli.mjs build -d content
# build succeeded; invalid_date_warnings=0
```
