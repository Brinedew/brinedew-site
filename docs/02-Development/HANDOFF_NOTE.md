# Mobile hamburger menu fixes (attempting to make it not suck) - 2025-08-15

I was trying to fix the mobile navigation hamburger menu that was completely broken. User said "It works like shit" and they were absolutely right. After running a comprehensive QA torture test, I found 6 critical failures that made the menu basically unusable.

## what actually works now

**Visual appearance**: The hamburger button shows up properly now with "Menu" text and a hamburger icon. Fixed the SVG to work in Edge browser by adding `fill="none"` and `stroke="currentColor"`.

**JavaScript loading pattern**: Completely rewrote the mobile menu script to follow the same pattern as the working darkmode button:
- Changed from `afterDOMLoaded` to `beforeDOMLoaded` in `MobileMenu.tsx` (line 36)
- Rewrote `scripts/mobileMenu.inline.ts` to use `document.addEventListener("nav")` pattern instead of `DOMContentLoaded`  
- Now uses `getElementsByClassName` instead of `querySelector` to match existing working buttons
- Added proper `window.addCleanup()` for event handlers

**ARIA accessibility**: Fixed the hardcoded aria-controls mismatch:
- Removed hardcoded `aria-controls="tag-explorer-content"` from the button
- Script now dynamically finds the TagExplorer content's actual ID (`tag-explorer-18` or similar)
- Sets `aria-controls` properly at runtime (line 59 in mobileMenu.inline.ts)

Files I changed:
- `quartz/components/MobileMenu.tsx` - switched to beforeDOMLoaded, removed hardcoded ARIA, fixed Edge SVG
- `quartz/components/scripts/mobileMenu.inline.ts` - complete rewrite following darkmode pattern
- `bugs_log.md` - documented all 6 critical issues with reproduction steps

## what's broken

**I didn't get to test it**. Was in the middle of building with `npx quartz build` when the handoff command interrupted. The build was running fine before interrupt, so the code should compile.

**Still need to verify**:
- Does the hamburger actually open the TagExplorer menu overlay on mobile?
- Does the CSS media query breakpoint work right? (Should hide hamburger above 800px)
- Does it work in Edge browser with the SVG fixes?
- Does the navigation close properly when you click a link?

The previous issues were:
1. Clicking hamburger navigated to random page instead of opening menu
2. JavaScript functions didn't exist (`toggleMobileMenu` undefined)
3. Console errors about search.js 404
4. ARIA-controls pointing to wrong ID
5. Hamburger showing at tablet size when it should be hidden

## where things stand

**Environment**: Website builds with Quartz 4, deploys via GitHub Actions to brinedew.com. Last successful build before my changes was working except for the broken hamburger menu.

**Current code state**: All my fixes are ready to build but not deployed yet. Need to run:
```bash
cd "D:\Coding\Website"
npx quartz build    # should work fine
git add .
git commit -m "Fix mobile hamburger menu JavaScript loading and ARIA issues"
git push
```

Then wait ~60 seconds for GitHub Actions to deploy and test at https://brinedew.com/posts/ on mobile.

## what to do next

**Most urgent**: Build and deploy the fixes, then test the hamburger menu on mobile. Go to https://brinedew.com/posts/, shrink browser to 375px width, click the hamburger "Menu" button. It should open a full-screen overlay with the TagExplorer content (all the tags and page links).

**How to test properly**:
1. Mobile (375px): Hamburger should show and work
2. Tablet (768px): Hamburger should be HIDDEN (desktop layout kicks in)  
3. Desktop (1200px): Hamburger should be hidden, TagExplorer in left sidebar
4. Edge browser: SVG icon should render

**If it still doesn't work**: The issue is probably that Quartz isn't loading the JavaScript properly. Check the browser console for errors. The pattern I followed (beforeDOMLoaded + nav event) works for darkmode button, so it should work for mobile menu too.

## stuff to remember

**Why the rewrite**: The original approach used `DOMContentLoaded` which only fires once. In Quartz's SPA navigation system, you need to listen for `"nav"` events to reattach handlers after page changes. That's why darkmode works and my original hamburger didn't.

**The ARIA ID issue**: TagExplorer generates random IDs like `tag-explorer-18`, so you can't hardcode `aria-controls`. The script now finds the actual ID dynamically and sets the aria-controls attribute at runtime.

**Breakpoint confusion**: When I tested at 768px and saw hamburger, I thought that was wrong. But 768px IS mobile in Quartz (mobile = max-width 800px). The issue was that it wasn't actually functioning, not that it was showing at the wrong size.

**Why Edge was broken**: SVG needed explicit `fill="none"` and `stroke="currentColor"` attributes. Other browsers are more forgiving but Edge requires them.

The hamburger menu should actually work now instead of randomly navigating to blog posts. But somebody needs to build it and test it to find out.