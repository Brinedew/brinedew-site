---
title: "Tutorial: Iconoplasm API for third-party developers"
tags:
  - content/wiki
date: 2026-06-23
draft: false
---

# Tutorial: Iconoplasm API for third-party developers

This tutorial walks through how a third-party developer (a script, an AI agent, a research tool, a small game) integrates with Iconoplasm programmatically. It is the developer counterpart to [Tutorial: How to generate and edit blots in Iconoplasm](tutorial-how-to-generate-and-edit-blots-in-iconoplasm), which is aimed at humans clicking through the website.

It will take around 10 minutes of your time.

Prerequisites:

- Comfort with HTTP and JSON
- A way to send `GET` and `POST` requests (`curl`, `requests`, `fetch`, or any HTTP client)
- For paid tiers: a wallet (x402) or a Stripe-compatible account (Stripe MPP), per the gating below

## 1. What kind of API are you integrating with?

Iconoplasm exposes **two** API surfaces with very different audiences, and you must not confuse them.

| Surface | Audience | Auth | Money | Status |
|---|---|---|---|---|
| First-party admin/runtime API at `/api/react-refactor/*` | The Iconoplasm web UI itself (Vladimir + collaborators running brinedew.com) | Discord session cookie | No | Live in production, not a public contract |
| **Agent data-access API at `/api/agent/*`** | **You — third-party developers and agents** | Test header in `test_only` mode; x402 proof or Stripe MPP proof in paid modes | Gated; no money in production today | `test_only` stub local, live deployment requires explicit Vladimir approval |

If you are building a tool that talks to Iconoplasm from outside, the second row is the one you want. The first row is an internal implementation detail of the web app; it is not stable, documented, or supported for third parties, and depending on it will break without warning.

Everything below this line is about the `/api/agent/*` surface.

## 2. Current status — read this first

The `/api/agent/*` API is in **test-only** mode. Specifically:

- `money_enabled` is `false` everywhere. No real money moves in any call you can make today.
- The catalog returns a single resource: `manifestation-metadata-sample`. This is a small synthetic fixture for integration testing, **not** a real dump of Iconoplasm's data.
- Payment proof is a fixed test header. There is no real facilitator, no real wallet, no real Stripe call.
- Production deployment (live `x402` or live Stripe MPP settlement) is a separate explicit approval gate, owned by Vladimir. It is **not** a thing you can flip on from a request header.

This is the honest, supported shape of the API right now. If you build an integration against it today, you are integrating against the test stub, and you should expect the contract to evolve when the first paid rail goes live.

## 3. Discover the catalog

Every third-party client starts with the discovery endpoint. It tells you which resources exist, which rails are configured, and whether money is enabled right now.

```
GET https://iconoplasm.brinedew.bio/api/agent/catalog
```

A real response from the test-only build looks like this (fields are stable; values reflect the current mode):

```json
{
  "service": "iconoplasm-agent-data-access",
  "mode": "test_only",
  "money_enabled": false,
  "payment_rails": ["x402-test"],
  "license": {
    "summary": "Private/local prototype; production license pending Vladimir approval.",
    "requires_approval_for_public_reuse": true
  },
  "resources": [
    {
      "id": "manifestation-metadata-sample",
      "href": "/api/agent/resources/manifestation-metadata-sample",
      "media_type": "application/json",
      "pricing": {"rail": "x402-test", "amount": "0.00", "currency": "TEST"},
      "description": "Small schema/sample for agent integration testing."
    }
  ]
}
```

Things to notice:

- `mode: "test_only"` and `money_enabled: false` mean **no real charges will ever happen on the calls described below**.
- `payment_rails` lists the rails the server is willing to speak. `x402-test` is a no-money compatibility stub. Real `x402` and Stripe MPP rails will appear here when they are approved and deployed.
- `resources[]` is the full list of available resources. Do not hardcode paths; always read them from the catalog, so you pick up new resources automatically.

A `curl` smoke test:

```bash
curl -sS https://iconoplasm.brinedew.bio/api/agent/catalog | jq
```

You should see the JSON above (or its current equivalent). If the call returns `404 Not Found`, the public deployment is not live yet, and you are in the wrong environment — see [Troubleshooting](#11-troubleshooting) below.

## 4. Read a resource

Resources are addressed by `id`. The `href` in the catalog is the URL to call.

```
GET https://iconoplasm.brinedew.bio/api/agent/resources/{resource_id}
```

Behavior, exactly as the server implements it today:

1. **Without payment proof** → the server returns `HTTP 402 Payment Required`. The body is JSON describing the payment requirements. This is the same shape an `x402` client understands, so a real agent client written against `x402` will already know what to do here.
2. **With the test proof header** in test mode → the server returns `HTTP 200` and a small, deterministic, synthetic payload. Real data is not included.
3. **Unknown `resource_id`** → `HTTP 404`, with a body that does not leak internal paths.

### 4a. The 402 response

A `402` from a paid resource looks like this:

```json
{
  "error": "payment_required",
  "mode": "test_only",
  "money_enabled": false,
  "resource": "manifestation-metadata-sample",
  "payment": {
    "rail": "x402-test",
    "amount": "0.00",
    "currency": "TEST",
    "instructions": "Retry with X-Iconoplasm-Test-Payment: test-paid. This is a no-money compatibility stub, not a real payment request."
  }
}
```

A well-behaved `x402` client will read the `payment` object and either pay the rail (when the rail is real) or, in test mode, simply attach the documented test header. The server never calls an external facilitator in test mode, and never asks you to provide a wallet, a key, or a Stripe secret.

### 4b. The test-mode success response

In test mode, send the documented test header and you will get a small fixture back:

```bash
curl -sS \
  -H "X-Iconoplasm-Test-Payment: test-paid" \
  https://iconoplasm.brinedew.bio/api/agent/resources/manifestation-metadata-sample
```

The body is deterministic and synthetic:

```json
{
  "resource": "manifestation-metadata-sample",
  "mode": "test_only",
  "money_enabled": false,
  "records": [
    {
      "id": "sample-001",
      "kind": "manifestation_metadata_sample",
      "fields": {
        "gene_symbol": "EXAMPLE",
        "aesthetic_mapping": "sample aesthetic",
        "schema_note": "Fixture only; not production data."
      }
    }
  ]
}
```

This is enough to validate that your client correctly:

- reads the catalog
- handles `402` and the embedded `payment` object
- retries with a payment proof header
- parses the success body

It is not enough to do real work. Real work requires the paid tier, which is gated.

## 5. Wire it up in Python

A minimal but realistic client. It uses only the standard library plus `requests`, talks to the live test stub, and surfaces the three states a real client must distinguish: catalog discovery, `402`, and `200`.

```python
"""Minimal third-party client for the Iconoplasm /api/agent/* surface.

Behavior:
- Discovers resources from the catalog
- Treats 402 as "payment required", reads the payment object, and retries
  with the documented test-mode proof header
- In test_only mode, no money moves. When money_enabled becomes true, the
  same retry path will carry x402 or Stripe MPP proof instead.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import requests

BASE_URL = os.environ.get(
    "ICONOPLASM_AGENT_BASE",
    "https://iconoplasm.brinedew.bio",
)
TEST_PROOF_HEADER = "X-Iconoplasm-Test-Payment"
TEST_PROOF_VALUE = "test-paid"


def get_catalog(session: requests.Session) -> dict[str, Any]:
    """Read the discovery catalog. Throws if the surface is not deployed."""
    r = session.get(f"{BASE_URL}/api/agent/catalog", timeout=15)
    r.raise_for_status()
    return r.json()


def fetch_resource(
    session: requests.Session,
    resource: dict[str, Any],
    payment_proof: dict[str, str] | None = None,
) -> requests.Response:
    """GET a resource, attaching payment proof if provided."""
    headers = dict(payment_proof or {})
    return session.get(resource["href"], headers=headers, timeout=60)


def parse_payment_challenge(response: requests.Response) -> dict[str, Any]:
    """Extract the payment object from a 402 body."""
    body = response.json()
    if "payment" not in body:
        raise RuntimeError(
            f"402 response missing payment object: {body!r}"
        )
    return body["payment"]


def main() -> int:
    with requests.Session() as s:
        catalog = get_catalog(s)
        if catalog.get("money_enabled"):
            print(
                "Note: money_enabled is true. "
                "Wire a real payment proof (x402 or Stripe MPP) before retrying.",
                file=sys.stderr,
            )
        else:
            print(
                "Catalog reports money_enabled=false; using test-mode proof header."
            )

        for resource in catalog.get("resources", []):
            print(f"\nResource: {resource['id']}  ({resource['href']})")

            r = fetch_resource(s, resource)

            if r.status_code == 200:
                print("  -> 200 OK")
                print(f"  body keys: {list(r.json().keys())}")
                continue

            if r.status_code == 402:
                payment = parse_payment_challenge(r)
                print(f"  -> 402 Payment Required via {payment.get('rail')}")
                if payment.get("rail") == "x402-test":
                    proof = {TEST_PROOF_HEADER: TEST_PROOF_VALUE}
                else:
                    raise RuntimeError(
                        f"Rail {payment.get('rail')!r} is not a test rail; "
                        "real payment integration is not yet available."
                    )
                r2 = fetch_resource(s, resource, payment_proof=proof)
                r2.raise_for_status()
                print(f"  -> {r2.status_code} after test proof")
                print(f"  body keys: {list(r2.json().keys())}")
                continue

            if r.status_code == 404:
                print("  -> 404 Not Found (resource not in this catalog)")
                continue

            r.raise_for_status()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Two design notes that matter for any real integration:

- **Always re-read the catalog on startup.** Do not hardcode resource IDs, prices, or rails. When the first paid resource goes live, your client should pick it up from `resources[]` without a code change.
- **Never assume `money_enabled: false` forever.** The same retry path that today sends `X-Iconoplasm-Test-Payment: test-paid` should, on a future server, send `X-PAYMENT: <x402 proof>` or the Stripe MPP equivalent. Keep the proof-construction step in a single function so this swap is one line.

## 6. Wire it up in JavaScript / TypeScript

A `fetch`-based version. It is deliberately small, but it follows the same pattern as the Python client.

```ts
type Catalog = {
  service: string;
  mode: "test_only" | string;
  money_enabled: boolean;
  payment_rails: string[];
  resources: Resource[];
};

type Resource = {
  id: string;
  href: string;
  media_type: string;
  pricing: { rail: string; amount: string; currency: string };
  description: string;
};

const BASE = process.env.ICONOPLASM_AGENT_BASE
  ?? "https://iconoplasm.brinedew.bio";
const TEST_PROOF_HEADER = "X-Iconoplasm-Test-Payment";
const TEST_PROOF_VALUE = "test-paid";

async function getCatalog(signal?: AbortSignal): Promise<Catalog> {
  const r = await fetch(`${BASE}/api/agent/catalog`, { signal });
  if (!r.ok) throw new Error(`catalog ${r.status}`);
  return r.json();
}

async function fetchResource(
  resource: Resource,
  proof: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(resource.href, { headers: proof, signal });
}

export async function drain(): Promise<void> {
  const catalog = await getCatalog();
  if (catalog.money_enabled) {
    console.warn(
      "money_enabled is true; wire real payment proof before retrying.",
    );
  } else {
    console.log("money_enabled=false; using test-mode proof header.");
  }

  for (const resource of catalog.resources) {
    console.log(`\nResource: ${resource.id}  (${resource.href})`);
    const first = await fetchResource(resource);
    if (first.status === 200) {
      console.log("  -> 200 OK");
      continue;
    }
    if (first.status === 402) {
      const challenge = await first.json();
      const rail = challenge?.payment?.rail;
      if (rail !== "x402-test") {
        throw new Error(
          `Rail ${rail} is not a test rail; real payment is not available yet.`,
        );
      }
      const retry = await fetchResource(resource, {
        [TEST_PROOF_HEADER]: TEST_PROOF_VALUE,
      });
      if (!retry.ok) throw new Error(`retry ${retry.status}`);
      console.log(`  -> ${retry.status} after test proof`);
      continue;
    }
    if (first.status === 404) {
      console.log("  -> 404 Not Found");
      continue;
    }
    throw new Error(`unexpected ${first.status}`);
  }
}
```

If you target a runtime that supports the web `fetch` API, this same code works in Node 18+, Deno, Bun, and the browser.

## 7. Authentication in test mode vs paid mode

There is no API key, no signup, and no shared secret for the test-only surface. The test proof is a public header, and the server never uses it to authenticate a real person.

When the first paid rail goes live, the authentication shape will change:

- **`x402`** — the server returns a `402` with a `WWW-Authenticate: Payment ...` challenge (or an equivalent body), the client pays via an `x402`-compatible wallet/facilitator, and retries with an `X-PAYMENT` proof header. The client side never holds a long-lived Iconoplasm API key; settlement is per-request.
- **Stripe MPP** — the server returns a `402` whose payment object describes a Stripe Shared Payment Token challenge. The client uses Stripe's agent-payment flow to settle and retries with the SPT proof. Again, no Iconoplasm-issued API key.

If your integration is going to be long-lived, the right move is to:

1. Read the catalog on every run.
2. Branch on `payment_rails[]`: if it includes `x402`, plug in an `x402` client; if it includes `stripe-mpp`, plug in a Stripe MPP client; if it includes `x402-test`, use the test header.
3. Surface a clear error if a real rail appears that your client doesn't yet understand. Do not silently fall through to the test header — that would be a security regression the moment money is enabled.

## 8. What you get, and what you don't

What the current contract gives you:

- A stable, documented discovery endpoint.
- A documented `402` body shape that matches `x402`.
- A documented test-mode success body shape.
- An honest `money_enabled` flag.
- An honest `license.requires_approval_for_public_reuse` flag.

What it does **not** give you, today:

- Real money. There is no resource for which calling the API actually costs anything.
- Real data. The success body is a synthetic fixture. Iconoplasm's actual mappings, manifestation metadata, and aesthetic taxonomies are **not** exposed through this surface yet.
- Bulk dumps. There is no "give me everything" endpoint on purpose; the design rule is "small and synthetic unless Vladimir explicitly approves a real data class for exposure."
- Live deployment. The catalog and resource paths above are correct against the local test build. The live site at `iconoplasm.brinedew.bio` returns `404` for `/api/agent/catalog` until the public deployment gate is opened. The hosting decision is Vladimir's, not the API's.

If you want a real data class exposed — mappings, manifestation metadata, aesthetic taxonomies, generated/curated assets — that is a separate approval conversation. The framework to add it exists; the data class, the price, and the license for it do not.

## 9. The path to a real paid API

There is a real plan to take this from `test_only` to a paid public API. The current recommended sequence, in order:

1. **Finish the no-money local stub.** The test endpoint, the catalog, the `402` body, and the acceptance tests for all of the above. This is what your client integrates against today.
2. **Open x402 sandbox/test integration.** Add the `x402[fastapi]` dependency, wire a disabled-by-default testnet adapter using a Vladimir-provided receiving address and facilitator config. No live funds, no public deploy.
3. **Open Stripe MPP test integration.** Add Stripe/MPP SDK glue in test mode with a Vladimir-provided test secret and profile ID. No live funds, no public deploy.
4. **Open the live x402 receiving path.** Configure a real facilitator and a real receiving wallet. Still not publicly deployed.
5. **Open public deployment.** A separate gate, owned by Vladimir. This is the step that actually puts the API in front of third-party clients.

Each step is gated and reviewed. The first three are technically possible today; the last two require real-world decisions (wallet custody, Stripe account, license terms) that only Vladimir can make.

## 10. Safety constraints you should respect

These are the rules the server enforces on itself, and that any well-behaved third-party client should respect as well:

- **Never** treat the test proof header as a real credential. It is a public value.
- **Never** assume a `200` from this API contains real data. The current `200` body is a synthetic fixture; do not publish, screenshot, or cite it as production output.
- **Never** cache the `money_enabled` flag across server restarts. Re-read the catalog.
- **Never** log the test proof header, the `X-PAYMENT` header, or anything that will eventually carry a real payment proof. Logs are a frequent leak path.
- **Never** assume resource IDs are stable across paid-rail rollouts. The `id` of a real paid resource will not be `manifestation-metadata-sample` — that is the fixture's id.

## 11. Troubleshooting

**`/api/agent/catalog` returns 404 on the live site.** This is expected until the public deployment gate is opened. The endpoint exists in the local test build, and the contract in this tutorial is the contract the deployed endpoint will speak. If you are trying to integrate today, run the test build locally; do not poke production.

**`/api/agent/catalog` returns 200 but with `money_enabled: true` and a real rail.** Treat that as a real call. Switch from the test header to the real proof for that rail (`x402` or Stripe MPP). If your client only knows the test header, fail closed — do not silently send the test header to a real-money server.

**`/api/agent/resources/manifestation-metadata-sample` returns 200 without any header.** This is the wrong path. The endpoint only returns `200` after either a paid proof (when money is enabled) or the documented test header. A bare `200` would mean the deployment is misconfigured; report it.

**You want a new resource exposed.** That is an approval conversation with Vladimir, not an API call. The catalog's `resources[]` array is the source of truth; if your resource is not there, it is not available.

**You found a discrepancy between this tutorial and the live catalog.** The live catalog wins. File it as a documentation bug; the tutorial is written against the contract described in the Iconoplasm design docs (`docs/AGENTIC_PAYMENTS_DATA_ACCESS.md` and `docs/AGENTIC_PAYMENTS_APPROVAL_PREP.md`), and the catalog is the wire-level truth.

## 12. Where to go next

- [Tutorial: How to generate and edit blots in Iconoplasm](tutorial-how-to-generate-and-edit-blots-in-iconoplasm) — for humans using the website
- [Iconoplasm FAQ](Iconoplasm-FAQ) — practical questions about generating, editing, voting, and pricing
- [Iconoplasm Patch Notes](Iconoplasm-Patch-Notes) — what changed recently, including any agent-API rollouts

If you are a third-party developer with a concrete integration need, the fastest path is the brinedew.bio Discord: ask there, and Vladimir can decide which gate to open next.
