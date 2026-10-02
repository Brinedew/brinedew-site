import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Element, Root } from "hast"
import { visit } from "unist-util-visit"
import { formatDate, getDate } from "../components/Date"
import type { QuartzPluginData } from "./vfile"

const skippedSlugPrefixes = ["tags/", "apps/", "settings"]

function hasAuthorDate(frontmatter: Record<string, unknown>): boolean {
  return (
    frontmatter.date !== undefined ||
    frontmatter.published !== undefined ||
    frontmatter.created !== undefined
  )
}

function dateParagraph(date: Date, label: string): Element {
  const time: Element = {
    type: "element",
    tagName: "time",
    properties: { datetime: date.toISOString() },
    children: [{ type: "text", value: formatDate(date, "en-US") }],
  }
  return {
    type: "element",
    tagName: "p",
    properties: { className: ["content-meta"] },
    children: label ? [{ type: "text", value: `${label}: ` }, time] : [time],
  }
}

/**
 * The article title is markdown (the first h1), so the publication date is
 * placed in the tree directly below that heading instead of the frame's page
 * header. Pages without a heading keep the previous top-of-article placement.
 *
 * B-818: a page that names its date with frontmatter `dateLabel` (the Iconoplasm
 * legal pages: "Last updated", "Effective") is dated here even under apps/, so
 * the date a reader sees is the same `date` field the folder listing and the
 * JSON-LD read. Such a page never hand-types its own date line.
 */
export const PublicationDate: QuartzTransformerPlugin = () => {
  return {
    name: "brinedew-publication-date",
    htmlPlugins() {
      return [
        () => (tree: Root, file) => {
          const data = file.data as QuartzPluginData
          const slug = String(data.slug ?? "")
          const frontmatter = (data.frontmatter ?? {}) as Record<string, unknown>
          const label =
            typeof frontmatter.dateLabel === "string" ? frontmatter.dateLabel.trim() : ""
          if (
            !hasAuthorDate(frontmatter) ||
            slug === "index" ||
            (!label && skippedSlugPrefixes.some((prefix) => slug.startsWith(prefix)))
          ) {
            return
          }

          let date: Date | undefined
          try {
            date = getDate(data)
          } catch {
            return
          }
          if (!date) return

          let inserted = false
          visit(tree, "element", (node: Element, index, parent) => {
            if (inserted || node.tagName !== "h1" || index === undefined || !parent) return
            parent.children.splice(index + 1, 0, dateParagraph(date, label))
            inserted = true
          })
          if (!inserted) {
            tree.children.unshift(dateParagraph(date, label))
          }
        },
      ]
    },
  }
}
