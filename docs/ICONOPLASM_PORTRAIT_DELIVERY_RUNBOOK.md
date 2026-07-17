# Iconoplasm portrait delivery — runbook

Read this when portraits are missing from the Iconoplasm website, browser
extension, request inbox, or a required Discord fulfillment DM.

## Delivery contract

Portrait bytes live in Bunny Storage. Healthy browser tabs read immutable
content-addressed portraits directly from Bunny CDN:

`https://iconoplasmportraits.b-cdn.net/portraits/v1/...`

The first real portrait in each tab decides the source for that tab. Every
other portrait waits for that decision:

1. If Bunny loads, the tab keeps using Bunny until it closes.
2. If Bunny fails or takes longer than 2.5 seconds, the tab uses
   `https://iconoplasm.brinedew.bio/portraits/v1/...` until it closes.
3. The first-party route reads Bunny's authenticated Storage API and caches the
   immutable response at Cloudflare. It must not fetch the failed public CDN
   hostname again.
4. If a selected path later fails, the tab switches once to the other path.
   After both paths have failed, it stops retrying.

This is a source-level circuit breaker, not per-image retry. A page with 100
portraits may produce one failed Bunny probe, not 100 failed Bunny requests.

## Why both paths exist

- Direct Bunny delivery avoids Worker request tax for healthy users.
- The first-party path prevents a regional resolver, VPN, proxy, or public CDN
  hostname problem from turning the product into broken image tiles.
- Both paths read the same content-addressed objects, so switching the delivery
  path does not change portrait identity or canon.
- R2 is not bound in production because the account billing/binding path is
  blocked. Do not propose it as though it were currently available.

## Measured baseline and budget

On 2026-07-17 the affected browser attempted 32 Bunny requests on the INS page;
they failed with `ERR_NAME_NOT_RESOLVED` in 27–83 ms. Those failures did not
reach our servers, but the repeated client work and broken page were real.

At cutover, the live Cloudflare cockpit showed roughly 620 Worker requests on
the latest day (0.62% of the 100,000/day allowance) and roughly 2,000 portrait
route requests in the current 11-day window.

The budget rule is therefore:

- healthy tabs stay direct-to-Bunny;
- only affected tabs spend Worker requests;
- each fallback image is one Worker request and is immutable edge-cacheable;
- investigate before changing this rule if portrait traffic approaches the
  account ceiling.

## First response

1. Reproduce in the Playwright browser on a fresh cache-busted page and wait at
   least five seconds.
2. Count portrait requests by host. An initially affected tab should show one
   failed Bunny request, then first-party portrait requests. It must not show a
   page-sized Bunny failure fanout.
3. Check every rendered portrait's `complete`, `naturalWidth`, and
   `naturalHeight`; an HTTP response alone is not visual proof.
4. Verify two different pages and capture screenshots.
5. Read the live Iconoplasm Observability page for the current Worker percentage
   and portrait-route total.
6. If the first-party route fails, check the server-side Bunny Storage
   credential and object existence. Never expose the credential to a client.

## Chesterton's fences

- Keep Bunny as the public manifest/base URL and keep its CSP/preconnect entry.
  It is the normal zero-Worker-cost path.
- Keep the first-party route. It is the independent hostname/network path for
  affected clients.
- The first-party reader prefers authenticated Bunny Storage. Public CDN reads
  are only a credential-less fallback for incomplete local environments.
- Portrait paths contain a content hash and are served with a one-year
  immutable cache policy. Do not make them private or short-lived.
- The website and extension must share one tab-wide source decision. Do not add
  separate per-component retry loops.
- Discord attachments are server-side reads and use authenticated storage
  directly; they do not depend on the browser circuit breaker.

## Acceptance test

- Start 100 portrait resolutions at once with no stored tab decision.
- Primary success: one primary probe, then all 100 resolve to Bunny.
- Primary failure: one primary failure, then all 100 resolve first-party.
- Reload in the same tab: no new probe.
- New tab: a new decision is allowed.
- Fail both paths: no infinite flip or retry loop.
