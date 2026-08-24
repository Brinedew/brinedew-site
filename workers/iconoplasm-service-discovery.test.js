import assert from "node:assert/strict"
import test from "node:test"

import {
  ICONOPLASM_PUBLIC_OPENAPI,
  ICONOPLASM_SERVICE_DISCOVERY_LINKS,
  appendIconoplasmServiceDiscoveryLinks,
  iconoplasmPublicOpenApiJson,
} from "./iconoplasm-service-discovery.js"

test("service discovery links distinguish the API contract from llms context", () => {
  const headers = appendIconoplasmServiceDiscoveryLinks(new Headers())
  const link = headers.get("Link") || ""
  assert.match(link, /openapi\.json>; rel="service-desc"; type="application\/json"/)
  assert.match(link, /metadata>; rel="service-meta"; type="application\/json"/)
  assert.match(link, /llms\.txt>; rel="describedby"; type="text\/plain"/)
  assert.doesNotMatch(link, /llms\.txt>; rel="service-meta"/)
  assert.equal(ICONOPLASM_SERVICE_DISCOVERY_LINKS.length, 3)
})

test("public OpenAPI describes the real bounded, unauthenticated blot resolver", () => {
  const operation = ICONOPLASM_PUBLIC_OPENAPI.paths["/api/public/v1/images/resolve"].post
  const schema = operation.requestBody.content["application/json"].schema
  assert.equal(ICONOPLASM_PUBLIC_OPENAPI.openapi, "3.1.0")
  assert.equal(schema.properties.symbols.maxItems, 50)
  assert.equal(schema.properties.identifiers.maxItems, 50)
  assert.equal(operation.security, undefined)
  assert.match(operation.description, /Prefer images\.gene_blot/)
  assert.equal(JSON.parse(iconoplasmPublicOpenApiJson()).openapi, "3.1.0")
})
