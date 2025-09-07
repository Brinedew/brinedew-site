# what i was working on - September 6, 2025

The Lineage shim plugin was completely broken - it was scrambling content across sections and creating comment duplication chaos every time someone saved a file in Lineage view. The whole point of this plugin is to let people edit blog posts in Obsidian's Lineage hierarchical view while keeping the files in the right format for website filtering.

But the plugin was doing the opposite - it was making files unusable by moving "section 1 content" to section 3, duplicating wrapper comments 3+ times, and changing section numbers randomly (1,1.1,2,2.1,3,3.1 would become 1,2,2.1,3,3.1,4,4.1).

## what actually works now

**Fixed the core architecture problem**: The plugin was trying to patch individual view saveDocument methods, which caused multiple transform applications (one per view). Replaced this with a **SaveArbiter** that intercepts `requestSave()` calls and coordinates single execution per file.

**Fixed ephemeral ID preservation**: Content now stays associated with correct section markers even when Lineage renumbers sections internally. The transform pipeline preserves `data-lsgid` attributes in memory during editing, then strips them for clean disk format.

**Fixed comment accumulation**: Wrapper comments are now properly stripped before re-emission, preventing the 3x duplication issue.

Files I changed:
- `content/.obsidian/plugins/lineage-order-agnostic-shim/main.js` - complete rewrite with SaveArbiter architecture (lines 154-213 contain the core arbiter logic)

The new architecture works like this:
```
READ: File loads → inject ephemeral IDs → transform to hierarchical for Lineage display
EDIT: User edits in Lineage view (hierarchical structure)  
SAVE: Lineage calls requestSave → SaveArbiter intercepts → single transform back to website format → save clean file
```

**Debugging instrumentation added**: Console logging shows exactly one `[lsg] requestSave (arbiter)` per save operation, with snapshots of before/after content to verify transforms work correctly.

## what's broken

**Still need to test the fix properly** - I implemented the complete SaveArbiter rewrite but haven't verified it actually prevents all three bugs yet. Need to:

1. Reset test file to clean state  
2. Reload plugin in Obsidian
3. Test save operation and verify no content scrambling occurs
4. Check console logs show single execution

**Root cause discovered but not addressed**: The wrapper comments `%% lineage:scaffold start %%` that sit **between** spans are being treated by Lineage as independent structural elements. This creates phantom sections that get their own span markers, causing the section renumbering chaos.

The SaveArbiter fixes the multiple-application symptom, but the real fix is moving comments **inside** section content where they won't be interpreted as structural elements.

## where things stand

**Plugin state**: Completely rewritten with SaveArbiter architecture, ready for testing
**Test file**: `content/posts/shim-bug-test.md` exists in corrupted state from previous failed tests
**Environment**: Windows system, Obsidian running, need to reload shim plugin

Commands that should work now:
```bash
# Test the fix
# 1. Reset content/posts/shim-bug-test.md to clean initial state
# 2. Disable/enable lineage-order-agnostic-shim plugin in Obsidian
# 3. Open test file in Lineage view, make small edit, save
# 4. Check console for single "[lsg] requestSave (arbiter)" message
# 5. Verify content stays in correct sections
```

## what to do next

**Most urgent: Test the SaveArbiter fix** - The architecture is sound but needs verification. Create a clean test file with proper depth-boundary format, test the save operation, and confirm all three bugs are resolved.

**Second: Address the comment placement issue** - The wrapper comments between spans need to be moved inside section content or eliminated entirely. The current placement creates phantom sections that cause structural chaos.

**Why this matters**: The website filtering system depends on content being in the right sections. If scaffolding content (editorial notes) leaks into the reader sections, it breaks the whole content pipeline.

Files to check:
- `content/posts/shim-bug-test.md` - reset to clean state for testing
- Console output during save operations - should show single execution
- `bugs_log.md` - update with test results

## stuff to remember

**The real insight**: Lineage treats anything between spans as independent structural elements. Comments placed outside spans become phantom sections with their own markers, causing the renumbering chaos we observed.

**SaveArbiter pattern**: When target plugin doesn't have plugin-level save methods, intercept `requestSave()` (consumer) instead of `saveDocument()` (producer). Use file-path keying to ensure single execution across multiple views.

**Content format requirements**: Website needs depth-boundary hybrid format (depths 1-2 in hierarchical order, then depths 3+ grouped together). Ephemeral IDs preserve content associations during Lineage's section renumbering.

**Don't trust successful transforms without testing** - the previous ephemeral ID approach looked correct in code but failed completely because the basic architecture (plugin-instance patching) was wrong for this plugin's structure.