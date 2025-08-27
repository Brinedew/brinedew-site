# How to Patch Obsidian Lineage Plugin for Order-Agnostic Parsing

The Lineage plugin currently breaks when content isn't in strict document order (parent before child). This patch replaces the order-sensitive parser with one that builds trees by numeric path instead.

## Solution: Replace the Parser

### Step 1: Locate Your Lineage Plugin Installation

The plugin is typically installed in one of these locations:

**Option A: Community Plugin (most common)**
```
~/.obsidian/plugins/obsidian-lineage/main.js
```

**Option B: Within your vault**
```
YourVault/.obsidian/plugins/obsidian-lineage/main.js
```

### Step 2: Find the Plugin Installation Directory

1. Open Obsidian
2. Go to Settings → Community Plugins → Installed Plugins
3. Find "Lineage" and click the gear icon
4. Click "Open plugin folder" - this will show you the exact path

### Step 3: Backup the Original Plugin

```bash
# Make a backup before modifying
cp main.js main.js.backup
```

### Step 4: Method A - Direct File Modification (Simplest)

If you're comfortable editing JavaScript, locate the `outlineToJson` function in `main.js` and replace it with our order-agnostic version.

The current function looks something like:
```javascript
outlineToJson: function(input) {
  // builds tree incrementally, assumes parent before child
}
```

Replace it with the order-agnostic parser from `/scripts/order-agnostic-lineage-parser.ts`.

### Step 5: Method B - Plugin Development Approach (Cleanest)

1. **Clone the Lineage repository:**
```bash
git clone https://github.com/ycnmhd/obsidian-lineage.git
cd obsidian-lineage
```

2. **Replace the parsing logic:**
   - Locate `src/lib/data-conversion/x-to-json/outline-to-json.ts`
   - Replace the entire `outlineToJson` function with our order-agnostic implementation

3. **Build the plugin:**
```bash
npm install
npm run build
```

4. **Install your patched version:**
   - Copy the built files to your Obsidian plugins directory
   - Or use BRAT to install from your fork

## The Key Changes

### Original Lineage Logic (Order-Dependent)
```javascript
// Processes line-by-line, builds hierarchy incrementally
lines.forEach(line => {
  if (isSection) {
    addNewNode(tree, parents, level, content);
    // Assumes parents exist before children
  }
});
```

### New Order-Agnostic Logic
```javascript
// Two-pass approach:
// Pass 1: Parse all sections into registry
// Pass 2: Build hierarchy by numeric relationships

// 1. Collect all sections regardless of order
const sections = parseSections(input);

// 2. Build parent-child relationships by section ID
for (const section of sections) {
  const parentId = getParentId(section.id); // "1.1.1" → "1.1"
  if (parentExists(parentId)) {
    attachChild(parentId, section);
  }
}
```

## Testing the Patch

1. **Create a test file with out-of-order sections:**
```markdown
<span data-lineage-section="1"></span>
## Section 1

<span data-lineage-section="2"></span>
## Section 2  

<span data-lineage-section="1.1.1"></span>
Content for 1.1.1 (appears before 1.1!)

<span data-lineage-section="1.1"></span>
### Subsection 1.1
```

2. **Open with patched Lineage plugin**
3. **Verify the hierarchy displays correctly:**
   - Section 1
     - Subsection 1.1
       - Content for 1.1.1

## Alternative: Plugin Wrapper Approach

If you don't want to modify Lineage directly, create a small helper plugin that preprocesses files for Lineage:

```javascript
// In your helper plugin's main.ts:
export default class LineagePreprocessor extends Plugin {
  async onload() {
    this.addCommand({
      id: 'open-for-lineage',
      name: 'Open for Lineage (reordered)',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        const content = await this.app.vault.read(file);
        const reordered = virtuallyReorderForLineage(content);
        
        // Create temporary file and open in Lineage
        await this.createTempFileForLineage(reordered, file.basename);
      }
    });
  }
}
```

## Why This Works

The patched parser:

1. **Scans the entire document first** - builds a complete registry of all sections
2. **Creates placeholder parents** - if section "1.1.1" exists but "1.1" doesn't, creates "1.1" automatically  
3. **Builds relationships by ID structure** - "1.1.1" belongs under "1.1" regardless of document position
4. **Sorts everything numerically** - final tree is in logical order even if source isn't

This allows you to keep your optimized document structure (outline first, content second) while still getting proper Lineage functionality.

## Troubleshooting

**Plugin won't load after modification:**
- Check browser console (Ctrl+Shift+I) for JavaScript errors
- Restore from backup and try again
- Consider using the plugin wrapper approach instead

**Hierarchy still broken:**
- Verify your span markers use the exact format: `<span data-lineage-section="1.2.3"></span>`
- Check that section IDs are purely numeric with dots: `1`, `1.1`, `1.1.1`

**Performance issues:**
- The new parser is O(N) in number of sections, same as original
- Your ~174 sections should have no noticeable performance impact

## Success Criteria

After patching, you should be able to:
1. Keep your current essay structure (grouped by depth) 
2. Open it in Lineage and see proper hierarchical tree
3. Navigate and edit sections in Gingko-style interface
4. Have changes save back to your original file structure