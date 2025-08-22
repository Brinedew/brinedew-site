# TagExplorer debugging - aug 22, 2025

I was debugging a really weird persistence bug in the TagExplorer sidebar. Some nested tags remember their collapsed state when you navigate between pages, others completely reset to expanded every time.

## what actually works now

**Main Tags header persistence is FIXED**: Clicking the "Tags" title now properly collapses/expands the entire sidebar and remembers that state across page navigation.

Root cause was hardcoded `aria-expanded="true"` in the TSX template fighting with JavaScript state management. Every page load would reset it to expanded.

Files I changed:
- `quartz/components/TagExplorer.tsx` line 243: removed hardcoded `aria-expanded="true"` attribute
- `quartz/components/scripts/tagExplorer.inline.ts` lines 109-131: added `toggleTagExplorer()` function with localStorage persistence
- JavaScript now fully manages the aria-expanded state and restores it immediately on page load

**Hover state visual feedback is FIXED**: The CSS cascade conflict is resolved.

Root cause was parent `.tag-container:hover` opacity blocking child highlights with CSS opacity inheritance. When parent is 80% opaque, child can never be more opaque.

Files I changed:
- `quartz/components/styles/tagExplorer.scss` lines 89-118: removed parent hover opacity, moved expanded tag selector outside container block
- Now collapsed tags dim on hover (toggle behavior), expanded tag names show teal highlight (link behavior), arrows always dim (toggle behavior)

**Commands that work**:
```bash
cd "D:\Coding\Website"
npx quartz build
git status  # everything committed and deployed
```

Both fixes are live at brinedew.com and working correctly.

## what's broken right now

**CRITICAL: Nested tag persistence is partially broken**. This is the main issue blocking everything.

**What works**: "aging", "topic" level tags, main header persistence
**What's broken**: "glossary" and "protein" tags completely reset to expanded on every page navigation

I can reproduce this 100%:
1. Go to brinedew.com/posts/aging-is-a-disease  
2. Expand the Tags sidebar
3. Click "glossary" arrow → collapses (46 protein links disappear)
4. Click "protein" arrow → collapses (46 protein links disappear)  
5. Navigate to ANY other page
6. Both "glossary" and "protein" are expanded again, but "aging" stays collapsed

**Technical evidence**: Using browser dev tools I verified:
- localStorage "TagExplorer.expandedTags" is being written correctly
- Click handlers fire and call toggleTagSection() properly
- CSS classes `.tag-expanded` and `.tag-collapsed` apply correctly
- Some tags persist ("aging") while others don't ("glossary", "protein")

This suggests a mismatch in localStorage key generation or restoration logic for certain tag types.

## where things stand

**Environment**: Website builds and deploys perfectly, Quartz 4.5.1 working fine

**Current state**: 
- Main sidebar functionality works great
- Visual feedback is correct  
- Deployment pipeline works in ~60 seconds
- Just this persistence selectivity bug remains

**Debugging commands I was using**:
```javascript
// In browser console to check localStorage
JSON.parse(localStorage.getItem("TagExplorer.expandedTags"))

// To check DOM attributes for working vs broken tags  
document.querySelectorAll('.tag-container').forEach(el => {
  console.log(el.getAttribute('data-tag'), el.closest('.tag-group').classList)
})
```

## what to do next

**Most urgent**: Debug why some nested tags persist and others don't.

The selectivity is the key clue - it's not a complete localStorage failure since "aging" works. There's probably a subtle difference in how "glossary"/"protein" vs "topic/aging" tag paths are handled.

Debugging approach:
1. Compare the exact localStorage keys being saved vs restored for working ("aging") vs broken ("glossary") tags
2. Check if the issue is in tag path normalization in `tagExplorer.inline.ts` around lines 35-42 and 99-124
3. Look for differences in DOM structure or data-tag attributes between working and broken tags

The restoration logic in `setupTagExplorer()` around line 140-160 is where I'd focus - it handles loading saved state and might have a logic error for certain tag types.

**Secondary**: There's still a blocked Sprint 4 for YouTube transcription (separate Flask backend issue), but fixing this persistence bug is much more important since it affects the core site navigation.

## stuff to remember  

**Why some tags work and others don't**: Still unknown - this is the mystery that needs solving. The pattern suggests tag path or type-specific logic error, not architectural problem.

**The CSS opacity cascade issue**: Fixed by understanding that parent opacity always limits child opacity regardless of child CSS rules. Had to restructure the selectors to avoid parent-child opacity conflicts.

**SPA navigation patterns**: Quartz requires "nav" event listeners, not DOMContentLoaded. Most online examples use wrong pattern for Quartz components.

**Deployment is solid**: GitHub Actions + Quartz builds work reliably. Changes are live in about a minute with good error reporting.

The main handoff item is that persistence bug - it's a logic error somewhere in the save/restore cycle, and the selectivity (some work, others don't) means it's debuggable with the right approach.