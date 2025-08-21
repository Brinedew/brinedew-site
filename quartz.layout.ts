import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [Component.ViewTransitions()],
  footer: Component.Footer({
    links: {
      "About": "About",
      "Graph": "graph",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.ContentMeta(),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        // Mobile hamburger menu button
        { Component: Component.MobileOnly(Component.MobileMenu()) },
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
      ],
    }),
    // Hide tag explorer on homepage only
    Component.ConditionalRender({
      component: Component.TagExplorer({ 
        title: "Tags", 
        minCount: 1, 
        sort: "count",
        hierarchical: true,
        aggregateCounts: true,
        defaultOpenDepth: 1
      }),
      condition: (page) => page.fileData.slug !== "index",
    }),
  ],
  right: [
    Component.DesktopOnly(Component.TableOfContents()),
    // Page tags section above backlinks
    Component.ConditionalRender({
      component: Component.PageTags(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    // Hide backlinks on homepage only
    Component.ConditionalRender({
      component: Component.Backlinks(),
      condition: (page) => page.fileData.slug !== "index",
    }),
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        // Mobile hamburger menu button
        { Component: Component.MobileOnly(Component.MobileMenu()) },
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
      ],
    }),
    Component.TagExplorer({ title: "Tags", minCount: 1, sort: "count" }),
  ],
  right: [],
}
