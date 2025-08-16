# Wiki flattening migration hit script issues - August 16, 2025

I was working on flattening the website's wiki structure from a rigid folder hierarchy (6+ levels deep) to a tag-based flat organization. The goal was moving everything from nested folders like `wiki/concepts/`, `wiki/mechanisms/`, `wiki/theories/` etc. to just `wiki/` root with rich tagging instead.

## what actually works now

**Frontmatter corruption completely fixed**: Had systematic corruption where date and tags fields got merged like `date: "2025-08-10tags: [...]"`. Fixed this surgically using MultiEdit tool - much more efficient than my original v2 file approach.

**16 files successfully migrated**: My first migration script (scripts/flatten-wiki.cjs) worked perfectly for the files I mapped:
- All concept files moved from `wiki/concepts/` to `wiki/`
- All mechanism files moved from `wiki/mechanisms/` to `wiki/`  
- All theory files moved from `wiki/theories/` to `wiki/`
- All organism files flattened from `wiki/organisms/cancer-lineages/` to `wiki/`
- All protein files moved from `wiki/proteins/oncogenes/` to `wiki/`

**Tags working perfectly**: Files now have proper tag taxonomy:
- `type/wiki` for all wiki content
- `category/concept`, `category/mechanism`, `category/theory` etc.
- `topic/aging`, `topic/cancer`, `topic/biology` for subjects
- `status/stub`, `status/complete` for content maturity

**URL aliases preserved**: Every moved file has aliases like:
```yaml
aliases:
  - wiki/concepts/death-pact
  - concepts/death-pact
```

**Verification commands that work**:
```bash
cd "D:\Coding\Website\content"
find . -type f -name "*.md" | wc -l  # Still 72 files
du -sh .  # Still 26MB total
```

## what's broken

**Cleanup script failing**: Consultant provided an advanced discovery-based script (scripts/flatten_wiki.cjs) to finish the job, but it crashes when trying to write reports:

```
Error: ENOENT: no such file or directory, open 'D:\Coding\Website\content\wiki\_reports\actions_*.json'
```

Even after creating `wiki/_reports`, `wiki/_backups`, `wiki/_conflicts` directories, it still fails.

**Leftover mess from partial migration**:
- `wiki/concepts/` has leftover index.md and .backup files
- `wiki/mechanisms/` has cellular-senescence.md (missed by first script) and index.md
- `wiki/theories/` has leftover index.md
- `wiki/organisms/` has nested empty directories and index files
- Manual work created some duplicates that need cleanup

**Current broken state**:
```
wiki/
├── [30 successfully migrated files]  ✓ 
├── concepts/                         ❌ should be gone
│   ├── index.md                     ❌ leftover
│   └── *.md.backup                  ❌ backup files  
├── mechanisms/                       ❌ should be gone
│   ├── cellular-senescence.md       ❌ missed by script
│   └── index.md                     ❌ leftover
└── [other leftover directories]      ❌ should be cleaned up
```

## where things stand

**Environment working fine**:
- Node.js v22.16.0 running properly
- Dependencies installed: `gray-matter js-yaml`
- Package.json has "type": "module" (forces .cjs extensions for CommonJS scripts)

**Git state clean**: Latest changes committed to main branch

**Commands that work right now**:
```bash
cd "D:\Coding\Website\content"
node ../scripts/flatten-wiki.cjs --dry-run  # first script (works but incomplete)
node ../scripts/flatten_wiki.cjs --dry-run  # advanced script (works for dry-run)
node ../scripts/flatten_wiki.cjs --write    # fails on report writing
```

## what to do next

**Most urgent**: Fix the advanced script's directory creation issue. The dry-run output looked perfect - it would:
- Move missed files like cellular-senescence.md
- Convert index.md files to proper pages (concepts.md, mechanisms.md etc.)
- Clean up backup files to _backups/
- Fix all internal links
- Remove empty directories

**Two options**:
1. **Debug the script**: Figure out why mkdir isn't creating _reports directory properly on Windows
2. **Manual cleanup**: Move the remaining 5-6 files manually using same pattern as successful migration

**Files needing manual moves if script can't be fixed**:
- `wiki/mechanisms/cellular-senescence.md` → `wiki/cellular-senescence.md` (add proper tags)
- Index files should become: `concepts/index.md` → `concepts.md`, `mechanisms/index.md` → `mechanisms.md`
- Backup files to `wiki/_backups/`

## stuff to remember

**The Carmack approach worked**: Writing a comprehensive migration script was way better than my manual copy-paste-delete approach. The consultant's discovery-based script is the right solution.

**Tag taxonomy is solid**: The category/topic/status tag system provides much more flexible organization than rigid folders ever could.

**Frontmatter corruption pattern**: Look for `date: "2025-08-10tags: [...]"` - this breaks Obsidian tag detection. Fix with surgical MultiEdit replacing just the broken line.

**URL preservation critical**: Every moved file needs aliases for old paths or links break. The migration scripts handle this automatically.

**File verification essential**: Always check file count and total size before/after any bulk operations. Caught several issues this way.

**Script debugging needed**: The advanced flatten_wiki.cjs script is trying to write to directories that don't exist properly. Either fix the mkdir issue or fall back to manual cleanup of remaining 5-6 files.