# Sprint 01 Summary

**Sprint Period**: Sept 29-30, 2025
**Status**: Partially Complete (1/4 epics completed, plus significant untracked work)

## Completed Epics

### ✅ Epic 1: HSLuv Color Signature Column
**Status**: Complete
**Estimated**: 4-6 hours | **Actual**: ~2 hours
**Location**: [Archived/COMPLETE-epic-hsluv-color-signature.md](../Archived/COMPLETE-epic-hsluv-color-signature.md)

Added hexcode column to persona.csv with actual colors computed from HSLuv coordinates. Works seamlessly with persona rebuild workflow.

## In-Progress Epics

### ⏸️ Epic 2: Dual Input Support (Gene Symbols + UniProt IDs)
**Status**: Not Started
**Estimated**: 3-4 hours

No work done yet. Still requires gene symbol resolver and UniProt search API integration.

### ⏸️ Epic 3: ComfyUI Integration
**Status**: Not Started
**Estimated**: 8-12 hours

ComfyUI installed but no workflow template or API client exists yet. Blocks Obsidian automation epic.

### ⏸️ Epic 4: Obsidian Page Creation
**Status**: Not Started
**Estimated**: 4-6 hours

MCP Obsidian tools available but no page generation function built yet.

## Untracked Work Completed

These features were built during Sprint 01 but weren't in the original epic files:

### Card Gallery in Prompter GUI (~3 hours)
**Files**: `apps/protein-portrait-prompter/index.html`, `src/gallery.js`, `src/main.js`

Built visual card gallery showing all 29 proteins with:
- 4:5 aspect ratio cards with images or colored hex placeholders
- Two-column layout (molecular properties left, persona properties right)
- Mapped properties highlighted with accent color
- Pre-loaded CSVs (no manual file selection needed)
- OKLCH color system matching website design

This wasn't in any epic but directly addresses the "visual color signature" goal from Epic 1.

### HPA Tissue Tau Integration (~2 hours)
**Files**: `scripts/protein_db.py` lines 212-440, `data/mapping.json`

Added Human Protein Atlas as new data source for tissue specificity:
- Tau score τ ∈ [0,1] measures expression breadth
- τ ≈ 0: housekeeping genes (ubiquitous) → desaturated colors
- τ ≈ 1: tissue-specific genes → vivid colors
- Mapped to Skintone Saturation (replaced RVIS percentile)

Biologically more meaningful than RVIS for visual distinctiveness. Currently 11/29 proteins have Tau data.

### Data Source Registry Refactoring (~4 hours)
**Files**: `scripts/protein_db.py` lines 304-506

Major architectural improvement that eliminated ~200 lines of duplicated code:

**Before**: Every data source (MobiDB, RVIS, HPA) required 9+ functions:
- `fetch_X_entry()`, `save_X_json()`, `load_X_cached()`
- `X_json_path()`, `refresh_X_cache()`
- Hardcoded source lists in 4+ files (frontend, backend, status display)

**After**: One registry dict + 3 generic functions:
- `DATA_SOURCES` dict with URL patterns, cache dirs, extract lambdas
- `_generic_fetch()`, `_generic_save()`, `_generic_load()`
- `refresh_data_source(source_name, ...)` handles all sources

**Impact**: Adding new data source now requires 3 lines in registry dict. No new code functions needed.

### Cache Optimization (~30 minutes)
**Files**: `scripts/protein_db.py` line 483-486

Added cache checking before fetching to prevent redundant API calls:
- Before: "Update All" made 116 API calls every time (29 proteins × 4 sources) → 5+ minutes
- After: Checks cache first, skips existing → 30 seconds for cached proteins

## Architecture Lessons

The registry refactoring was the big win. User feedback: "Are you kidding me? Ultrathink how Carmack would react to hearing you say [per-source functions are] inevitable."

The lesson: When functions differ only in data (URLs, file paths, dict keys) rather than logic, that's one function with a config dict. The "Carmack test" from CLAUDE.md now documents this pattern.

## Sprint Velocity

**Planned work**: 4 epics, 19-28 hours estimated
**Actual completed**: 1 epic + 3 untracked features, ~11 hours actual

Sprint planning missed the architectural work that emerged organically (registry refactoring, HPA integration, card gallery). These weren't in epics but directly served the project goals.

## Next Sprint Considerations

**Remaining Epic Work**: ~20 hours across 3 epics (dual input, ComfyUI, Obsidian)

**Tech Debt Items**:
- "Update All" timeout issue (needs SSE or async jobs for proper fix)
- Only 11/29 proteins have HPA Tau data (needs batch fetch)
- Card gallery not visually tested yet
- Server requires manual restart after code changes

**Blocked Dependencies**:
- Obsidian epic blocked by ComfyUI epic (needs character images)
- ComfyUI epic could benefit from dual input support (gene symbols in prompts)
