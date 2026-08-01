import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const spaRouterPath = new URL("./spa.inline.ts", import.meta.url)
const iconoplasmAppPath = new URL("../../static/iconoplasm/app.js", import.meta.url)

test("the Quartz router yields clicks already claimed by a feature router", async () => {
  const source = await readFile(spaRouterPath, "utf8")
  const clickStart = source.indexOf('window.addEventListener("click"')
  const clickEnd = source.indexOf('window.addEventListener("popstate"', clickStart)

  assert.notEqual(clickStart, -1, "missing Quartz click router")
  assert.notEqual(clickEnd, -1, "missing Quartz click router boundary")
  const clickRouter = source.slice(clickStart, clickEnd)
  assert.match(clickRouter, /if \(event\.defaultPrevented\) return[\s\S]*getOpts\(event\)/)
})

test("the Quartz router reads new-tab intent from the enclosing anchor", async () => {
  const source = await readFile(spaRouterPath, "utf8")
  const optionsStart = source.indexOf("const getOpts")
  const optionsEnd = source.indexOf("function notifyNav", optionsStart)

  assert.notEqual(optionsStart, -1, "missing Quartz link option parser")
  assert.notEqual(optionsEnd, -1, "missing Quartz link option parser boundary")
  const optionsParser = source.slice(optionsStart, optionsEnd)
  assert.match(
    optionsParser,
    /const a = target\.closest\("a"\)[\s\S]*if \(a\.target === "_blank"\) return/,
  )
  assert.doesNotMatch(optionsParser, /target\.attributes\.getNamedItem\("target"\)/)
})

test("the Quartz router yields history entries explicitly owned by Iconoplasm", async () => {
  const [routerSource, appSource] = await Promise.all([
    readFile(spaRouterPath, "utf8"),
    readFile(iconoplasmAppPath, "utf8"),
  ])
  const popstateStart = routerSource.indexOf('window.addEventListener("popstate"')
  const popstateEnd = routerSource.indexOf("return\n    })", popstateStart)

  assert.notEqual(popstateStart, -1, "missing Quartz popstate router")
  assert.notEqual(popstateEnd, -1, "missing Quartz popstate router boundary")
  const popstateRouter = routerSource.slice(popstateStart, popstateEnd)
  assert.match(popstateRouter, /event\.state\?\.quartzRouterIgnore === true/)
  assert.match(appSource, /next\.quartzRouterIgnore = true/)
  assert.match(appSource, /var nextState = \{ iconoplasm: true, quartzRouterIgnore: true \}/)
})
