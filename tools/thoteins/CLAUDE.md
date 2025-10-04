# Claude Development Notes for Thoteins

This file documents procedural mistakes and lessons learned so future AI assistants don't repeat the same goofs.

## project structure essentials (READ THIS FIRST)

### apps you need to know about

**apps/mapping-studio/** - GUI tool for managing mapping.json
- Run: `python apps/mapping-studio/gui_launcher.pyw`
- What it does: Discovers fields from features.csv and persona.csv, lets you create mappings between molecular and persona properties
- Critical: This is how mapping.json gets edited - not by hand
- When to use: If you see questions about mapping.json structure, field types, or how mappings work, look here first
- Bug history: Had asymmetric field discovery logic (features.csv checked for delimiters, persona.csv didn't) - fixed Oct 1, 2025

**apps/protein-portrait-prompter/** - Main GUI for protein data
- Frontend: index.html + src/*.js
- Backend: local_writer.py (Flask server on port 8787)
- Features: Card gallery, protein data fetching, mapping application
- Run: Start local_writer.py, open index.html in browser

### critical data files

**data/mapping.json** - Central configuration for molecular→persona mappings
- Structure: `{"molecular": [], "human": [], "mappings": []}`
- Field types: "numeric", "set" (semicolon-delimited), "text"
- Edited by: mapping-studio GUI (NOT manually!)
- Rule: Target field type must match source multiplicity (set→set, numeric→numeric)

**data/proteins/features.csv** - Molecular properties (mass, length, domains, KEGG families, etc.)
**data/proteins/persona.csv** - Human characteristics (height, sex, politics, aesthetics, etc.)

**data/aesthetics/** - Aesthetic mapping resources
- `Aesthetics_Wiki.txt`: Full MediaWiki XML dump (989 aesthetics, 7.1MB)
- `aesthetics_index.json`: Parsed aesthetic names + descriptions for AI matching
- `gemini_prompt.txt`: Latest prompt sent to AI (auto-generated)
- `gemini_suggestions.txt`: Latest AI suggestions (auto-saved)

### when you encounter mapping.json questions

DON'T: Assume fields are manually configured
DON'T: Guess about how field types are determined
DON'T: Spend 20 messages investigating before checking the GUI

DO: Immediately check apps/mapping-studio/gui_launcher.pyw
DO: Look for the discover_from_csv() function (lines ~624-692)
DO: Understand that the GUI infers field types from CSV data patterns

## debugging goofs i made (sept 29, 2025)

### goof 1: assumed the algorithm was wrong when the data was incomplete

**What I did wrong**: When I saw 20+ proteins all showing exactly 0% disorder, I immediately started debugging the calculation logic in `percent_disordered_from_entry()`. Spent time tracing through the algorithm step by step.

**What was actually wrong**: Two proteins (P02671, P04439) had no MobiDB cache files at all. The algorithm was perfect - it was correctly returning 0% because it had no disorder data to work with.

**How to avoid this**: Always check if the input data exists before debugging the processing algorithm. Run `ls data/proteins/mobidb/ | wc -l` and compare to the number of proteins in features.csv.

### goof 2: tried to fix the wrong part of the MobiDB parsing

**What I did wrong**: The disorder percentages were all 0%, so I assumed the cached MobiDB files were truncated or incomplete. I started improving the fetch timeout and error handling.

**What was actually wrong**: The cached files were complete (493KB with 28 disorder fields), but the parsing algorithm was looking for "disorder" in field *values* (`id`, `source_id`, `label`) instead of field *names* (`curated-disorder-disprot`).

**The real issue**: MobiDB API structure changed since the algorithm was written. Field names (not field values) indicate disorder content.

**How to avoid this**: When data looks wrong, inspect the actual API response structure first. Run `python -c "import json; entry = json.load(open('data/proteins/mobidb/P00533.json')); print([k for k in entry.keys() if 'disorder' in k.lower()])"` to see what disorder fields actually exist.

### goof 3: focused on algorithm sophistication instead of data completeness

**What I did wrong**: Got distracted by the complex fallback logic in `percent_disordered_from_entry()` (region parsing, coverage calculation, etc.) when the simple fix was just checking the right field names.

**What actually worked**: Bypassed all the complex logic and just looked for `content_fraction` in top-level fields with "disorder" in the key name. One simple loop fixed everything.

**How to avoid this**: When debugging data processing, start with the simplest possible approach first. Complex algorithms are usually overengineered - try the obvious thing before diving into edge cases.

### goof 4: didn't validate the fix properly

**What I did wrong**: After fixing the disorder algorithm, I tested it on P00533 (EGFR) and got 63.4%, declared victory, and moved on.

**What I should have done**: Tested a few more proteins to make sure the fix was general. I would have caught that P02671 and P04439 still showed "none" because they had no cache files at all.

**How to avoid this**: After fixing a data processing bug, test the fix on at least 3-5 different inputs to make sure it's actually general and not just working for your test case.

## architecture insights

### the dual implementation trap

**The problem**: Had mapping logic in both Python (`scripts/protein_db.py`) and JavaScript (`src/logic.js`). Changes required updating both, and they could drift out of sync.

**The fix**: Made frontend call backend API for all mapping. Single source of truth in Python.

**Why this pattern is dangerous**: It's not just about keeping code in sync. It's about cognitive load. When debugging, you have to check *two* implementations to understand what should happen.

**How to avoid**: Always ask "is this business logic already implemented somewhere else?" before writing it again. If yes, call the existing implementation instead of duplicating it.

### the legacy comment disease

**The problem**: 400 lines of commented-out JavaScript in `index.html` with old mass calculation logic (53.4 kDa vs 53 kDa), deprecated function definitions, etc.

**Why it's harmful**: Future developers don't know if the commented code represents an alternative approach they should consider, or just old garbage. They waste time reading it and trying to understand why it was kept.

**The fix**: Delete commented code unless it's actively serving as documentation for a specific decision.

**How to prevent**: If you comment out code "temporarily", set a calendar reminder to delete it in 2 weeks. If it's still commented out after 2 weeks, you don't need it.

## windows development gotchas

### unicode encoding in print statements

**The problem**: Used arrow characters (→) in Python print statements. Windows console uses cp1252 encoding which can't handle Unicode emojis, causing `UnicodeEncodeError`.

**The fix**: Replace fancy Unicode with plain ASCII characters (`-` instead of `→`).

**How to avoid**: Never use emojis or fancy Unicode in any print statements, file outputs, or console text on Windows. Use plain text descriptions instead.

### csv file locking

**The problem**: When rebuilding features.csv, if the file is open in an IDE, the script writes to `features.csv.next` instead and warns about file locks.

**The fix**: Close the CSV file in your editor before running rebuild commands.

**How to avoid**: Always close data files before running scripts that modify them. The `.next` file fallback is smart but creates confusion.

## command patterns that work

### testing disorder percentages quickly
```bash
python -c "import sys; sys.path.insert(0, 'scripts'); import protein_db as pdb; print(f'EGFR: {pdb.percent_disordered_for_uid(\"P00533\")}%')"
```

### fetching new data types
```bash
python scripts/protein_db.py refresh-mobidb P00533 P01116  # disorder data
python scripts/protein_db.py refresh-rvis EGFR KRAS       # gene intolerance data
python scripts/protein_db.py rebuild                      # rebuild CSV with all data
```

### checking data completeness
```bash
ls data/proteins/mobidb/ | wc -l     # count cached disorder files
ls data/proteins/rvis/ | wc -l       # count cached RVIS files
wc -l data/proteins/features.csv     # count proteins in CSV (subtract 1 for header)
```

## things that were actually fine

### the MobiDB API fetch logic
The `fetch_mobidb_entry()` function was working perfectly. Downloaded 235KB of data with 23 disorder fields. The problem was in the parsing, not the fetching.

### the CSV writing logic
The `rebuild_features_csv()` function correctly handles missing data and writes proper CSVs. The problem was that the disorder calculation was returning wrong values to write.

### the basic project structure
The separation between UniProt fetching, MobiDB caching, and CSV building is clean and logical. The architecture is sound.

## documentation location patterns

### don't assume docs are in the root

**The pattern**: Documentation files like `bugs_log.md`, `ROADMAP.md`, `handoff_note.md` etc. might be scattered across subdirectories, not just in the project root.

**Where to actually look**:
- `docs/` folder and its subdirectories
- `docs/02-Development/` for development-specific files
- Project root (sometimes)
- `.claude/` or similar config folders

**How to find them**: Use `find . -name "bugs_log.md"` or `find . -name "*handoff*"` to locate all instances before assuming they don't exist or are only in one location.

**Why this matters**: If you update the wrong file or miss files in other locations, you create conflicting documentation that confuses the next person.

## architectural refactoring lessons (oct 1, 2025)

### goof 5: hardcoding when you should centralize

**What I did wrong**: When implementing HPA data source, frontend had hardcoded list `['uniprot', 'mobidb', 'rvis']` and I tried to fix by adding `'hpa'` to the list.

**User feedback**: "Think of something better" - rejected the hardcoding approach entirely.

**Second attempt goof**: Tried to add sources query endpoint, health endpoint sources, etc. - just more hardcoding in different places.

**User feedback**: "So your 'think of something better' is just to hardcode sources in a couple more places? Ultrathink what Carmack would say."

**The real fix**: Backend maintains registry of available sources, frontend just sends protein IDs. Backend decides what to fetch based on registry.

**Why this pattern matters**: Every time you add a data source, you shouldn't touch multiple files. Registry pattern means one dict entry = complete integration.

**How to avoid**: When you find yourself adding the same string literal in multiple places, that's a data structure trying to emerge. Create the centralized registry first.

### goof 6: claiming duplication is "inevitable"

**What I did wrong**: Had separate `fetch_mobidb_entry()`, `fetch_rvis_entry()`, `fetch_hpa_entry()` functions. When asked to add caching, I said "Per-source functions (inevitable)" and started adding more per-source wrappers.

**User feedback**: "Are you kidding me? Ultrathink how Carmack would react to hearing you say this."

**What I should have seen**: All three functions do the same thing - fetch JSON from URL, save to file. Only differences are *data* (URL pattern, file path, JSON extraction).

**The real fix**: Three generic functions (`_generic_fetch`, `_generic_save`, `_generic_load`) + one registry dict with URL patterns, cache dirs, and extract lambdas. Deleted 27 per-source functions, reduced codebase by ~200 lines.

**Why this was inexcusable**: I literally had the three functions open side-by-side and still didn't see they were identical except for the data. This is the most basic programming abstraction - separating code from data.

**How to avoid**: If you're about to write similar functions for different cases, stop and ask "what would this look like with one function and a dict of config?" 99% of the time that's the right answer.

### goof 7: not checking cache before fetching

**What I did wrong**: "Update All" button made 116 API calls every time (29 proteins × 4 sources), even when data was already cached. Took 5+ minutes.

**User feedback**: "Are we re-fetching already existing data?? Think what Carmack would do"

**The fix**: Added cache check at the start of `refresh_data_source()`:
```python
if not force and _generic_load(cache_path):
    print(f"{source_name} cached for {identifier}, skipping")
    return True
```

**Result**: Reduced time from 5 minutes to 30 seconds for cached proteins.

**Why this was stupid**: Classic performance bug - doing expensive operations when you already have the result. Should have been the first thing to check.

**How to avoid**: Before any network call or expensive computation, ask "do I already have this answer somewhere?" Cache-before-fetch should be default behavior.

### goof 8: leaving dead code after refactoring

**What I did wrong**: Created generic `_generic_fetch()` function and DATA_SOURCES registry, but left old `fetch_mobidb_entry()`, `save_mobidb_json()`, etc. functions in the file.

**User feedback**: "Why is there dead code then? Remove"

**The fix**: Deleted all per-source functions once generic version was working.

**Why this creates problems**: Future developers see both implementations and don't know which one is actually used. Wastes mental energy figuring out the relationship between them.

**How to avoid**: Refactoring isn't done until the old code is deleted. "Make it work, make it right, delete the old version" - all three steps are mandatory.

## debugging goofs i made (oct 1, 2025)

### goof 9: didn't check for existing tools before investigating

**What I did wrong**: User asked why "Aesthetics" was parsed as text instead of set. I spent multiple messages investigating mapping.json structure, checking field types, looking for Python code that writes to mapping.json, before discovering there's a GUI tool (mapping-studio) that manages it.

**What was actually wrong**: The mapping-studio GUI has a `discover_from_csv()` function that infers field types from CSV data. It had asymmetric logic - features.csv checked for delimiters (`;|/`) to identify set-type fields, but persona.csv didn't check, defaulting everything non-numeric to "text".

**Why this took so long**: I assumed mapping.json was manually edited or written by backend code. I didn't check the apps/ directory for GUI tools until the user explicitly told me "nobody manually added a mapping."

**How to avoid this**: When investigating configuration files:
1. First check apps/ directory for relevant tools
2. Look for GUI or editor applications that might manage the config
3. Search for the config filename in all Python files to find what writes to it
4. Only after ruling out existing tools should you assume manual editing

**The pattern**: Users build tools to manage configuration because hand-editing JSON is error-prone. If there's complex configuration, there's probably a tool. Check for the tool first.

### the carmack test for duplication

**The pattern**: When you have similar functions or code blocks, apply this test:

1. Open them side-by-side
2. Diff them mentally
3. If differences are only data (URLs, file paths, dict keys), not logic - it's one function plus config
4. If you can't explain why the duplication is necessary in one sentence, it's not necessary

**Examples that failed the test**:
- `fetch_mobidb_entry()` vs `fetch_hpa_entry()` - only URL pattern differs
- `save_mobidb_json()` vs `save_hpa_json()` - only directory path differs
- `refresh_mobidb_cache()` vs `refresh_hpa_cache()` - only source name differs

**The fix**: All became `refresh_data_source(source_name, ...)` with registry lookup.

**Why Carmack specifically**: He's famous for ruthlessly eliminating duplication and abstractions that don't carry their weight. If you can't defend your duplication to someone with that standard, it needs to go.

### backend-driven vs frontend-driven architecture

**The mistake**: Frontend deciding what data sources exist and which to fetch.

**The correct pattern**:
- Backend maintains DATA_SOURCES registry with all available sources
- Frontend sends protein identifiers (UIDs, gene symbols)
- Backend decides what sources to query based on registry and what data is needed
- Frontend is just a thin display layer

**Why this matters**: When you add a new data source:
- Wrong way: Update frontend source list, backend fetch logic, display logic - 3 files minimum
- Right way: Add one entry to DATA_SOURCES dict - backend handles everything automatically

**The principle**: Data sources are a backend concern. Frontend shouldn't know or care what sources exist.

## aesthetic mapping workflow (oct 1, 2025)

**The problem**: Protein families need to map to cultural aesthetics for character generation, but mapping 17+ families by hand is tedious and inconsistent.

**The solution**: AI-assisted mapping using Gemini with full context (worldbuilding, existing mappings, 989 available aesthetics).

**How it works**:
1. Script discovers families from `features.csv` dynamically (scans `kegg_families` column)
2. Compares against `mapping.json` to find unmapped or placeholder entries
3. Builds prompt with worldbuilding context, family descriptions, and full aesthetics wiki
4. Queries Gemini to suggest mappings based on semantic/thematic fit
5. Applies suggestions to `mapping.json`
6. Rebuild `persona.csv` to see results

**Commands**:
```bash
# Check what needs mapping
python scripts/map_aesthetics.py

# Get AI suggestions and apply automatically
python scripts/map_aesthetics.py --apply

# Re-map everything (ignores existing mappings)
python scripts/map_aesthetics.py --force-remap
```

**GUI**: Mapping Studio launcher has "Map Aesthetics (AI)" button that runs `--apply` automatically.

**Data-driven design**: No hardcoded family lists. Script adapts to whatever families exist in the data.

**Edge cases**: Proteins without KEGG families (NOTCH1, NOTCH3) won't get aesthetics from this mapping. That's expected - they have no family data to map from.

**Gemini mapping quality** (Oct 1, 2025):
- Health Goth for chaperones (wellness/discipline)
- Cargopunk for membrane trafficking (logistics)
- Atompunk for mitochondrial biogenesis (power plants)
- Wuxia for peptidases vs inhibitors (martial combat)
- Minimalism for phosphatases (opposite of kinases)

All suggestions were thematically coherent and aligned with worldbuilding factions.

---

*When in doubt, check the data before debugging the code. When you see duplication, extract data from code.*