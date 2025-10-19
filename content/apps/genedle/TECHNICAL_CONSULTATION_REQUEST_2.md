# Technical Consultation Request #2: Genedle Script Loading Issue

**Date:** October 9, 2025  
**Site:** brinedew.bio (Quartz 4.5.1 static site generator)  
**Issue:** Genedle app not loading - scripts/styles not injected into HTML during build

---

## Executive Summary

The Genedle app exists and is fully functional (app.js, styles.css, data.json all built and working), but the page displays only attribution text. Root cause: the conditional logic in Head.tsx that should inject `<script>` and `<link>` tags for the Genedle app is not executing during the Quartz build process, despite matching slug conditions.

---

## Project Context

### What is Genedle?
A daily protein guessing game (like Wordle/Tradle) where users identify a target protein from progressive hints about function, domains, and tissue specificity. Built per PRD.txt specifications as a static app.

### Site Architecture
- **Framework:** Quartz v4.5.1 (static site generator using React/TypeScript)
- **Deployment:** Static HTML/CSS/JS files in `/public`
- **App Pattern:** Self-contained apps in `/static/[app-name]/` with:
  - `app.js` - main application code
  - `styles.css` - app-specific styling
  - `data.json` - static game data

### Working Example: Scriptotic
Another app (Scriptotic) successfully loads using the identical pattern:
- Content: `/content/apps/scriptotic/index.md`
- Assets: `/static/apps/scriptotic/app.js`, `app.css`
- Head.tsx injects scripts for slug `apps/scriptotic/index` or `apps/scriptotic`
- **This works correctly** - scripts appear in built HTML

---

## Implementation History

### What Was Built Successfully
1. **App Code** (`/quartz/static/genedle/app.js` - 647 lines)
   - Date-based daily protein selection
   - Autocomplete search over proteins
   - Progressive hint system
   - Scoring (GO overlap, domain matching, expression correlation)
   - Share functionality
   - Local storage for streaks

2. **Game Data** (`/quartz/static/genedle/data.json`)
   - 100 proteins with full metadata
   - GO-Slim terms, InterPro domains, tissue expression
   - UniProt links, HGNC symbols

3. **Index System** (`/quartz/static/genedle/index.json`)
   - Daily selection algorithm
   - Salt-based deterministic picking

4. **Styling** (`/quartz/static/genedle/styles.css`)
   - Chip-based UI for hints
   - Progress bars for similarity
   - Mobile-responsive layout

5. **Content Page** (`/content/apps/genedle.md`)
   ```markdown
   ---
   title: "Genedle"
   description: "Daily protein guessing game"
   date: 2025-10-08
   draft: false
   tags:
   - content/apps
   ---
   
   <div id="genedle-root" data-static="../static/genedle"></div>
   
   ---
   
   **Attribution:** GO-Slim terms derived from...
   ```

### What Was Attempted for Script Loading

**Location:** `/quartz/components/Head.tsx` (lines 120-151)

```tsx
{/* Conditional app assets - only load on relevant pages */}
{(() => {
  // Guard against non-array slugs (e.g., 404 page)
  if (!Array.isArray(fileData.slug)) {
    return null;
  }
  
  const slug = fileData.slug.join("/");
  const rootPrefix = pathToRoot(fileData.slug);
  
  // Scriptotic app (THIS WORKS)
  if (slug === "apps/scriptotic/index" || slug === "apps/scriptotic") {
    return (
      <>
        <link rel="stylesheet" href={`${rootPrefix}static/apps/scriptotic/app.css?v=1`} />
        <script defer src={`${rootPrefix}static/apps/scriptotic/app.js?v=1`}></script>
      </>
    );
  }
  
  // Genedle app (THIS DOES NOT WORK)
  if (slug === "apps/genedle" || fileData.frontmatter?.title === "Genedle") {
    return (
      <>
        <link rel="stylesheet" href={`${rootPrefix}static/genedle/styles.css?v=1`} />
        <script defer src={`${rootPrefix}static/genedle/app.js?v=1`}></script>
      </>
    );
  }
  
  return null;
})()}
```

---

## Current Problem Details

### Observed Symptoms
1. **Page loads correctly:** `/apps/genedle.html` exists and is accessible
2. **Body has correct slug:** `<body data-slug="apps/genedle">`
3. **Root div present:** `<div id="genedle-root" data-static="../static/genedle"></div>` renders
4. **Attribution text visible:** The markdown content displays fine
5. **Scripts missing:** NO `<script>` or `<link>` tags for Genedle in `<head>`
6. **Console shows:** "Genedle: root element not found, skipping initialization" (from app.js guard)

### What the Built HTML Shows

**Expected in `<head>`:**
```html
<link rel="stylesheet" href="../static/genedle/styles.css?v=1" />
<script defer src="../static/genedle/app.js?v=1"></script>
```

**Actually in `<head>`:**
```html
<!-- NOTHING - the conditional block returns null or doesn't execute -->
```

### Verification Steps Taken
1. ✅ Confirmed `fileData.slug` is array `["apps", "genedle"]`
2. ✅ Confirmed `fileData.slug.join("/")` produces `"apps/genedle"`
3. ✅ Confirmed `fileData.frontmatter.title` is `"Genedle"`
4. ✅ Rebuilt site with `npx quartz build` - no errors
5. ✅ Checked built files exist in `/public/static/genedle/`
6. ✅ Verified Scriptotic uses identical pattern and WORKS
7. ✅ Checked console - no build-time errors or warnings

---

## Technical Deep Dive

### How Quartz Processes Pages

1. **Content Processing:**
   - Reads `/content/apps/genedle.md`
   - Parses frontmatter (title, tags, etc.)
   - Converts markdown to HTML
   - Sets `fileData.slug = ["apps", "genedle"]`

2. **Component Rendering:**
   - Calls `Head` component with `fileData`
   - Head.tsx should execute IIFE to conditionally inject scripts
   - Returns React elements that become HTML `<head>` content

3. **HTML Generation:**
   - Combines all component outputs
   - Writes final HTML to `/public/apps/genedle.html`

### Why Scriptotic Works But Genedle Doesn't

**Scriptotic:**
- Content file: `/content/apps/scriptotic/index.md`
- Slug: `["apps", "scriptotic", "index"]`
- Condition: `slug === "apps/scriptotic/index" || slug === "apps/scriptotic"`
- Result: ✅ MATCH → scripts injected

**Genedle:**
- Content file: `/content/apps/genedle.md`  
- Slug: `["apps", "genedle"]`
- Condition: `slug === "apps/genedle" || fileData.frontmatter?.title === "Genedle"`
- Result: ❌ NO MATCH (somehow?) → scripts NOT injected

### Hypothesis Candidates

1. **IIFE Not Executing at Build Time**
   - Possible React SSR issue where IIFE is treated as client-side code?
   - Need to verify if Quartz evaluates JSX IIFEs during static generation

2. **Slug Comparison Timing**
   - Maybe `fileData.slug` is mutated after Head component renders?
   - Or comparison happens before slug is fully resolved?

3. **Frontmatter Access Issue**
   - `fileData.frontmatter?.title` might not be accessible at Head render time
   - Type mismatch or undefined propagation?

4. **Build Order/Caching**
   - Head.tsx changes not picked up despite rebuild?
   - Need to verify TypeScript compilation is working

5. **Path Resolution**
   - `pathToRoot(fileData.slug)` might be computing wrong value?
   - Would affect URL but not whether block executes

---

## Code Locations Reference

### Key Files
```
D:\Coding\Website\
├── quartz/
│   ├── components/
│   │   └── Head.tsx                    # ISSUE IS HERE (lines 120-151)
│   └── static/
│       └── genedle/
│           ├── app.js                  # ✅ EXISTS AND WORKS
│           ├── styles.css              # ✅ EXISTS
│           ├── data.json               # ✅ EXISTS
│           └── index.json              # ✅ EXISTS
├── content/
│   └── apps/
│       ├── genedle.md               # ✅ CORRECT FRONTMATTER
│       └── scriptotic/
│           └── index.md                # ✅ WORKS AS REFERENCE
└── public/
    ├── apps/
    │   └── genedle.html             # ❌ MISSING SCRIPTS IN <head>
    └── static/
        └── genedle/
            ├── app.js                  # ✅ COPIED CORRECTLY
            ├── styles.css              # ✅ COPIED CORRECTLY
            ├── data.json               # ✅ COPIED CORRECTLY
            └── index.json              # ✅ COPIED CORRECTLY
```

### Critical Code Sections

**Head.tsx IIFE (NOT WORKING):**
```tsx
// Line ~138 in Head.tsx
if (slug === "apps/genedle" || fileData.frontmatter?.title === "Genedle") {
  return (
    <>
      <link rel="stylesheet" href={`${rootPrefix}static/genedle/styles.css?v=1`} />
      <script defer src={`${rootPrefix}static/genedle/app.js?v=1`}></script>
    </>
  );
}
```

**app.js Boot Function (WORKS WHEN SCRIPT LOADS):**
```javascript
// Line ~631 in app.js
function boot() {
  const el = document.getElementById('genedle-root');
  if (!el) {
    console.info('Genedle: root element not found, skipping initialization');
    return;
  }
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
```

---

## What Works (Verification)

### Manual Script Injection Test
If I manually add these lines to `/public/apps/genedle.html`:
```html
<link rel="stylesheet" href="../static/genedle/styles.css" />
<script defer src="../static/genedle/app.js"></script>
```

**Result:** ✅ App loads perfectly, all functionality works:
- Proteins load from data.json
- Autocomplete functions
- Guessing and scoring work
- Hints unlock progressively
- Share text generates correctly
- Streak tracking via localStorage works

This confirms the app code itself is 100% functional.

---

## Questions for Consultant

1. **Why doesn't the IIFE in Head.tsx execute for Genedle when Scriptotic works?**
   - Is there something about the slug comparison that's failing?
   - Does Quartz handle IIFEs differently in certain contexts?

2. **How can we debug the build-time execution?**
   - Can we add console.logs that appear during `npx quartz build`?
   - Is there a way to inspect `fileData` at Head render time?

3. **Is there an alternative pattern for conditional script injection?**
   - Should we use a different component hook?
   - Could we use Quartz plugins instead of Head component?

4. **Type checking question:**
   - Could TypeScript be silently failing on the IIFE?
   - Should we check the compiled JavaScript output?

5. **Quartz-specific behavior:**
   - Are there known issues with JSX IIFEs in Quartz components?
   - Do we need special handling for defer/async scripts?

---

## Requested Deliverables

1. **Root Cause Analysis**
   - Why the conditional block doesn't execute
   - Whether it's a Quartz limitation or code issue

2. **Working Solution**
   - Modified Head.tsx that successfully injects scripts
   - Or alternative approach (plugin, different component, etc.)

3. **Debugging Approach**
   - Method to inspect build-time values
   - How to verify conditional logic during static generation

4. **Documentation**
   - Pattern to follow for future apps
   - Any Quartz-specific gotchas to avoid

---

## Environment Details

- **Quartz Version:** 4.5.1
- **Node Version:** (check with `node --version`)
- **Operating System:** Windows
- **Build Command:** `npx quartz build`
- **Dev Server:** `npx quartz build --serve`

---

## Appendix: Full Head.tsx Conditional Section

```tsx
{/* Conditional app assets - only load on relevant pages */}
{(() => {
  // Guard against non-array slugs (e.g., 404 page)
  if (!Array.isArray(fileData.slug)) {
    return null;
  }
  
  const slug = fileData.slug.join("/");
  const rootPrefix = pathToRoot(fileData.slug);
  
  // Scriptotic app
  if (slug === "apps/scriptotic/index" || slug === "apps/scriptotic") {
    return (
      <>
        <link rel="stylesheet" href={`${rootPrefix}static/apps/scriptotic/app.css?v=1`} />
        <script defer src={`${rootPrefix}static/apps/scriptotic/app.js?v=1`}></script>
      </>
    );
  }
  
  // Genedle app
  if (slug === "apps/genedle" || fileData.frontmatter?.title === "Genedle") {
    return (
      <>
        <link rel="stylesheet" href={`${rootPrefix}static/genedle/styles.css?v=1`} />
        <script defer src={`${rootPrefix}static/genedle/app.js?v=1`}></script>
      </>
    );
  }
  
  return null;
})()}
```

**Expected behavior:** When processing `/content/apps/genedle.md`, the IIFE should:
1. Check `fileData.slug` is array ✅
2. Join to `"apps/genedle"` ✅
3. Match first condition (`slug === "apps/genedle"`) ✅
4. Return JSX with link and script tags ❌ (NOT HAPPENING)

**Actual behavior:** The IIFE appears to return `null` or not execute, resulting in no scripts in the final HTML.

---

## Contact

For follow-up questions or additional code samples, please reach out.


