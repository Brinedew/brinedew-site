# Technical Bugs Report
*Generated: 2025-08-11*

## Critical Issues - STILL BROKEN

### 1. Dark Mode Toggle STILL BROKEN
**Status**: 🔴 Critical - **ATTEMPTED FIX FAILED**
**File**: `quartz/components/Darkmode.tsx` and CSS theme variables  
**Symptoms**: Button state changes correctly but visual theme does not switch. Site remains stuck in dark mode.

**What Claude Code Attempted**:
- ❌ Claimed mobile click blocking was the issue - WRONG
- ❌ Added `pointer-events: none/auto` to explorer CSS - DID NOT FIX THE ACTUAL PROBLEM
- ❌ Verified CSS theme variables exist in config - STILL NOT WORKING
- ❌ Confirmed JavaScript DOM manipulation works - VISUAL THEME STILL BROKEN

**Actual Technical Status**:
- ✅ Button DOM element shows `[active]` state when clicked
- ✅ Button text updates correctly: "Light mode" ↔ "Dark mode"
- ❌ CSS theme variables not being applied to change visual appearance
- ❌ Background remains dark (`#1a1a1a`) regardless of button state
- ❌ Text colors do not switch between light/dark themes

**Real Root Cause**: Unknown - CSS theme switching mechanism is broken
**Investigation Still Needed**: 
- Check if `saved-theme` attribute is actually being set on `document.documentElement`
- Verify CSS selectors `:root[saved-theme="light"]` and `:root[saved-theme="dark"]` are working
- Debug if theme CSS is being loaded/applied correctly
- Check browser developer tools for CSS loading issues

---

### 2. Mobile Click Blocking - **FALSELY CLAIMED AS FIXED**
**Status**: 🔴 Critical - **ATTEMPTED FIX DID NOT WORK**
**Symptoms**: Explorer sidebar STILL blocks clicks to UI elements on mobile

**What Claude Code Attempted**:
- ❌ Added `pointer-events: none` to collapsed explorer CSS
- ❌ Claimed the fix worked based on button state change - WRONG
- ❌ Confused button JavaScript working with actual click accessibility - WRONG

**Actual Technical Status**:
- ❌ Dark mode button still shows Playwright timeout errors on mobile
- ❌ Error: `<div class="explorer-content">...intercepts pointer events` STILL OCCURS
- ❌ Mobile users still cannot reliably click UI elements
- ❌ CSS z-index and pointer-events issues NOT RESOLVED

**Real Root Cause**: CSS fixes were not properly applied or are insufficient
**Investigation Still Needed**:
- Check if CSS changes actually deployed to live site
- Verify explorer overlay positioning on mobile viewports
- Debug z-index stacking context issues
- Test actual mobile touch interactions, not just desktop simulation

---

### 3. Excalidraw Images Not Rendering
**Status**: 🟡 Medium Priority - **DOCUMENTATION UPDATED ONLY**
**Expected**: Embedded image display  
**Actual**: Text link `Vibes-are-principal-components-2025-07-28-12.52.03.excalidraw`

**What Claude Code Did**:
- ✅ Added setup instructions to CLAUDE.md
- ❌ Did not actually fix any code or test the solution

**Root Cause**: Missing PNG auto-export from Obsidian Excalidraw plugin
**Fix Required**: User must enable PNG auto-export in Obsidian:
1. Obsidian → Settings → Community plugins → Excalidraw
2. ✅ Enable "Auto export PNG" 
3. ✅ Set "Keep same folder as drawing"

---

## Feature Requests

### 4. Remove Graph View Component ✅ COMPLETED
**Status**: ✅ Completed  
**Files Modified**: `quartz.layout.ts:44`
**Action**: Removed `Component.Graph()` from `defaultContentPageLayout.right[]` array

---

## Configuration Issues

### 5. Package.json Script Path Issue  
**File**: `package.json:16`
**Current**: `"docs": "npx quartz build --serve -d docs"`
**Issue**: Content moved from `docs/` to `content/` during migration  
**Fix**: Update to `"docs": "npx quartz build --serve"` or point to correct directory

---

## Working Features ✅
- Search functionality with highlighting
- SPA navigation and breadcrumbs  
- Content rendering and markdown processing
- Explorer sidebar structure display
- Site architecture and content organization

---

## Investigation Priority
1. **Dark mode CSS debugging** - Check theme toggle implementation
2. **Mobile responsive layout** - Fix click blocking issues  
3. **Excalidraw workflow** - Verify PNG export process
4. **Layout cleanup** - Remove graph view, fix responsive issues