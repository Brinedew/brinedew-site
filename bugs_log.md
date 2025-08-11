# Technical Bugs Report
*Generated: 2025-08-11*

## Critical Issues

### 1. Dark Mode Toggle Broken
**Status**: 🔴 Critical  
**File**: `quartz/components/Darkmode.tsx` (likely)  
**Symptoms**: Button state changes from "Dark mode" to "Light mode" but CSS theme doesn't switch. Site remains in dark mode.

**Technical Details**:
- Button DOM element shows `[active]` state when clicked
- Button text updates correctly: "Dark mode" → "Light mode" 
- CSS theme classes not being applied/toggled
- Background remains dark (`#1a1a1a` - dark mode color)
- Text remains light (should be dark in light mode)

**Expected Behavior**: Theme should switch from dark background/light text to light background/dark text

**Investigation Needed**: 
- Check if CSS theme variables are being updated
- Verify theme toggle event handlers
- Inspect browser localStorage theme persistence

---

### 2. Excalidraw Images Not Rendering
**Status**: 🔴 Critical  
**Expected**: Embedded image display  
**Actual**: Text link `Vibes-are-principal-components-2025-07-28-12.52.03.excalidraw`

**Root Cause**: Missing PNG auto-export from Obsidian Excalidraw plugin

**Code Location**: 
```markdown
> [Vibes-are-principal-components-2025-07-28-12.52.03.excalidraw](../assets/images/Vibes-are-principal-components-2025-07-28-12.52.03.excalidraw)
```

**Fix Required**: User must enable PNG auto-export in Obsidian:
1. Obsidian → Settings → Community plugins → Excalidraw
2. ✅ Enable "Auto export PNG" 
3. ✅ Set "Keep same folder as drawing"

---

### 3. Mobile Layout Click Blocking
**Status**: 🟡 High Priority  
**Symptoms**: Explorer sidebar blocks clicks to other UI elements on mobile/narrow viewports

**Technical Details**:
- Playwright timeout errors when clicking elements
- Error: `<div class="explorer-content">...intercepts pointer events`
- Affects dark mode toggle, navigation links, content interactions

**Code Investigation Needed**:
- Check CSS z-index layers in mobile breakpoints
- Review explorer sidebar responsive behavior
- May need CSS fix for `pointer-events` or positioning

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