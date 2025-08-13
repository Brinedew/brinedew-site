# what i was working on - Aug 13, 2025

The user was annoyed that their website had broken fonts, ugly scrollbars in sidebars, inconsistent typography, and highlight colors that looked like someone threw different design systems in a blender. Basically, the site looked amateur despite having decent content.

The core problem was that Quartz (the static site generator) was trying to download fonts from Google Fonts during build, getting 404 errors, and saving HTML error pages as .woff2 files. Plus the default Quartz styling was a mess of different colors, font weights, and sticky sidebars that fought with each other.

## what actually works now

Fixed the broken fonts by adding `fontOrigin: "local"` to `quartz.config.ts` line 16. Now Quartz uses the actual font files from `quartz/static/fonts/` instead of trying to download them and failing.

Files I changed:
- `quartz.config.ts` - added fontOrigin: "local" to stop the Google Fonts downloading madness
- `quartz/styles/base.scss` lines 229-230 - changed sidebars from sticky positioning to static, height from 100vh to auto
- `quartz/components/styles/explorer.scss` lines 113-114 - removed overflow-y: auto to kill the scrollbars
- `quartz/static/custom.css` - completely rewrote the color system and typography

The typography is now consistent:
- All sidebar links use Crimson Pro serif at 0.9rem with 0.85 opacity
- Body text uses proper dark academia OKLCH colors with actual contrast
- All highlights (links, hovers, text selection) use the same teal accent color
- Removed the horrible progressive dimming in the table of contents

Colors that work:
- Light mode: `oklch(20% 0.035 50)` for text on `oklch(96% 0.015 75)` background
- Dark mode: `oklch(85% 0.015 65)` for text on `oklch(8% 0.02 45)` background  
- Accent: `oklch(50% 0.08 185)` in light, `oklch(68% 0.08 185)` in dark

Commands that work:
```bash
cd "D:\Coding\Website"
npx quartz build    # builds to public/
git status          # check what changed
```

## what's broken

Nothing major is broken right now. The fonts load correctly, sidebars scroll naturally with the page, and everything has consistent colors.

Small things that could be better:
- The highlight CSS uses `oklch(from var(--accent) l c h / 0.25)` which needs CSS relative color syntax support (works in modern browsers)
- Some of the CSS specificity wars required `!important` flags to override Quartz defaults

## where things stand

The site is a Quartz 4 static site that builds to GitHub Pages. The build process:
1. Local: `npx quartz build` creates files in `public/`
2. GitHub Actions: runs the same build on push and deploys to Pages
3. Live site: brinedew.com (GitHub Pages with custom domain)

Current setup works with:
- Node.js for Quartz build process
- Fonts stored locally in `quartz/static/fonts/` 
- CSS in `quartz/static/custom.css` overrides Quartz defaults
- Content in `content/` directory (Markdown files)

## what to do next

The typography and colors are done. If someone wants to work on this further:

1. **Content optimization** - the actual blog posts in `content/posts/` could use editing
2. **Mobile experience** - test how the sidebars work on phone/tablet
3. **Performance** - the font files are pretty big, could subset them for web use

To test everything is working:
1. Check https://brinedew.com loads with proper fonts
2. Try both light and dark mode toggle
3. Hover over sidebar links and body links - should all use the same teal color
4. Select some text - should highlight with teal background

Most of the browser dev tools stuff for checking fonts:
```js
document.fonts.check('normal 400 1em "Crimson Pro"')  // should return true
getComputedStyle(document.querySelector('article')).fontFamily  // should show Crimson Pro
```

## stuff to remember

The big insight was that Quartz has this weird `fontOrigin` setting that defaults to trying to download Google Fonts even when you have local fonts. Setting it to "local" fixes the whole thing.

Also, Quartz's CSS is organized weirdly - base styles in `quartz/styles/`, component styles in `quartz/components/styles/`, but custom overrides go in `quartz/static/custom.css`. The custom CSS gets loaded last so you can override everything, but you need `!important` for specificity wars.

The OKLCH color system actually works great once you get the hang of it. Much better than HSL for creating consistent palettes. The format is `oklch(lightness% chroma hue)` where lightness is 0-100%, chroma is roughly 0-0.4, and hue is 0-360 degrees.

Don't mess with the `quartz.config.ts` theme colors - they get converted to CSS variables but in a weird way. Better to override everything in the custom CSS file.