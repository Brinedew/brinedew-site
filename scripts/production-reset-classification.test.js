import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(
  new URL("../.github/workflows/retry-production-after-d1-reset.yml", import.meta.url),
  "utf8",
)
const start = workflow.indexOf('          runs_json="$(')
const end = workflow.indexOf('          if [[ -n "${successful_run_id}" ]]', start)
assert.ok(start >= 0 && end > start, "the actual workflow classification block must exist")
const classification = workflow.slice(start, end).replace(/^          /gm, "")
const sha = "add2f6928d0ad7185665b21481ca8b38130e58ab"
const requiredSteps = [
  "Deploy the only allowed internal stateful worker (production)",
  "Deploy production static site to Cloudflare Pages",
  "Activate current Iconoplasm HTML shell cache version",
  "Smoke test production host ownership and browser bootstraps",
  "Smoke test Discord OAuth entry and anonymous session contract",
]
function run(id, overrides = {}) {
  return {
    id,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    created_at: `2026-09-09T09:0${id}:00Z`,
    run_started_at: `2026-09-09T09:0${id}:00Z`,
    run_attempt: 1,
    ...overrides,
  }
}
function fullJobs() {
  return {
    total_count: 2,
    jobs: [
      { name: "reader-recovery-only", status: "completed", conclusion: "skipped", steps: null },
      {
        name: "deploy-production",
        status: "completed",
        conclusion: "success",
        steps: requiredSteps.map((name) => ({ name, status: "completed", conclusion: "success" })),
      },
    ],
  }
}
function classify(runs, jobs = {}, extra = {}) {
  // Execute the real workflow shell with an offline gh replacement. Unexpected
  // calls, including mutations, fail; no provider credentials enter this test.
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
      gh() {
        [[ "$1" == "api" && "$#" == "2" ]] || return 97
        case "$2" in
          "repos/test/site/actions/workflows/deploy-quartz.yml/runs?branch=main&per_page=100")
            printf '%s' "$MOCK_RUNS" ;;
          "repos/test/site/actions/runs/$EXPECTED_RUN/jobs?filter=latest&per_page=100")
            [[ "$MOCK_FAILURE" != "1" ]] || return 98
            printf '%s' "$MOCK_JOBS" ;;
          *) return 99 ;;
        esac
      }
      ${classification}
      printf '%s' "$successful_run_id"`,
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        REPOSITORY: "test/site",
        DEPLOY_WORKFLOW: "deploy-quartz.yml",
        head_sha: sha,
        MOCK_RUNS: JSON.stringify({ workflow_runs: runs }),
        MOCK_JOBS: JSON.stringify(jobs),
        EXPECTED_RUN: String(runs.at(-1)?.id ?? ""),
        MOCK_FAILURE: "0",
        ...extra,
      },
    },
  )
  if (result.error) throw result.error
  return result
}
function expectSelection(runs, jobs, expected, extra) {
  const result = classify(runs, jobs, extra)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, expected)
}

test("actual reader-only success with full deployment skipped is not restored production", () => {
  expectSelection(
    [run(1)],
    {
      total_count: 2,
      jobs: [
        { name: "reader-recovery-only", status: "completed", conclusion: "success", steps: [] },
        { name: "deploy-production", status: "completed", conclusion: "skipped", steps: null },
      ],
    },
    "",
  )
})

test("full deployment requires successful activation and both terminal smoke checks", () => {
  expectSelection([run(1)], fullJobs(), "1")
  for (const step of requiredSteps) {
    const jobs = fullJobs()
    jobs.jobs[1].steps.find((item) => item.name === step).conclusion = "skipped"
    expectSelection([run(1)], jobs, "")
  }
})

test("a newer reader-only success supersedes an older full-success workflow", () => {
  expectSelection([run(1), run(2)], { total_count: 1, jobs: [fullJobs().jobs[0]] }, "")
})

test("a newer failed attempt cannot be hidden by an older full success", () => {
  expectSelection([run(1), run(2, { conclusion: "failure" })], {}, "")
})

test("reruns are ordered by attempt start rather than original creation time", () => {
  expectSelection(
    [run(1, { run_started_at: "2026-09-09T09:09:00Z", run_attempt: 2 }), run(2)],
    fullJobs(),
    "1",
    { EXPECTED_RUN: "1" },
  )
})

test("stale source, active-only and empty history never claim completed production", () => {
  expectSelection([run(1, { head_sha: "other-source" })], {}, "")
  expectSelection([run(1, { status: "in_progress", conclusion: null })], {}, "")
  expectSelection([], {}, "")
})

test("missing or ambiguous full-deployment jobs do not establish restoration", () => {
  expectSelection([run(1)], { total_count: 0, jobs: [] }, "")
  const duplicate = fullJobs()
  duplicate.jobs.push(duplicate.jobs[1])
  duplicate.total_count++
  expectSelection([run(1)], duplicate, "")
})

test("unavailable, malformed and incomplete job evidence stops the controller", () => {
  for (const extra of [
    { MOCK_FAILURE: "1" },
    { MOCK_JOBS: "not-json" },
    { MOCK_JOBS: JSON.stringify({ total_count: 3, jobs: fullJobs().jobs }) },
    { MOCK_JOBS: JSON.stringify({ total_count: 0, jobs: null }) },
  ]) {
    const result = classify([run(1)], fullJobs(), extra)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, "")
  }
})

const body = workflow.split("        run: |\n")[1].replace(/^          /gm, "")
function telemetry(reads) {
  return JSON.stringify({
    data: {
      viewer: {
        accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: reads, rowsWritten: 2 } }] }],
      },
    },
  })
}
function controller(overrides = {}) {
  const failed = run(1, { conclusion: "failure" })
  const recovered = run(2)
  const readerJobs = {
    total_count: 2,
    jobs: [
      { name: "reader-recovery-only", status: "completed", conclusion: "success", steps: [] },
      { name: "deploy-production", status: "completed", conclusion: "skipped", steps: null },
    ],
  }
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
      date() {
        case "$*" in
          "-u +%H") printf 00 ;;
          "-u +%M") printf 07 ;;
          "-u +%F") printf 2026-09-10 ;;
          *) return 97 ;;
        esac
      }
      curl() {
        case "\${!#}" in
          */schedules) printf '%s' '{"success":true}' ;;
          *queues?per_page=100) printf '%s' '{"success":true,"result":[{"queue_name":"iconoplasm-sync-finalization","queue_id":"one"},{"queue_name":"iconoplasm-vote-projection","queue_id":"two"},{"queue_name":"iconoplasm-gene-card-materialization","queue_id":"three"}]}' ;;
          */queues/one|*/queues/two|*/queues/three)
            [[ "$*" == *'delivery_paused":true'* ]] || return 98
            printf '%s' '{"success":true}' ;;
          */graphql) printf '%s' "$MOCK_TELEMETRY" ;;
          *) return 99 ;;
        esac
      }
      gh() {
        case "$*" in
          *"commits/main --jq .sha") printf '%s' "$TEST_SHA" ;;
          *"check-runs?per_page=100") printf '%s' "$MOCK_CHECKS" ;;
          *"runs?branch=main&per_page=100") printf '%s' "$MOCK_RUNS" ;;
          *"runs/2/jobs?filter=latest&per_page=100") printf '%s' "$MOCK_READER_JOBS" ;;
          *"runs/1/jobs?per_page=100") printf '%s' "$MOCK_FAILED_JOBS" ;;
          *"dispatches -f ref=main")
            [[ "$*" == *'--method POST'* ]] || return 98
            printf 'CANONICAL_DISPATCH\\n' ;;
          *) return 99 ;;
        esac
      }
      ${body}`,
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        CLOUDFLARE_API_TOKEN: "offline-fixture",
        CLOUDFLARE_ACCOUNT_ID: "offline-fixture",
        CLOUDFLARE_SCRIPT_NAME: "geneguessr-api",
        REPOSITORY: "test/site",
        DEPLOY_WORKFLOW: "deploy-quartz.yml",
        TEST_SHA: sha,
        MOCK_RUNS: JSON.stringify({ workflow_runs: [failed, recovered] }),
        MOCK_READER_JOBS: JSON.stringify(readerJobs),
        MOCK_CHECKS: JSON.stringify({
          check_runs: [{ name: "build-and-test", conclusion: "success" }],
        }),
        MOCK_TELEMETRY: telemetry(10),
        MOCK_FAILED_JOBS: JSON.stringify({
          jobs: [
            { name: "reader-recovery-only", conclusion: "skipped", steps: null },
            {
              name: "deploy-production",
              conclusion: "failure",
              steps: [
                { name: "Reject exhausted capacity before release setup", conclusion: "failure" },
              ],
            },
          ],
        }),
        ...overrides,
      },
    },
  )
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test("full controller resumes canonical release after reader-only recovery", () => {
  const output = controller()
  assert.match(output, /CANONICAL_DISPATCH/)
  assert.doesNotMatch(output, /already deployed successfully/)
  assert.match(output, /delivery_paused=true/)
})

test("full controller retains exact-CI, active-release and capacity fences", () => {
  for (const overrides of [
    { MOCK_CHECKS: JSON.stringify({ check_runs: [] }) },
    {
      MOCK_RUNS: JSON.stringify({
        workflow_runs: [
          run(1, { conclusion: "failure" }),
          run(2),
          run(3, { status: "in_progress", conclusion: null }),
        ],
      }),
    },
    { MOCK_TELEMETRY: telemetry(1500000) },
  ])
    assert.doesNotMatch(controller(overrides), /CANONICAL_DISPATCH/)
})

test("a failed reader job or unsafe full-release failure never supplies retry permission", () => {
  for (const jobs of [
    [
      {
        name: "reader-recovery-only",
        steps: [{ name: "Reject exhausted capacity before release setup", conclusion: "failure" }],
      },
      { name: "deploy-production", conclusion: "skipped", steps: null },
    ],
    [
      {
        name: "deploy-production",
        steps: [
          {
            name: "Apply reviewed D1 migrations through prediction admission",
            conclusion: "failure",
          },
        ],
      },
    ],
  ])
    assert.doesNotMatch(
      controller({ MOCK_FAILED_JOBS: JSON.stringify({ jobs }) }),
      /CANONICAL_DISPATCH/,
    )
})
