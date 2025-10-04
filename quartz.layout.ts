import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [Component.ViewTransitions()],
  footer: Component.Footer({
    links: {
      // Use an absolute link so it doesn't change based on current page depth
      "About": "/About.html",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    // MINIMALISM: Breadcrumbs commented out for cleaner design
    // Component.ConditionalRender({
    //   component: Component.Breadcrumbs(),
    //   condition: (page) => page.fileData.slug !== "index",
    // }),
    // MINIMALISM: Article title commented out for cleaner design
    // Component.ArticleTitle(),
    // MINIMALISM: Content meta (date, reading time) commented out for cleaner design
    // Component.ContentMeta(),
    Component.ProteinInfobox(),
    Component.ProteinGallery(),
  ],
  left: [
    Component.MobileOnly(Component.PageTitle()),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        // Mobile hamburger menu button
        { Component: Component.MobileOnly(Component.MobileMenu()) },
        // Desktop & Tablet: inline logo inside the row
        { Component: Component.DesktopOnly(Component.PageTitle()) },
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
    // MINIMALISM: Backlinks commented out for cleaner design
    // Component.ConditionalRender({
    //   component: Component.Backlinks(),
    //   condition: (page) => page.fileData.slug !== "index",
    // }),
  ],
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [
    // MINIMALISM: Breadcrumbs, title, and meta commented out for cleaner design
    // Component.Breadcrumbs(), 
    // Component.ArticleTitle(), 
    // Component.ContentMeta()
  ],
  left: [
    Component.MobileOnly(Component.PageTitle()),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        // Mobile hamburger menu button
        { Component: Component.MobileOnly(Component.MobileMenu()) },
        { Component: Component.DesktopOnly(Component.PageTitle()) },
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
