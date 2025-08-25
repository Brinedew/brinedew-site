# major document restructuring - august 25, 2025

The user wanted me to fix a massive academic document that had terrible structure - walls of text, broken section hierarchies, and content that was organized more like a research paper than something people would actually want to read.

## what actually works now

I completely restructured "the-price-of-not-being-cancer-v3.md" using Gingko-style editing principles:

**Fixed the broken structure:**
- Had 19 sections, 6 of which were "orphan" sections with only one subsection (bad Gingko practice)
- Consolidated down to 14 sections with balanced hierarchies
- Merged sections 9+10 into complete governance architecture  
- Eliminated sections 16-18 by merging into unified applications section
- Removed section 19 appendix entirely

**Added structural signposting:**
- Every second-level heading now has bracketed signposts like `[Hook with striking examples]` or `[Present the dangerous implications]`
- These are instructions for the writer, not visible to readers
- Tell the writer what rhetorical job each section is supposed to do

**Split massive content dumps:**
- Section 5 went from one giant blob to 6 focused subsections
- Section 8 became 11 logical progression steps  
- Section 12 got broken into 10 specific mechanism questions
- Each subsection now answers one focused question instead of covering everything

Files changed:
- `content/posts/the-price-of-not-being-cancer-v3.md` - complete restructure, 188 insertions, 179 deletions

## what's broken right now

**The site build is failing.** Local build with `npx quartz build` gives this error:
```
Failed to process html `content/posts/the-price-of-not-being-cancer-v3.md`: Cannot read properties of null (reading 'data')
```

We fixed the most obvious structural issues (empty sections, missing headings) but Quartz is still choking on something in the markdown. The frontmatter looks fine, so it's probably something with the section comment structure or content formatting.

The site isn't updating at brinedew.com because the GitHub Actions build is failing with the same error.

## where things stand

**Git status:** Everything is committed locally but not pushed yet because we're testing the build first
- Last commit: "Fix document structure after Gingko reorganization" (e7a8ccd)
- Ready to push once the build works

**Document structure:** Clean 3-column Gingko hierarchy:
- Column 1: Major sections (1-14) with main headings
- Column 2: Focused questions with structural signposting  
- Column 3: Detailed explanations that answer the questions

**GitHub pull requests:** There are 2 dependency update PRs waiting:
- #5: CI dependencies update (opened 7 hours ago)
- #4: Production dependencies update (opened 7 hours ago)

## what to do next

**Fix the build first:** The Quartz error suggests there's still something wrong with the markdown structure. Check for:
1. Malformed section comments (`<!--section: X-->` patterns)
2. Missing newlines at end of file (I noticed "No newline at end of file" in the cat output)
3. Weird characters or encoding issues
4. Image links that point to non-existent files

**Commands to test:**
```bash
cd "D:\Coding\Website"
npx quartz build  # Should complete without errors
```

**Handle those GitHub PRs:** The dependency updates are probably safe to merge. Use these commands:
```bash
gh pr merge 5 --squash  # Merge CI dependencies 
gh pr merge 4 --squash  # Merge production dependencies
```

**After build works, push and deploy:**
```bash
git push
# Wait 60 seconds, then check https://brinedw.com/posts/the-price-of-not-being-cancer-v3/
```

## stuff to remember

**Why this restructuring mattered:** The original document was a classic case of academic writing that dumped information instead of guiding readers. Each section had massive paragraphs covering multiple concepts. The Gingko restructuring creates a logical flow where:
- Each major section poses a problem
- Each subsection asks a specific question about that problem
- Each sub-subsection gives a focused answer

**The signposting system:** Those bracketed instructions like `[Establish the core problem]` are for the writer, not the reader. They make sure each section has a clear rhetorical purpose instead of just being a content dump.

**Quartz is picky about markdown:** This isn't the first time Quartz has failed on structural issues. The error message "Cannot read properties of null" usually means it hit something in the markdown that doesn't parse right - empty sections, malformed frontmatter, or weird section nesting.

The document transformation worked great conceptually, but there's still some technical issue preventing it from building. Focus on that first before pushing anything live.