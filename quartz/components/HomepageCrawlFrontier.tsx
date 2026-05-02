import { FullSlug, resolveRelative } from "../util/path"
import { classifyCrawlSection, isCrawlableFile } from "../util/crawlability"
import { Date, getDate } from "./Date"
import { byDateAndAlphabetical } from "./PageList"
import style from "./styles/homepageCrawlFrontier.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

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
          {(["posts", "wiki", "apps", "pages"] as const).map((section) =>
            sections[section].length > 0 ? (
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
            ) : null,
          )}
        </div>
      </nav>
    )
  }

  HomepageCrawlFrontier.css = style
  return HomepageCrawlFrontier
}) satisfies QuartzComponentConstructor
