# Website Content Folder Flattening Sprint

**Status**: 🟡 Ready for Development  
**Goal**: Flatten categorical folders into tag-based organization  
**Timeline**: ~2-3 hours estimated effort  

## What We're Actually Doing

**Current state**: Content is scattered across categorical folders: `Misconceptions/`, `Recommendations/`, `models/`, `resources/`  
**Target state**: Flat structure in `posts/` with frontmatter tags for organization, following the pattern already established for `wiki/`

**Philosophy**: Use minimal folders (`posts/`, `wiki/`, `apps/`) with rich tagging instead of nested folder hierarchies. This matches Obsidian's strength in tag-based organization.

## Current Structure Analysis

### Already Flattened ✅
- `wiki/` - Uses tag taxonomy: `type/wiki`, `category/concept|mechanism|theory`, `topic/aging|cancer|biology`, `status/stub|complete`
- `posts/` - Some content already tagged with `type/post`
- `apps/` - Should remain as separate folder for functional apps

### Need Flattening 🎯
- `Misconceptions/` (5 files) → Move to `posts/` with `type/misconception` tag
- `Recommendations/` (1 file) → Move to `posts/` with `type/recommendation` tag  
- `models/` (1 file) → Move to `posts/` with `type/model` tag
- `resources/` (1 file) → Move to `posts/` with `type/resource` tag

### Keep As-Is 📌
- `assets/`, `images/`, `stylesheets/` - Infrastructure folders
- `drafts/` - Working area folder
- `Attachments/` - Even if empty, may be used by Obsidian
- `tags/` - Contains Quartz component documentation

## Tag Taxonomy Extension

### Current Working Taxonomy
```yaml
# Type classification
type/wiki          # Knowledge base entries
type/post          # Blog posts
type/app           # Interactive applications

# Content categorization (wiki-specific)
category/concept   # Ideas and definitions  
category/mechanism # How things work
category/theory    # Explanatory frameworks

# Topic areas
topic/aging        # Aging research
topic/cancer       # Cancer research  
topic/biology      # General biology
topic/longevity    # Longevity interventions

# Content status
status/stub        # Incomplete content
status/complete    # Finished content
status/published   # Published posts
```

### Extensions for Flattened Content
```yaml
# New content types
type/misconception # Common misconceptions to debunk
type/recommendation # Curated recommendations  
type/model         # Interactive models/simulations
type/resource      # Reference materials and links

# Additional topic areas (as needed)
topic/research     # Research methodology
topic/interventions # Specific interventions
```

## Sprint Epics

### Epic 1: Content Migration 🟢 **HIGH IMPACT**

**Goal**: Move all categorical folder content to `posts/` with proper tagging

**Tasks**:
1. **Audit current content**
   - List all files in `Misconceptions/`, `Recommendations/`, `models/`, `resources/`
   - Check current frontmatter tags in each file
   - Note any special formatting or metadata

2. **Migrate Misconceptions folder**
   - Move 5 files from `Misconceptions/` to `posts/`
   - Add `type/misconception` tag to frontmatter
   - Keep existing `topic/aging`, `topic/longevity` tags
   - Preserve `status/published` where present

3. **Migrate other categorical folders**
   - Move `Recommendations/Papers.md` → `posts/` with `type/recommendation`
   - Move `models/evolution-demo.md` → `posts/` with `type/model`  
   - Move `resources/longevity-research.md` → `posts/` with `type/resource`

**Effort**: 1 hour  
**Success Criteria**: All categorical folders empty, content in `posts/` with proper tags

---

### Epic 2: Link Updates and Validation 🟡 **CRITICAL FOR STABILITY**

**Goal**: Fix all internal links broken by the folder flattening

**Tasks**:
1. **Find all references to moved content**
   - Search for links to `Misconceptions/`, `Recommendations/`, etc.
   - Check navigation configs in `quartz.config.ts`
   - Look for hardcoded folder references

2. **Update markdown links**
   - Convert `[text](../Misconceptions/file.md)` → `[text](file.md)`
   - Update any wikilinks `[[Misconceptions/file]]` → `[[file]]`
   - Test all updated links work correctly

3. **Update site navigation**
   - Verify Quartz generates correct navigation from new structure
   - Check that tag-based organization works in the UI
   - Test search and filtering by tags

**Effort**: 1 hour  
**Success Criteria**: No broken links, navigation works correctly

---

### Epic 3: Documentation and Cleanup 🔵 **MAINTENANCE**

**Goal**: Update documentation and clean up empty folders

**Tasks**:
1. **Update content CLAUDE.md**
   - Document new tag taxonomy extensions
   - Update file organization guidelines
   - Add examples of proper frontmatter for new content types

2. **Clean up empty folders**
   - Remove empty `Misconceptions/`, `Recommendations/`, `models/`, `resources/` folders
   - Update `.gitignore` if needed
   - Verify no important hidden files left behind

3. **Test complete workflow**
   - Build site locally with `npx quartz build`
   - Verify all content displays correctly
   - Test that tag-based organization works for content discovery

**Effort**: 30 minutes  
**Success Criteria**: Clean folder structure, updated docs, working site build

## Migration Command Pattern

For each folder migration:
```bash
# Move file with git to preserve history
git mv content/Misconceptions/aging-is-a-disease.md content/posts/aging-is-a-disease.md

# Update frontmatter (example)
# OLD:
tags: [topic/aging, topic/longevity, status/published]

# NEW: 
tags: [type/misconception, topic/aging, topic/longevity, status/published]
```

## Technical Considerations

### Link Update Strategy
- Use grep to find all references: `grep -r "Misconceptions/" content/`
- Update relative paths systematically
- Test each change with local build

### Frontmatter Preservation
- Keep existing topic and status tags
- Add type classification without removing context
- Maintain date fields and other metadata

### Quartz Navigation
- Quartz auto-generates navigation from folder structure
- Tag-based filtering happens through frontmatter
- No manual navigation configuration needed

## Risk Assessment

**Low Risk**: File moving (git preserves history)  
**Medium Risk**: Link updates (systematic approach mitigates this)
**Low Risk**: Navigation changes (Quartz handles automatically)

**Mitigation**: Test site build after each epic completion

## Success Metrics

**Epic 1 Complete**: All categorical content moved to `posts/` with correct tags  
**Epic 2 Complete**: All internal links work, navigation displays correctly  
**Epic 3 Complete**: Clean folder structure, updated documentation

**Sprint Success**: Content organized by tags instead of folders, following established wiki pattern

---

*Sprint planned: August 17, 2025*  
*Following established wiki flattening pattern with tag-based organization*