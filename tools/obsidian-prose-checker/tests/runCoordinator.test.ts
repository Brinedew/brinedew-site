import { describe, expect, test, vi } from "vitest"
import { AGENTS } from "../src/agents"
import type { OpenCodeClient } from "../src/openCodeClient"
import { RunCoordinator } from "../src/runCoordinator"

function fakeClient(options: { available?: boolean; delayMs?: number } = {}): OpenCodeClient {
  return {
    probeModel: vi.fn(async () => ({
      available: options.available ?? true,
      contextTokens: 1_048_576,
      status: options.available === false ? "model-unavailable" : "connected",
      message: options.available === false ? "free model absent" : "connected",
      checkedAt: Date.now(),
    })),
    runAgent: vi.fn(async (agent, documentText, _hash, signal) => {
      if (options.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, options.delayMs)
          signal.addEventListener("abort", () => {
            clearTimeout(timeout)
            reject(new Error("cancelled"))
          })
        })
      }
      return [
        {
          agentId: agent.id,
          exactText: documentText,
          prefixContext: "",
          suffixContext: "",
          occurrenceHint: 0,
          explanation: "fixture",
          replacement: null,
          anchorKind: agent.anchorPolicy === "line-marker" ? "line" : "span",
        },
      ]
    }),
  } as unknown as OpenCodeClient
}

async function waitForFinish(coordinator: RunCoordinator, filePath: string): Promise<void> {
  await vi.waitFor(() => expect(coordinator.getRunForFile(filePath)?.finishedAt).not.toBeNull())
}

describe("run coordinator", () => {
  test("returns the existing active run instead of duplicating it", async () => {
    const client = fakeClient({ delayMs: 30 })
    const coordinator = new RunCoordinator(
      client,
      AGENTS.slice(0, 2),
      { onRunStarted: vi.fn(), onAgentCompleted: vi.fn(), onAgentCleared: vi.fn() },
      1,
    )
    const first = await coordinator.startRun("note.md", "Concrete text.")
    const second = await coordinator.startRun("note.md", "Changed text.")
    expect(second.id).toBe(first.id)
    await waitForFinish(coordinator, "note.md")
    expect(client.runAgent).toHaveBeenCalledTimes(2)
  })

  test("fails every queued agent without chat calls when free model is absent", async () => {
    const client = fakeClient({ available: false })
    const coordinator = new RunCoordinator(client, AGENTS.slice(0, 3), {
      onRunStarted: vi.fn(),
      onAgentCompleted: vi.fn(),
      onAgentCleared: vi.fn(),
    })
    const run = await coordinator.startRun("note.md", "Concrete text.")
    expect([...run.agents.values()].every((agent) => agent.status === "failed")).toBe(true)
    expect(client.runAgent).not.toHaveBeenCalled()
  })

  test("cancels active and queued agents while retaining completed callbacks", async () => {
    const client = fakeClient({ delayMs: 100 })
    const completed = vi.fn()
    const coordinator = new RunCoordinator(
      client,
      AGENTS.slice(0, 3),
      { onRunStarted: vi.fn(), onAgentCompleted: completed, onAgentCleared: vi.fn() },
      1,
    )
    const run = await coordinator.startRun("note.md", "Concrete text.")
    coordinator.cancelRun(run.id)
    expect(run.cancelled).toBe(true)
    expect([...run.agents.values()].every((agent) => agent.status === "cancelled")).toBe(true)
  })
})
