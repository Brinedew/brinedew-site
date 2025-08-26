# gingko structure filtering - august 25, 2025

The user complained that https://brinedw.com/posts/the-price-of-not-being-cancer-v3 was showing the whole Gingko document structure instead of just the content readers should see. The page was displaying first column headings, second column signposting like "[Hook with striking examples]", AND the third column explanations - when it should only show the third column.

The problem: visitors see the full 3-column Gingko editing structure instead of a clean article.

## what actually works now

I fixed the original Quartz build error that was blocking everything. That sed command from the consultant worked perfectly:

```bash
sed -i 's/<!--section: \([0-9.]*\)-->/<span data-lineage-section="\1"><\/span>/g' path/to/file.md
```

The build now succeeds without errors. The site deploys fine. The document exists at the right URL.

Files I changed:
- Added the regex fix to `D:\Coding\CLAUDE.md` at line 398-410  
- Converted all `<!--section: X-->` comments to `<span data-lineage-section="X"></span>` in the main document
- Created `quartz/plugins/transformers/lineageFilter.ts` - a remark plugin that didn't work
- Created `quartz/plugins/transformers/rehypeLineageFilter.ts` - a rehype plugin that doesn't run

## what's broken

The filtering plugins don't actually run. I built two different approaches:

1. **Remark plugin approach**: Filters markdown AST before HTML conversion. Build logs showed it was detecting markers and filtering correctly locally, but consultant's analysis revealed this happens in the wrong pipeline pass - the HTML emitter uses a different processor that doesn't include our modifications.

2. **Rehype plugin approach**: Filters HTML AST after conversion. This should work according to the consultant, but GitHub Actions logs show NO console output from either plugin. Neither `[LineageFilter] PRODUCTION: Processing ...` nor `[rehypeLineageFilter] Processing ...` appears in the build logs.

Current symptom: The article shows as completely empty (`<article class="popover-hint"></article>`) but the TOC still shows all the structural headings. This suggests the rehype plugin might be running and filtering EVERYTHING instead of just columns 1&2, OR the plugins aren't loading at all.

Commands that work:
- `npx quartz build` - builds successfully, no errors
- Local build shows plugin console output, GitHub Actions shows none

Commands that don't work:
- The actual filtering - all content still visible on live site

## where things stand

- Quartz 4.5.1 site builds and deploys successfully 
- Document exists but shows wrong content structure to readers
- Plugins are configured in `quartz.config.ts` but don't appear to run in production
- GitHub Actions environment might be different from local build environment

The rehype approach should work according to the consultant. The plugin structure follows Quartz patterns correctly. Something about plugin loading or execution is broken between local and production.

## what to do next

**Most urgent thing**: Debug why the rehype plugin isn't running in GitHub Actions.

Check these possibilities:
1. Import/export issue - maybe `rehypeLineageFilter` isn't being imported correctly in production
2. Plugin registration problem - the `htmlPlugins()` array might not be processed the same way locally vs. production  
3. Build environment difference - maybe rehype-raw isn't available in GitHub Actions

Start by adding more aggressive debugging:
- Add console.log to the main LineageFilter function (not just inside the processor)
- Add try-catch blocks around the plugin imports
- Check if rehype-raw is actually loading

Files to check:
- `quartz/plugins/transformers/lineageFilter.ts` line 15-25 (the main export)
- `quartz.config.ts` line 63 (where the plugin is registered)
- GitHub Actions logs for any import errors that might be getting swallowed

The rehype approach is the right direction according to the consultant - the issue is execution, not design.

## stuff to remember

The consultant's analysis was spot-on: filtering at the markdown stage doesn't work because Quartz rebuilds multiple processor passes and our modifications get lost. The rehype stage is where HTML emitting happens, so modifications there should stick.

The empty `<article>` element suggests the plugin IS running but filtering too aggressively. If it wasn't running at all, we'd see all the original content. The fact that we see nothing means the plugin is probably working but has a logic bug in the range detection.

Don't go back to CSS hiding approaches - that loads all the content then hides it, which sucks for SEO and page performance. The build-time filtering approach is correct.

The sed regex fix for the Quartz build error should be kept - that part definitely works and prevents the "Cannot read properties of null" error when processing HTML comments in markdown.