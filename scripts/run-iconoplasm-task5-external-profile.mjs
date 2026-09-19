import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const profiles = new Set([
  "provider-before",
  "provider-query",
  "browser",
  "region-apac",
  "region-eu",
  "region-us",
  "bunny",
  "fault-stale-pointer",
  "fault-bunny-outage",
  "fault-expired-artifact",
  "fault-laptop-off",
  "fault-d1-exhaustion",
  "fault-queue-exhaustion",
  "fault-delayed-projection",
  "shed-100000-discovery",
  "shed-100000-vote",
  "shed-100000-publication",
  "shed-1000000-discovery",
  "shed-1000000-vote",
  "shed-1000000-publication",
  "shed-1000000-worker",
  "shed-1000000-durable_object",
])

const valueFor = (name) =>
  process.argv
    .slice(2)
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
const profile = valueFor("--profile")
const output = valueFor("--output")
const commit = valueFor("--commit")
const environment = valueFor("--environment")
const baseUrl = process.env.ICONOPLASM_STAGING_BASE_URL
if (!profiles.has(profile)) throw new Error("Unknown Task 5 external profile")
if (!/^[a-f0-9]{40}$/.test(commit || "") || environment !== "staging")
  throw new Error("Exact staging commit is required")
const parsedBase = new URL(baseUrl)
if (parsedBase.protocol !== "https:" || parsedBase.username || parsedBase.password)
  throw new Error("Task 5 staging base must be a credential-free HTTPS URL")
if (!output) throw new Error("Task 5 profile output path is required")

const { stdout, stderr } = await run(
  "iconoplasm-task5-evidence",
  [
    "produce",
    `--profile=${profile}`,
    `--base-url=${parsedBase.origin}`,
    `--commit=${commit}`,
    `--environment=${environment}`,
  ],
  {
    env: process.env,
    windowsHide: true,
    timeout: 20 * 60 * 1_000,
    maxBuffer: 16 * 1024 * 1024,
  },
)
if (stderr.trim()) process.stderr.write(stderr)
const artifact = JSON.parse(stdout)
if (artifact.commitSha !== commit || artifact.environment !== environment)
  throw new Error("External Task 5 producer returned mismatched provenance")
await mkdir(path.dirname(path.resolve(output)), { recursive: true })
await writeFile(path.resolve(output), `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
