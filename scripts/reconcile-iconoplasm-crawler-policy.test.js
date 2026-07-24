import assert from "node:assert/strict"
import test from "node:test"

import {
  loadIconoplasmCrawlerPolicy,
  reconcileIconoplasmCrawlerPolicy,
} from "./reconcile-iconoplasm-crawler-policy.mjs"

function jsonResponse(result, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, result }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

test("crawler policy distinguishes training crawlers from search and user agents", async () => {
  const policy = await loadIconoplasmCrawlerPolicy()
  assert.deepEqual(policy.blockedTrainingCrawlers, ["GPTBot", "ClaudeBot"])
  assert.deepEqual(policy.allowedSearchCrawlers, [
    "OAI-SearchBot",
    "Claude-SearchBot",
    "PerplexityBot",
  ])
  assert.deepEqual(policy.allowedUserAgents, ["ChatGPT-User", "Claude-User", "Perplexity-User"])
  assert.match(policy.expression, /http\.host eq "iconoplasm\.brinedew\.bio"/)
  assert.match(policy.expression, /GPTBot/)
  assert.match(policy.expression, /ClaudeBot/)
  assert.doesNotMatch(policy.expression, /OAI-SearchBot|Claude-SearchBot|PerplexityBot/)
})

test("reconciliation creates the custom ruleset when the zone has no entrypoint", async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes("/zones?name=")) {
      return jsonResponse([{ id: "zone-1", name: "brinedew.bio" }])
    }
    if (String(url).endsWith("/entrypoint")) return jsonResponse(null, 404)
    if (String(url).endsWith("/zones/zone-1/rulesets")) return jsonResponse({ id: "ruleset-1" })
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await reconcileIconoplasmCrawlerPolicy({
    apiToken: "test-token",
    fetchImpl,
    logger: { log() {} },
  })
  assert.equal(result.outcome, "created_ruleset")
  const createCall = calls.find((call) => call.init.method === "POST")
  const body = JSON.parse(createCall.init.body)
  assert.equal(body.phase, "http_request_firewall_custom")
  assert.equal(body.rules.length, 1)
  assert.equal(body.rules[0].ref, "iconoplasm_training_crawler_budget_guard")
  assert.equal(body.rules[0].action, "block")
})

test("reconciliation is a no-op when the deployed rule already matches", async () => {
  const policy = await loadIconoplasmCrawlerPolicy()
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes("/zones?name=")) {
      return jsonResponse([{ id: "zone-1", name: "brinedew.bio" }])
    }
    if (String(url).endsWith("/entrypoint")) {
      return jsonResponse({
        id: "ruleset-1",
        rules: [
          {
            id: "rule-1",
            ref: policy.ruleRef,
            description: policy.ruleDescription,
            action: policy.action,
            expression: policy.expression,
            enabled: true,
          },
        ],
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await reconcileIconoplasmCrawlerPolicy({
    apiToken: "test-token",
    fetchImpl,
    logger: { log() {} },
  })
  assert.equal(result.outcome, "unchanged")
  assert.equal(calls.length, 2)
})

test("reconciliation updates a drifted project-owned rule without replacing unrelated rules", async () => {
  const policy = await loadIconoplasmCrawlerPolicy()
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes("/zones?name=")) {
      return jsonResponse([{ id: "zone-1", name: "brinedew.bio" }])
    }
    if (String(url).endsWith("/entrypoint")) {
      return jsonResponse({
        id: "ruleset-1",
        rules: [
          { id: "other-rule", ref: "unrelated", action: "block", expression: "true" },
          {
            id: "rule-1",
            ref: policy.ruleRef,
            description: "stale",
            action: "block",
            expression: "false",
            enabled: true,
          },
        ],
      })
    }
    if (String(url).endsWith("/rules/rule-1") && init.method === "PATCH") {
      return jsonResponse({ id: "rule-1" })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const result = await reconcileIconoplasmCrawlerPolicy({
    apiToken: "test-token",
    fetchImpl,
    logger: { log() {} },
  })
  assert.equal(result.outcome, "updated_rule")
  assert.equal(calls.filter((call) => call.init.method === "PATCH").length, 1)
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 0)
})
