import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  desiredRedirectRule,
  desiredRewriteRule,
  loadStaticEdgePolicy,
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
