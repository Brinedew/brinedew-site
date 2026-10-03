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
  // Build and Test runs 14 to 16 minutes on main (2026-10-03, with the browser
  // E2E steps), and a deploy queued behind another one starts its wait early.
  timeoutMs = 40 * 60 * 1000,
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

  // One network blip, 5xx or 429 among ~180 polls must not kill a release (the
  // #359 deploy died on a single `fetch failed`, 26 Sep 2026). A refusal such as
  // 401/403/404 still fails at once, and a lasting outage fails after a few tries.
  const maxConsecutiveTransient = 5
  let consecutiveTransient = 0
  while (Date.now() < deadline) {
    let response
    try {
      response = await fetchImpl(endpoint, {
        signal: AbortSignal.timeout(Math.min(30_000, Math.max(1, deadline - Date.now()))),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${cleanToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
    } catch (error) {
      response = null
      if (++consecutiveTransient >= maxConsecutiveTransient) {
        throw new Error(
          `Could not verify Build and Test: GitHub API unreachable after ${consecutiveTransient} tries (${error?.message || error})`,
        )
      }
    }
    if (response && (response.status >= 500 || response.status === 429)) {
      if (++consecutiveTransient >= maxConsecutiveTransient) {
        throw new Error(
          `Could not verify Build and Test: GitHub API unreachable after ${consecutiveTransient} tries (HTTP ${response.status})`,
        )
      }
      response = null
    }
    if (!response) {
      await sleep(Math.max(250, Number(pollMs) || 0))
      continue
    }
    if (!response.ok) {
      throw new Error(`Could not verify Build and Test: GitHub API returned ${response.status}`)
    }
    consecutiveTransient = 0
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
