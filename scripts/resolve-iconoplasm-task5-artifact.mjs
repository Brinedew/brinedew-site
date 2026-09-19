import { appendFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const WORKFLOW_PATH = ".github/workflows/iconoplasm-viral-load-task5.yml"
const JOB_NAME = "produce-iconoplasm-viral-load-task5-evidence"

export async function resolveTask5Artifact({
  repository,
  runId,
  expectedCommit,
  token,
  fetchImpl = fetch,
}) {
  if (!/^[^/]+\/[^/]+$/.test(repository || "") || !Number.isSafeInteger(Number(runId)))
    throw new Error("Repository and numeric Task 5 run id are required")
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || "") || !token)
    throw new Error("Exact commit and GitHub token are required")
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }
  const read = async (url) => {
    const response = await fetchImpl(url, { headers })
    if (!response.ok) throw new Error("GitHub Task 5 provenance query failed")
    return response.json()
  }
  const run = await read(`https://api.github.com/repos/${repository}/actions/runs/${runId}`)
  if (run.path !== WORKFLOW_PATH || run.head_sha !== expectedCommit || run.conclusion !== "success")
    throw new Error("Task 5 run does not match the allowlisted workflow and exact commit")
  const jobs =
    (
      await read(
        `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
      )
    ).jobs || []
  const matchingJobs = jobs.filter((job) => job.name === JOB_NAME && job.conclusion === "success")
  if (matchingJobs.length !== 1) throw new Error("Task 5 producer job is not uniquely successful")
  const artifacts =
    (await read(`https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts`))
      .artifacts || []
  const artifactName = `iconoplasm-viral-load-task5-evidence-${expectedCommit}`
  const matchingArtifacts = artifacts.filter(
    (artifact) =>
      artifact.name === artifactName &&
      artifact.expired === false &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest || ""),
  )
  if (matchingArtifacts.length !== 1)
    throw new Error("Exact immutable Task 5 artifact is missing or ambiguous")
  return {
    runId: Number(runId),
    jobId: matchingJobs[0].id,
    artifactId: matchingArtifacts[0].id,
    artifactName,
    artifactDigest: matchingArtifacts[0].digest,
  }
}

async function main() {
  const valueFor = (name) =>
    process.argv
      .slice(2)
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1)
  const resolved = await resolveTask5Artifact({
    repository: process.env.GITHUB_REPOSITORY,
    runId: Number(valueFor("--run-id")),
    expectedCommit: valueFor("--expected-commit"),
    token: process.env.GITHUB_TOKEN,
  })
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required")
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `run_id=${resolved.runId}`,
      `job_id=${resolved.jobId}`,
      `artifact_id=${resolved.artifactId}`,
      `artifact_name=${resolved.artifactName}`,
      `artifact_digest=${resolved.artifactDigest}`,
      "",
    ].join("\n"),
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`)
    process.exitCode = 1
  })
