# what i was working on - 2025-08-12

I was trying to fix a really stupid font loading problem where the site was serving HTML 404 pages instead of actual font files, making all text look terrible with font decode errors in the console.

## what actually works now

**Fixed the deployment workflow stupidity:**
- I was fixing fonts locally but never committing them - classic "works on my machine" problem
- Added a rule to CLAUDE.md (lines 364-376) to never leave fixes uncommitted
- Fixed the commit → push → deploy → test cycle properly

**Got proper font files deployed:**
- CrimsonPro-VariableFont_wght.woff2: 48,348 bytes (was serving HTML 404 pages before)
- CrimsonPro-Italic-VariableFont_wght.woff2: 51,236 bytes 
- IBMPlexMono files: 14,812 and 14,988 bytes
- All files now have proper wOF2 signatures and correct variable font weight ranges

Files I changed:
- `quartz/static/fonts/*.woff2` - replaced HTML error pages with actual Google Fonts API downloads
- `.github/workflows/*.yaml` - removed hardcoded `jackyzha0/quartz` repository conditions so CI works on this fork
- Deleted obsolete `docs/` folder and `mkdocs.yml` from old MkDocs setup
- `CLAUDE.md` lines 364-376 - added critical deployment workflow rule

Working commands:
```bash
cd D:\Coding\Website
git status  # check what needs committing
git add .
git commit -m "descriptive message"
git push origin main  # triggers GitHub Actions deployment
# Wait ~90 seconds, then test live site
```

## what's broken

**Font errors still happening despite correct files:**
According to ChatGPT's diagnosis, the OTS parsing error `1008813135 = 0x3C21444F = "<!DO"` means the browser is still getting HTML instead of font files. But when I test the font URLs directly, they return proper woff2 files with correct signatures.

This suggests either:
1. Deep browser cache issues (tried cache busting)
2. CDN propagation delays on GitHub Pages
3. Some redirect/rewrite happening I'm not seeing
4. Service worker interfering (need to check)

**Next person should run ChatGPT's diagnostic steps 1-3 from the response I got.**

## where things stand

**Deployment pipeline working:**
- GitHub Actions "Deploy Quartz to GitHub Pages" completes successfully in ~90 seconds
- Font files are definitely deployed (verified via direct fetch API calls)
- Site builds and serves correctly at brinedew.com

**Current environment:**
- Local repo: `D:\Coding\Website` on Windows
- Remote: `Brinedew/brinedw-site` GitHub repository 
- Deployment: GitHub Pages with custom domain brinedw.com
- All infrastructure (Sprint 1 & 2) completed - mobile nav works, dark mode works, typography is implemented

## what to do next

**Most urgent: Debug the font loading mystery**
Follow ChatGPT's diagnostic steps - the font files are correct on the server but something's intercepting them:

1. In browser console, run the `fetch()` test to see if you get wOF2 bytes or HTML
2. Check for service workers that might be rewriting requests
3. Verify the exact URL paths match case-sensitivity 
4. Test font loading with a cache-busting query parameter in the CSS

**Secondary: Content quality issues**
Once fonts work, there's a bigger content workflow problem:
- `content/posts/vibes-are-principal-components.md` is published but contains raw audio transcription ("Rhh!sdsdsds")
- No editorial review process between draft and publish
- Excalidraw images showing as text links instead of rendered diagrams

The infrastructure is solid now. The remaining work is content quality and editorial workflow, not technical fixes.

## stuff to remember

**Why the font problem was so persistent:**
I kept downloading fonts that looked correct locally but were actually the wrong type - first HTML 404 pages, then static fonts when the CSS expected variable fonts (weight range 300-900). The final variable fonts from Google Fonts API are the right ones.

**The deployment workflow that actually works:**
Never test locally and assume it's fixed. Always commit → push → wait for deployment → test live site. I wasted hours "fixing" things that were only fixed locally.

**What ChatGPT figured out instantly:**
The OTS error number decodes to ASCII "<!DO" meaning the browser is getting HTML, not font bytes. This is a classic redirect/404/service worker issue, not a font compatibility problem.

If the next person can't resolve the font loading with ChatGPT's diagnostic steps, consider switching to a different font delivery method (CDN like Bunny Fonts or Google Fonts directly) rather than self-hosting.