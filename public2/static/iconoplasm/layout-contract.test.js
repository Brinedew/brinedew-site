import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const cssPath = new URL("./styles.css", import.meta.url)

test("Iconoplasm desktop keeps the right sidebar usable while mobile remains single column", async () => {
  const css = await readFile(cssPath, "utf8")

  assert.match(
    css,
    /grid-template-columns:\s*240px minmax\(0, 1fr\) minmax\(220px, 250px\) !important;/,
    "desktop Iconoplasm layout must not collapse the right sidebar into a narrow sliver",
  )
  assert.match(
    css,
    /@media \(min-width: 1024px\)[\s\S]*grid-template-areas:\s*"grid-sidebar-left grid-header grid-sidebar-right"\s*"grid-sidebar-left grid-center grid-sidebar-right"\s*"grid-sidebar-left grid-footer grid-sidebar-right";/,
    "Iconoplasm's early three-column breakpoint must also use three-column grid areas instead of Quartz tablet areas",
  )
  assert.match(
    css,
    /@media \(min-width: 1024px\)[\s\S]*#quartz-body > \.sidebar\.right\s*\{[\s\S]*flex-direction:\s*column;/,
    "the right sidebar must use desktop behavior when Iconoplasm places it in a side column",
  )
  assert.match(
    css,
    /@media \(max-width: 800px\)[\s\S]*body\[data-slug\^="apps\/iconoplasm"\] #quartz-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important;/,
    "mobile Iconoplasm layout should remain the existing single-column footer/sidebar behavior",
  )
})
