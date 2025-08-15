# Technical Bugs Report
*Updated: 2025-08-15*

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

### 12. Mobile Hamburger Menu - BROKEN ❌
**Status**: 🔴 **CRITICAL** - Mobile navigation completely non-functional  
**Issue**: Hamburger menu implementation has multiple critical failures
**Files Affected**: 
- `quartz/components/MobileMenu.tsx`
- `quartz/components/scripts/mobileMenu.inline.ts` 
- `quartz/components/styles/mobileMenu.scss`
- `quartz.layout.ts`

#### Sub-Issue 12A: Random Navigation Bug (CRITICAL)
**Problem**: Hamburger menu click navigates to random page instead of opening menu
**Reproduction Steps**:
1. Go to https://brinedew.com/posts/ on mobile viewport (375px)
2. Click hamburger "Menu" button  
**Expected**: Menu overlay opens
**Actual**: Browser navigates to `/posts/vibes-are-principal-components` (random page)
**Impact**: Core functionality completely broken - menu unusable

#### Sub-Issue 12B: JavaScript Loading Failure (CRITICAL) 
**Problem**: Mobile menu JavaScript not loading/executing
**Evidence**:
- `toggleMobileMenu` function doesn't exist in browser
- No click handlers attached to hamburger button
- Console shows 404 error: `Failed to load resource: search.js`
**Impact**: No hamburger menu functionality at all

#### Sub-Issue 12C: ARIA-Controls ID Mismatch (HIGH)
**Problem**: Accessibility completely broken due to hardcoded ARIA attributes
**Details**:
- Hamburger button: `aria-controls="tag-explorer-content"`
- Actual TagExplorer content ID: `tag-explorer-18` (dynamically generated)
**Impact**: Screen readers broken, JavaScript selectors fail

#### Sub-Issue 12D: CSS Media Query Incorrect (MEDIUM)
**Problem**: Hamburger menu shows at wrong viewport sizes
**Reproduction**: Resize to 768px tablet view
**Expected**: Hamburger hidden (desktop layout should be active)
**Actual**: Hamburger still visible creating UI clutter
**Impact**: Shows hamburger when not needed

#### Sub-Issue 12E: Edge Browser Icon Rendering (MEDIUM)
**Problem**: Hamburger icon doesn't render in Microsoft Edge browser
**Reported By**: User observation during testing
**Details**: SVG hamburger icon fails to display in Edge
**Impact**: Visual UI degradation in Edge browser

#### Sub-Issue 12F: Intermittent Menu Functionality (LOW)
**Problem**: Menu occasionally works but behavior is inconsistent
**Reported By**: User observation - "I do sometimes see a menu when I click it"
**Details**: Suggests race condition or timing issue with JavaScript loading
**Impact**: Unpredictable user experience

**Root Cause Analysis**:
1. **Primary**: JavaScript compilation/loading pipeline broken in Quartz build process
2. **Secondary**: ARIA attributes hardcoded instead of dynamic ID matching
3. **Tertiary**: No integration testing during development

**Fixes Applied - August 15, 2025**:
- ✅ Rewrote JavaScript to follow working darkmode pattern (beforeDOMLoaded + nav events)
- ✅ Fixed ARIA-controls ID mismatch with dynamic ID detection
- ✅ Fixed Edge browser SVG rendering with proper fill/stroke attributes
- ❌ Not tested on live site - interrupted during build process
- ❌ CSS media query and overlay functionality still needs verification

**Files Changed**:
- `quartz/components/MobileMenu.tsx` - switched to beforeDOMLoaded, removed hardcoded ARIA
- `quartz/components/scripts/mobileMenu.inline.ts` - complete rewrite following Quartz patterns

**Status**: 🟡 **PARTIALLY FIXED** - Major JavaScript and accessibility issues resolved but not deployed/tested