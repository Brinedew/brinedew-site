import test, { describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { VFile } from "vfile"
import type { Root, Element } from "hast"
import { Assets } from "./assets"
import type { BuildCtx } from "../../util/ctx"
import type { ProcessedContent } from "../vfile"
import type { StaticResources } from "../../util/resources"

const el = (tagName: string, properties: Element["properties"]): Element => ({
  type: "element",
  tagName,
  properties,
  children: [],
})

/** A published page whose rendered tree contains the given elements. */
function page(slug: string, relativePath: string, ...children: Element[]): ProcessedContent {
  const tree: Root = { type: "root", children }
  const file = new VFile("")
  file.data = { slug, relativePath } as VFile["data"]
  return [tree as never, file]
}

async function emitReferenced(files: string[], content: ProcessedContent[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-assets-referenced-"))
  const directory = path.join(root, "content")
  const output = path.join(root, "public")
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(directory, f)), { recursive: true })
    fs.writeFileSync(path.join(directory, f), "x")
  }
  const ctx = {
    argv: { directory, output },
    cfg: {
      configuration: { publishAssets: "referenced", ignorePatterns: [] },
      plugins: { pageTypes: [] },
    },
  } as unknown as BuildCtx
  const written: string[] = []
  for await (const fp of Assets().emit(ctx, content, {} as StaticResources) as AsyncIterable<
    Promise<string> | string
  >) {
    written.push(
      path
        .relative(output, await fp)
        .split(path.sep)
        .join("/"),
    )
  }
  fs.rmSync(root, { recursive: true, force: true })
  return written.sort()
}

describe('publishAssets: "referenced" (#2531)', () => {
  test("copies only files published pages reference, however they reference them", async () => {
    const written = await emitReferenced(
      [
        "images/my photo.png", // published under its slugified name
        "diagram.svg",
        "files/report.pdf",
        "hero.png",
        "été.png",
        "secret.png", // only an unpublished page links to it (not in `content`)
        "orphan.png",
        "notes/private.md",
      ],
      [
        page(
          "notes/page",
          "notes/page.md",
          el("img", { src: "../images/my-photo.png" }),
          el("object", { data: "../diagram.svg", type: "image/svg+xml" }), // ofm's SVG embed
          el("a", { href: "/files/report.pdf" }),
          el("img", { src: "x", srcSet: "../hero.png 2x, ../hero.png 1x" }),
          el("img", { src: "../%C3%A9t%C3%A9.png" }),
          el("a", { href: "https://example.com/orphan.png" }),
        ),
      ],
    )
    assert.deepStrictEqual(written, [
      "diagram.svg",
      "files/report.pdf",
      "hero.png",
      "images/my-photo.png",
      "été.png",
    ])
  })

  test("copies CSV/JSON datasets referenced by vega-lite code blocks", async () => {
    const vegaSpecTop = JSON.stringify({
      data: { url: "/attachments/zoo-mammal-cancer-mortality.csv" },
      layer: [
        { data: { url: "../attachments/overlay.json" }, mark: "line" },
        { data: { url: "https://example.com/remote.csv" }, mark: "point" },
      ],
    })
    const vegaSpecConcat = JSON.stringify({
      hconcat: [{ data: { url: "/attachments/somatic-mutation-rates.csv" }, mark: "point" }],
    })
    const highlightedCode: Element = {
      type: "element",
      tagName: "code",
      properties: { dataLanguage: "vega-lite" },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { dataLine: "" },
          children: [{ type: "text", value: vegaSpecTop }],
        },
      ],
    }
    const plainCode: Element = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-vega-lite"] },
      children: [{ type: "text", value: vegaSpecConcat }],
    }

    const written = await emitReferenced(
      [
        "Attachments/zoo-mammal-cancer-mortality.csv",
        "Attachments/overlay.json",
        "Attachments/somatic-mutation-rates.csv",
        "Attachments/unreferenced.csv",
      ],
      [page("wiki/petos-paradox", "wiki/petos-paradox.md", highlightedCode, plainCode)],
    )
    assert.deepStrictEqual(written, [
      "attachments/overlay.json",
      "attachments/somatic-mutation-rates.csv",
      "attachments/zoo-mammal-cancer-mortality.csv",
    ])
  })

  test('"all" (the default) still copies everything but Markdown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-assets-all-"))
    const directory = path.join(root, "content")
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, "orphan.png"), "x")
    fs.writeFileSync(path.join(directory, "page.md"), "# x")
    const ctx = {
      argv: { directory, output: path.join(root, "public") },
      cfg: { configuration: { ignorePatterns: [] }, plugins: { pageTypes: [] } },
    } as unknown as BuildCtx
    const written: string[] = []
    for await (const fp of Assets().emit(ctx, [], {} as StaticResources) as AsyncIterable<
      Promise<string> | string
    >) {
      written.push(path.basename(await fp))
    }
    fs.rmSync(root, { recursive: true, force: true })
    assert.deepStrictEqual(written, ["orphan.png"])
  })
})
