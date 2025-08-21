# protein wiki deployment and site navigation issues - aug 21, 2025

## what i was actually working on

Had a concatenated protein glossary file with 46 protein entries that needed to be split into individual wiki pages. Also discovered and partially fixed the alex-content-critic agent which had broken WSL paths and wasn't saving output properly.

The real problem: Created 46 high-quality protein wiki pages but they're practically invisible to users because the site has terrible information architecture for wiki discovery.

## what actually works now

**Protein wiki pages are live and functional:**
- Split `protein_glossary_multicellularity_enforcement_stack_2025_08_21.md` into 46 individual files
- All pages deployed successfully to brinedew.com/wiki/[protein-name]
- Pages show up in search (tested with "p53" search)
- Tags system works - all 46 pages tagged as "glossary" and "protein"
- Consistent formatting: "What it is", "Why it matters here", "Notes" sections

Files created in `content/wiki/`:
- `p53-tp53.md`, `mdm2.md`, `rb-rb1.md`, `atm.md`, `atr.md`, etc.
- 46 total protein pages covering cell cycle, apoptosis, growth factors, immune checkpoints

**Alex-content-critic agent fixed:**
- Changed WSL path `/mnt/d/Coding` to Windows path `"D:\Coding"` in `.claude/agents/alex-content-critic.md`
- Added output redirection to save reviews as timestamped files in `gemini-output/`
- Added directory creation: `mkdir -p "gemini-output"`
- Fixed Unicode handling for proteins like β-catenin
- Updated personality to appreciate Yudkowsky/SSC style writing (not just hate everything)

Working commands:
```bash
cd "D:\Coding\Website" && git status  # shows clean state
```

## what's broken

**Major discoverability problem:**
- Protein wiki pages are orphaned from main site navigation
- Homepage has no clear path to wiki content
- Users can only find proteins through specific searches or by accident
- 46 high-quality pages are essentially invisible to casual browsing

**What I tested with Playwright on brinedew.com:**
- Search for "p53" works perfectly - shows both old and new p53 pages
- Direct navigation to protein pages works (e.g., `/wiki/mdm2`)
- But normal user flow from homepage → no obvious way to discover wiki section
- Tags sidebar only shows after you're already on a protein page (catch-22)

## where things stand

**Environment:**
- All changes committed and pushed to GitHub (commit 5877d39: "Add protein glossary wiki pages")
- GitHub Actions deployment successful - pages are live
- VS Code integration working properly (alex-content-critic needed restart to fix hanging)
- Playwright browser automation working for testing

**Current file structure:**
- 46 new files in `content/wiki/` with protein-prefixed names
- Original concatenated file removed
- No changes to site navigation or homepage

## what to do next

**Most urgent: Fix wiki discoverability**

1. **Create wiki browse page** - `content/wiki/proteins.md` or update `content/wiki/index.md` to include:
   - Categorized protein list (cell cycle, apoptosis, growth factors, etc.)
   - Clear navigation from main site

2. **Add homepage navigation** - Edit `content/index.md` to include wiki link:
   - Current homepage only links to "The Price of Not Being Cancer" post
   - Needs "Browse protein wiki" or "Research wiki" prominent link

3. **Cross-link from main content** - Link from posts like "The Price of Not Being Cancer" to relevant proteins (p53, MDM2, etc.)

## stuff to remember

**Why I made these choices:**
- Used Python script instead of manual file creation (Carmack approach - automate the boring stuff)
- Kept original YAML frontmatter structure for consistency
- Used safe filenames (converted spaces to hyphens, β to beta)
- Fixed alex-content-critic agent because it's useful for content review, but gemini @directory syntax is fundamentally broken for large directories

**Gotchas:**
- Gemini CLI has serious issues with @directory syntax on large directories - creates fake file listings instead of analyzing real content
- VS Code restart was required to fix gemini hanging issues
- Unicode characters in protein names (β-catenin) need special handling in filename generation
- The protein pages work great individually but need better site integration

**Testing approach that actually works:**
- Use Playwright to test real user browsing patterns, not direct URL navigation
- Search functionality works well for discovery
- Tag system provides good navigation once you find one protein page