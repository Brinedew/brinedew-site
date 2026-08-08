import { createHash } from "node:crypto";
import { AGENT_BY_ID } from "./agents";
import {
  findProtectedRanges,
  intersectsProtectedRange,
  type ProtectedKind,
  type ProtectedRange,
} from "./protectedRanges";
import type { AgentFinding, ResolvedFinding } from "./types";

export interface AnchorResolution {
  from: number;
  to: number;
}

export interface ValidationResult {
  valid: ResolvedFinding[];
  rejected: number;
}

function allOccurrences(text: string, needle: string): number[] {
  const result: number[] = [];
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const found = text.indexOf(needle, offset);
    if (found === -1) break;
    result.push(found);
    offset = found + Math.max(1, needle.length);
  }
  return result;
}

function contextMatches(text: string, from: number, finding: AgentFinding): boolean {
  const before = text.slice(Math.max(0, from - finding.prefixContext.length), from);
  const after = text.slice(
    from + finding.exactText.length,
    from + finding.exactText.length + finding.suffixContext.length,
  );
  return before === finding.prefixContext && after === finding.suffixContext;
}

const EXPLICITLY_TARGETED_PROTECTED_KINDS: Readonly<Record<string, readonly ProtectedKind[]>> = {
  "citation-shaped-prose": ["citation"],
  "quoted-claim-restatement": ["citation", "quoted-speech"],
  "foreign-title-translation": ["quoted-speech"],
};

function intersectsDisallowedProtectedRange(
  from: number,
  to: number,
  ranges: readonly ProtectedRange[],
  agentId: string,
): boolean {
  const allowed = new Set(EXPLICITLY_TARGETED_PROTECTED_KINDS[agentId] ?? []);
  return ranges.some(
    (range) =>
      from < range.to &&
      to > range.from &&
      range.kinds.some((kind) => !allowed.has(kind)),
  );
}

export function resolveAnchor(text: string, finding: AgentFinding): AnchorResolution | null {
  if (finding.exactText.length === 0) return null;
  const protectedRanges = findProtectedRanges(text);
  const candidates = allOccurrences(text, finding.exactText).filter((from) => {
    const to = from + finding.exactText.length;
    return !intersectsDisallowedProtectedRange(from, to, protectedRanges, finding.agentId);
  });

  // A unique verbatim quotation is authoritative even when a model makes a
  // boundary-only context mistake. We canonicalize its context below before
  // any late-result comparison. Repeated text still requires exact adjacent
  // context, so occurrenceHint alone can never select an ambiguous quotation.
  if (candidates.length === 1) {
    const from = candidates[0];
    if (from === undefined) return null;
    return { from, to: from + finding.exactText.length };
  }

  const hasDisambiguatingContext =
    finding.prefixContext.length > 0 || finding.suffixContext.length > 0;
  const contextCandidates = hasDisambiguatingContext
    ? candidates.filter((from) => contextMatches(text, from, finding))
    : [];
  if (contextCandidates.length === 1) {
    const from = contextCandidates[0];
    if (from === undefined) return null;
    return { from, to: from + finding.exactText.length };
  }

  if (
    Number.isInteger(finding.occurrenceHint) &&
    finding.occurrenceHint >= 0 &&
    finding.occurrenceHint < candidates.length
  ) {
    const from = candidates[finding.occurrenceHint];
    if (
      from === undefined ||
      !hasDisambiguatingContext ||
      !contextMatches(text, from, finding)
    ) return null;
    return { from, to: from + finding.exactText.length };
  }
  return null;
}

function findingId(finding: AgentFinding, from: number, to: number): string {
  return createHash("sha256")
    .update(
      [
        finding.agentId,
        String(from),
        String(to),
        finding.exactText,
        finding.explanation,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 24);
}

export function validateAndResolveFindings(
  rawFindings: readonly AgentFinding[],
  expectedAgentId: string,
  filePath: string,
  documentText: string,
  documentHash: string,
): ValidationResult {
  const agent = AGENT_BY_ID.get(expectedAgentId);
  if (!agent) return { valid: [], rejected: rawFindings.length };

  const seen = new Set<string>();
  const valid: ResolvedFinding[] = [];
  let rejected = 0;

  for (const finding of rawFindings) {
    if (
      finding.agentId !== expectedAgentId ||
      finding.anchorKind !== (agent.anchorPolicy === "line-marker" ? "line" : "span") ||
      typeof finding.explanation !== "string" ||
      typeof finding.exactText !== "string" ||
      typeof finding.prefixContext !== "string" ||
      typeof finding.suffixContext !== "string" ||
      !(typeof finding.replacement === "string" || finding.replacement === null)
    ) {
      rejected += 1;
      continue;
    }
    const anchor = resolveAnchor(documentText, finding);
    if (!anchor) {
      rejected += 1;
      continue;
    }
    const id = findingId(finding, anchor.from, anchor.to);
    if (seen.has(id)) continue;
    seen.add(id);
    const protectedRanges = findProtectedRanges(documentText);
    const canApply =
      agent.suggestionPolicy !== "explain-only" &&
      finding.anchorKind === "span" &&
      finding.replacement !== null &&
      !intersectsProtectedRange(anchor.from, anchor.to, protectedRanges);
    valid.push({
      ...finding,
      prefixContext: documentText.slice(Math.max(0, anchor.from - 80), anchor.from),
      suffixContext: documentText.slice(anchor.to, anchor.to + 80),
      id,
      filePath,
      agentLabel: agent.label,
      agentDefinition: agent.definition,
      from: anchor.from,
      to: anchor.to,
      sourceDocumentHash: documentHash,
      agentVersion: agent.version,
      visualState: "fresh",
      canApply,
    });
  }

  return { valid, rejected };
}
