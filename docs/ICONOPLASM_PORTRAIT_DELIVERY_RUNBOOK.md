# Iconoplasm portrait delivery — runbook

Read this if a user reports "portraits not loading on iconoplasm.brinedew.bio"
or "the iconoplasm browser extension is showing empty squares." It is a
short first-response guide that distills the 2026-06-26 incident into a
3-step diagnostic. The full investigation evidence is in
`artifacts/image-bug-diagnosis-2026-06-26/`.

## TL;DR for the impatient

1. The bug is almost never the project. Run `scripts/check-isp-dns-self-heal.cmd`
   and read the output. If all four consumer resolvers return NOERROR + A
   record, the bug is on a different layer (browser cache, network proxy,
   VPN, ad-blocker). If any return NXDOMAIN or SERVFAIL, the bug is at the
   resolver and the fix is to wait for the cache to expire.
2. **Do not** propose flipping the manifest's `portrait_base_url` from
   `https://iconoplasmportraits.b-cdn.net` to `https://iconoplasm.brinedew.bio`.
   The architecture doc `docs/ICONOPLASM_PORTRAIT_STORAGE_REFACTOR.md`
   documents the durable fix, and the durable fix is R2. R2 is currently
   disabled on the account. Going to the worker origin without R2 puts the
   worker in front of every portrait fetch and burns Free-plan Workers
   request budget. That is a band-aid, not a fix.
3. **Do not** trust the cost-guard table in `docs/DISCORD_INTEGRATION.md`.
   It is stale and says the account is on Workers Paid ($5/mo). The account
   is on Workers Free (100K requests/day) and has been for ~6 months. The
   table numbers are wrong by an order of magnitude.

## The two serving paths

| Path            | URL                                                      | DNS                       | Who serves the bytes                                | When to use                                                                                                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------- | ------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bunny pull zone | `https://iconoplasmportraits.b-cdn.net/portraits/v1/...` | Bunny NS layer (wildcard) | Bunny CDN edge                                      | Primary. Set in the manifest's `portrait_base_url`.                                                                                                                                                                                                                                                                         |
| Worker origin   | `https://iconoplasm.brinedew.bio/portraits/v1/...`       | Cloudflare authoritative  | Cloudflare worker, which fetches from Bunny storage | Fallback. Lives in the same `wrangler.toml` deploy. The `/portraits/` route is already wired and tested; see `iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js:1559-1577` and `iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js:25289-25307`. |

The worker-origin URL is reachable from any network because `brinedew.bio` is
on Cloudflare DNS. The Bunny URL is reachable from any network _that can
resolve `b-cdn.net` hostnames_ — which is most public resolvers, but not all
consumer ISP resolvers (see the 2026-06-26 incident).

## Why public resolvers can't see the bug

Bunny's NS layer (`ns1.bunnydns.com`, `ns2.bunnydns.com`, `ns3.bunnydns.com`)
returns a wildcard A record for any `*.b-cdn.net` subdomain. So
`afafafafafafafa.b-cdn.net` and `iconoplasmportraits.b-cdn.net` both return
the same kind of answer from public resolvers. The bug cannot be reproduced
from a public resolver. It can only be reproduced from the user's actual
recursive resolver. This is why the diagnostic script targets four specific
ISP resolver IPs rather than querying 8.8.8.8.

## Step-by-step diagnostic

When a user reports "portraits broken on the live site":

1. **Reproduce in a real browser, on the user's network, with the user's
   resolver.** Open the iconoplasm page in the Playwright browser that is
   already logged into brinedew.bio. Open DevTools console. Look for
   `net::ERR_NAME_NOT_RESOLVED` against `iconoplasmportraits.b-cdn.net`.
   If you see it, the bug is on the DNS layer.

2. **Run the ISP resolver check.** `scripts/check-isp-dns-self-heal.cmd`
   queries the four Vietnamese ISP resolvers (2001:ee0:23::23,
   2001:ee0:26::26, 123.23.23.23, 123.26.26.26) over raw UDP. If any return
   NXDOMAIN, the bug is on the ISP. If all return NOERROR + A record, the
   bug is on a different layer (proxy, browser cache, ad-blocker, etc.).

3. **Read the live admin cockpit.** Navigate to
   `https://brinedew.bio/admin/iconoplasm#costs` in the Playwright browser
   (you are already logged in; the admin redirects there automatically).
   The "Workers request ceiling" panel shows the past 14 days of worker
   requests. The "Route attribution" panel shows the top routes. These are
   the only ground truth for "how much budget is the project actually
   using." Do not trust any cost number that does not come from this page.

4. **Look at the project side only after step 3.** If the live admin shows
   the project is fine, the project is fine. Don't ship a code change.

## What NOT to do

- **Do not** route all portrait fetches through the worker as a "fix." The
  in-cycle portrait route serves 3K requests over 14 days. Routing all 19,023
  portrait URLs through the worker would push the request count to a
  substantially higher number per day, against a 100K Free-plan ceiling.
  This is a budget cost for a problem the user can solve by waiting for an
  ISP cache to expire.
- **Do not** edit `docs/DISCORD_INTEGRATION.md`'s cost-guard table to match
  the Free plan without re-measuring. The actual numbers in that table
  (22k-63k Workers requests/day, 8.1B D1 reads/month, etc.) are based on
  the assumption that the account is on Workers Paid. Without re-measuring
  against the live Free-plan quotas, the corrected table would be guessing.
- **Do not** propose R2 as a fix. R2 is currently disabled on this account
  (per `wrangler.toml:133-145` and the architecture doc). It is not a code
  change. It is an account-level change that requires re-adding a payment
  method to the Cloudflare account.

## Why the bug is on the user's ISP, not the project

- The project's wrangler.toml, deployed worker bindings, and manifest have
  not changed in a way that affects portrait URLs. The portrait env vars
  were set on 2026-04-16 and have not been modified since.
- Bunny's edge is healthy. Curl the resolved Bunny IP directly with the
  correct Host header; you get 200 OK image/webp.
- Public resolvers (Google, Cloudflare, Adguard) resolve the hostname.
  The Bunny authoritative nameservers resolve it. The wildcard `b-cdn.net`
  NS delegation is healthy.
- Some consumer ISP resolvers return NXDOMAIN. This is a resolver-side
  failure, not a project-side failure.

The pattern — Bunny's pull zone hostname broken for _some_ resolvers but not
others, while the worker-origin URL works for everyone — is the signature of
a _resolver-side_ bug. Wait for the resolver to recover. Do not fix the
project.

## Evidence

The full investigation that produced this runbook is in
`artifacts/image-bug-diagnosis-2026-06-26/`. Key files:

- `thum_800.png` — thum.io screenshot showing the page rendering correctly
  on a network that _can_ resolve the Bunny hostname. The disproof of the
  "every user in the world is broken" hypothesis.
- `worker-origin-portrait-200x200.png` — a real portrait rendering on the
  user's own Playwright session when accessed via the worker-origin URL.
  This proves the bytes are reachable from the user's network, just not at
  the Bunny URL the manifest currently uses.
- `probe_isp_resolvers.py` / `check-isp-dns-self-heal.cmd` — the diagnostic
  script. Run it any time.
- The script copy in `scripts/probe_isp_resolvers_for_iconoplasm_cdn.py`
  and `scripts/check-isp-dns-self-heal.cmd` is the canonical version. The
  artifact folder copy is a snapshot.

## Why this runbook exists

Before this runbook, the next agent who hit this bug would have to:

1. Read the architecture doc to learn the manifest's portrait_base_url
   points to Bunny.
2. Read the wrangler.toml to learn there's a worker-origin fallback.
3. Read the public-edge worker to learn the `/portraits/` route is already
   wired.
4. Read the public Bunny status to confirm Bunny is healthy.
5. Probe multiple public resolvers to confirm the DNS layer is fine on the
   public side.
6. Probe the user's ISP resolvers directly to find the NXDOMAIN.
7. Verify the bug is not on the project side (wrangler.toml diff,
   deployed bindings via the Cloudflare API, the live gallery response).
8. Conclude "wait for the resolver cache to expire."

This runbook compresses those 8 steps into one. Read the runbook, run the
script, look at the admin cockpit. Then decide.
