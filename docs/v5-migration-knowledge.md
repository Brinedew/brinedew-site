# Quartz v5 Migration Knowledge

## Critical: ContentBody Wrapper

**Source**: https://raw.githubusercontent.com/quartz-community/content-page/main/src/components/ContentBody.tsx

v5 wraps all article content in:
```html
<article class="popover-hint">
  <div class="markdown-preview-view markdown-rendered">
    <!-- content here -->
  </div>
</article>
```

This breaks ALL `article > X` CSS child combinators. Always use descendant selectors:
- `article h1` ✅ (descendant — matches grandchildren through wrapper)
- `article > h1` ❌ (child — h1 is now a grandchild)

**Linear**: B-544 for full chain of discovery

## Image Captions

v5 OFM renders images as bare `<p><img>` — no `<figure>`/`<figcaption>`.
Alt text from `![caption](img.png)` is only in the `alt` attribute, not visible text.

Current fix: CSS `p:has(img) + p` styles the next paragraph as italic caption.
Long-term: rehype plugin to convert to `<figure><figcaption>`.

## Plugin System

v4: Built-in `Plugin.X()` pattern
v5: Community packages from `quartz-community/`, factory function pattern.
Custom plugins need their own package.json + build.
