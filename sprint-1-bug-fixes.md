# Website Sprint 1: Critical Bug Fixes
*Created: August 2025*

## what we're dealing with

The Quartz migration is mostly done, but there are some critical bugs making the site unusable on mobile and breaking core features. Based on the bugs_log.md analysis and gemini's investigation, here's what actually needs fixing.

## this sprint's goal

Make brinedew.com fully functional on all devices. Right now mobile users can't click anything, and the dark mode toggle doesn't work for anyone.

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

## definition of done

- [ ] Mobile users can click all buttons and navigate normally
- [ ] Dark mode toggle switches themes correctly
- [ ] `npm run docs` command works for local development
- [ ] Excalidraw setup documented clearly

## testing plan

1. **Mobile testing**: Use browser dev tools to test narrow viewport (375px width)
2. **Dark mode testing**: Toggle multiple times, refresh page, check localStorage
3. **Local dev testing**: Run `npm run docs` and verify site builds/serves
4. **Visual testing**: Check that excalidraw images display properly when exported correctly

## hand-off criteria

When this sprint is done, the site should work normally for all users on all devices. No major functionality should be broken or unusable.

## time estimate: 1-2 days

Most of this is debugging and CSS fixes. The mobile click issue might take the longest to track down, but once found it's probably a small CSS change.