# Technical Bugs Report
*Updated: 2025-08-11*

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

## Critical Issues - STILL BROKEN

### 3. Mobile Click Blocking - UNFIXED 🔴
**Status**: 🔴 Critical - **NOT ADDRESSED YET**
**File**: `quartz/components/styles/explorer.scss` lines 213-266
**Symptoms**: Explorer sidebar blocks clicks to UI elements on mobile viewports

**Root Cause**: Explorer overlay uses wrong positioning (`position: absolute` vs `position: fixed`) and incorrect CSS selectors.

**Fix Available**: Replace mobile CSS block with corrected version (documented in handoff note).

**Priority**: High - affects mobile usability

---

### 4. Excalidraw Images Not Rendering 
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