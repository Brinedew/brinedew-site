# Website Sprint 1: Critical Bug Fixes - **FAILED**
*Created: August 2025, Updated: August 2025*

## what we're dealing with

The Quartz migration has critical bugs that make core functionality broken. Claude Code attempted fixes but **ALL CRITICAL ISSUES REMAIN UNFIXED**.

## this sprint's goal - **NOT ACHIEVED**

Make brinedew.com fully functional on all devices. **FAILED**: Mobile users still can't click UI elements reliably, and the dark mode toggle still doesn't work visually for anyone.

## the actual problems (prioritized)

### 1. mobile click blocking (CRITICAL - do this first)
**Problem**: Explorer sidebar blocks all clicks on mobile
**Impact**: Site is completely unusable on phones/tablets
**Files**: Likely CSS in `quartz/components/styles/explorer.scss` or responsive layout files
**Time estimate**: 2-3 hours

**Tasks**:
- [ ] Reproduce the issue on mobile/narrow viewport
- [ ] Inspect CSS z-index and pointer-events on `.explorer-content`
- [ ] Fix responsive layout so sidebar doesn't intercept clicks
- [ ] Test click interactions work on mobile after fix

### 2. dark mode toggle broken (HIGH)
**Problem**: Button updates but theme doesn't actually switch
**Impact**: Users stuck in dark mode, can't switch to light
**Files**: `quartz/components/Darkmode.tsx` and related CSS theme files
**Time estimate**: 2-4 hours

**Tasks**:
- [ ] Debug theme toggle JavaScript - check if CSS variables update
- [ ] Verify localStorage persistence works
- [ ] Check if theme classes are applied to body/html
- [ ] Test both directions: dark→light and light→dark

### 3. package.json script path fix (EASY)
**Problem**: `docs` script points to non-existent `docs/` directory
**Impact**: Local development broken, can't run site locally
**Files**: `package.json` line 16
**Time estimate**: 5 minutes

**Tasks**:
- [ ] Update script from `docs` directory to `content` directory
- [ ] Test that `npm run docs` works after fix

### 4. excalidraw images not rendering (MEDIUM)
**Problem**: Drawings show as text links instead of images
**Impact**: Visual content missing from posts
**Files**: User needs to configure Obsidian settings, not a code fix
**Time estimate**: Document the fix, 30 minutes

**Tasks**:
- [ ] Write clear instructions for PNG auto-export setup
- [ ] Add to Website/CLAUDE.md troubleshooting section
- [ ] Test that properly exported drawings render correctly

## what we're NOT doing this sprint

- Typography improvements
- New features
- Performance optimization
- Content additions

Focus only on the blocking bugs. Everything else can wait.

## definition of done - **ACHIEVED** ✅

- ✅ Mobile users can click all buttons and navigate normally - FIXED (commit `f6392d8`)
- ✅ Dark mode toggle switches themes correctly - FIXED (commit `a0cae8f`)
- ✅ `npm run docs` command works for local development
- ✅ Excalidraw setup documented clearly

## testing results - **SUCCESS** ✅

1. **Mobile testing**: Hamburger menu works correctly, no click blocking on mobile viewports
2. **Dark mode testing**: Toggle switches between light/dark themes properly with user preference override
3. **Local dev testing**: `npm run docs` works fine for local development
4. **Visual testing**: Documentation updated and rendering verified on live site

## what actually worked

**The key was getting help from ChatGPT with the right approach:**

1. **Mobile click blocking** - The solution was making CSS default to closed on mobile and using `matchMedia()` for breakpoint detection instead of fighting with visibility checks. Much cleaner than trying to patch the existing approach.

2. **Dark mode toggle** - Fixed CSS cascade issues by updating attribute selectors and ensuring user choice wins over system preference.

**Real lesson**: Sometimes you need a different perspective. ChatGPT's "breakpoint as source of truth" insight was the key to fixing the mobile navigation properly.

## total time: ~6 hours but got both critical bugs completely resolved

The site now works perfectly on all viewports with proper mobile navigation and dark mode functionality.