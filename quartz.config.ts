import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

const config: QuartzConfig = {
  configuration: {
    pageTitle: "B",
    enableSPA: true,
    enablePopovers: true,
    analytics: null,
    locale: "en-US",
    baseUrl: "brinedew.bio",
    ignorePatterns: [
      // existing
      "private",
      "templates",
      ".obsidian",
      "*.tmp",
      // added
      ".obsidian/",
      "Templates/",
      "Snippets/",
      "**/*.canvas",
      "**/*.excalidraw",
      "**/~$*",
      "**/.DS_Store",
      "**/Thumbs.db",
      "Attachments/private-*",
    ],
    defaultDateType: "created",
    theme: {
      cdnCaching: false,
      fontOrigin: "local",
      typography: { header: "system-ui", body: "system-ui", code: "ui-monospace" },
      colors: {
        lightMode: {
          light: "#faf8f8",
          lightgray: "#e5e5e5",
          gray: "#b8b8b8",
          darkgray: "#4e4e4e",
          dark: "#2b2b2b",
          secondary: "#0050a0",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "rgba(255, 234, 0, 0.35)", // new
        },
        darkMode: {
          light: "#1a1a1a",
          lightgray: "#393639",
          gray: "#646464",
          darkgray: "#d4d4d4",
          dark: "#ebebec",
          secondary: "#7aa2f7",
          tertiary: "#84a59d",
          highlight: "rgba(143, 159, 169, 0.15)",
          textHighlight: "rgba(125, 211, 252, 0.25)", // new
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.LineageTextFilter({ minDepthToShow: 3 }),   // new text-based filter - must be first
      Plugin.FrontMatter(),
      Plugin.YouTubeAutoEmbed(),
      // Plugin.LineageFilter({ minDepthToShow: 3 }),    // old rehype filter - disabled
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "filesystem"],
      }),
      Plugin.Latex({ renderEngine: "katex" }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: true }),
      Plugin.GitHubFlavoredMarkdown(),
      // Render single newlines as <br> to match Obsidian preview
      Plugin.HardLineBreaks(),
      Plugin.TableOfContents({
        maxDepth: 3,
        minEntries: 1,
        showByDefault: true,
        collapseByDefault: false,
      }),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description({ descriptionLength: 150 }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      // Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
