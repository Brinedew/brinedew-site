function requireText(value, label) {
  const text = String(value || "").trim()
  if (!text) throw new Error(`${label} is required`)
  return text
}

export async function waitForSuccessfulPushCi({
  repository,
  headSha,
  token,
  workflow = "ci.yaml",
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 15 * 60 * 1000,
  pollMs = 5_000,
} = {}) {
  const cleanRepository = requireText(repository, "GitHub repository")
  const cleanHeadSha = requireText(headSha, "Git commit SHA")
  const cleanToken = requireText(token, "GitHub Actions token")
  const cleanWorkflow = requireText(workflow, "CI workflow")
  const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || 0)
  const endpoint = new URL(
    `https://api.github.com/repos/${cleanRepository}/actions/workflows/${encodeURIComponent(cleanWorkflow)}/runs`,
  )
  endpoint.searchParams.set("head_sha", cleanHeadSha)
  endpoint.searchParams.set("event", "push")
  endpoint.searchParams.set("per_page", "20")

  while (Date.now() < deadline) {
    const response = await fetchImpl(endpoint, {
      signal: AbortSignal.timeout(Math.min(30_000, Math.max(1, deadline - Date.now()))),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cleanToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!response.ok) {
      throw new Error(`Could not verify Build and Test: GitHub API returned ${response.status}`)
    }
    const payload = await response.json()
    const run = (Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : []).find(
      (candidate) => candidate?.head_sha === cleanHeadSha && candidate?.event === "push",
    )
    if (run?.status === "completed") {
      if (run.conclusion !== "success") {
        throw new Error(
          `Store submission blocked: Build and Test concluded ${run.conclusion || "without success"} for ${cleanHeadSha}.`,
        )
      }
      return run
    }
    await sleep(Math.max(250, Number(pollMs) || 0))
  }
  throw new Error("Store submission blocked: Build and Test did not succeed within the deadline.")
}
