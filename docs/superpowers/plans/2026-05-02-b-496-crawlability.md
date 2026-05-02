# B-496 Crawlability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `brinedew.bio` automatically easier for search crawlers and AI agents to discover, summarize, and follow from the homepage and static crawl artifacts.

**Architecture:** Keep crawlability generation inside the Quartz static build so new Obsidian notes are picked up automatically. Add one shared crawlability model, use it from homepage links, metadata, sitemap/RSS/search index, and a generated `/llms.txt`, while keeping Cloudflare Workers out of the public crawl path.

**Tech Stack:** Quartz 4 fork, TypeScript/Preact components, Node `node:test`, Cloudflare Pages static output, Playwright MCP for browser verification.

---

## Context

Linear issue: `B-496` ("make site more crawlable").

Current crawl problem, verified with Playwright MCP against `https://brinedew.bio/`: the root page exposes only the tagline, Geneguessr, and footer links. Important content exists in generated tag/folder pages, but a search agent starting at `/` sees a weak frontier.

Subagent findings:

- Static content lives in `D:\Coding\Website\content`.
- Quartz emits static HTML from `content/`; production deploy serves static Pages through a public edge Worker.
- `D:\Coding\Website\quartz\plugins\emitters\contentIndex.tsx` emits `sitemap.xml`, `index.xml`, and `static/contentIndex.json`.
- `D:\Coding\Website\quartz\components\Head.tsx` owns canonical/meta description/OG/Twitter tags.
- `D:\Coding\Website\content\robots.txt` is copied as a static file and already points to `https://brinedew.bio/sitemap.xml`.
- `https://brinedew.bio/llms.txt` currently returns `404`.
- Do not add public runtime crawl routes that touch D1/KV/DO. The crawl fix should be static Quartz output.
- Do not touch or weaken Iconoplasm D1 guard tests.

Existing unrelated local changes to preserve:

- `D:\Coding\Website\.github\workflows\iconoplasm-queue-diagnostics.yml`
- `D:\Coding\Website\docs\ICONOPLASM_DEPLOY_CREDENTIALS.md`

## File Structure

- Create `D:\Coding\Website\quartz\util\crawlability.ts`
  - Shared helpers for draft/noindex detection, public URL mapping, section classification, and crawlable file filtering.
- Create `D:\Coding\Website\quartz\util\crawlability.test.ts`
  - Unit tests for the shared crawlability rules.
- Create `D:\Coding\Website\quartz\components\HomepageCrawlFrontier.tsx`
  - Homepage-only component that automatically renders crawlable links to recent posts, wiki entries, apps, tags, sitemap, RSS, and `llms.txt`.
- Create `D:\Coding\Website\quartz\components\styles\homepageCrawlFrontier.scss`
  - Minimal layout for the homepage crawl frontier.
- Modify `D:\Coding\Website\quartz\components\index.ts`
  - Export `HomepageCrawlFrontier`.
- Modify `D:\Coding\Website\quartz.layout.ts`
  - Add `HomepageCrawlFrontier` to the root page only.
- Modify `D:\Coding\Website\quartz\components\Head.tsx`
  - Add robots meta for `draft`, `noindex`, or `excludeFromSearch` frontmatter.
  - Reuse public URL mapping for canonical/social URLs where possible.
- Modify `D:\Coding\Website\quartz\plugins\emitters\contentIndex.tsx`
  - Use shared indexability rules.
  - Generate `/llms.txt`.
  - Keep sitemap/RSS/search URLs consistent for mapped app subdomains.
- Modify `D:\Coding\Website\quartz\plugins\emitters\index.ts`
  - Export any new emitter only if `llms.txt` is split out; otherwise no change.
- Modify `D:\Coding\Website\quartz.config.ts`
  - No new plugin needed if `llms.txt` is added to `ContentIndex`; otherwise add the emitter immediately after `ContentIndex`.

## Task 1: Shared Crawlability Rules

**Files:**

- Create: `D:\Coding\Website\quartz\util\crawlability.ts`
- Create: `D:\Coding\Website\quartz\util\crawlability.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `D:\Coding\Website\quartz\util\crawlability.test.ts`:

```ts
import assert from "node:assert/strict"
import test, { describe } from "node:test"
import { FullSlug } from "./path"
import {
  classifyCrawlSection,
  getPublicUrlForSlug,
  isCrawlableFile,
  isNoIndexFile,
} from "./crawlability"

describe("crawlability rules", () => {
  test("draft and noindex files are not crawlable", () => {
    assert.equal(isNoIndexFile({ frontmatter: { draft: true } }), true)
    assert.equal(isNoIndexFile({ frontmatter: { draft: "true" } }), true)
    assert.equal(isNoIndexFile({ frontmatter: { noindex: true } }), true)
    assert.equal(isNoIndexFile({ frontmatter: { excludeFromSearch: true } }), true)
    assert.equal(isNoIndexFile({ frontmatter: { draft: false } }), false)
  })

  test("crawlable file requires a slug and public frontmatter", () => {
    assert.equal(
      isCrawlableFile({ slug: "posts/example" as FullSlug, frontmatter: { title: "Example" } }),
      true,
    )
    assert.equal(
      isCrawlableFile({
        slug: "posts/draft" as FullSlug,
        frontmatter: { title: "Draft", draft: true },
      }),
      false,
    )
    assert.equal(isCrawlableFile({ frontmatter: { title: "Missing slug" } }), false)
  })

  test("public URL mapping keeps app subdomains consistent", () => {
    assert.equal(getPublicUrlForSlug("brinedew.bio", "index" as FullSlug), "https://brinedew.bio/")
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "posts/Iconoplasm-FAQ" as FullSlug),
      "https://brinedew.bio/posts/Iconoplasm-FAQ",
    )
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "apps/geneguessr" as FullSlug),
      "https://geneguessr.brinedew.bio/",
    )
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "apps/geneguessr/privacy" as FullSlug),
      "https://geneguessr.brinedew.bio/privacy",
    )
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "apps/iconoplasm" as FullSlug),
      "https://iconoplasm.brinedew.bio/",
    )
  })

  test("sections are derived from slugs and tags", () => {
    assert.equal(
      classifyCrawlSection({
        slug: "apps/iconoplasm" as FullSlug,
        frontmatter: { tags: ["content/apps"] },
      }),
      "apps",
    )
    assert.equal(
      classifyCrawlSection({
        slug: "posts/Example" as FullSlug,
        frontmatter: { tags: ["topic/cancer"] },
      }),
      "posts",
    )
    assert.equal(
      classifyCrawlSection({
        slug: "wiki/Glossary" as FullSlug,
        frontmatter: { tags: ["content/wiki"] },
      }),
      "wiki",
    )
    assert.equal(
      classifyCrawlSection({ slug: "About" as FullSlug, frontmatter: { title: "About" } }),
      "pages",
    )
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run with a 60 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm test -- quartz/util/crawlability.test.ts }
if (-not (Wait-Job $job -Timeout 60)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 60 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Test job failed' }
```

Expected: fails because `quartz/util/crawlability.ts` does not exist.

- [ ] **Step 3: Implement shared helper**

Create `D:\Coding\Website\quartz\util\crawlability.ts`:

```ts
import { FullSlug, SimpleSlug, joinSegments, simplifySlug } from "./path"
import { QuartzPluginData } from "../plugins/vfile"

const truthyFrontmatter = (value: unknown): boolean => value === true || value === "true"

const subdomainMappings: Record<string, string> = {
  "apps/geneguessr": "geneguessr.brinedew.bio",
  "apps/iconoplasm": "iconoplasm.brinedew.bio",
}

export type CrawlSection = "apps" | "posts" | "wiki" | "pages"

export function isNoIndexFile(file: Pick<QuartzPluginData, "frontmatter">): boolean {
  const fm = file.frontmatter ?? {}
  return (
    truthyFrontmatter(fm.draft) ||
    truthyFrontmatter(fm.noindex) ||
    truthyFrontmatter(fm.excludeFromSearch)
  )
}

export function isCrawlableFile(file: QuartzPluginData): boolean {
  return typeof file.slug === "string" && file.slug.length > 0 && !isNoIndexFile(file)
}

export function getPublicUrlForSlug(baseUrl: string, slug: FullSlug | SimpleSlug): string {
  const simpleSlug = simplifySlug(slug as FullSlug)
  if (simpleSlug === "" || simpleSlug === "index") {
    return `https://${baseUrl}/`
  }

  for (const [pathPrefix, subdomain] of Object.entries(subdomainMappings)) {
    if (simpleSlug === pathPrefix || simpleSlug.startsWith(pathPrefix + "/")) {
      if (simpleSlug === pathPrefix) {
        return `https://${subdomain}/`
      }
      return `https://${subdomain}${simpleSlug.slice(pathPrefix.length)}`
    }
  }

  return `https://${joinSegments(baseUrl, encodeURI(simpleSlug))}`
}

export function classifyCrawlSection(file: QuartzPluginData): CrawlSection {
  const slug = String(file.slug ?? "")
  const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter.tags : []

  if (slug.startsWith("apps/") || tags.includes("content/apps")) return "apps"
  if (slug.startsWith("posts/") || tags.includes("content/post")) return "posts"
  if (slug.startsWith("wiki/") || tags.includes("content/wiki")) return "wiki"

  return "pages"
}
```

- [ ] **Step 4: Run the unit test again**

Run:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm test -- quartz/util/crawlability.test.ts }
if (-not (Wait-Job $job -Timeout 60)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 60 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Test job failed' }
```

Expected: PASS.

## Task 2: Automatic Homepage Crawl Frontier

**Files:**

- Create: `D:\Coding\Website\quartz\components\HomepageCrawlFrontier.tsx`
- Create: `D:\Coding\Website\quartz\components\styles\homepageCrawlFrontier.scss`
- Modify: `D:\Coding\Website\quartz\components\index.ts`
- Modify: `D:\Coding\Website\quartz.layout.ts`

- [ ] **Step 1: Add the homepage component**

Create `D:\Coding\Website\quartz\components\HomepageCrawlFrontier.tsx`:

```tsx
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { Date, getDate } from "./Date"
import { byDateAndAlphabetical } from "./PageList"
import { FullSlug, resolveRelative } from "../util/path"
import { classifyCrawlSection, isCrawlableFile } from "../util/crawlability"
import style from "./styles/homepageCrawlFrontier.scss"

const sectionTitles = {
  posts: "Latest posts",
  wiki: "Wiki entries",
  apps: "Apps",
  pages: "Start here",
}

const sectionLimits = {
  posts: 8,
  wiki: 8,
  apps: 6,
  pages: 6,
}

export default (() => {
  const HomepageCrawlFrontier: QuartzComponent = ({
    cfg,
    fileData,
    allFiles,
  }: QuartzComponentProps) => {
    if (fileData.slug !== "index") return null

    const sorted = allFiles
      .filter((file) => isCrawlableFile(file) && file.slug !== "index")
      .sort(byDateAndAlphabetical(cfg))

    const sections = {
      posts: sorted
        .filter((file) => classifyCrawlSection(file) === "posts")
        .slice(0, sectionLimits.posts),
      wiki: sorted
        .filter((file) => classifyCrawlSection(file) === "wiki")
        .slice(0, sectionLimits.wiki),
      apps: sorted
        .filter((file) => classifyCrawlSection(file) === "apps")
        .slice(0, sectionLimits.apps),
      pages: sorted
        .filter((file) => classifyCrawlSection(file) === "pages")
        .slice(0, sectionLimits.pages),
    }

    return (
      <nav class="homepage-crawl-frontier" aria-label="Site index">
        <div class="homepage-crawl-frontier__quick-links">
          <a class="internal" href={resolveRelative(fileData.slug!, "posts/index" as FullSlug)}>
            All posts
          </a>
          <a class="internal" href={resolveRelative(fileData.slug!, "wiki/index" as FullSlug)}>
            Wiki
          </a>
          <a class="internal" href={resolveRelative(fileData.slug!, "apps/index" as FullSlug)}>
            Apps
          </a>
          <a class="internal" href={resolveRelative(fileData.slug!, "tags/index" as FullSlug)}>
            Tags
          </a>
          <a href="/sitemap.xml">Sitemap</a>
          <a href="/index.xml">RSS</a>
          <a href="/llms.txt">llms.txt</a>
        </div>
        <div class="homepage-crawl-frontier__sections">
          {(["posts", "wiki", "apps", "pages"] as const).map(
            (section) =>
              sections[section].length > 0 && (
                <section>
                  <h2>{sectionTitles[section]}</h2>
                  <ul>
                    {sections[section].map((page) => (
                      <li>
                        <a class="internal" href={resolveRelative(fileData.slug!, page.slug!)}>
                          {page.frontmatter?.title ?? page.slug}
                        </a>
                        {page.dates && (
                          <small>
                            <Date date={getDate(cfg, page)!} locale={cfg.locale} />
                          </small>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      </nav>
    )
  }

  HomepageCrawlFrontier.css = style
  return HomepageCrawlFrontier
}) satisfies QuartzComponentConstructor
```

- [ ] **Step 2: Add styling**

Create `D:\Coding\Website\quartz\components\styles\homepageCrawlFrontier.scss`:

```scss
.homepage-crawl-frontier {
  margin-top: 2rem;
}

.homepage-crawl-frontier__quick-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 0 0 1.5rem;
}

.homepage-crawl-frontier__sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 1.5rem;
}

.homepage-crawl-frontier h2 {
  font-size: 1.05rem;
  margin: 0 0 0.5rem;
}

.homepage-crawl-frontier ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.homepage-crawl-frontier li {
  margin: 0.35rem 0;
}

.homepage-crawl-frontier small {
  color: var(--gray);
  display: block;
  font-size: 0.85rem;
  line-height: 1.2;
}
```

- [ ] **Step 3: Export the component**

Modify `D:\Coding\Website\quartz\components\index.ts`:

```ts
import HomepageCrawlFrontier from "./HomepageCrawlFrontier"
```

Add it to the exported object:

```ts
HomepageCrawlFrontier,
```

- [ ] **Step 4: Add it to the root layout**

Modify `D:\Coding\Website\quartz.layout.ts` in `defaultContentPageLayout.beforeBody`:

```ts
Component.ProteinInfobox(),
Component.HomepageCrawlFrontier(),
```

Expected behavior: the component returns `null` everywhere except `content/index.md`, so no other pages get new chrome.

## Task 3: Robots Meta and Indexability

**Files:**

- Modify: `D:\Coding\Website\quartz\components\Head.tsx`
- Modify: `D:\Coding\Website\quartz\plugins\emitters\contentIndex.tsx`

- [ ] **Step 1: Add `noindex` meta to `Head.tsx`**

Import helper:

```ts
import { getPublicUrlForSlug, isNoIndexFile } from "../util/crawlability"
```

After `canonicalUrl` is computed, add:

```ts
const robotsDirective = isNoIndexFile(fileData) ? "noindex,nofollow,noarchive" : "index,follow"
```

In the `<head>` output near the description meta, add:

```tsx
<meta name="robots" content={robotsDirective} />
```

For canonical/social URL consistency, replace the default `socialUrl` computation with:

```ts
const socialUrl =
  fileData.slug === "404"
    ? url.toString()
    : getPublicUrlForSlug(cfg.baseUrl ?? "example.com", fileData.slug!)
```

- [ ] **Step 2: Use shared indexability in `ContentIndex`**

Modify imports in `D:\Coding\Website\quartz\plugins\emitters\contentIndex.tsx`:

```ts
import { getPublicUrlForSlug, isCrawlableFile } from "../../util/crawlability"
```

Remove the local `subdomainMappings` and `isDraftFile` helpers.

In the emit loop, replace:

```ts
if (isDraftFile(file.data)) {
  continue
}
```

with:

```ts
if (!isCrawlableFile(file.data)) {
  continue
}
```

In `generateSiteMap`, use:

```ts
const createURLEntry = (slug: FullSlug, content: ContentDetails): string => `<url>
    <loc>${getPublicUrlForSlug(base, slug)}</loc>
    ${content.date && `<lastmod>${content.date.toISOString()}</lastmod>`}
  </url>`
```

In `generateRSSFeed`, use:

```ts
const href = getPublicUrlForSlug(base, slug as FullSlug)
```

and then use `href` for both `<link>` and `<guid>`.

## Task 4: Generate `/llms.txt`

**Files:**

- Modify: `D:\Coding\Website\quartz\plugins\emitters\contentIndex.tsx`

- [ ] **Step 1: Add `llms.txt` generator**

In `D:\Coding\Website\quartz\plugins\emitters\contentIndex.tsx`, add:

```ts
function generateLlmsTxt(cfg: GlobalConfiguration, idx: ContentIndexMap): string {
  const base = cfg.baseUrl ?? ""
  const rows = Array.from(idx)
    .filter(([slug]) => slug !== "index")
    .sort(([aSlug, a], [bSlug, b]) => {
      const aRank = sectionRank(aSlug)
      const bRank = sectionRank(bSlug)
      if (aRank !== bRank) return aRank - bRank
      if (a.date && b.date) return b.date.getTime() - a.date.getTime()
      return a.title.localeCompare(b.title)
    })

  const lines = [
    "# Brinedew.bio",
    "",
    "Research notes on molecular cell biology through the lens of agents, altruism, and defection.",
    "",
    "This file is generated from the public Obsidian/Quartz content at build time.",
    "",
    "## Core indexes",
    "",
    `- [Homepage](https://${base}/): Site entry point`,
    `- [Sitemap](https://${base}/sitemap.xml): XML sitemap`,
    `- [RSS](https://${base}/index.xml): Recent public updates`,
    `- [Tags](https://${base}/tags): Generated tag index`,
    "",
    "## Public content",
    "",
    ...rows.map(([slug, content]) => {
      const description = content.description
        ? ` - ${content.description.replace(/\s+/g, " ").trim()}`
        : ""
      return `- [${content.title}](${getPublicUrlForSlug(base, slug)})${description}`
    }),
    "",
  ]

  return lines.join("\n")
}

function sectionRank(slug: FullSlug): number {
  if (slug.startsWith("apps/")) return 0
  if (slug.startsWith("posts/")) return 1
  if (slug.startsWith("wiki/")) return 2
  return 3
}
```

- [ ] **Step 2: Emit `llms.txt`**

After sitemap/RSS emission in `ContentIndex.emit`, add:

```ts
yield write({
  ctx,
  content: generateLlmsTxt(cfg, linkIndex),
  slug: "llms" as FullSlug,
  ext: ".txt",
})
```

Expected generated route: `https://brinedew.bio/llms.txt`.

## Task 5: Static Build Verification

**Files:**

- No new files unless tests reveal compile errors.

- [ ] **Step 1: Run focused unit tests**

Run with a 90 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm test -- quartz/util/crawlability.test.ts }
if (-not (Wait-Job $job -Timeout 90)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 90 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Focused tests failed' }
```

Expected: PASS.

- [ ] **Step 2: Run type/style check**

Run with a 180 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm run check }
if (-not (Wait-Job $job -Timeout 180)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 180 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Check failed' }
```

Expected: PASS.

- [ ] **Step 3: Build static site**

Run with a 240 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm run build }
if (-not (Wait-Job $job -Timeout 240)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 240 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Build failed' }
```

Expected: PASS and `D:\Coding\Website\public\llms.txt` exists.

- [ ] **Step 4: Inspect generated crawl artifacts**

Run:

```powershell
Set-Location 'D:\Coding\Website'
Select-String -Path 'public\index.html' -Pattern 'Latest posts','Wiki entries','llms.txt','sitemap.xml'
Select-String -Path 'public\llms.txt' -Pattern '# Brinedew.bio','Iconoplasm','Glossary','Sitemap'
Select-String -Path 'public\sitemap.xml' -Pattern 'https://iconoplasm.brinedew.bio/','https://geneguessr.brinedew.bio/'
```

Expected:

- Homepage has automatic crawl frontier text and links.
- `llms.txt` includes key public pages from Obsidian content.
- Sitemap maps `apps/iconoplasm` and `apps/geneguessr` to their subdomains.

## Task 6: Playwright MCP Browser Verification

**Files:**

- No source edits expected.

- [ ] **Step 1: Start local Quartz server with a deadline-aware command**

Run:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm run dev }
Start-Sleep -Seconds 8
Receive-Job $job -Keep
```

Keep the job id visible. If the server does not print a local URL within 60 seconds, stop it:

```powershell
if (-not (Wait-Job $job -Timeout 60)) { Receive-Job $job -Keep; Stop-Job $job; throw 'Dev server did not become ready within 60 seconds' }
```

If `npm run dev` keeps running normally after printing the URL, do not wait for completion; use the printed localhost URL for Playwright MCP.

- [ ] **Step 2: Use Playwright MCP to inspect the homepage**

Use Playwright MCP, not shell browser helpers:

1. `browser_navigate` to the local URL printed by Quartz.
2. `browser_snapshot` with boxes enabled.
3. Confirm the accessibility snapshot contains:
   - `All posts`
   - `Wiki`
   - `Apps`
   - `Tags`
   - `Sitemap`
   - `RSS`
   - `llms.txt`
   - at least one real post link
   - at least one real wiki link

- [ ] **Step 3: Use Playwright MCP to inspect generated artifacts**

Navigate with Playwright MCP to:

- `/llms.txt`
- `/sitemap.xml`
- `/index.xml`

Expected:

- `/llms.txt` loads as text and starts with `# Brinedew.bio`.
- `/sitemap.xml` includes crawlable public URLs.
- `/index.xml` loads RSS XML.

- [ ] **Step 4: Stop the dev server**

Run:

```powershell
Stop-Job $job
Receive-Job $job
Remove-Job $job
```

## Task 7: Full Safety Verification

**Files:**

- No source edits expected unless tests fail.

- [ ] **Step 1: Run the protected Iconoplasm D1 guard tests**

Run with a 180 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm test -- workers/iconoplasm.d1-cost-barrier.test.js workers/iconoplasm.d1-hot-query-guard.test.js workers/iconoplasm.do-not-delete-cost-guards.test.js }
if (-not (Wait-Job $job -Timeout 180)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 180 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'D1 guard tests failed' }
```

Expected: PASS. If any fail, assume guardrail drift or accidental unsafe code until proven otherwise.

- [ ] **Step 2: Run route smoke tests relevant to the edge/backend boundary**

Run with a 180 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm test -- workers/admin-routing.test.js workers/index.iconoplasm-routing.test.js }
if (-not (Wait-Job $job -Timeout 180)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 180 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Route tests failed' }
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite if focused tests pass**

Run with a 300 second deadline:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; npm test }
if (-not (Wait-Job $job -Timeout 300)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 300 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Full test suite failed' }
```

Expected: PASS.

## Task 8: Deployment Plan

**Files:**

- No source edits expected.

- [ ] **Step 1: Review local diff before deploy**

Run:

```powershell
Set-Location 'D:\Coding\Website'
git status --short
git diff -- quartz util components plugins quartz.config.ts quartz.layout.ts content
```

Expected:

- B-496 files only, plus pre-existing unrelated changes left untouched.
- No changes to `workers/iconoplasm-gateway.js`.
- No weakening of D1 guard tests.

- [ ] **Step 2: Deploy through the normal production path**

After implementation and tests pass, use the canonical deploy path:

```powershell
$job = Start-Job { Set-Location 'D:\Coding\Website'; pwsh -File scripts/deploy-cloudflare-prod.ps1 }
if (-not (Wait-Job $job -Timeout 900)) { Stop-Job $job; Receive-Job $job; throw 'Timed out after 900 seconds' }
Receive-Job $job
if ((Get-Job $job).State -ne 'Completed') { throw 'Production deploy failed' }
```

Expected: GitHub Actions production workflow is dispatched or completed according to the script behavior.

- [ ] **Step 3: Verify live site with Playwright MCP**

Use Playwright MCP:

1. Navigate to `https://brinedew.bio/`.
2. Snapshot the page.
3. Confirm homepage exposes crawlable links to posts/wiki/apps/tags/sitemap/RSS/`llms.txt`.
4. Navigate to `https://brinedew.bio/llms.txt`.
5. Navigate to `https://brinedew.bio/sitemap.xml`.

Expected: live behavior matches local build verification.

## Self-Review

- Spec coverage: The plan addresses homepage crawl frontier, internal links, `llms.txt`, metadata, sitemap/RSS consistency, and automatic generation from Obsidian/Quartz content.
- Backend boundary: The plan keeps all crawl artifacts static and does not add runtime D1/KV/DO reads.
- Test coverage: Unit tests cover indexability and URL mapping; build inspection covers emitted artifacts; Playwright MCP covers browser-visible crawl surface; protected backend tests cover D1 guardrails.
- Known risk: `npm run build` rewrites `public/`; review generated changes separately before committing.
