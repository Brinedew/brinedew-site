import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { REMOTE_EDITOR_TESTING } from "../src/remoteEditor";
import type { ResolvedFinding } from "../src/types";

function baseFinding(overrides: Partial<ResolvedFinding> = {}): ResolvedFinding {
  return {
    id: "finding-1",
    agentId: "staccato-exposition",
    exactText: "One mutates.",
    prefixContext: "Two alleles exist. ",
    suffixContext: " The other works.",
    occurrenceHint: 0,
    explanation: "Missing causal joint.",
    replacement: "One allele mutates, but",
    anchorKind: "span",
    filePath: "note.md",
    agentLabel: "Staccato exposition",
    agentDefinition: "Flag missing causal joints.",
    from: 19,
    to: 31,
    sourceDocumentHash: "hash",
    agentVersion: 1,
    visualState: "fresh",
    canApply: true,
    ...overrides,
  };
}

function withFinding(): EditorState {
  let state = EditorState.create({
    doc: "Two alleles exist. One mutates. The other works.",
    extensions: [REMOTE_EDITOR_TESTING.field],
  });
  state = state.update({ effects: REMOTE_EDITOR_TESTING.setAll.of([baseFinding()]) }).state;
  return state;
}

describe("remote finding lifecycle", () => {
  test("maps a finding when an edit occurs elsewhere", () => {
    const state = withFinding().update({ changes: { from: 0, insert: "Prefix. " } }).state;
    const finding = state.field(REMOTE_EDITOR_TESTING.field)[0]!;
    expect(finding.from).toBe(27);
    expect(finding.to).toBe(39);
  });

  test("removes a finding when an edit touches its range", () => {
    const state = withFinding().update({ changes: { from: 22, to: 29, insert: "changes" } }).state;
    expect(state.field(REMOTE_EDITOR_TESTING.field)).toHaveLength(0);
  });

  test("fades old findings at the start of a run", () => {
    const state = withFinding().update({ effects: REMOTE_EDITOR_TESTING.markAllStale.of(null) }).state;
    expect(state.field(REMOTE_EDITOR_TESTING.field)[0]).toMatchObject({
      visualState: "stale",
      canApply: false,
    });
  });

  test("replaces touched findings with one resolved tombstone after apply", () => {
    const resolved = baseFinding({
      exactText: "One allele mutates, but",
      to: 41,
      visualState: "resolved",
      canApply: false,
    });
    const state = withFinding().update({
      changes: { from: 19, to: 31, insert: "One allele mutates, but" },
      effects: REMOTE_EDITOR_TESTING.upsert.of(resolved),
    }).state;
    expect(state.field(REMOTE_EDITOR_TESTING.field)).toEqual([resolved]);
  });
});
