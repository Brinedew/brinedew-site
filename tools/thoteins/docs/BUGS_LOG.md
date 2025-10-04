# Bugs Log

This file tracks bugs that have been identified and resolved in the Thoteins project.

## Fixed Bugs (from Sept 27 handoff note)

### 1. GUI doesn't appear when double-clicking `.bat` launcher

**Problem**: Root launcher batch file would fail silently - GUI window wouldn't appear when double-clicking `run_thoteins.bat`.

**Root Cause**: Multiple issues with Python discovery, missing error logging, and no fallback handling.

**Fix Applied**:
- **Enhanced Python detection**: Added sophisticated Python discovery in `run_thoteins.bat` lines 20-70
  - Uses `py -0p` to find registered Python installations with absolute paths
  - Prefers `pythonw.exe` siblings to avoid console windows
  - Falls back through `pythonw`, `python`, then `py -3` commands
- **Added comprehensive logging**: All startup attempts logged to `logs/launcher_start.log`
  - Shows which Python was chosen
  - Logs the exact command being executed
  - Captures start command exit codes
- **Added preflight checks**: Verifies tkinter availability before launching GUI (lines 82-88)
- **Fallback strategy**: If `start` command fails, switches to direct console execution with error display (lines 103-110)

**Evidence of fix**: Launcher logs show successful Python detection and command execution since Sept 28.

### 2. Rebuild buttons show no output - users can't tell if rebuild worked

**Problem**: Rebuild Database and Rebuild Persona buttons in the mapping editor would run but show no feedback in the log pane.

**Root Cause**: Subprocess output wasn't being captured and marshaled back to the GUI thread.

**Fix Applied** (in `apps/mapping-studio/gui_launcher.pyw` lines 330-381):
- **Threaded execution with output capture**: Both rebuild functions now run in background threads
- **Real-time output streaming**: Uses `subprocess.run` with `capture_output=True, text=True`
- **GUI thread safety**: Uses `self.root.after(0, lambda: ...)` to marshal stdout/stderr back to main thread
- **Command tracking**: Shows the exact command executed and exit code
- **Status feedback**: Clear success/failure messages based on exit codes

**Code locations**:
- `rebuild_database()`: lines 330-349
- `rebuild_persona()`: lines 362-381

### 3. Categorical mappings show "no tokens" even when tokens should exist

**Problem**: The mapping editor would show `status: no tokens` for categorical mappings even when the source CSV contained valid token data.

**Root Cause**: Token discovery logic wasn't properly parsing delimited values in CSV cells.

**Fix Applied** (in `apps/mapping-studio/gui_launcher.pyw` lines 655-665):
- **Enhanced token parsing**: Updated `discover_variables()` method to properly split delimited values
- **Multiple delimiter support**: Handles `;`, `|`, and `/` as token separators
- **Robust cell processing**:
  ```python
  if any(d in cell for d in ";|/"):
      parts = [p.strip() for p in cell.replace("|",";").replace("/",";").split(";") if p.strip()]
  ```
- **Improved status computation**: `compute_mapping_status()` method properly checks discovered tokens (lines 736-747)

**Status indicators now working**:
- `ok`: Source and target columns exist, tokens discovered for categorical mappings
- `unpaired`: Source/target column missing from CSV
- `no tokens`: Truly no tokens found (legitimate warning)

## Legacy Technical Debt Identified

### Dual Mapping Logic Implementation

**Issue**: Mapping rules exist in two separate implementations:
- **Python**: `scripts/protein_db.py` `_apply_mapping()` function - used for official persona CSV generation
- **JavaScript**: `apps/protein-portrait-prompter/src/logic.js` `applyMapping()` function - used for real-time frontend preview

**Risk**: Changes to mapping logic require manual synchronization. Subtle differences could cause frontend to show different results than backend CSV.

**Current Differences**:
- Height rounding: JS uses `Math.round(mapped)`, Python uses `int(round(k * base))`
- Numeric precision: JS uses `Math.round(mapped * 10) / 10` for non-height values
- Error handling variations between implementations

### Legacy Code Cleanup Needed

**Issue**: Large commented-out block in `apps/protein-portrait-prompter/index.html` (lines ~130-200+) contains old inline JavaScript:
- Deprecated mass calculation: `Math.round(data.sequence.molWeight / 100) / 10` (gives 53.4 kDa)
- Current calculation: `Math.round(data.sequence.molWeight / 1000)` (gives 53 kDa)
- Old template rendering logic
- Outdated utility functions

**Impact**: Confuses future developers, increases maintenance burden, represents inconsistent implementation history.

## Recently Resolved Technical Debt

### Mapping Logic Consolidation (Sept 29, 2025) - COMPLETED
- **Solution**: Frontend now calls `/apply-mapping` API endpoint in local_writer.py
- **Result**: Single source of truth in Python, no sync issues, consistent results
- **Files changed**: Removed JavaScript `applyMapping()`, added API client, cleaned up imports
- **Status**: ✅ Production ready, fully tested

### Legacy Code Cleanup (Sept 29, 2025) - COMPLETED
- **Solution**: Removed ~400 lines of commented legacy JavaScript from `index.html`
- **Result**: File reduced from 520 to 126 lines, eliminated mass calculation confusion
- **Impact**: Cleaner codebase, no more misleading deprecated logic
- **Status**: ✅ Complete, no remaining legacy comments

## Recently Fixed Bugs

### Disorder Percentage Data Corruption (Sept 29, 2025) - FIXED
- **Problem**: All 28 proteins showing exactly 0% disorder (biologically impossible)
- **Root cause**: `percent_disordered_from_entry()` checking field values instead of field names in MobiDB API response
- **Debug process**: Found MobiDB API returns 235KB with disorder data, but algorithm missed it because disorder info is in field names like `curated-disorder-disprot`, not in `id`/`source_id`/`label` values
- **Solution**: Updated algorithm in `scripts/protein_db.py` lines 298-311 to check top-level disorder field names
- **Result**: Realistic disorder percentages (EGFR: 63.4%, KRAS: 45.0%, range 15-100%)
- **Status**: ✅ All proteins now show accurate disorder data, "none" for truly missing data

## Recently Fixed Bugs (Sept 30, 2025)

### GUI Update Button Not Fetching RVIS Data - FIXED
- **Problem**: Clicking "Update All" in protein-portrait-prompter GUI only fetched UniProt + MobiDB, not RVIS data
- **Root cause**: Frontend was calling external APIs directly (UniProt, MobiDB) but had no way to orchestrate RVIS fetching (requires extracting gene symbols from UniProt first, then calling GenoHub API)
- **Solution**: Created unified `/refresh-proteins` endpoint in `local_writer.py` lines 459-576 that orchestrates all data fetching (UniProt → extract gene symbols → fetch RVIS)
- **Result**: GUI Update button now fetches all three data sources automatically, returns full protein data with disorder + RVIS populated
- **Status**: ✅ Complete, tested with batch fetching

### Numeric Columns Showing as Text Type - FIXED
- **Problem**: `rvis_percentile` and `percent_disordered` columns displayed as "text" in mapping editors instead of numeric, breaking numerical mappings
- **Root cause**: Functions returned string `"none"` for missing data, polluting column type inference (28 numbers + 1 string = text column)
- **Solution**: Modified `enrich_protein_row()` in `protein_db.py` lines 833-855 to only add fields if actually numeric (`isinstance(val, (int, float))`)
- **Result**: Both columns now have 28 numeric values + 1 empty cell (HLA-A), 0 text strings; mapping editors recognize them as numerical
- **Status**: ✅ Complete, CSV rebuilt with clean numeric columns

### Adding Data Columns Required Editing 5+ Scattered Locations - FIXED
- **Problem**: Adding a new column required editing column lists in 2 places, injection code in 2 functions, potentially other locations - high maintenance cost
- **Root cause**: Data enrichment logic was duplicated between `update_features_csv_with_obj()` and `rebuild_features_csv()` functions
- **Solution**: Created `enrich_protein_row()` in `protein_db.py` lines 822-863 as single source of truth for all supplementary data (MobiDB, RVIS, etc.). Column lists now auto-derived from enriched row keys.
- **Result**: Adding a column now requires editing one function only (5-8 lines). Demonstrated by adding `first_letter` column in 4 lines.
- **Status**: ✅ Complete, architecture refactored

### Frontend Had Duplicate Parsing/API Logic - FIXED
- **Problem**: Frontend had CSV parser (35 lines), file upload parsers, direct API calls to UniProt/MobiDB, fallback logic - all duplicating backend capabilities
- **Root cause**: Frontend was designed as standalone app instead of thin client
- **Solution**: Added three backend endpoints (`/api/persona`, `/upload-proteins`, `/refresh-proteins`), removed ~120 lines of frontend parsing/API orchestration
- **Result**: Frontend is now thin display layer that calls backend for all data processing. No CSV parsers, no API calls, no fallbacks.
- **Status**: ✅ Complete, major architectural cleanup

## Known Issues (Sept 30, 2025)

### "Update All" Button Timeout for Uncached Proteins - FIXED
**Problem**: GUI "Update All" button would time out when fetching data for many uncached proteins. Took 4+ minutes for 29 proteins fetching all sources (UniProt, MobiDB, RVIS, HPA).

**Root Cause**: Missing cache checks before fetching. Every click made 116 API calls (29 proteins × 4 sources) even when data already existed.

**Fix Applied**: Added cache checking at start of `refresh_data_source()` (Oct 1, 2025). Now checks if data exists before fetching, skips cached proteins automatically.

**Result**: Reduced time from 5 minutes to 30 seconds for cached proteins. Timeout no longer occurs in normal usage.

**Status**: ✅ Fixed - cache optimization implemented

### Server Requires Manual Restart After Code Changes
**Problem**: Python modules not reloaded automatically when `protein_db.py` or `local_writer.py` are edited. Changes don't take effect until server restart.

**Root Cause**: Python's module import system caches imports. Flask dev mode has auto-reload but we're not using it.

**Current Workaround**: Manually kill and restart server after code changes.

**Proper Fix Needed**: Enable Flask dev mode with `app.run(debug=True)` or use a tool like `watchdog` to restart on file changes.

**Status**: ⏸️ Low priority - affects development workflow but not end users

### Incomplete HPA Tissue Tau Data
**Problem**: Only 11 out of 29 proteins have Tissue Tau values. Remaining 18 proteins show empty `tissue_tau` column.

**Root Cause**: HPA API requires gene symbols, not all proteins have been fetched yet. Initial data fetch may have been incomplete.

**Current Status**: Now that cache optimization is fixed (see above), clicking "Update All" should complete remaining proteins quickly without timeout.

**To Complete**: Click "Update All" once or twice more until all proteins have HPA data. Cache checking prevents redundant fetches.

**Status**: ⏸️ Partially complete - needs batch completion run

### Card Gallery CSV Parser Bug (Oct 1, 2025)
**Problem**: Card gallery displayed protein data with column misalignment - EGFR showed "E" for disorder percentage, "Yes" for first letter, wrong values everywhere.

**Root Cause**: Naive CSV parser in `src/gallery.js` used `split(',')` which broke on quoted fields containing commas. Example: `domains_top3` field contains `"Protein kinase; Important for dimerization, phosphorylation"` - the comma inside quotes caused the split to create extra columns, shifting all subsequent data.

**Solution**: Implemented proper CSV parser that tracks quote state (lines 16-71 in `gallery.js`). Now handles:
- Quoted fields with internal commas
- Escaped quotes (two consecutive quotes)
- Mixed quoted and unquoted fields

**Status**: ✅ Fixed - card gallery now displays all fields correctly

### Mapping Studio Field Discovery Asymmetry (Oct 1, 2025)
**Problem**: Aesthetics column in persona.csv contains semicolon-delimited values ("placeholder; placeholder") but was discovered as type "text" instead of "set". This caused the categorical mapping from kegg_families→Aesthetics to produce single-value fields instead of multi-value sets.

**Root Cause**: `discover_from_csv()` in `apps/mapping-studio/gui_launcher.pyw` had asymmetric logic:
- features.csv (line 648-653): numeric → check for delimiters (`;|/`) → text
- persona.csv (line 688): numeric → text (missing delimiter check!)

When the GUI scanned persona.csv, it saw "placeholder; placeholder" but never checked for semicolons, so it classified Aesthetics as "text".

**Solution**: Made persona.csv discovery use same three-way logic as features.csv (lines 688-693). Now both CSVs check: numeric → set (if has delimiters) → text.

**Status**: ✅ Fixed - future "Reload CSVs" will correctly identify semicolon-delimited persona fields as type "set"

### Mapping Studio UI Not Scrollable (Oct 1, 2025)
**Problem**: Mapping Studio GUI became unusable with many mappings:
- Treeview had fixed `height=8` - only 8 mappings visible
- Listboxes had no scrollbars - molecular/persona fields disappeared
- Editor area had no scrolling - categorical mappings with 50+ tokens were cut off

**Root Cause**: Original implementation didn't anticipate more than 8-10 mappings or long token lists. No scrollbars anywhere.

**Solution**: Completely modernized GUI (lines 521-650 in `gui_launcher.pyw`):
- Removed `height=8` constraint on Treeview, added scrollbar
- Added scrollbars to both listboxes
- Implemented Canvas+Scrollbar pattern for editor area
- Applied modern styling (white panels, subtle backgrounds, professional colors)
- Increased default window size to 1200x800

**Status**: ✅ Fixed - GUI now handles 50+ mappings and long token lists comfortably

## Remaining Recommendations

1. **Add mapping tests**: Unit tests for `_apply_mapping` function to prevent future regressions
2. **Consider mapping DSL**: More complex mapping rules might benefit from declarative configuration
3. **Move prompt generation to backend**: Still 40+ lines of template rendering logic in frontend that should be a `/generate-prompts` endpoint
4. **Implement async job pattern**: Fix "Update All" timeout issue with proper async architecture

---
*Log started: September 29, 2025*