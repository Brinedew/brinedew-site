export const ICONOPLASM_OPENAPI_PATH = "/api/public/v1/openapi.json"
export const ICONOPLASM_SERVICE_METADATA_PATH = "/api/public/v1/metadata"
export const ICONOPLASM_LLM_CONTEXT_PATH = "/llms.txt"

// RFC 8631 gives generic Web clients a standards-based path from any public
// Iconoplasm response to the existing resolver. llms.txt remains a separate,
// human-readable context document; it is not mislabeled as API metadata.
export const ICONOPLASM_SERVICE_DISCOVERY_LINKS = Object.freeze([
  `<${ICONOPLASM_OPENAPI_PATH}>; rel="service-desc"; type="application/json"`,
  `<${ICONOPLASM_SERVICE_METADATA_PATH}>; rel="service-meta"; type="application/json"`,
  `<${ICONOPLASM_LLM_CONTEXT_PATH}>; rel="describedby"; type="text/plain"`,
])

export function appendIconoplasmServiceDiscoveryLinks(headers) {
  const next = headers instanceof Headers ? headers : new Headers(headers)
  for (const link of ICONOPLASM_SERVICE_DISCOVERY_LINKS) next.append("Link", link)
  return next
}

const reusableImageFields = {
  type: "object",
  required: ["type", "canonical_url", "rights", "license_url", "attribution_required"],
  properties: {
    type: { type: "string", enum: ["gene_blot", "portrait"] },
    canonical_url: { type: "string", format: "uri" },
    semantic_url: { type: "string", format: "uri" },
    info_url: { type: "string", format: "uri" },
    width: { type: ["integer", "null"] },
    height: { type: ["integer", "null"] },
    checksum_sha256: { type: ["string", "null"] },
    availability: { type: ["string", "null"] },
    rights: { type: "string", const: "CC0 1.0 Universal" },
    license_url: {
      type: "string",
      const: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    usage_url: { type: "string", format: "uri" },
    embedding_permitted: { type: "boolean", const: true },
    hotlinking_permitted: { type: "boolean", const: true },
    modification_permitted: { type: "boolean", const: true },
    commercial_use_permitted: { type: "boolean", const: true },
    attribution_required: { type: "boolean", const: false },
  },
}

export const ICONOPLASM_PUBLIC_OPENAPI = Object.freeze({
  openapi: "3.1.0",
  info: {
    title: "Iconoplasm public image resolver",
    version: "1.0.0",
    description:
      "Resolve human gene symbols, aliases, HGNC identifiers, and UniProt accessions to canonical Iconoplasm gene blots. A gene blot is the machine-downloadable card image with the gene name and symbol over the canonical character portrait.",
  },
  servers: [{ url: "https://iconoplasm.brinedew.bio" }],
  paths: {
    "/api/public/v1/images/resolve": {
      post: {
        operationId: "resolveGeneImages",
        summary: "Resolve up to 50 gene identifiers to canonical gene blots",
        description:
          "No authentication is required. Prefer images.gene_blot for pathway diagrams and other machine image use. The portrait field is temporary migration coverage.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                oneOf: [{ required: ["symbols"] }, { required: ["identifiers"] }],
                properties: {
                  symbols: {
                    type: "array",
                    minItems: 1,
                    maxItems: 50,
                    items: { type: "string" },
                  },
                  identifiers: {
                    type: "array",
                    minItems: 1,
                    maxItems: 50,
                    items: { type: "string" },
                  },
                },
                additionalProperties: false,
              },
              examples: { wnt_pathway: { value: { symbols: ["WNT3A", "FZD7", "CTNNB1"] } } },
            },
          },
        },
        responses: {
          200: {
            description: "One ordered result per supplied identifier",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["canonical_key", "max_symbols", "results"],
                  properties: {
                    api_version: { type: "string" },
                    schema_version: { type: "integer" },
                    card_snapshot_version: { type: "string" },
                    canonical_key: { type: "string", const: "symbol" },
                    max_symbols: { type: "integer", const: 50 },
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["requested", "found", "images"],
                        properties: {
                          requested: { type: "string" },
                          canonical_symbol: { type: ["string", "null"] },
                          matched_by: { type: ["string", "null"] },
                          found: { type: "boolean" },
                          page_url: { type: "string", format: "uri" },
                          images: {
                            anyOf: [
                              { type: "null" },
                              {
                                type: "object",
                                required: ["gene_blot", "portrait"],
                                properties: {
                                  gene_blot: reusableImageFields,
                                  portrait: { anyOf: [{ type: "null" }, reusableImageFields] },
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: "Missing identifiers or more than 50 supplied" },
          429: { description: "Public rate limit exceeded" },
          503: { description: "Published card snapshot temporarily unavailable" },
        },
      },
    },
  },
})

export function iconoplasmPublicOpenApiJson() {
  return `${JSON.stringify(ICONOPLASM_PUBLIC_OPENAPI, null, 2)}\n`
}
