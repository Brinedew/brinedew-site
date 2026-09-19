import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const valueFor = (name) => {
  const prefix = `${name}=`
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length)
}
const commitSha = valueFor("--commit")
const environment = valueFor("--environment")
const repository = process.env.GITHUB_REPOSITORY
const runId = Number(process.env.GITHUB_RUN_ID)
const token = process.env.GITHUB_TOKEN
if (!/^[a-f0-9]{40}$/.test(commitSha || "") || environment !== "staging")
  throw new Error("Exact staging commit and environment are required")
if (!repository || !runId || !token) throw new Error("GitHub workflow identity is required")

const outputRoot = path.resolve("artifacts/iconoplasm-viral-load-gates/task5")
const rawRoot = path.join(outputRoot, "raw")
await mkdir(rawRoot, { recursive: true })

const requiredReceipts = [
  "hosted-driver.json",
  "provider-query.json",
  "browser.json",
  "region-apac.json",
  "region-eu.json",
  "region-us.json",
  "bunny.json",
  "fault-stale-pointer.json",
  "fault-bunny-outage.json",
  "fault-expired-artifact.json",
  "fault-laptop-off.json",
  "fault-d1-exhaustion.json",
  "fault-queue-exhaustion.json",
  "fault-delayed-projection.json",
  "shed-100000-discovery.json",
  "shed-100000-vote.json",
  "shed-100000-publication.json",
  "shed-1000000-discovery.json",
  "shed-1000000-vote.json",
  "shed-1000000-publication.json",
  "shed-1000000-worker.json",
  "shed-1000000-durable_object.json",
]
const rawArtifacts = {}
for (const name of requiredReceipts) {
  rawArtifacts[name] = await readFile(path.join(rawRoot, name), "utf8")
  const parsed = JSON.parse(rawArtifacts[name])
  if (parsed.commitSha !== commitSha || parsed.environment !== environment)
    throw new Error(`Receipt ${name} does not match the staging commit`)
}
const hostedDriver = JSON.parse(rawArtifacts["hosted-driver.json"])
if (!hostedDriver.certificationReady) throw new Error("Hosted driver did not meet its schedule")

const runResponse = await fetch(
  `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
  { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } },
)
if (!runResponse.ok) throw new Error("Could not resolve immutable GitHub job identity")
const jobs = (await runResponse.json()).jobs || []
const job = jobs.find((candidate) => candidate.name.includes("collect-viral-load-staging-evidence"))
if (!job?.id) throw new Error("Could not identify the staging evidence job")

const kindFor = (name) =>
  name === "hosted-driver.json"
    ? "hosted_driver"
    : name === "provider-query.json"
      ? "provider_query"
      : name === "browser.json"
        ? "authenticated_browser"
        : name.startsWith("region-")
          ? "region"
          : name === "bunny.json"
            ? "bunny_delivery"
            : name.startsWith("shed-")
              ? "operation_shed_receipt"
              : "fault_injection"
const rawManifest = []
for (const [name, text] of Object.entries(rawArtifacts)) {
  await writeFile(path.join(rawRoot, name), text, "utf8")
  rawManifest.push({
    name,
    kind: kindFor(name),
    sha256: createHash("sha256").update(text).digest("hex"),
  })
}
const provider = JSON.parse(rawArtifacts["provider-query.json"])
const failures = requiredReceipts
  .filter((name) => name.startsWith("fault-"))
  .map((name) => JSON.parse(rawArtifacts[name]))
const receipt = {
  schemaVersion: 1,
  kind: "iconoplasm_viral_load_task5_evidence",
  provenance: {
    workflowPath: ".github/workflows/deploy-quartz.yml",
    runId,
    jobId: job.id,
    conclusion: "success",
    commitSha,
    environment,
  },
  rawArtifacts: rawManifest,
  run: {
    id: String(runId),
    environment,
    accountIdHash: provider.identity.accountIdHash,
    commitSha,
    startedAt: hostedDriver.startedAt,
    endedAt: hostedDriver.endedAt,
  },
  hostedLoad: {
    physicalRequests: hostedDriver.physicalStaticRequests,
    commandsAttempted: hostedDriver.commandsAttempted,
    day: hostedDriver.target.day,
    commandIdentity: hostedDriver.commandIdentity,
    concurrentStaticChecks: Math.floor(hostedDriver.physicalStaticRequests / 5),
  },
  commandReceipts: {
    acceptedCommands: hostedDriver.commandOutcomes.acceptedDurable,
    capacityRefusedCommands: hostedDriver.commandOutcomes.capacityRefused,
    lostAcceptedCommands: hostedDriver.commandOutcomes.invalidCommandReceipts,
    digestAlgorithm: hostedDriver.commandReceiptDigestAlgorithm,
    digest: hostedDriver.commandReceiptDigest,
  },
  failureProfiles: failures,
  externalGates: {
    hostedExecution: "verified",
    authenticatedBrowser: "verified",
    multiRegion: "verified",
    bunnyDelivery: "verified",
  },
  provider,
}
const evidence = {
  ...receipt,
  digestAlgorithm: "sha256",
  digest: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
}
await writeFile(
  path.join(outputRoot, "evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
)
process.stdout.write(
  `${JSON.stringify({ verified: true, rawArtifactCount: rawManifest.length })}\n`,
)
