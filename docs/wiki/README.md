# Wiki Navigation Guide

## How to Add New Content

The wiki navigation auto-generates from your file structure. To add new content:

1. **Create markdown files** in the appropriate folder
2. **That's it!** Navigation updates automatically
3. Cross-reference with relative links like `[link text](../other-folder/file.md)`

## Folder Structure

- `concepts/` - Theoretical frameworks
- `theories/` - Evolutionary theories of aging  
- `mechanisms/` - Biological mechanisms
- `organisms/` - Model organisms and comparative biology

## Important Rules

**❌ Don't create `.pages` files** - They break auto-navigation

**✅ Do create `index.md` files** - They become section landing pages

**✅ Do use descriptive filenames** - They appear in navigation as-is

## Examples

```
docs/wiki/
├── concepts/
│   ├── index.md              # "Concepts" section page
│   ├── new-concept.md        # Shows as "New Concept" in nav
│   └── another-idea.md       # Shows as "Another Idea" in nav
└── theories/
    ├── index.md              # "Theories" section page  
    └── my-theory.md          # Shows as "My Theory" in nav
```

Navigation appears alphabetically with `index.md` files first.