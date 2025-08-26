# Technical Bugs Report
*Updated: 2025-01-26*

## Fixed Issues ✅

### 1. Dark Mode Toggle - FIXED ✅
**Status**: ✅ **RESOLVED** - commit `a0cae8f`
**Files Fixed**: 
- `quartz/components/scripts/darkmode.inline.ts` - changed `saved-theme` to `data-theme` attribute
- `quartz/components/styles/darkmode.scss` - updated CSS selectors to match `data-theme`
- `quartz/static/custom.css` - implemented Pattern A CSS cascade fix

**Root Cause Identified**: JavaScript was setting `saved-theme` attribute but CSS was looking for `data-theme`. Additionally, `@media (prefers-color-scheme: dark)` was overriding explicit user choice due to CSS cascade order.

**Fix Applied**: Pattern A approach - base defaults, system preference with `:not([data-theme])` guard, then explicit user choice attributes. This ensures user choice always wins over system preference.

**Resolution Verified**: Dark mode toggle now switches themes correctly on both light/dark system preferences.

---

### 2. Search Button Positioning - FIXED ✅  
**Status**: ✅ **RESOLVED** - commit `a0cae8f`
**File Fixed**: `quartz/static/custom.css` - search button CSS

**Root Cause**: Search button was using `position: fixed; bottom: 2rem; right: 2rem` with excessive padding, making it a huge floating element.

**Fix Applied**: Changed to inline flexbox positioning with other header buttons, removed "Search" text, proper icon centering.

**Resolution Verified**: Search button now properly sized and positioned with dark mode/reader mode buttons.

---

### 3. Content Filtering System - FIXED ✅
**Status**: ✅ **RESOLVED** - commits `a2d7db4`, `debe5a8` 
**Files Fixed**:
- `quartz/plugins/transformers/lineageTextFilter.ts` - new textTransform-based filtering plugin
- `quartz/plugins/transformers/index.ts` - exported new plugin
- `quartz.config.ts:63` - switched from broken rehype approach to working textTransform

**Root Cause**: The rehype plugin approach was fundamentally broken. Quartz processes rehype plugins in workers where they don't actually execute on the HTML that gets emitted to the final page. The registration logs showed up but the per-file processing never happened.

**Fix Applied**: Created new textTransform plugin that processes raw markdown before any HTML parsing. Filters out Gingko depth 1-2 sections (signposting/outline) and keeps only depth 3+ sections (actual content) for readers.

**Testing Results**: Processed 174 Gingko markers, kept 80 depth-3+ sections, filtered out 94 signposting sections. File size preserved exactly (78,095 bytes). Live site now shows clean content without editing structure.

**Resolution Verified**: The essay at brinedew.com/posts/the-price-of-not-being-cancer-v3 now displays only reader-focused content, with all editorial signposting removed.

---

### 4. Inconsistent List Text Colors - FIXED ✅
**Status**: ✅ **RESOLVED** - commit `debe5a8`
**File Fixed**: `quartz/styles/base.scss:32-45` - removed `li` from base color selector

**Root Cause**: List items (`li`) were explicitly set to `var(--darkgray)` in base Quartz styles while body text used `var(--dark)`, creating inconsistent typography where lists appeared dimmed.

**Fix Applied**: Removed `li` from the problematic color selector, allowing lists to inherit `color: var(--dark)` from parent article elements. Kept `li` in overflow-wrap rule since that's still needed.

**Approach**: Instead of overriding with `!important`, removed the source of the CSS conflict for cleaner cascade behavior. All UI lists (sidebar, TOC, tag explorer) already had explicit colors in custom.css so remained unaffected.

**Resolution Verified**: List items now have consistent color with body text throughout the site.

---

## Recently Fixed Issues ✅

### 3. Mobile Click Blocking - FIXED ✅
**Status**: ✅ **RESOLVED** - commit `f6392d8`
**Files Fixed**: 
- `quartz/components/styles/explorer.scss` - Default mobile CSS to closed state with `.is-open` class
- `quartz/components/scripts/explorer.inline.ts` - Use `matchMedia()` instead of `checkVisibility()` for breakpoint detection

**Root Cause**: CSS defaulted to open state on mobile (`&:not(.collapsed)`), requiring JavaScript to fight against it. Also used unreliable visibility detection instead of actual breakpoint matching.

**Fix Applied**: ChatGPT's "breakpoint as source of truth" approach - CSS defaults closed, JavaScript only opts into open state using `matchMedia('(max-width: 800px)')` listener.

**Resolution Verified**: 
- Mobile navigation starts closed when resizing desktop→mobile ✅
- Hamburger menu opens/closes correctly on tap ✅
- No click blocking on mobile viewports ✅
- Desktop navigation remains unaffected ✅

---

### 4. TagExplorer Component Architecture - PARTIALLY FIXED ⚠️
**Status**: 🟡 **PARTIALLY RESOLVED** - commit `af40fa7`  
**Issue**: TagExplorer component was implemented with inline CSS/JS hacks instead of following Quartz patterns

**Root Cause**: Original implementation ignored established Quartz component architecture (external SCSS, external TypeScript, proper templates)

**Fix Applied**: Complete rewrite following Explorer component patterns:
- Created external `quartz/components/styles/tagExplorer.scss` 
- Created external `quartz/components/scripts/tagExplorer.inline.ts`
- Implemented grid-based collapsible animations
- Added proper TypeScript interaction logic with localStorage persistence

**Partially Fixed**:
- ✅ Individual tag collapsibility with state persistence
- ✅ Proper Quartz component architecture 
- ✅ Clean separation of concerns (CSS, JS, JSX)
- ✅ Grid-based animations instead of max-height hacks

**Remaining Issues**:
- ❌ Main "Tags" header not collapsible (needs overall component collapse logic)
- ❌ Font styling inconsistent with TOC (opacity, font-weight, hover states)  
- ❌ PageTags component not rendering in sidebar (layout issue)
- ❌ Horizontal scrollbar flicker during animations (needs overflow-x: hidden)

---

### 5. Excalidraw Images Not Rendering 
**Status**: 🟡 Medium Priority - **DOCUMENTATION PROVIDED**
**Expected**: Embedded image display  
**Actual**: Text link `Vibes-are-principal-components-2025-07-28-12.52.03.excalidraw`

**Root Cause**: Missing PNG auto-export from Obsidian Excalidraw plugin
**Fix Required**: User configuration in Obsidian:
1. Obsidian → Settings → Community plugins → Excalidraw
2. ✅ Enable "Auto export PNG" 
3. ✅ Set "Keep same folder as drawing"

**Documentation**: Setup instructions added to `CLAUDE.md`

---

### 5. Package.json Script Path Issue  
**Status**: 🟡 Low Priority - **NOT BLOCKING**
**File**: `package.json:16`
**Current**: `"docs": "npx quartz build --serve -d docs"`
**Issue**: Content moved from `docs/` to `content/` during migration  
**Fix**: Update to `"docs": "npx quartz build --serve"` or point to correct directory

---

## Working Features ✅
- ✅ Dark mode toggle (fixed in commit `a0cae8f`)
- ✅ Search functionality with proper positioning
- ✅ SPA navigation and breadcrumbs  
- ✅ Content rendering and markdown processing
- ✅ Explorer sidebar structure display
- ✅ Site architecture and content organization
- ✅ Mobile hamburger navigation (fixed in commit `f6392d8`)
- ✅ Desktop-to-mobile viewport transitions
- ✅ Self-hosted fonts (Crimson Pro) via nuclear patch approach
- ✅ Editorial design transformation complete
- ✅ MkDocs to Quartz 4 migration complete

---

### 6. Font Loading Errors - FIXED ✅  
**Status**: ✅ **RESOLVED** - August 2025
**Issue**: Font loading errors resolved - Crimson Pro now loads correctly on live site
**Resolution Verified**: Typography displays as intended with self-hosted variable fonts

---

## Outstanding Issues

### 7. Scriptotic Sentinel Backend Startup Failure - FIXED ✅
**Status**: ✅ **RESOLVED** - August 13, 2025
**Issue**: Sentinel activation failed due to Python environment conflicts and PowerShell path separator issues

**Root Causes Identified**:
1. **Python Environment**: PowerShell PATH resolved to Anaconda (`C:\ProgramData\anaconda3\python.exe`) instead of system Python (`C:\Python313\python.exe`)
2. **Path Separators**: PowerShell argument `"src\core\web_server.py"` became `"srccoreweb_server.py"` due to backslash escape processing

**Fixes Applied**:
- Updated PowerShell script to use explicit Python path: `C:\Python313\python.exe`
- Fixed argument separator: `"src/core/web_server.py"` (forward slashes)
- Added permanent documentation to root `CLAUDE.md` about Windows path separator syntax

**Resolution Verified**:
- ✅ Sentinel triggers PowerShell script correctly
- ✅ Flask backend starts with proper Python environment
- ✅ Sentinel detects healthy backend and transitions to "ready" state
- ✅ API proxy works: POST /api/transcribe returns job_id successfully
- ✅ End-to-end activation flow: offline → starting → ready → proxy requests

**Files Fixed**:
- `D:\Coding\Scriptotic\start_scriptotic_web.ps1` - Explicit Python path and forward slashes
- `D:\Coding\CLAUDE.md` - Added Windows PowerShell path separator documentation

---

### 8. Scriptotic Backend Environment Mismatch - FIXED ✅
**Status**: ✅ **RESOLVED** - Environment consolidation complete
**Issue**: PowerShell startup script uses wrong Python virtual environment for vLLM

**Root Cause**: PowerShell script calls `source voxtral-env/bin/activate` but vLLM is installed in `~/venv-vllm-stable/bin/activate`

**Fix Applied**: 
- Consolidated to 2 clean environments (Windows venv + WSL2 venv-vllm-stable)
- Updated all scripts to use explicit interpreter paths
- Added runtime guards to prevent wrong environment usage
- Archived broken voxtral-env
- Optimized vLLM memory settings (FP8 KV cache, V0 engine)

**Resolution Verified**: Transcription pipeline works up to vLLM audio size limits (~16 minutes)

**Working Command (Updated with Memory Optimization)**:
```bash
wsl -d Ubuntu bash -c "source ~/venv-vllm-stable/bin/activate && python -m vllm.entrypoints.openai.api_server --model mistralai/Voxtral-Mini-3B-2507 --task transcription --dtype bfloat16 --kv-cache-dtype fp8_e5m2 --calculate-kv-scales --gpu-memory-utilization 0.95 --max-model-len 4096 --max-num-seqs 1 --port 8000 --host 0.0.0.0 --tokenizer-mode mistral --config-format mistral --load-format mistral"
```

**Evidence**: KV cache memory increased from 0.24GB → 1.81GB available with optimizations

---

### 9. vLLM Audio File Size Limits - FIXED ✅
**Status**: ✅ **RESOLVED** - Sprint 4 implementation complete
**Issue**: vLLM rejects audio files over ~16 minutes with "Maximum file size exceeded" error

**Root Cause**: HTTP file upload limits (25MB), not model capacity. Voxtral-Mini supports up to 30 minutes.

**Fix Applied**: 
- Implemented FFmpeg Opus compression in `D:\Coding\Scriptotic\src\core\web_server.py` lines 86-89 (24kbps reduces files by 6.3x)
- Added 30-minute chunking algorithm lines 100-111 with 10-second overlaps
- Worker functions write transcript files to `output/` directory

**Resolution**: Files that previously failed due to size now process through compression → chunking → transcription pipeline.

---

### 10. Flask Backend Auto-Start Failure - NEW ❌
**Status**: 🔴 **UNRESOLVED** - Blocking all transcription requests
**Issue**: Flask backend (port 5000) not starting when triggered by Sentinel (port 5050)

**Root Cause**: PowerShell auto-start mechanism failing - exact cause unknown

**Impact**: 
- Website shows "Server: offline" and "Submit failed"
- Sentinel responds with service status but cannot proxy to Flask
- All integration work completed but system unusable due to this

**Evidence**:
- Sentinel running: `curl http://localhost:5050/api/server-status` → `{"status":"idle"}`  
- Flask not running: `curl http://localhost:5000/api/server-status` → Connection refused

**Next Steps**: 
- Debug PowerShell script execution when Sentinel triggers auto-start
- Check execution policies, paths, and Flask startup logs
- Test manual script execution to verify Flask can start

---

### 11. TagExplorer Font Styling - FIXED ✅
**Status**: ✅ **RESOLVED** - commits `a63f01a`, `23eab0d`, `85ee156`, `bae1d16`
**Issue**: TagExplorer page links were nearly invisible due to CSS specificity conflict and wrong hover colors

**Root Cause Identified**: TOC styles (`ul.toc-content.overflow > li > a`) had higher CSS specificity than TagExplorer styles (`.tag-pages-outer > ul li a`), causing TOC's `opacity: 0.35` to override TagExplorer's intended `opacity: 0.85`.

**Fixes Applied**:
- **CSS Scoping**: Prefixed TOC styles with `.toc` wrapper to prevent leakage into TagExplorer
- **Scroll Spy Removal**: Eliminated outdated IntersectionObserver JavaScript and faded CSS states  
- **Correct Hover Color**: Changed from `var(--secondary)` (gray) to `var(--tertiary)` (actual blue)
- **Line Spacing**: Added `margin-bottom: 0.2rem` and `line-height: 1.4` to prevent cramped appearance

**Resolution Verified**: 
- ✅ TagExplorer links now show at proper opacity (0.85)
- ✅ Hover state turns blue like other site links
- ✅ Proper visual spacing between links
- ✅ Both TOC and TagExplorer maintain independent, clean styling

---

## NEW CRITICAL ISSUES - MOBILE HAMBURGER MENU

### 12. Mobile Hamburger Menu - FIXED ✅
**Status**: ✅ **RESOLVED** - commits `8ee6710`, `aa64cbc`, `35d7385`
**Issue**: Hamburger menu had 6 critical failures making mobile navigation unusable
**Files Fixed**: 
- `quartz/components/MobileMenu.tsx` - removed hardcoded ARIA-controls, switched to beforeDOMLoaded pattern
- `quartz/components/scripts/mobileMenu.inline.ts` - complete rewrite following Quartz SPA patterns
- `quartz/components/styles/mobileMenu.scss` - added `pointer-events: none` to child elements for Edge compatibility

#### All 6 Sub-Issues RESOLVED:

**12A: Random Navigation Bug** ✅ FIXED
- **Root Cause**: JavaScript loading pattern incompatible with Quartz SPA navigation
- **Fix Applied**: Rewrote to use `beforeDOMLoaded` + `"nav"` event listeners (not `DOMContentLoaded`)
- **Resolution Verified**: Menu opens TagExplorer overlay instead of navigating to random pages

**12B: JavaScript Loading Failure** ✅ FIXED  
- **Root Cause**: Used wrong event pattern for Quartz SPA system
- **Fix Applied**: Changed from `DOMContentLoaded` to `"nav"` event with proper cleanup
- **Resolution Verified**: Click handlers properly attached, menu functions correctly

**12C: ARIA-Controls ID Mismatch** ✅ FIXED
- **Root Cause**: Hardcoded `aria-controls="tag-explorer-content"` but actual ID was `tag-explorer-18`
- **Fix Applied**: Dynamic ID detection at runtime: `tagExplorerContent.id`
- **Resolution Verified**: ARIA attributes now match actual DOM structure

**12D: CSS Media Query** ✅ FIXED
- **Root Cause**: Breakpoint logic was correct, issue was non-functional JavaScript
- **Fix Applied**: JavaScript now works, so media queries function properly
- **Resolution Verified**: Hamburger hidden at 900px+, visible at 375px mobile

**12E: Edge Browser SVG Rendering** ✅ FIXED
- **Root Cause**: Edge requires explicit `fill="none"` and `stroke="currentColor"` on SVG elements
- **Fix Applied**: Added proper SVG attributes in `MobileMenu.tsx`
- **Resolution Verified**: Icon renders correctly in Edge browser

**12F: Edge Browser Click Detection** ✅ FIXED
- **Root Cause**: Edge handles SVG hit-testing differently - child elements intercept clicks
- **Fix Applied**: Added `pointer-events: none` to all child elements (`> *` selector)
- **Resolution Verified**: Mouse clicks now properly reach button element in Edge

**Final Resolution - August 15, 2025**:
- ✅ All 6 critical issues resolved and tested with Playwright
- ✅ Hamburger menu works consistently across Chrome, Edge browsers  
- ✅ Mobile navigation opens/closes correctly with keyboard (Escape) and click
- ✅ ARIA accessibility properly implemented with dynamic ID matching
- ✅ Cross-browser SVG rendering and click detection functional

**Key Technical Insight**: Quartz SPA navigation requires `"nav"` event listeners, not `DOMContentLoaded`. Most online examples use wrong pattern for Quartz components.

---

### 13. Posts Page Empty Content - FIXED ✅
**Status**: ✅ **RESOLVED** - August 21, 2025
**Issue**: Posts page (brinedew.com/posts) showed only heading with no content while wiki page worked fine

**Root Cause**: `content/posts.md` was essentially empty. Quartz FolderPage plugin needs actual content to generate listing page structure.

**Fix Applied**: Added proper frontmatter and minimal content to posts.md:
```yaml
---
title: "Posts"
date: 2025-08-21
---

# Posts
*This page will automatically list all posts below.*
```

**Resolution Verified**: Posts page now displays proper structure with title, content, and automatic post listing functionality.

---

### 14. TagExplorer UI Issues - MOSTLY FIXED ✅
**Status**: ✅ **MOSTLY RESOLVED** - August 22, 2025  
**Issue**: Multiple TagExplorer problems affecting usability

**Issues Fixed**:
- ✅ **Hierarchical display working**: "topic (14)" → aging (4), biology (4), cancer (3) with proper nesting
- ✅ **Click handlers working**: All collapse/expand functionality responds correctly to clicks  
- ✅ **Main header persistence**: Clicking "Tags" title properly collapses/expands entire sidebar across navigation
- ✅ **Hover state visual feedback**: Collapsed tags dim on hover, expanded tag names show teal highlight, arrows always dim
- ✅ **CSS opacity cascade conflict**: Fixed parent hover opacity blocking child highlights

**Files Fixed**:
- `quartz/components/TagExplorer.tsx` - removed hardcoded aria-expanded, hierarchical rendering (lines 17-243)
- `quartz/components/scripts/tagExplorer.inline.ts` - complete rewrite of click handlers and persistence (lines 89-151)  
- `quartz/components/styles/tagExplorer.scss` - fixed hover states and CSS cascade (lines 89-118)

**Remaining Issue**: 
- ❌ **Selective nested tag persistence**: "glossary" and "protein" tags reset to expanded on navigation, but "aging" and other hierarchical tags persist correctly

**Evidence**: Can reproduce by collapsing "glossary"/"protein" tags then navigating - they expand again while "topic/aging" stays collapsed.

**Next Steps**: Debug localStorage key mismatch for flat vs hierarchical tag types in `setupTagExplorer()` restoration logic.

---

### 15. QuickAdd Plugin Configuration Issues - RESEARCHED ❌
**Status**: 🔴 **UNRESOLVED** - Custom note creation workflow blocked
**Issue**: User wants Ctrl+N to show dialog with 4 choices (Post, Wiki Page, Protein Page, Default Note) with folder routing and templates

**Root Causes Discovered**:
1. **Original QuickAdd Installation Corrupted**: Plugin folder missing `main.js`, `manifest.json`, `styles.css` - only had leftover `data.json`
2. **GUI Approach Failed**: QuickAdd's "Add Choice" button defaults to Template type with no obvious way to change to Multi type
3. **Configuration Wiped on Reinstall**: Fresh QuickAdd installation comes completely clean, no preserved settings

**Technical Investigation**:
- Built comprehensive JSON configuration scripts (`setup-quickadd.ps1`, `reset-quickadd.ps1`) 
- Created all supporting files (templates, scripts, hotkey bindings)
- Configuration structure was perfect but plugin wasn't loading due to missing executable files
- Obsidian preserves user data (`data.json`) during uninstall but removes plugin executables

**Files Created**:
- `content/Templates/Post Template.md` - basic post template with frontmatter
- `content/Templates/Smart Wiki Template.md` - existing, asks protein vs regular
- `.obsidian/scripts/default-new-note.js` - script for default Obsidian new note behavior
- `setup-quickadd.ps1` / `reset-quickadd.ps1` - PowerShell scripts for JSON configuration

**What Should Work**:
- Multi choice "Create New Note" with 4 sub-choices
- Post → content/posts/ folder with Post Template
- Wiki Page → content/wiki/ folder with Smart Wiki Template (asks protein/not protein)
- Protein Page → content/wiki/ folder (placeholder for UniProt API integration)
- Default Note → macro executing core Obsidian new note command

**Current State**: Fresh QuickAdd installation, all supporting files exist, configuration approach validated

**Next Steps**: 
1. Run `reset-quickadd.ps1` to recreate JSON configuration
2. Alternative: Manual GUI setup if PowerShell approach still fails
3. Future: Add UniProt API integration to Protein Page choice for auto-populating template fields

**User Impact**: High - this is a core workflow improvement they've been requesting

---

### 16. Quartz Build Error from HTML Comments - FIXED ✅
**Status**: ✅ **RESOLVED** - August 25, 2025
**Issue**: Quartz build failed with "Cannot read properties of null (reading 'data')" when processing Gingko-structured document

**Root Cause**: Quartz markdown-to-HTML transforms expect element nodes but HTML comments (`<!--section: X-->`) have no `.data` property. Some plugins naively access `node.data` without checking node type.

**Fix Applied**: 
```bash
sed -i 's/<!--section: \([0-9.]*\)-->/<span data-lineage-section="\1"><\/span>/g' file.md
```

**Files Fixed**:
- `content/posts/the-price-of-not-being-cancer-v3.md` - converted all section comments to spans
- `D:\Coding\CLAUDE.md` - documented the regex fix for future reference

**Resolution Verified**: ✅ Build succeeds, site deploys without errors

---

### 17. Gingko Document Structure Filtering - UNRESOLVED ❌  
**Status**: 🔴 **UNRESOLVED** - Live site showing wrong content structure
**Issue**: https://brinedew.com/posts/the-price-of-not-being-cancer-v3 displays full 3-column Gingko editing structure instead of just third-column content for readers

**Problem**: Visitors see first column headings + second column signposting like "[Hook with striking examples]" + third column explanations, when they should only see the explanations.

**Attempted Fixes**:
1. **Remark Plugin**: Created markdown AST filter but consultant analysis revealed it runs in wrong pipeline pass - HTML emitter uses different processor
2. **Rehype Plugin**: Created HTML AST filter that should work, but GitHub Actions logs show NO console output from plugin - plugins aren't running in production

**Technical Evidence**:
- Local build shows plugin console output: `[LineageFilter] Found marker with depth X`
- GitHub Actions shows zero plugin output, neither remark nor rehype versions
- Live site shows empty `<article>` element but TOC shows all structural headings
- Empty article suggests plugin IS running but filtering everything instead of just columns 1&2

**Files Created**:
- `quartz/plugins/transformers/lineageFilter.ts` - main plugin wrapper  
- `quartz/plugins/transformers/rehypeLineageFilter.ts` - HTML AST filter logic
- Plugin registered in `quartz.config.ts` at line 63

**Next Steps Required**:
- Debug why rehype plugin doesn't run in GitHub Actions (import/export issue?)
- Add aggressive debugging with try-catch blocks around plugin imports
- Check if rehype-raw is available in production environment  
- Fix range detection logic if plugin IS running but filtering too broadly

**User Impact**: High - main site content shows wrong structure to all visitors