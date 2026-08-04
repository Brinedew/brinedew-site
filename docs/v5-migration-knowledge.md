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

v5 OFM initially renders images inside paragraphs and puts the caption only in
the image `alt` attribute. The local `image-captions` HTML transformer is the
canonical repair: it splits prose-image-prose paragraphs into independent
blocks and emits semantic `<figure>/<figcaption>` markup. Do not replace this
with blank-line linting or `p:has(img)` CSS; the published renderer must remain
correct even when CommonMark merges adjacent source lines into one paragraph.

Essay vertical rhythm is also renderer-owned. At the standard 19px article
size, the contract is 25.6px prose leading and a 17.1px top-level block gap,
with centered figure/caption geometry. Superscripts and subscripts use
zero-height inline boxes with relative visual positioning so footnotes and
citations cannot enlarge a line box.

Essay figure images also override Quartz's global `content-visibility: auto`.
That optimization collapses off-screen replaced elements without a reserved
intrinsic size and causes large layout jumps in long image-heavy posts.

## Plugin System

v4: Built-in `Plugin.X()` pattern
v5: Community packages from `quartz-community/`, factory function pattern.
Custom plugins need their own package.json + build.
