import type { FullSlug, QuartzPluginData, SortFn } from "@quartz-community/types"
import { resolveRelative } from "@quartz-community/utils/path"
import { archiveDate, partitionArchive } from "../archive"

interface ArchiveCopy {
  eyebrow: string
  description: string
  draftDescription: string
}

const archiveCopy: Record<string, ArchiveCopy> = {
  "content/post": {
    eyebrow: "ESSAYS & ARGUMENTS",
    description:
      "Long-form writing on molecular biology, aging, evolution, and the incentives around science.",
    draftDescription:
      "Public works in progress. These may contain gaps, rough edges, and conclusions that change.",
  },
  "content/wiki": {
    eyebrow: "RESEARCH LIBRARY",
    description: "AI-assisted primers, lab notes, and memory aids for molecular cell biology.",
    draftDescription:
      "Open research notes. Useful now, but still being checked, expanded, or reorganized.",
  },
}

interface ArchiveListProps {
  pages: QuartzPluginData[]
  currentSlug: FullSlug
  locale: string
  emptyMessage: string
}

function formatArchiveDate(date: Date, locale: string) {
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
}

function ArchiveList({ pages, currentSlug, locale, emptyMessage }: ArchiveListProps) {
  if (pages.length === 0) return <p class="archive-index__empty">{emptyMessage}</p>

  return (
    <ol class="archive-index__list">
      {pages.map((page) => {
        const date = archiveDate(page)
        return (
          <li class="archive-index__entry">
            <a
              class="archive-index__link internal internal-link"
              href={resolveRelative(currentSlug, page.slug!)}
            >
              <span class="archive-index__title">{page.frontmatter?.title}</span>
              {date && (
                <time class="archive-index__date" datetime={date.toISOString()}>
                  {formatArchiveDate(date, locale)}
                </time>
              )}
            </a>
          </li>
        )
      })}
    </ol>
  )
}

interface ArchiveIndexOptions {
  tag: string
  title: string
  pages: QuartzPluginData[]
  currentSlug: FullSlug
  locale: string
  sort?: SortFn
}

export function ArchiveIndex({
  tag,
  title,
  pages,
  currentSlug,
  locale,
  sort,
}: ArchiveIndexOptions) {
  const copy = archiveCopy[tag]
  const { published, drafts } = partitionArchive(pages, sort)
  const publishedId = `${tag.replaceAll("/", "-")}-published`
  const draftsId = `${tag.replaceAll("/", "-")}-drafts`

  return (
    <main class="archive-index">
      <header class="archive-index__masthead">
        <p class="archive-index__eyebrow">{copy.eyebrow}</p>
        <h1>{title}</h1>
        <p class="archive-index__dek">{copy.description}</p>
        <p class="archive-index__summary">
          <span>{published.length} published</span>
          <span aria-hidden="true">·</span>
          <span>{drafts.length} working drafts</span>
        </p>
      </header>

      <section
        class="archive-index__section archive-index__section--published"
        aria-labelledby={publishedId}
      >
        <div class="archive-index__section-heading">
          <div>
            <p class="archive-index__section-number" aria-hidden="true">
              01
            </p>
            <h2 id={publishedId}>Published</h2>
          </div>
          <p>
            {published.length} finished {published.length === 1 ? "piece" : "pieces"}
          </p>
        </div>
        <ArchiveList
          pages={published}
          currentSlug={currentSlug}
          locale={locale}
          emptyMessage="No finished pieces yet."
        />
      </section>

      <section
        class="archive-index__section archive-index__section--drafts"
        aria-labelledby={draftsId}
      >
        <div class="archive-index__section-heading">
          <div>
            <p class="archive-index__section-number" aria-hidden="true">
              02
            </p>
            <h2 id={draftsId}>Working drafts</h2>
          </div>
          <p>{copy.draftDescription}</p>
        </div>
        <ArchiveList
          pages={drafts}
          currentSlug={currentSlug}
          locale={locale}
          emptyMessage="No working drafts right now."
        />
      </section>
    </main>
  )
}
