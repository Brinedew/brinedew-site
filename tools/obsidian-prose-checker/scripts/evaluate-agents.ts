import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { AGENTS } from "../src/agents"
import {
  buildEvaluationFixtures,
  scoreEvaluation,
  type EvaluationMetrics,
  type EvaluationFixture,
} from "../src/evaluation"
import { hashDocument } from "../src/hash"
import { OpenCodeClient, OpenCodeError } from "../src/openCodeClient"

const RUNS_PER_FIXTURE = 5
const CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.BPC_EVAL_CONCURRENCY ?? 24)))
const client = new OpenCodeClient()
const catalog = await client.probeModel(new AbortController().signal, true)
if (!catalog.available) throw new Error(catalog.message)

interface AgentEvaluation {
  agentId: string
  label: string
  runs: EvaluationMetrics[]
  averageRecall: number
  averageFalsePositiveRate: number
  averageAnchorValidity: number
  repeatedRunDisagreement: number
  passed: boolean
  errors: string[]
}

const requestedAgentId = process.env.BPC_EVAL_AGENT_ID?.trim()
const evaluatedAgents = requestedAgentId
  ? AGENTS.filter((agent) => agent.id === requestedAgentId)
  : AGENTS
if (requestedAgentId && evaluatedAgents.length === 0) {
  throw new Error(`Unknown BPC_EVAL_AGENT_ID: ${requestedAgentId}`)
}
const jobs = evaluatedAgents.flatMap((agent) =>
  buildEvaluationFixtures(agent).flatMap((fixture) =>
    Array.from({ length: RUNS_PER_FIXTURE }, (_, runIndex) => ({ agent, fixture, runIndex })),
  ),
)
interface FixtureRun {
  fixtureId: string
  kind: EvaluationFixture["kind"]
  metrics: EvaluationMetrics
}
const results = new Map<string, FixtureRun[]>()
const errors = new Map<string, string[]>()
let cursor = 0
let completed = 0

async function worker(): Promise<void> {
  while (cursor < jobs.length) {
    const index = cursor++
    const job = jobs[index]
    if (!job) return
    const prefix = `# Atomic detector evaluation: ${job.agent.label}\n\n`
    const text = `${prefix}${job.fixture.text}\n`
    const document = {
      text,
      fixtures: [
        {
          ...job.fixture,
          from: prefix.length,
          to: prefix.length + job.fixture.text.length,
        },
      ],
    }
    const controller = new AbortController()
    try {
      let findings
      try {
        findings = await client.runAgent(
          job.agent,
          document.text,
          hashDocument(document.text),
          controller.signal,
          catalog.contextTokens,
        )
      } catch (error) {
        if (!(error instanceof OpenCodeError) || !error.transient) throw error
        await new Promise((resolveDelay) => setTimeout(resolveDelay, error.retryAfterMs ?? 2_000))
        findings = await client.runAgent(
          job.agent,
          document.text,
          hashDocument(document.text),
          controller.signal,
          catalog.contextTokens,
        )
      }
      const metrics = scoreEvaluation(document, findings)
      results.set(job.agent.id, [
        ...(results.get(job.agent.id) ?? []),
        { fixtureId: job.fixture.id, kind: job.fixture.kind, metrics },
      ])
    } catch (error) {
      errors.set(job.agent.id, [
        ...(errors.get(job.agent.id) ?? []),
        `${job.fixture.id} run ${job.runIndex + 1}: ${error instanceof Error ? error.message : String(error)}`,
      ])
    } finally {
      completed += 1
      if (completed % 10 === 0 || completed === jobs.length) {
        process.stdout.write(`evaluation progress ${completed}/${jobs.length}\n`)
      }
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

const report: AgentEvaluation[] = evaluatedAgents.map((agent) => {
  const runs = results.get(agent.id) ?? []
  const positiveRuns = runs.filter((run) => run.kind === "positive")
  const negativeRuns = runs.filter((run) => run.kind === "negative")
  const averageRecall = average(positiveRuns.map((run) => run.metrics.recall))
  const averageFalsePositiveRate = average(negativeRuns.map((run) => run.metrics.falsePositiveRate))
  const averageAnchorValidity = average(runs.map((run) => run.metrics.anchorValidity))
  const byFixture = new Map<string, number[]>()
  for (const run of runs) {
    const flagged = run.metrics.returnedFindings > 0 ? 1 : 0
    byFixture.set(run.fixtureId, [...(byFixture.get(run.fixtureId) ?? []), flagged])
  }
  const repeatedRunDisagreement = Math.max(
    0,
    ...[...byFixture.values()].map((flags) => {
      const rate = average(flags)
      return Math.min(rate, 1 - rate)
    }),
  )
  const agentErrors = errors.get(agent.id) ?? []
  const expectedRuns = buildEvaluationFixtures(agent).length * RUNS_PER_FIXTURE
  return {
    agentId: agent.id,
    label: agent.label,
    runs: runs.map((run) => run.metrics),
    averageRecall,
    averageFalsePositiveRate,
    averageAnchorValidity,
    repeatedRunDisagreement,
    passed:
      runs.length === expectedRuns &&
      agentErrors.length === 0 &&
      averageRecall >= 0.85 &&
      averageFalsePositiveRate <= 0.1 &&
      averageAnchorValidity >= 0.95 &&
      repeatedRunDisagreement <= 0.15,
    errors: agentErrors,
  }
})

const outputRoot = resolve(
  process.cwd(),
  "..",
  "..",
  "artifacts",
  "obsidian-prose-checker",
  "evaluations",
)
await mkdir(outputRoot, { recursive: true })
const outputPath = resolve(
  outputRoot,
  `evaluation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
)
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      model: "deepseek-v4-flash-free",
      runsPerFixture: RUNS_PER_FIXTURE,
      fixturesPerAgent: 36,
      concurrency: CONCURRENCY,
      passed: report.filter((entry) => entry.passed).length,
      failed: report.filter((entry) => !entry.passed).length,
      agents: report,
    },
    null,
    2,
  )}\n`,
  "utf8",
)
process.stdout.write(`${outputPath}\n`)
if (report.some((entry) => !entry.passed)) process.exitCode = 1
