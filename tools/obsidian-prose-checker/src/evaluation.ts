import { AGENT_BY_ID, AGENTS } from "./agents";
import { resolveAnchor } from "./anchors";
import type { AgentDefinition, AgentFinding, Example } from "./types";

const POSITIVE_PREFIXES = [
  "The draft states: ",
  "In the mechanism section, ",
  "The next paragraph says, ",
  "The reference explanation reads, ",
  "The article introduces the point this way: ",
  "The section continues: ",
  "The author writes, ",
  "The explanatory passage says, ",
  "The page then states, ",
  "The body text reads, ",
  "The discussion adds, ",
  "The final paragraph says, ",
] as const;

const NEUTRAL_PASSAGES = [
  "Ligand binding activates the receptor kinase, which phosphorylates the adaptor and recruits the downstream complex.",
  "During S phase, homologous recombination uses the sister chromatid as a repair template.",
  "Crypt stem cells transmit fixed replication errors to descendant epithelial cells.",
  "The germline carries hereditary variants into gametes and then into the next generation.",
  "RB1 restrains E2F-dependent transcription at the G1/S transition.",
  "The mitochondrial pathway releases cytochrome c and activates the apoptosome.",
  "Horizontal gene transfer moves DNA between lineages through transformation, transduction, or conjugation.",
  "Lineage tracing distinguishes persistent clones from independently recurring mutations.",
  "Double-strand breaks recruit repair proteins after damage-dependent phosphorylation.",
  "A sister chromatid becomes available after DNA replication and supplies a homologous template.",
  "Selection changes clone frequency when heritable variants alter survival or reproduction.",
  "The vertical line represents hereditary material passing through successive generations.",
  "Death-receptor binding assembles the signaling complex that activates initiator caspases.",
  "Meristem cells can contribute descendants to both vegetative tissue and reproductive structures.",
  "Genome repair lowers the rate at which later driver mutations enter a cell lineage.",
  "The section first defines the ordinary transfer route and then examines documented exceptions.",
] as const;

export interface EvaluationFixture {
  id: string;
  kind: "positive" | "negative";
  text: string;
  rationale: string;
}

export interface EvaluationDocument {
  text: string;
  fixtures: Array<EvaluationFixture & { from: number; to: number }>;
}

export interface EvaluationMetrics {
  recall: number;
  falsePositiveRate: number;
  anchorValidity: number;
  positiveHits: number;
  negativeHits: number;
  returnedFindings: number;
}

function wrapPositive(example: Example, index: number): EvaluationFixture {
  return {
    id: `positive-${index + 1}`,
    kind: "positive",
    text: `${POSITIVE_PREFIXES[index] ?? ""}${example.text}`,
    rationale: example.rationale,
  };
}

function neighborExamples(agent: AgentDefinition): Example[] {
  return agent.protectedNearNeighbors.flatMap((id) => AGENT_BY_ID.get(id)?.positiveExamples ?? []);
}

export function buildEvaluationFixtures(agent: AgentDefinition): EvaluationFixture[] {
  const seedPositive = agent.positiveExamples[0];
  const seedNegative = agent.hardNegativeExamples[0];
  if (!seedPositive || !seedNegative) throw new Error(`${agent.id} lacks evaluation seeds.`);

  const positives = POSITIVE_PREFIXES.map((_, index) => wrapPositive(seedPositive, index));
  const neighborNegatives = neighborExamples(agent).slice(0, 8).map((example, index) => ({
    id: `negative-neighbor-${index + 1}`,
    kind: "negative" as const,
    text: example.text,
    rationale: `Protected neighboring error: ${example.rationale}`,
  }));
  const ownNegatives = Array.from({ length: 8 }, (_, index) => ({
    id: `negative-seed-${index + 1}`,
    kind: "negative" as const,
    text: index === 0 ? seedNegative.text : `${NEUTRAL_PASSAGES[index - 1] ?? ""} ${seedNegative.text}`,
    rationale: seedNegative.rationale,
  }));
  const neutralNeeded = 24 - neighborNegatives.length - ownNegatives.length;
  const neutralNegatives = Array.from({ length: neutralNeeded }, (_, index) => ({
    id: `negative-neutral-${index + 1}`,
    kind: "negative" as const,
    text: NEUTRAL_PASSAGES[index % NEUTRAL_PASSAGES.length] ?? seedNegative.text,
    rationale: "A concrete mechanism with explicit actors, transition, constraint, and outcome.",
  }));
  return [...positives, ...neighborNegatives, ...ownNegatives, ...neutralNegatives];
}

export function buildEvaluationDocument(agent: AgentDefinition): EvaluationDocument {
  const fixtures = buildEvaluationFixtures(agent);
  let text = `# Atomic detector evaluation: ${agent.label}\n\n`;
  const located: EvaluationDocument["fixtures"] = [];
  for (const fixture of fixtures) {
    text += `<!-- bpc-fixture:${fixture.id} -->\n`;
    const from = text.length;
    text += fixture.text;
    const to = text.length;
    text += "\n\n---\n\n";
    located.push({ ...fixture, from, to });
  }
  return { text, fixtures: located };
}

export function scoreEvaluation(
  document: EvaluationDocument,
  findings: readonly AgentFinding[],
): EvaluationMetrics {
  const positiveHits = new Set<string>();
  const negativeHits = new Set<string>();
  let validAnchors = 0;
  for (const finding of findings) {
    const anchor = resolveAnchor(document.text, finding);
    if (!anchor) continue;
    validAnchors += 1;
    for (const fixture of document.fixtures) {
      if (anchor.from < fixture.to && anchor.to > fixture.from) {
        (fixture.kind === "positive" ? positiveHits : negativeHits).add(fixture.id);
      }
    }
  }
  const positiveCount = document.fixtures.filter((fixture) => fixture.kind === "positive").length;
  const negativeCount = document.fixtures.filter((fixture) => fixture.kind === "negative").length;
  return {
    recall: positiveCount === 0 ? 1 : positiveHits.size / positiveCount,
    falsePositiveRate: negativeCount === 0 ? 0 : negativeHits.size / negativeCount,
    anchorValidity: findings.length === 0 ? 1 : validAnchors / findings.length,
    positiveHits: positiveHits.size,
    negativeHits: negativeHits.size,
    returnedFindings: findings.length,
  };
}

export function assertEvaluationCorpus(): void {
  if (AGENTS.length !== 60) throw new Error(`Expected 60 atomic agents; found ${AGENTS.length}.`);
  for (const agent of AGENTS) {
    const fixtures = buildEvaluationFixtures(agent);
    const positives = fixtures.filter((fixture) => fixture.kind === "positive");
    const negatives = fixtures.filter((fixture) => fixture.kind === "negative");
    if (positives.length < 12 || negatives.length < 24) {
      throw new Error(`${agent.id} has ${positives.length} positives and ${negatives.length} negatives.`);
    }
  }
}
