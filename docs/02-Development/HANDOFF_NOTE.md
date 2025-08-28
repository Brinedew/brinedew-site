# what i was working on - august 27, 2025

Started with sprint planning but ended up solving a much bigger problem: how to make Lineage plugin work with content that's organized by depth instead of hierarchical order.

The user has a long essay where sections 1-2 are editorial scaffolding (signposts, transitions) and sections 3+ are actual content. This separation helps LLMs work on one layer at a time. But Lineage expects standard tree order (1 → 1.1 → 1.1.1 → 1.2), so it couldn't build the tree correctly from grouped content.

Got a consultation from an expert who provided a complete architectural solution based on stable UIDs and deterministic normalization. The approach is solid - single source of truth, idempotent operations, explicit state. But the implementation has a bug.

## what actually works now

**Fixed mobile/desktop git sync issue**: Added `content/.obsidian/plugins/obsidian-git/` to `.stignore` so the git plugin only exists on PC. Mobile devices get full Obsidian functionality without git interference.

**Updated all documentation**: `Website/CLAUDE.md` now reflects actual current setup instead of outdated workflow docs:
- Single shared vault in `content/` folder (not separate mobile/desktop configs)
- Flat wiki structure with 65+ entries using tags instead of folders  
- Working QuickAdd automation with proper templates
- 22 active plugins documented with their actual purposes

**Modernized tag taxonomy**: Bulk renamed all `type/*` tags to `content/*` across entire site:
- `type/post` → `content/post` (11 files updated)
- `type/wiki` → `content/wiki` 
- `type/apps` → `content/apps`

Used proper Python script (`scripts/rename-type-to-content.py`) with automatic backups. All QuickAdd templates work correctly with new taxonomy.

**Built Lineage normalization core logic**: Created the foundation for bidirectional editing with grouped-by-depth content:

- `scripts/lineage-core.ts` - parsing and normalization functions (300 lines)
- `scripts/lineage-normalizer-plugin.ts` - complete Obsidian plugin (200+ lines)
- `scripts/test-lineage-normalization.cjs` - test suite validating core logic

The system assigns stable UIDs to sections (`data-lineage-uid`) and can reconstruct proper tree view regardless of document order.

**Commands that work:**
```bash
cd "D:\Coding\Website"
python scripts/rename-type-to-content.py  # completed successfully, 11 files updated
node scripts/test-lineage-normalization.cjs  # runs tests, shows structure working
npx quartz build  # builds site with new tag structure
```

## what's broken

**Critical idempotency bug**: The normalization function isn't idempotent - running it twice produces different output. Test shows:
- First normalization: 1236 characters
- Second normalization: 1344 characters  
- Difference appears around line 14 in output

This breaks the core requirement that normalize-on-save should be safe to run repeatedly.

**Lineage integration incomplete**: Built the order-agnostic parser but never hooked it into actual Lineage plugin. The tree builder exists but needs to replace Lineage's default conversion function.

**Plugin not deployed**: The normalizer plugin is TypeScript that needs compilation and installation in Obsidian. Architecture is complete but not tested in real environment.

**Test failure details:**
```bash
node scripts/test-lineage-normalization.cjs
# Look for "Normalization is idempotent: false"  
# Shows where first vs second run differ
```

## where things stand

**Git repo clean**: All changes pushed to main branch (commit 2190308). GitHub Actions deployed tag taxonomy changes to live site successfully.

**Content structure solid**:
- 110 markdown files processed without corruption
- Flat wiki with proper tag organization working
- QuickAdd templates generating correct frontmatter with `content/*` tags
- Mobile/desktop sync working properly

**Development environment ready**:
- Node.js project with TypeScript setup
- Script infrastructure with proper backup patterns  
- Test framework validates most core logic (except idempotency)

## what to do next

**Fix the idempotency bug first** - this is blocking everything else. The bug is in `scripts/test-lineage-normalization.cjs` around the normalization logic.

Debug approach:
1. Check if `assignUidsOnce` is being called multiple times when UIDs already exist
2. Look at whitespace handling in `emitSection` function - likely adding extra newlines
3. Compare the two normalization outputs character by character to find exact difference

The consultant's architecture is right, but we violated the idempotent property somewhere in the implementation.

**Then integrate with Lineage** - once normalization works reliably, hook the order-agnostic parser into Lineage. The consultant provided three approaches:
- Virtual file (create temporary sequential version for Lineage)
- Fork Lineage and replace tree builder
- Runtime monkey-patch (riskiest but no fork needed)

## stuff to remember

**The consultant's insight was brilliant**: Use stable UIDs for identity, keep layout implicit through deterministic normalization. Avoids "two files get out of sync" problem completely. This is the Carmack approach - explicit state, simple linear passes, idempotent operations.

**Why the grouped structure matters**: The depth separation (1-2 scaffold, 3+ content) isn't just for Lineage. It lets LLMs work on editorial layer separately from content layer, which is crucial for the writing workflow.

**Don't trust passing tests yet**: The "scaffold first" test passed but idempotency failed, meaning the core operation isn't solid. Fix the fundamental correctness issue before adding Lineage integration complexity.

**The architecture is right**: Single source of truth with stable UIDs and normalized layout. The implementation just has a basic bug that needs fixing.

Next person should focus on making normalization actually idempotent before attempting any Lineage integration. The foundation is good but needs to be rock-solid first.