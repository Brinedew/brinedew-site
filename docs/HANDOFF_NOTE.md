# what i was working on - September 2, 2025

Trying to fix the Lineage plugin single-column display issue that's been breaking the writing workflow for months. The problem was that content with section markers wasn't showing up as a proper 3-column hierarchical tree in Obsidian's Lineage view - instead everything was stuck in a single column.

The bigger issue was that fixing this would break the website content filtering system, which expects content organized in "depth-grouped" order (scaffolding sections 1-2 first, then content sections 3+ later) but Lineage wants to save everything in hierarchical order (1 → 1.1 → 1.1.1 → 1.2).

## what actually works now

Fixed the root cause that prevented Lineage from working at all: wrong attribute names.

**The breakthrough**: Lineage expects `data-section` but all the content was using `data-lineage-section`. Changed all 174 instances with this command:
```bash
cd "D:\Coding\Website\content\posts" && sed -i 's/data-lineage-section="/data-section="/g' the-price-of-not-being-cancer-v3.md
```

Now Lineage can actually parse the sections and shows proper multi-column tree view. You can navigate between sections, see the hierarchical structure, and edit content normally.

Files I changed:
- `content/posts/the-price-of-not-being-cancer-v3.md` - fixed all attribute names, content got reorganized by Lineage to hierarchical order
- `content/posts/lineage-test-post.md` - test file with correct attributes, works perfectly in Lineage view
- `content/.obsidian/plugins/lineage-order-agnostic-shim/main.js` - enhanced with save-path patching to prevent content reorganization
- `bugs_log.md` - marked original issue as resolved, documented new secondary issue

## what's broken

**The shim plugin enhancement doesn't work yet.** I added save-path patching logic to intercept `saveDocument()` and transform content back to depth-grouped order, but it's not preventing the reorganization.

The cancer post is now in hierarchical order when it should be depth-grouped for the website filtering to work. This means the LineageTextFilter can't properly distinguish between scaffolding sections (editorial notes like "[Hook with striking examples]") and actual content sections.

Error symptoms:
- Content opens fine in Lineage (shows proper tree)
- Saving in Lineage view automatically reorganizes from depth-grouped to hierarchical
- Website filtering system expects depth-grouped but gets hierarchical
- Editorial scaffolding may leak back onto the live site

## where things stand

**Lineage plugin functionality**: ✅ Works perfectly - multi-column display, tree navigation, section editing all functional

**Content organization**: ❌ Files get reorganized from depth-grouped to hierarchical when saved in Lineage view

**Website filtering**: ❌ May be broken because content is no longer in expected depth-grouped format

**Shim plugin status**: Enhanced but not working yet - the `saveDocument` patching logic was added but isn't preventing reorganization

Current working commands:
```bash
# Test Lineage functionality
# Open content/posts/lineage-test-post.md in Obsidian Lineage view

# Check if website filtering still works
cd "D:\Coding\Website"
npx quartz build
# Check if brinedew.com/posts/the-price-of-not-being-cancer-v3 shows clean content without editorial scaffolding
```

## what to do next

**Most urgent: Debug why the shim plugin save patching isn't working**

The enhanced shim plugin should intercept `saveDocument()` and transform hierarchical content back to depth-grouped before saving. Check the console logs in Obsidian when saving a Lineage document:

1. Open Developer Tools in Obsidian (Ctrl+Shift+I)
2. Open a file with lineage sections in Lineage view
3. Make a small edit and save
4. Look for console messages starting with "Lineage Shim:"

If you don't see `"INTERCEPTED saveDocument call!"` then the patching isn't working. The logic is in `content/.obsidian/plugins/lineage-order-agnostic-shim/main.js` starting around line 217.

Possible issues:
- Plugin not finding the `saveDocument` method on the view object
- Method signatures changed in Lineage v0.8.5
- Need to patch at a different point in the save pipeline

Alternative approach: Instead of patching individual view instances, might need to patch the Lineage plugin instance itself, or patch `requestSave()` instead of `saveDocument()`.

## stuff to remember

**The real problem was hidden by a simple mistake**: Wrong attribute names prevented Lineage from parsing ANY sections, so all the sophisticated debugging about content ordering and plugin patching was solving the wrong problem. Always check basic assumptions first.

**The transformation logic is sound**: The `groupedToSequential()` and `sequentialToGrouped()` functions work correctly and handle all the edge cases. The issue is just applying them at the right point in Lineage's save pipeline.

**Content filtering depends on depth-grouped organization**: The website's LineageTextFilter expects scaffolding sections (depth 1-2) grouped together first, followed by content sections (depth 3+). Hierarchical organization breaks this filtering.

**Boundary rule to enforce**: Allow rearranging within depth groups (1-2 sections can reorder among themselves, 3+ sections can reorder among themselves) but prevent crossing the boundary between scaffolding and content.

The plugin architecture research was solid - we found the exact intervention points in Lineage's codebase. Just need to get the patching to actually execute during saves.