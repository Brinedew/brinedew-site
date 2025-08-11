# Website Sprint 2: From Demo to Publication
*Created: August 2025*

## the real problem

Designer analysis: "You're shipping documentation, not a publication." The site shows off Quartz features instead of being an actual editorial space with intent.

## this sprint's goal

Transform brinedew.com from "Quartz install guide" into "The [Name] - a longevity research publication" with editorial identity and design that serves the content, not the framework.

## phases (in execution order)

### PHASE 1: Kill the Framework Demo (30 mins) ⚡
**Goal**: Delete Quartz marketing, write actual homepage

**Tasks**:
- [ ] Delete Quartz demo content (`content/index.md`, `content/showcase/`, `content/features/`, `content/configuration/`)
- [ ] Write real homepage with purpose statement (not feature list)
- [ ] Hide file explorer on homepage only via `quartz.layout.ts`

**Definition of done**: Homepage explains what this place is, not what Quartz can do

---

### PHASE 2: Typography as Architecture (1 hour) 🎯
**Goal**: Editorial typography that creates hierarchy, not academic text blocks

**Tasks**:
- [ ] Implement Crimson Pro + IBM Plex Mono + system font stack
- [ ] Set 19px base font size with 1.45 line-height (tighter than academic 1.6+)
- [ ] Create actual headline hierarchy (2.4em h1 at 300 weight, 1.4em h2 at 600)
- [ ] Use variable font weights (425 for body text)
- [ ] Add `text-wrap: pretty` for better line breaks

**Definition of done**: Text feels like reading a publication, not documentation

---

### PHASE 3: Color Without Being Colorful (45 mins) 🎨
**Goal**: OKLCH color system with restraint - warm paper, not stark white

**Tasks**:
- [ ] Implement OKLCH color system (warm paper light theme, near-black dark theme)
- [ ] Set up CSS color variables with slight yellow cast for warmth
- [ ] Style links with `text-decoration-color` and subtle hover states
- [ ] Use one accent color sparingly (muted teal)

**Definition of done**: Colors feel intentional and editorial, not default framework

---

### PHASE 4: Progressive Enhancement (1 hour) ⚡
**Goal**: View Transitions for smooth navigation without SPA complexity

**Tasks**:
- [ ] Add View Transitions API for same-origin navigation
- [ ] Implement CSS crossfade animations (250ms, cubic-bezier easing)
- [ ] Keep header stable during transitions
- [ ] Maintain scroll position for back button

**Definition of done**: Navigation feels smooth but pages are still real pages

---

### PHASE 5: Knowledge Features Without Theater (2 hours) 🔍
**Goal**: Graph and backlinks as tools, not homepage decoration

**Tasks**:
- [ ] Move graph view to dedicated `/graph` page (not floating widget)
- [ ] Create dedicated graph layout without explorer/nav
- [ ] Redesign backlinks as subtle end-of-article references
- [ ] Style backlinks with uppercase labels and minimal visual weight

**Definition of done**: Knowledge features serve readers, don't show off capabilities

---

### PHASE 6: Polish That Matters (1 hour) ✨
**Goal**: Fix interactions and add performance optimizations

**Tasks**:
- [ ] Fix explorer mobile interaction (pointer-events management)
- [ ] Position search as fixed top-right with keyboard shortcut display
- [ ] Add modulepreload for search.js, prefetch for /posts
- [ ] Implement proper lazy loading for images
- [ ] Update site name from "BrineDew" to actual project identity

**Definition of done**: Site feels polished and intentional in all details

## what we're NOT doing

- Adding animations everywhere (one crossfade is enough)
- Making a startup landing page
- Redesigning Quartz components (they work fine)
- Using 67 fonts (Crimson Pro + system fonts only)
- Adding dark patterns (no email popups, no subscribe banners)

## time estimate: ~6 hours total

- Phase 1: 30 minutes (delete demo, write homepage)
- Phase 2: 1 hour (typography system)
- Phase 3: 45 minutes (color system)
- Phase 4: 1 hour (view transitions)
- Phase 5: 2 hours (knowledge features)
- Phase 6: 1 hour (polish)

## definition of done

- [ ] Homepage explains the site's purpose, not Quartz's features
- [ ] Typography creates editorial hierarchy with Crimson Pro
- [ ] Colors use OKLCH warm paper theme with restraint
- [ ] Navigation has smooth View Transitions without SPA complexity
- [ ] Graph and backlinks serve content, don't dominate layout
- [ ] All interactions work smoothly on mobile
- [ ] Site has actual editorial identity, not framework demo

## testing approach

1. **Content test**: Can a new visitor understand what this site is about from the homepage?
2. **Typography test**: Does text feel like reading a publication vs. documentation?
3. **Navigation test**: Do page transitions feel smooth without JavaScript complexity?
4. **Mobile test**: Can users interact with all elements reliably?
5. **Performance test**: Does site load fast with proper resource hints?

## why this order matters

Designer's insight: "Fix the content strategy first; the design follows naturally."

Phase 1 immediately transforms site identity. Phases 2-3 make it feel editorial. Phases 4-6 add polish without gimmicks.

Bug fixes (mobile clicking, dark mode) can wait because this redesign will likely replace the problematic CSS anyway.

---

## Code Snippets from Designer

### Phase 1: Kill the Framework Demo

**Delete these directories:**
```bash
# In your content folder
rm content/index.md
rm -rf content/showcase content/features content/configuration
```

**New homepage template (`content/index.md`):**
```markdown
---
title: ""
enableToc: false
---

# [Your actual site name, not "BrineDew"]

[One sentence about what this place is. Not features. Purpose.]

Start with [[/your-best-piece]] or browse [[/posts]].
```

**Hide explorer on homepage (`quartz.layout.ts`):**
```typescript
export const defaultLayouts: LayoutData = {
  index: {
    head: Component.Head(),
    header: [],
    beforeBody: [],
    pageBody: Component.Content(),
    left: [], // NO EXPLORER ON INDEX
    right: [],
    footer: Component.Spacer(),
  },
  // Keep explorer for other pages
  defaultLayout: {
    // ... existing config with explorer
  }
}
```

### Phase 2: Typography as Architecture

**Font imports and variables (`quartz/styles/custom.scss`):**
```scss
@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300..900;1,300..900&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root {
  // System stack for UI, Crimson for content
  --bodyFont: 'Crimson Pro', 'Iowan Old Style', Palatino, serif;
  --headerFont: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  --codeFont: 'IBM Plex Mono', 'SF Mono', Consolas, monospace;
  
  // Tighter, more editorial spacing
  --fontSize: 19px; // Bigger body = more confident
  --lineHeight: 1.45; // Tighter than academic 1.6+
  --paragraphSpacing: 0.75em; // Less spacing = more flow
}

// Headlines that actually create hierarchy
h1 { 
  font-size: 2.4em;
  font-weight: 300; // Light weight at large size
  letter-spacing: -0.02em;
  line-height: 1.1;
}

h2 {
  font-size: 1.4em;
  font-weight: 600;
  margin-top: 2em;
  font-family: var(--headerFont);
}

// Body text with personality
article {
  font-family: var(--bodyFont);
  font-size: var(--fontSize);
  font-weight: 425; // Variable font finesse
  
  p {
    margin-bottom: var(--paragraphSpacing);
    text-wrap: pretty; // 2025: better line breaks
  }
}
```

### Phase 3: Color Without Being Colorful

**OKLCH color system:**
```scss
@layer base {
  :root {
    // Light: warm paper, not stark white
    --bg: oklch(97.5% 0.01 85); // Slight yellow cast
    --fg: oklch(25% 0.02 85);   // Warm black
    --muted: oklch(55% 0.01 85);
    --accent: oklch(50% 0.08 185); // Muted teal
    
    // UI elements darker than text (inverted expectation)
    --ui-border: oklch(88% 0.01 85);
    --ui-bg: oklch(94% 0.005 85);
  }
  
  // Dark theme: actually dark, not gray
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: oklch(12% 0.01 85);    // Near black
      --fg: oklch(88% 0.01 85);    // Warm white
      --muted: oklch(65% 0.01 85);
      --accent: oklch(68% 0.08 185);
      
      --ui-border: oklch(22% 0.01 85);
      --ui-bg: oklch(16% 0.005 85);
    }
  }
}

// One accent color, used sparingly
a {
  color: inherit;
  text-decoration-color: var(--accent);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.2em;
  
  &:hover {
    color: var(--accent);
  }
}
```

### Phase 4: Progressive Enhancement

**View Transitions script (`quartz/components/scripts/viewTransitions.inline.ts`):**
```typescript
const script = `
if (document.startViewTransition) {
  // Intercept all same-origin navigation
  document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link || link.origin !== location.origin) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    
    e.preventDefault();
    
    document.startViewTransition(async () => {
      // Fetch and replace content
      const response = await fetch(link.href);
      const html = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(html, 'text/html');
      
      // Swap content but keep scroll for back button
      document.documentElement.replaceWith(newDoc.documentElement);
      history.pushState({}, '', link.href);
    });
  });
}
`;
```

**CSS view transition styling:**
```scss
// Crossfade everything except persistent UI
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 250ms;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

// Keep header/nav stable
header {
  view-transition-name: header;
}
```

### Phase 5: Knowledge Features

**Dedicated graph page (`content/graph.md`):**
```markdown
---
title: "Graph"
enableToc: false
---

<div id="full-graph-container"></div>
```

**Graph layout in `quartz.layout.ts`:**
```typescript
graph: {
  head: Component.Head(),
  header: [],
  beforeBody: [],
  pageBody: Component.Graph({ fullPage: true }),
  left: [],
  right: [],
  footer: Component.Spacer(),
}
```

**Subtle backlinks styling:**
```scss
// Make backlinks subtle, not dominant
.backlinks {
  margin-top: 4rem;
  padding-top: 2rem;
  border-top: 1px solid var(--ui-border);
  
  h3 {
    font-size: 0.9em;
    font-weight: 500;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  ul {
    list-style: none;
    padding: 0;
    
    li {
      padding: 0.25em 0;
      font-size: 0.95em;
    }
  }
}
```

### Phase 6: Polish Details

**Fixed interactions:**
```scss
// Explorer shouldn't hijack mobile taps
.explorer {
  @media (max-width: 768px) {
    &:not(.expanded) {
      pointer-events: none;
    }
  }
}

// Search should be omnipresent
.search {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 999;
  
  kbd {
    font-size: 0.8em;
    padding: 0.1em 0.3em;
    background: var(--ui-bg);
    border: 1px solid var(--ui-border);
    border-radius: 3px;
  }
}
```

**Performance optimizations:**
```html
<!-- In your base template -->
<link rel="modulepreload" href="/static/search.js">
<link rel="prefetch" href="/posts" as="document">

<!-- Actual lazy load, not eager -->
<img loading="lazy" decoding="async" ...>
```

**Site configuration (`quartz.config.ts`):**
```typescript
configuration: {
  pageTitle: "Your Actual Site Name",
  description: "One real sentence about what you write about",
  // ...
}
```