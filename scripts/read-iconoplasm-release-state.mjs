// The installed Worker's settings say which revision is live: the deploy wrote
// its commit into ICONOPLASM_HTML_SHELL_CACHE_VERSION. A code-only release
// (verify-code-release.mjs) diffs against that revision.
export async function readIconoplasmReleaseState({
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  token = process.env.CLOUDFLARE_API_TOKEN,
  fetcher = fetch,
} = {}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token)
    throw new Error("COST_RELEASE_STATE_CREDENTIALS_REQUIRED")
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/geneguessr-api/settings`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!response.ok) throw new Error("COST_RELEASE_STATE_UNAVAILABLE")
  const value = await response.json()
  if (value?.success !== true || !Array.isArray(value.result?.bindings))
    throw new Error("COST_RELEASE_STATE_UNAVAILABLE")
  const matches = value.result.bindings.filter(
    (item) => item.name === "ICONOPLASM_HTML_SHELL_CACHE_VERSION",
  )
  if (matches.length > 1 || (matches.length && matches[0].type !== "plain_text"))
    throw new Error("COST_RELEASE_STATE_INVALID")
  return { cache_version: matches[0]?.text ?? "" }
}
