# B-184: All 3D viewers reload on clue reveal and guess

## FACTS (verified)
- B-179 fixed this same symptom on 2025-12-01
- B-179 root cause: double `render()` calls - `requestHintReveal()` called render, then `activateSpoiler()` also called render
- B-179 fix: make `requestHintReveal()` just return payload, `activateSpoiler()` is single owner of render
- B-179 fix is STILL IN PLACE - checked line 1190-1197
- `renderGuessesSection()` has optimization to only append new guess cards (lines 3371-3377)
- `renderClueSectionsIntoDom()` has viewer preservation logic (lines 3278-3290)

## ROOT CAUSE FOUND

The viewer preservation logic in `renderClueSectionsIntoDom` (lines 3278-3290) temporarily **removes the viewer from DOM** to preserve it:

```javascript
} else if (existingViewer && !gameOver) {
  preservedViewer = existingViewer;
  preservedViewer.remove();  // <-- REMOVES FROM DOM - causes black flash
}
slot.innerHTML = renderClueCard(gameOver);  // Replaces entire slot
if (preservedViewer) {
  newViewerShell.replaceWith(preservedViewer);  // Puts it back
}
```

Even though the viewer is "preserved" (same DOM element, not reloaded), the **momentary removal from DOM causes Mol* to show black**. WebGL contexts may detect parent removal and trigger re-render.

## PROPOSED FIX

Instead of replacing the entire clue card and preserving the viewer, **only update the sections that changed**:

Option A: Surgical DOM update
```javascript
// Only update the sections container, not the structure viewer
const sectionsContainer = document.querySelector('.pg-clue-sections');
if (sectionsContainer) {
  sectionsContainer.innerHTML = renderClueSectionsHtml();
  return;  // Don't touch the structure viewer at all
}
```

Option B: Use CSS to hide during transition (bandaid)
```css
.pg-clue-structure { transition: opacity 0.1s; }
```

**Recommendation: Option A** - never remove the viewer from DOM during hint reveals.

## THEORIES (unverified - need 5+)

1. ~~**B-179 fix was reverted** - someone undid the commit~~ ELIMINATED - fix still present
2. ~~**New code path added** - a different function now calls render() during hint reveal~~ UNLIKELY - only one render() call
3. ~~**Guess submission has same bug**~~ ELIMINATED - only one render() call
4. **[LIKELY] targetStructureInfo cache invalidated** - line 2486 clears it on every hydration
5. ~~**Collapse/expand triggers re-init**~~ NOT INVESTIGATED YET
6. ~~**DOM manipulation destroys viewers**~~ PARTIALLY - but preservation logic exists

## PROPOSED FIX

Don't clear `targetStructureInfo` unconditionally. Only clear if the target protein actually changed.

Current (line 2486):
```javascript
targetStructureInfo = null;
```

Fix:
```javascript
// Only clear structure info if target actually changed
const newTargetId = payload.clueTarget?.uniprot || payload.status?.targetId;
if (targetStructureInfo && newTargetId !== targetStructureInfo.targetId) {
  targetStructureInfo = null;
}
```

Or simpler - just remove the line entirely since structure should persist for the same game session.

## LOG

Test 1: Verify B-179 fix - PASSED, fix still present
Test 2: Check guess submission - PASSED, only one render() call
Test 3: Found cache invalidation bug at line 2486

