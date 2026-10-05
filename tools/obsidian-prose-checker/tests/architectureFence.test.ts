import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { DEFAULT_ECHO_TEMPLATES, EchoClient, buildEchoBody } from "../src/echoClient"
import { OPENCODE_FREE_MODEL, OPENCODE_ZEN_BASE_URL } from "../src/openCodeClient"
import { RequestLog } from "../src/requestLog"

// ARCHITECTURE FENCE [BPC-001]
const websiteRoot = resolve(process.cwd(), "..", "..")

describe("BPC-001 explicit free-Zen-only boundary", () => {
  test("is registered in instructions, runbook, source, and tests", () => {
    const registry = JSON.parse(
      readFileSync(resolve(websiteRoot, "architecture-fences.json"), "utf8"),
    ) as { fences: Array<{ id: string; markers: Array<{ file: string; token: string }> }> }
    const fence = registry.fences.find((entry) => entry.id === "BPC-001")
    expect(fence).toBeDefined()
    for (const marker of fence!.markers) {
      expect(readFileSync(resolve(websiteRoot, marker.file), "utf8")).toContain(marker.token)
    }
  })

  test("pins the sole remote route to free DeepSeek on Zen", () => {
    expect(OPENCODE_ZEN_BASE_URL).toBe("https://opencode.ai/zen/v1")
    expect(OPENCODE_FREE_MODEL).toBe("deepseek-v4-flash-free")
    const source = readFileSync(
      resolve(websiteRoot, "tools", "obsidian-prose-checker", "src", "openCodeClient.ts"),
      "utf8",
    )
    expect(source).not.toContain("zen/go/v1")
    expect(source).not.toContain('"deepseek-v4-flash"')
    expect(source).not.toContain("openrouter.ai")
  })

  test("keeps model probing behind explicit run methods", () => {
    const main = readFileSync(
      resolve(websiteRoot, "tools", "obsidian-prose-checker", "src", "main.ts"),
      "utf8",
    )
    const onload = main.slice(main.indexOf("async onload"), main.indexOf("onunload"))
    expect(onload).not.toMatch(/\.probeModel\(/)
    expect(onload).not.toMatch(/\.runAgent\(/)
    expect(onload).not.toContain("OPENCODE_API_KEY")
    expect(onload).not.toMatch(/\.rewrite\(/)
    expect(onload).not.toMatch(/\.checkConnection\(/)
    expect(onload).not.toContain("ECHO_API_KEY")
  })

  test("sends Echo only the person's template, text and settings", () => {
    const template = "Before.\n{{text}}\nBetween {{text}} after."
    const text = 'A draft with "quotes", a {{brace}} and\nnewlines.'
    const body = buildEchoBody(
      { persona: " Scott Alexander ", template, reasoningEffort: "low" },
      text,
    )
    expect(JSON.parse(body)).toStrictEqual({
      model: "echo",
      persona: "Scott Alexander",
      reasoning_effort: "low",
      messages: [{ role: "user", content: template.split("{{text}}").join(text) }],
    })
    expect(() =>
      buildEchoBody(
        { persona: "Scott Alexander", template: "no slot", reasoningEffort: "low" },
        text,
      ),
    ).toThrow("{{text}}")
  })

  test("records each request byte-for-byte as it is sent", async () => {
    const log = new RequestLog()
    const sent: Array<string | null> = []
    const client = new EchoClient({
      log,
      keyProvider: () => "test-key",
      transport: async (_url, _method, _key, body) => {
        sent.push(body)
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ choices: [{ message: { content: "Rewritten." } }] }),
        }
      },
    })
    const body = buildEchoBody(
      {
        persona: "Scott Alexander",
        template: DEFAULT_ECHO_TEMPLATES.macro,
        reasoningEffort: "low",
      },
      "Draft.",
    )
    await client.rewrite(body, "Scott Alexander", new AbortController().signal)
    const [record] = log.forSubject("echo", "Scott Alexander")
    expect(sent).toStrictEqual([body])
    expect(record?.body).toBe(body)
    expect(record?.headers.Authorization).toBe("Bearer <ECHO_API_KEY>")
    expect(JSON.stringify(record)).not.toContain("test-key")
  })
})
