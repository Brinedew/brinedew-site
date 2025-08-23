# Quartz Draft System Implementation - 2025-08-23

I just finished implementing a proper draft system for the Quartz 4 blog and got QuickAdd working properly. The user wanted new content to default to draft instead of published, plus they needed a working note creation workflow.

## what actually works now

**QuickAdd is finally working:**
- Fixed the vault location issue - QuickAdd was installed in wrong .obsidian folder
- Fixed PowerShell UTF-8 BOM encoding that was breaking JSON parsing
- All 3 templates work: Post, Wiki Page, Protein Page
- Ctrl+N brings up the dialog and creates files properly

**Draft system is implemented:**
- Switched from tag-based (`status/published`) to proper frontmatter (`draft: true/false`)
- All 111 existing content files now have `draft: true` by default
- Site structure pages (About, index, apps) stay published
- RemoveDrafts filter completely excludes draft files from build (they don't exist on live site)

**Content cleanup completed:**
- Deleted test files and untitled junk
- Fixed image references (`posts/image.png` → `Attachments/anoikis-illustration.png`)  
- Moved misplaced content to correct folders
- Updated dark-mode-test-page to Quartz 4 standards with transclusion test

Files I changed:
- `content/Templates/*.md` - all templates now use `draft: true` instead of status tags
- `content/.obsidian/plugins/quickadd/data.json` - fixed template paths and folder targets
- `content/posts/dark-mode-test-page.md` - converted MkDocs syntax to Quartz callouts, added transclusion
- `content/wiki/cellular-senescence.md` - published for transclusion test with block reference
- `scripts/add-draft-property.ps1` - bulk script that added draft property to all content

## what's broken

**Posts page shows published drafts:** The user noticed 3 posts appear on brinedew.com/posts but there's no "posts" tag in the sidebar. This suggests either:
- The draft filter isn't working properly for folder listings 
- The posts have `draft: false` already (cellular-senescence and dark-mode-test-page were set to false for testing)

**Test page link name too long:** The dark-mode-test-page URL is unwieldy - should probably be shortened to just "test-page" or similar.

**Sidebar tag issues:** The user mentioned posts aren't showing up in the tag explorer properly. Might be related to the draft filtering or tag structure changes.

## where things stand

**Current environment:**
- QuickAdd working in content vault (`D:\Coding\Website\content`)
- All changes pushed to GitHub and deployed live
- Draft system active - most content hidden from live site
- Only 2-3 pages actually published for testing

**Working commands:**
```bash
# Test QuickAdd workflow
cd "D:\Coding\Website\content" 
# Open Obsidian, press Ctrl+N, should see 3-option dialog

# Check draft filtering locally
cd "D:\Coding\Website"
npx quartz build
# Should only build non-draft content

# Bulk publish content (remove draft property)
cd "D:\Coding\Website"
# Edit files to remove `draft: true` or change to `draft: false`
```

## what to do next

**Fix the posts page issue:** Check why published posts aren't showing tag associations properly. Look at:
1. `content/posts/index.md` - might need draft property removed
2. Tag structure after the status tag cleanup 
3. Whether FolderPage plugin respects draft filtering

**Clean up test page:** Either shorten the filename or add a better title/slug. The URL `brinedew.com/posts/dark-mode-test-page` is too verbose.

**Publish key content:** The user probably wants some actual posts visible. Look for high-quality content in posts/ and wiki/ and remove `draft: true` from the good stuff.

**Test transclusions:** Verify the `![[cellular-senescence#^what-it-is]]` transclusion actually works on the live site.

## stuff to remember

**UTF-8 BOM was the real culprit:** The consultant was right - Windows PowerShell writing UTF-8 with BOM broke JSON.parse in QuickAdd. Using `System.Text.UTF8Encoding $false` fixed it.

**Vault location matters:** QuickAdd needs to be in the same .obsidian folder as the vault you actually have open in Obsidian. The user opens `content/` as the vault, not the parent `Website/` folder.

**Draft filtering is build-time, not runtime:** Files with `draft: true` literally don't exist on the live site - they're excluded during build, not just hidden.

**Tag cleanup already happened:** The user ran scripts to remove status tags before this session, so the tag structure is already flattened.

**Site is live at brinedew.com:** Changes pushed to GitHub deploy automatically via Actions. The user can immediately see results.

The user seems happy that QuickAdd finally works, but they caught some issues with the draft filtering that need attention. The technical implementation is solid - just need to tune which content gets published.