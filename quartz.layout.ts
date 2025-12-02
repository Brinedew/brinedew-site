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
        // Mobile tags dropdown button
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
    // TagSections: visible on desktop sidebar, dropdown on mobile
    Component.ConditionalRender({
      component: Component.TagSections(),
      condition: (page) => page.fileData.slug !== "index",
    }),
  ],
  right: [
    Component.DesktopOnly(Component.TableOfContents()),
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
    // Render the protein gallery only on /apps/proteins/index
    Component.ProteinGallery(),
  ],
  left: [
    Component.MobileOnly(Component.PageTitle()),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        // Mobile tags dropdown button
        { Component: Component.MobileOnly(Component.MobileMenu()) },
        { Component: Component.DesktopOnly(Component.PageTitle()) },
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
      ],
    }),
    // TagSections: visible on desktop sidebar, dropdown on mobile
    Component.TagSections(),
  ],
  right: [],
}
