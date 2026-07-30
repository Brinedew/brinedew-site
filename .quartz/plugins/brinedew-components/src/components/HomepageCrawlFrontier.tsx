import { FullSlug, resolveRelative } from "../util/path"
import { classifyCrawlSection, isCrawlableFile } from "../util/crawlability"
import { homepageAppHref, homepageApps } from "./homepageApps"
import { byDateAndAlphabetical } from "./PageList"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const sectionTitles = {
  posts: "Posts",
  apps: "Apps",
  wiki: "Wiki",
}

const sectionTargets = {
  posts: "tags/content/post" as FullSlug,
  apps: "apps/index" as FullSlug,
  wiki: "tags/content/wiki" as FullSlug,
}

const sectionLimits = {
  posts: 4,
  wiki: 4,
}

const isMetaInventoryFile = (file: { frontmatter?: Record<string, unknown> | null }): boolean => {
  const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter.tags : []
  return tags.includes("meta") || tags.includes("content/meta")
}

const sectionIndexSlugs = new Set(["posts/index", "wiki/index", "apps/index"])

const summarize = (description: unknown): string | null => {
  if (typeof description !== "string") return null
  const compact = description.replace(/\s+/g, " ").trim()
  if (!compact) return null
  return compact.length > 130 ? `${compact.slice(0, 127).trim()}...` : compact
}

const homepageDescription = (description: unknown): string | null => summarize(description)

export default (() => {
  const HomepageCrawlFrontier: QuartzComponent = ({
    cfg,
    fileData,
    allFiles,
  }: QuartzComponentProps) => {
    if (fileData.slug !== "index") return null

    const sorted = allFiles
      .filter(
        (file) =>
          isCrawlableFile(file) &&
          file.slug !== "index" &&
          !sectionIndexSlugs.has(String(file.slug)) &&
          !isMetaInventoryFile(file) &&
          // Drafts stay on tag pages; keep them off the public frontpage.
          classifyCrawlSection(file) !== "drafts",
      )
      .sort(byDateAndAlphabetical())

    const sections = {
      posts: sorted
        .filter((file) => classifyCrawlSection(file) === "posts")
        .slice(0, sectionLimits.posts),
      wiki: sorted
        .filter((file) => classifyCrawlSection(file) === "wiki")
        .slice(0, sectionLimits.wiki),
    }
    const baseUrl = cfg.baseUrl ?? "brinedew.bio"

    return (
      <nav class="homepage-crawl-frontier" aria-label="Site index">
        <div class="homepage-crawl-frontier__sections">
          {(["posts", "wiki"] as const).map((section) =>
            sections[section].length > 0 ? (
              <section>
                <h2>
                  {sectionTargets[section] ? (
                    <a
                      class="internal"
                      href={resolveRelative(fileData.slug!, sectionTargets[section]!)}
                    >
                      {sectionTitles[section]}
                    </a>
                  ) : (
                    sectionTitles[section]
                  )}
                </h2>
                <ul>
                  {sections[section].map((page) => (
                    <li>
                      <a class="internal" href={resolveRelative(fileData.slug!, page.slug!)}>
                        {page.frontmatter?.title ?? page.slug}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
          <section>
            <h2>
              <a class="internal" href={resolveRelative(fileData.slug!, sectionTargets.apps)}>
                {sectionTitles.apps}
              </a>
            </h2>
            <ul>
              {homepageApps.map((app) => (
                <li>
                  <a href={homepageAppHref(baseUrl, app)}>{app.title}</a>
                  {homepageDescription(app.description) && (
                    <p>{homepageDescription(app.description)}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </nav>
    )
  }

  HomepageCrawlFrontier.css = `
.homepage-crawl-frontier {
  margin: 2.5rem 0 0;
}

.homepage-crawl-frontier__sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 2rem;
}

.homepage-crawl-frontier h2 {
  color: var(--darkgray);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0 0 0.75rem;
  text-transform: uppercase;
}

.homepage-crawl-frontier h2 > a {
  color: inherit;
}

.homepage-crawl-frontier ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.homepage-crawl-frontier li {
  margin: 0 0 0.85rem;
}

.homepage-crawl-frontier li > a {
  display: inline-block;
  line-height: 1.2;
}

.homepage-crawl-frontier p {
  color: var(--gray);
  font-size: 0.92rem;
  line-height: 1.35;
  margin: 0.18rem 0 0;
}
`

  return HomepageCrawlFrontier
}) satisfies QuartzComponentConstructor
