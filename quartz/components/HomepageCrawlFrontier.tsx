import { FullSlug, resolveRelative } from "../util/path"
import { classifyCrawlSection, isCrawlableFile } from "../util/crawlability"
import { byDateAndAlphabetical } from "./PageList"
import style from "./styles/homepageCrawlFrontier.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const sectionTitles = {
  posts: "Posts",
  apps: "Apps",
  wiki: "Wiki",
}

const sectionLimits = {
  posts: 4,
  wiki: 4,
}

const summarize = (description: unknown): string | null => {
  if (typeof description !== "string") return null
  const compact = description.replace(/\s+/g, " ").trim()
  if (!compact) return null
  return compact.length > 130 ? `${compact.slice(0, 127).trim()}...` : compact
}

const homepageDescription = (description: unknown): string | null => summarize(description)

const homepageApps = [
  {
    slug: "apps/iconoplasm/index" as FullSlug,
    title: "Iconoplasm",
    description: "Gene personas and visual identities for human protein-coding genes.",
  },
  {
    slug: "apps/geneguessr/index" as FullSlug,
    title: "GeneGuessr",
    description: "A daily protein guessing game built from structure and function clues.",
  },
]

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
    }

    return (
      <nav class="homepage-crawl-frontier" aria-label="Site index">
        <div class="homepage-crawl-frontier__primary-links">
          <a class="internal" href={resolveRelative(fileData.slug!, "posts/index" as FullSlug)}>
            Posts
          </a>
          <a class="internal" href={resolveRelative(fileData.slug!, "wiki/index" as FullSlug)}>
            Wiki
          </a>
          <a class="internal" href={resolveRelative(fileData.slug!, "apps/index" as FullSlug)}>
            Apps
          </a>
        </div>
        <div class="homepage-crawl-frontier__sections">
          {(["posts", "wiki"] as const).map((section) =>
            sections[section].length > 0 ? (
              <section>
                <h2>{sectionTitles[section]}</h2>
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
            <h2>{sectionTitles.apps}</h2>
            <ul>
              {homepageApps.map((app) => (
                <li>
                  <a class="internal" href={resolveRelative(fileData.slug!, app.slug)}>
                    {app.title}
                  </a>
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

  HomepageCrawlFrontier.css = style
  return HomepageCrawlFrontier
}) satisfies QuartzComponentConstructor
