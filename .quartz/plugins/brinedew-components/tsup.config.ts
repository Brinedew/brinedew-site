import { defineConfig } from "tsup"
import type { Plugin } from "esbuild"
const sassPlugin: Plugin = {
  name: "sass-loader",
  setup(build) {
    build.onLoad({ filter: /\.scss$/ }, async (args) => {
      const sass = await import("sass")
      const result = sass.compile(args.path)
      return { contents: result.css, loader: "text" }
    })
  },
}
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  target: "es2022",
  splitting: false,
  noExternal: [/.*/],
  outDir: "dist",
  platform: "node",
  esbuildOptions(o) { o.jsx = "automatic"; o.jsxImportSource = "preact" },
  esbuildPlugins: [sassPlugin],
})
