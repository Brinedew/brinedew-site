import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  desiredRedirectRule,
  desiredRewriteRule,
  loadStaticEdgePolicy,
  reconcileStaticEdgePolicy,
} from "./reconcile-brinedew-static-edge-policy.mjs"

// B-834: one policy owns the Cloudflare settings that keep brinedew.bio and
// geneguessr.brinedew.bio static. The deployed Worker routes (wrangler.toml
// and the deploy workflow's reassignment step) must agree with it, or a
// deploy would quietly put a Worker back in front of every file.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8")

test("the public edge Worker is routed only to API and admin paths", async () => {
  const [policy, wrangler, workflow] = await Promise.all([
    loadStaticEdgePolicy(),
    read("../wrangler.toml"),
    read("../.github/workflows/deploy-quartz.yml"),
  ])
  // Production routes only; [env.staging] owns staging.brinedew.bio separately.
  const production = wrangler.split(/^\[env\./m)[0]
  const routes = [...production.matchAll(/pattern = "([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(routes.sort(), [...policy.publicEdgeRoutes].sort())
  for (const pattern of policy.retiredPublicEdgeRoutes) {
    assert.ok(!routes.includes(pattern), `${pattern} must not be a Worker route`)
    assert.ok(!workflow.includes(`"${pattern}"`), `${pattern} must not be reassigned on deploy`)
  }
  for (const pattern of policy.publicEdgeRoutes) {
    assert.ok(
      pattern.includes("/api/") || pattern.includes("/admin"),
      `${pattern} is not an API/admin path`,
    )
    assert.ok(workflow.includes(`"${pattern}"`), `${pattern} missing from deploy reassignment`)
  }
})

test("legacy GeneGuessr redirects cannot loop with the document rewrite", async () => {
  const policy = await loadStaticEdgePolicy()
  // Single Redirects run before URL Rewrites in the same request, so a
  // redirect may target "/" while the rewrite maps "/" to the Pages path.
  for (const rewrite of policy.rewriteRules) {
    assert.ok(rewrite.path.startsWith("/apps/geneguessr/"), rewrite.ref)
    for (const redirect of policy.redirectRules) {
      assert.ok(
        !redirect.expression.includes(`"${rewrite.path.replace(/\/$/, "")}"`) ||
          redirect.targetUrl?.startsWith("https://geneguessr.brinedew.bio/"),
        `${redirect.ref} must send ${rewrite.path} to the canonical host`,
      )
    }
  }
})

test("rules serialize to the Cloudflare ruleset shape", async () => {
  const policy = await loadStaticEdgePolicy()
  const www = desiredRedirectRule(policy.redirectRules[0])
  assert.equal(www.action, "redirect")
  assert.equal(www.action_parameters.from_value.status_code, 301)
  assert.equal(www.action_parameters.from_value.preserve_query_string, true)
  const rewrite = desiredRewriteRule(policy.rewriteRules[0])
  assert.deepEqual(rewrite.action_parameters, { uri: { path: { value: "/apps/geneguessr/" } } })
})

// B-858. Ways the consent setting could silently fail, written first:
// 1. the Web Analytics site is not matched, and the reconciler reports "fine";
// 2. auto_install stays on after an apply;
// 3. the release never runs the analytics stage at all.
function analyticsCloudflare(sites) {
  const writes = []
  const fetchImpl = async (url, init = {}) => {
    const path = String(url).replace("https://api.cloudflare.com/client/v4", "")
    if (path.startsWith("/zones?name="))
      return Response.json({ success: true, result: [{ id: "z", name: "brinedew.bio" }] })
    if (path.endsWith("/rum/site_info/list")) return Response.json({ success: true, result: sites })
    if (
      path.endsWith("/rulesets/phases/http_config_settings/entrypoint") &&
      (init.method || "GET") === "GET"
    ) {
      return new Response(JSON.stringify({ success: false }), { status: 404 })
    }
    if (path.endsWith("/rulesets") && init.method === "POST") {
      writes.push({ path, body: JSON.parse(init.body) })
      return Response.json({ success: true, result: {} })
    }
    if (init.method === "PUT") {
      writes.push({ path, body: JSON.parse(init.body) })
      return Response.json({ success: true, result: {} })
    }
    throw new Error(`unexpected ${init.method || "GET"} ${path}`)
  }
  return { fetchImpl, writes }
}

test("an unmatched Web Analytics site is drift, and apply refuses", async () => {
  const { fetchImpl } = analyticsCloudflare([
    { site_tag: "t", host: "elsewhere.example", site_token: "x" },
  ])
  const options = { apiToken: "t", accountId: "a", stage: "analytics", fetchImpl, log: () => {} }
  // Two drifts: the missing configuration rule and the unmatched site.
  assert.deepEqual(await reconcileStaticEdgePolicy({ ...options, mode: "check" }), { drift: 2 })
  await assert.rejects(reconcileStaticEdgePolicy({ ...options, mode: "apply" }), /not found/)
})

test("the analytics stage turns Cloudflare's beacon injection off by configuration rule and site setting", async () => {
  const policy = await loadStaticEdgePolicy()
  assert.equal(policy.webAnalyticsAutoInstall, false)
  const { fetchImpl, writes } = analyticsCloudflare([
    {
      site_tag: "tag1",
      host: "brinedew.bio",
      site_token: policy.webAnalyticsSiteToken,
      auto_install: true,
    },
  ])
  await reconcileStaticEdgePolicy({
    apiToken: "t",
    accountId: "a",
    mode: "apply",
    stage: "analytics",
    fetchImpl,
    log: () => {},
  })
  assert.deepEqual(writes, [
    {
      path: "/zones/z/rulesets",
      body: {
        name: policy.configRulesetName,
        kind: "zone",
        phase: "http_config_settings",
        rules: [
          {
            ref: "brinedew_no_injected_web_analytics",
            description: policy.configRules[0].description,
            expression: "true",
            action: "set_config",
            action_parameters: { disable_rum: true },
            enabled: true,
          },
        ],
      },
    },
    {
      path: "/accounts/a/rum/site_info/tag1",
      body: { auto_install: false, host: "brinedew.bio", zone_tag: "z" },
    },
  ])
  const workflow = await read("../.github/workflows/deploy-quartz.yml")
  assert.match(workflow, /reconcile-brinedew-static-edge-policy\.mjs --apply analytics/)
})
