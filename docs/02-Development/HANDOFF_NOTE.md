# Mobile hamburger menu fixes and line spacing cleanup - August 15, 2025

I was fixing the mobile navigation hamburger menu that was completely broken and cleaning up line spacing issues in the navigation panels.

## what actually works now

**Hamburger menu is finally working**:
- Fixed 6 critical issues that made mobile nav unusable (random page navigation, JavaScript loading failures, ARIA mismatches)
- Rewrote `quartz/components/scripts/mobileMenu.inline.ts` to follow working darkmode button pattern
- Fixed Edge browser SVG hit-testing issue with `pointer-events: none` on child elements in `quartz/components/styles/mobileMenu.scss`
- Menu now opens/closes correctly on mobile, works in Edge, passes Playwright tests

**Line spacing partially fixed**:
- Fixed TagExplorer links in `quartz/components/styles/tagExplorer.scss` line 144: increased `margin-bottom` to 0.4rem, reduced `line-height` to 1.22
- Fixed TOC links in `quartz/components/styles/toc.scss` lines 50-64: same mathematical approach
- Mathematical calculation: 2:1 ratio between link spacing (0.4rem) vs within-link line spacing (0.2rem)

Files I changed:
- `quartz/components/MobileMenu.tsx` - removed hardcoded ARIA-controls, switched to beforeDOMLoaded pattern
- `quartz/components/scripts/mobileMenu.inline.ts` - complete rewrite, dynamic ID detection, proper event cleanup
- `quartz/components/styles/mobileMenu.scss` - added `pointer-events: none` to `> *` selector, fixed Edge SVG clicking
- `quartz/components/styles/tagExplorer.scss` - line 144: `margin-bottom: 0.4rem`, line 153: `line-height: 1.22`
- `quartz/components/styles/toc.scss` - lines 50-64: added proper li spacing structure

## what's broken

**Line spacing fix didn't work**: User said "Didn't work" after I deployed the calculated line spacing changes. Either:
1. The CSS didn't deploy properly (build system issue)
2. The calculation was wrong
3. I'm targeting the wrong CSS selectors
4. Need to clear browser cache to see changes

**Explorer component not fixed**: I started fixing `quartz/components/styles/explorer.scss` but got interrupted. The Explorer file/folder links still have the same line spacing problem as the original TagExplorer had.

## where things stand

**Environment is working**: 
- Website builds and deploys successfully: `npx quartz build` works
- GitHub Actions pipeline functional: commits auto-deploy to https://brinedew.com in ~60 seconds
- Edge browser hamburger menu now works (confirmed with Playwright testing)

**Current state**:
- All hamburger menu fixes are deployed and working
- TagExplorer and TOC line spacing changes are committed but effectiveness unknown
- Build was interrupted before I could test the line spacing results

## what to do next

**Most urgent: Debug the line spacing fix**
1. Go to https://brinedew.com/posts/ in desktop view (1200px width)
2. Look at left sidebar TagExplorer links - are they spaced better now?
3. If not working, inspect element in browser DevTools:
   - Check if `margin-bottom: 0.4rem` is applied to `.tag-pages-outer > ul li`
   - Check if `line-height: 1.22` is applied to `.tag-pages-outer > ul li a`
   - Look for CSS cascade conflicts or selector specificity issues

**If line spacing still broken**:
- Problem might be wrong CSS selectors
- Look at actual DOM structure with DevTools Elements panel
- The TagExplorer generates dynamic HTML, so the CSS selectors might not match reality
- Check if other CSS rules are overriding the spacing (use DevTools Computed tab)

**Then fix Explorer component**: Apply same calculated spacing fix to `quartz/components/styles/explorer.scss` lines 116-132 - add the li structure with proper margin-bottom and line-height.

## stuff to remember

**Why the hamburger menu broke**: Quartz uses SPA navigation with `"nav"` events, not `DOMContentLoaded`. Most online examples use the wrong pattern. Always use `beforeDOMLoaded` + nav event listener for Quartz components.

**Why Edge browser was broken**: Edge handles SVG hit-testing differently than Chrome. Child elements (SVG lines, text spans) inside buttons intercept mouse clicks. Solution: `pointer-events: none` on all child elements forces clicks to bubble to parent button.

**Line spacing calculation**: 
- Current bad: 0.36rem within links, 0.2rem between links
- Target good: 0.2rem within links, 0.4rem between links  
- Math: `line-height = (font-size + desired-spacing) / font-size = (0.9 + 0.2) / 0.9 = 1.22`

**CSS deployment gotcha**: Changes to SCSS files require full `npx quartz build` + git push + wait for GitHub Actions. Browser cache might also need clearing.

**The line spacing problem happens in 3 places**: TagExplorer (left sidebar), TOC (right sidebar when page has headings), and Explorer (file browser). I fixed 2 of 3.