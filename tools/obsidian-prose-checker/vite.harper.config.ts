import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: "src/harperEngineBundle.ts",
      formats: ["cjs"],
      fileName: () => "harper-engine.cjs",
    },
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
      output: {
        inlineDynamicImports: true,
        exports: "named",
      },
    },
  },
});
