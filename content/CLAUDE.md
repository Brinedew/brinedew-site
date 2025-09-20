---
draft: true
---

# content folder notes

*Specific to working with files in the content/ directory*

---

## frontmatter corruption fixes

**Problem that happened:** Date and tags fields got merged in YAML like this:
```yaml
date: "2025-08-10tags: [content/post, topic/cancer]"
```

**How to spot it:** Files show up as "untagged" in Obsidian even though they look like they have tags.

**How to fix it:** Use MultiEdit to surgically replace just the broken frontmatter:
```javascript
old_string: 'date: "2025-08-10tags: [content/post, topic/cancer]"'
new_string: 'date: 2025-08-10\ntags: [content/post, topic/cancer]'
```

**Don't** use the Obsidian MCP patch tool for frontmatter - it creates nested YAML that's even more broken.

## wiki structure (now flattened!)

`content/wiki/` is now flat - everything lives directly in `wiki/` with tags instead of folders.

**Tag system for new content:**
- `content/wiki` - all wiki content
- `content/post` - all posts
- `content/apps` - all apps
- `meta` - technical site maintenance

**To add new wiki content:**
1. Create markdown files directly in `wiki/` with proper frontmatter
2. Add appropriate tags instead of putting in folders
3. Cross-reference everything with wikilinks or relative links

## excalidraw integration

**How to make drawings work on the website:**
1. Create drawings in Obsidian using `![[drawing.excalidraw]]` syntax
2. Enable PNG auto-export in Obsidian Excalidraw plugin settings:
   - ✅ Auto export PNG 
   - ✅ Keep same folder as drawing
3. Both the .excalidraw.md file and exported PNG sync via Syncthing
4. Website displays the PNG images automatically

**Common problem:** Drawings show as text links instead of images? Check that PNG auto-export is enabled.

## file naming and organization

**Posts go in:** `content/posts/`
**Wiki entries go in:** `content/wiki/` (flat, no subfolders)
**Images go in:** `content/posts/assets/images/`
**Apps go in:** `content/apps/`

**File naming rules:**
- Use hyphens instead of spaces: `aging-research.md` not `aging research.md`
- Keep filenames simple and descriptive
- No special characters that break URLs

## frontmatter patterns that work

**For posts:**
```yaml
---
title: "Your Post Title"
date: 2025-08-10
tags: [content/post]
---
```

**For wiki entries:**
```yaml
---
title: "Concept Name"
date: 2025-08-10
tags: [content/wiki]
aliases:
  - old-path/concept-name
  - concept-name
---
```

**For apps:**
```yaml
---
title: "App Name"
tags: [content/apps]
noindex: false
---
```

## internal linking

**Use wikilinks for wiki content:** `[[cellular-senescence]]`
**Use relative links for posts:** `[link text](../posts/post-name.md)`
**For images:** `![alt text](../posts/assets/images/image.png)`

**After flattening:** All wiki links work without folder paths since everything's in `wiki/` root.

---

*For general site setup, development workflow, and deployment - see the root CLAUDE.md file*
