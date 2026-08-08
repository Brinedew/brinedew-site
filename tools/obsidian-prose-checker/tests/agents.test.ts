import { describe, expect, test } from "vitest";
import { AGENTS, DEFAULT_ENABLED_AGENT_IDS } from "../src/agents";
import { assertEvaluationCorpus, buildEvaluationFixtures } from "../src/evaluation";
import { buildAgentPrompt } from "../src/prompt";

describe("atomic agent registry", () => {
  test("contains exactly sixty unique, narrow agents", () => {
    expect(AGENTS).toHaveLength(60);
    expect(new Set(AGENTS.map((agent) => agent.id)).size).toBe(60);
    for (const agent of AGENTS) {
      expect(agent.label).not.toMatch(/^(voice|cohesion|style|clarity)$/i);
      expect(agent.definition.length).toBeGreaterThan(40);
      expect(agent.positiveExamples.length).toBeGreaterThan(0);
      expect(agent.hardNegativeExamples.length).toBeGreaterThan(0);
      expect(agent.version).toBe(1);
    }
  });

  test("keeps the proof-of-concept all-agent button to three representative calls", () => {
    expect(DEFAULT_ENABLED_AGENT_IDS).toEqual(
      new Set(["self-referential-roadmap", "staccato-exposition", "section-stub"]),
    );
    expect(AGENTS.filter((agent) => agent.enabled).map((agent) => agent.id)).toEqual([
      "self-referential-roadmap",
      "staccato-exposition",
      "section-stub",
    ]);
  });

  test("builds at least 12 positives and 24 hard negatives for every agent", () => {
    expect(() => assertEvaluationCorpus()).not.toThrow();
    for (const agent of AGENTS) {
      const fixtures = buildEvaluationFixtures(agent);
      expect(fixtures.filter((fixture) => fixture.kind === "positive")).toHaveLength(12);
      expect(fixtures.filter((fixture) => fixture.kind === "negative")).toHaveLength(24);
    }
  });

  test("puts one full immutable document and one agent into each prompt", () => {
    const document = "A caretaker does not make the cell divide faster.\nUnique end marker 7f031.";
    const prompt = buildAgentPrompt(AGENTS[9]!, document, "hash-123");
    expect(prompt.system).toContain("one atomic prose-error detector");
    expect(prompt.user).toContain(`id: ${AGENTS[9]!.id}`);
    expect(prompt.user.match(/Unique end marker 7f031\./g)).toHaveLength(1);
    expect(prompt.system).toContain("return an empty findings array");
    expect(prompt.user).toContain("Never rewrite the full document");
  });
});
