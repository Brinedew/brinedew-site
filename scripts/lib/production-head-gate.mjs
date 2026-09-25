export async function assertCurrentProductionHead({
  repository,
  headSha,
  token,
  fetchImpl = fetch,
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository || "") ||
    !/^[a-f0-9]{40}$/.test(headSha || "") ||
    !token
  )
    throw new Error("Production head verification requires repository, exact SHA and GitHub token")
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/git/ref/heads/main`,
    {
      signal: AbortSignal.timeout(30000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  )
  if (!response.ok)
    throw new Error(`Cannot verify current production source: HTTP ${response.status}`)
  const ref = await response.json()
  if (
    ref.ref !== "refs/heads/main" ||
    ref.object?.type !== "commit" ||
    ref.object?.sha !== headSha
  ) {
    const error = new Error(
      "Stale production run refused: its commit is not current main; dispatch current main",
    )
    error.code = "PRODUCTION_HEAD_SUPERSEDED"
    throw error
  }
  return headSha
}

// B-857: when PRs merge seconds apart, the older push's run found main had
// moved and failed red, and red reads as "production is broken". For a push,
// main moving means a newer push's run is already queued, so this run is
// superseded, not failed: cancel it, and it ends grey like any other
// superseded run. A manual dispatch of an old commit, an unreadable head, or
// a cancel the API refuses still fail red. None of them may proceed.
export async function enforceProductionHead({ env, fetchImpl = fetch }) {
  try {
    await assertCurrentProductionHead({
      repository: env.GITHUB_REPOSITORY,
      headSha: env.GITHUB_SHA,
      token: env.GITHUB_TOKEN,
      fetchImpl,
    })
    return "current"
  } catch (error) {
    if (error?.code !== "PRODUCTION_HEAD_SUPERSEDED" || env.GITHUB_EVENT_NAME !== "push")
      throw error
    if (!/^\d+$/.test(env.GITHUB_RUN_ID || "")) throw error
    const response = await fetchImpl(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/cancel`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    )
    if (response.status !== 202)
      throw new Error(
        `Superseded production run could not cancel itself (HTTP ${response.status}); refusing to deploy`,
      )
    return "superseded"
  }
}
