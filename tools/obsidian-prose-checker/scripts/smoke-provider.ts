import { AGENT_BY_ID } from "../src/agents"
import { validateAndResolveFindings } from "../src/anchors"
import { hashDocument } from "../src/hash"
import { OpenCodeClient } from "../src/openCodeClient"

const documentText = `# Alleles

This page will explain the allele model.

Two alleles exist. One mutates. The other works. Growth stays restrained.

## Practical note

This distinction matters.
`
const agentIds = ["self-referential-roadmap", "staccato-exposition", "section-stub"]
const agents = agentIds.map((id) => {
  const agent = AGENT_BY_ID.get(id)
  if (!agent) throw new Error(`Smoke-test agent is absent from the registry: ${id}`)
  return agent
})

const startedAt = Date.now()
const client = new OpenCodeClient()
const catalog = await client.probeModel(new AbortController().signal, true)
if (!catalog.available) throw new Error(catalog.message)
const documentHash = hashDocument(documentText)
const outcomes = await Promise.all(
  agents.map(async (agent) => {
    const findings = await client.runAgent(
      agent,
      documentText,
      documentHash,
      new AbortController().signal,
      catalog.contextTokens,
    )
    const validation = validateAndResolveFindings(
      findings,
      agent.id,
      "provider-smoke.md",
      documentText,
      documentHash,
    )
    return {
      agentId: agent.id,
      returnedFindings: findings.length,
      validatedFindings: validation.valid.length,
      rejectedFindings: validation.rejected,
    }
  }),
)

process.stdout.write(
  `${JSON.stringify({
    catalogStatus: catalog.status,
    modelAvailable: catalog.available,
    contextTokens: catalog.contextTokens,
    agents: outcomes,
    durationMs: Date.now() - startedAt,
  })}\n`,
)

if (outcomes.some((outcome) => outcome.validatedFindings === 0)) {
  throw new Error("At least one proof-of-concept agent did not produce a valid anchor.")
}
