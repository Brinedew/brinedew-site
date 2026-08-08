import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { OPENCODE_FREE_MODEL, OPENCODE_ZEN_BASE_URL } from "../src/openCodeClient";

// ARCHITECTURE FENCE [BPC-001]
const websiteRoot = resolve(process.cwd(), "..", "..");

describe("BPC-001 explicit free-Zen-only boundary", () => {
  test("is registered in instructions, runbook, source, and tests", () => {
    const registry = JSON.parse(
      readFileSync(resolve(websiteRoot, "architecture-fences.json"), "utf8"),
    ) as { fences: Array<{ id: string; markers: Array<{ file: string; token: string }> }> };
    const fence = registry.fences.find((entry) => entry.id === "BPC-001");
    expect(fence).toBeDefined();
    for (const marker of fence!.markers) {
      expect(readFileSync(resolve(websiteRoot, marker.file), "utf8")).toContain(marker.token);
    }
  });

  test("pins the sole remote route to free DeepSeek on Zen", () => {
    expect(OPENCODE_ZEN_BASE_URL).toBe("https://opencode.ai/zen/v1");
    expect(OPENCODE_FREE_MODEL).toBe("deepseek-v4-flash-free");
    const source = readFileSync(
      resolve(websiteRoot, "tools", "obsidian-prose-checker", "src", "openCodeClient.ts"),
      "utf8",
    );
    expect(source).not.toContain("zen/go/v1");
    expect(source).not.toContain('"deepseek-v4-flash"');
    expect(source).not.toContain("openrouter.ai");
  });

  test("keeps model probing behind explicit run methods", () => {
    const main = readFileSync(
      resolve(websiteRoot, "tools", "obsidian-prose-checker", "src", "main.ts"),
      "utf8",
    );
    const onload = main.slice(main.indexOf("async onload"), main.indexOf("onunload"));
    expect(onload).not.toMatch(/\.probeModel\(/);
    expect(onload).not.toMatch(/\.runAgent\(/);
    expect(onload).not.toContain("OPENCODE_API_KEY");
  });
});
