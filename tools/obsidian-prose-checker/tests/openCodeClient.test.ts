import { describe, expect, test, vi } from "vitest"
import {
  OpenCodeClient,
  OPENCODE_FREE_MODEL,
  OPENCODE_ZEN_BASE_URL,
  type HttpResponse,
  type OpenCodeTransport,
} from "../src/openCodeClient"
import { AGENTS } from "../src/agents"
import { hashDocument } from "../src/hash"

function response(status: number, body: unknown): HttpResponse {
  return { status, headers: {}, body: JSON.stringify(body) }
}

describe("OpenCode Zen client", () => {
  test("does not read credentials or touch the network during construction", () => {
    const keyProvider = vi.fn(() => "secret")
    const transport = vi.fn<OpenCodeTransport>()
    new OpenCodeClient({ keyProvider, transport })
    expect(keyProvider).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  test("probes only the free DeepSeek model on OpenCode Zen", async () => {
    const calls: Array<{ url: string; method: string }> = []
    const transport: OpenCodeTransport = async (url, method) => {
      calls.push({ url: url.toString(), method })
      return response(200, { data: [{ id: OPENCODE_FREE_MODEL, context_length: 1_048_576 }] })
    }
    const client = new OpenCodeClient({ keyProvider: () => "secret", transport })
    const catalog = await client.probeModel(new AbortController().signal, true)
    expect(catalog.available).toBe(true)
    expect(catalog.contextTokens).toBe(1_048_576)
    expect(calls).toEqual([{ url: `${OPENCODE_ZEN_BASE_URL}/models`, method: "GET" }])
  })

  test("fails closed when the free model is absent", async () => {
    const transport: OpenCodeTransport = async () => response(200, { data: [{ id: "paid-model" }] })
    const client = new OpenCodeClient({ keyProvider: () => "secret", transport })
    const catalog = await client.probeModel(new AbortController().signal, true)
    expect(catalog.available).toBe(false)
    expect(catalog.status).toBe("model-unavailable")
  })

  test("repairs malformed JSON without resending the document", async () => {
    const bodies: string[] = []
    const transport: OpenCodeTransport = async (_url, method, _key, body) => {
      if (method === "GET") return response(200, { data: [{ id: OPENCODE_FREE_MODEL }] })
      bodies.push(body ?? "")
      if (bodies.length === 1) {
        return response(200, { choices: [{ message: { content: "not json" } }] })
      }
      return response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    agentId: "staccato-exposition",
                    exactText: "Two alleles exist. One mutates. The other works.",
                    prefixContext: "",
                    suffixContext: "",
                    occurrenceHint: 0,
                    explanation: "Missing causal joints.",
                    replacement: "One allele mutates, but the other still works.",
                    anchorKind: "span",
                  },
                ],
              }),
            },
          },
        ],
      })
    }
    const client = new OpenCodeClient({ keyProvider: () => "secret", transport })
    const text = "Two alleles exist. One mutates. The other works."
    const findings = await client.runAgent(
      AGENTS.find((agent) => agent.id === "staccato-exposition")!,
      text,
      hashDocument(text),
      new AbortController().signal,
      1_048_576,
    )
    expect(findings).toHaveLength(1)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toContain(text)
    expect(bodies[1]).not.toContain(text)
    expect(bodies[1]).toContain("not json")
  })

  test("blocks an oversized complete prompt before transport", async () => {
    const transport = vi.fn<OpenCodeTransport>()
    const client = new OpenCodeClient({ keyProvider: () => "secret", transport })
    const text = "x".repeat(30_000)
    await expect(
      client.runAgent(AGENTS[0]!, text, hashDocument(text), new AbortController().signal, 10_000),
    ).rejects.toMatchObject({ code: "context-overflow" })
    expect(transport).not.toHaveBeenCalled()
  })
})
