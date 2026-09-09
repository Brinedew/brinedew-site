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
  if (ref.ref !== "refs/heads/main" || ref.object?.type !== "commit" || ref.object?.sha !== headSha)
    throw new Error(
      "Stale production run refused: its commit is not current main; dispatch current main",
    )
  return headSha
}
