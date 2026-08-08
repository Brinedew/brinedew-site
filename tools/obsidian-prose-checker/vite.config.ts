import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export default defineConfig(({ mode }) => ({
  ...(mode === "test"
    ? {
        resolve: {
          alias: {
            obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
          },
        },
      }
    : {}),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: (id) =>
        id === "obsidian" ||
        id === "electron" ||
        id.startsWith("@codemirror/") ||
        nodeBuiltins.has(id),
      output: {
        inlineDynamicImports: true,
        exports: "default",
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
}));
