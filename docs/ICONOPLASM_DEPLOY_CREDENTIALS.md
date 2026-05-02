# Iconoplasm Deploy Credentials

This file records where deploy credentials live. It does not contain secret values.

## Canonical Production Deploy Path

Production deploys go through GitHub Actions in `Brinedew/brinedew-site`:

- Workflow: `.github/workflows/deploy-quartz.yml`
- Workflow name: `Deploy Production (Cloudflare Pages + Worker)`
- Trigger: push to `main`, or manual `workflow_dispatch`
- Required GitHub repository secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

The repository secrets are the durable source of truth for Cloudflare deploy credentials. Local shell credentials are useful for diagnostics, but they are not the authority.

## Local Diagnostic Credentials

The local workstation may expose:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `D:\Coding\Datasets\iconoplasm\logs\cloudflare_auth_cache.json`

These are diagnostic credentials for Website Ops telemetry. If local Wrangler or the Cloudflare API returns Cloudflare code `10000` for write/deploy operations, do not keep retrying locally. Use the GitHub Actions production deploy path above, because the repo secrets may have different permissions from the local token.

As of 2026-05-02, the installed local user token verifies as active but returns Cloudflare code `10000` for account Queue and billing APIs:

- `GET /user/tokens/verify`: works
- `GET /accounts/{account_id}/queues`: `403` / `10000`
- `GET /accounts/{account_id}/billing/profile`: `403` / `10000`
- `GET /accounts/{account_id}/subscriptions`: `403` / `10000`
- `GET /accounts/{account_id}/billing/usage/paygo`: `403` / `10000`

Do not treat that local token as the admin token for Queue/billing recovery.

## Canonical Cloudflare Admin Diagnostics

Use `.github/workflows/iconoplasm-queue-diagnostics.yml` when Queue or billing auth matters. It runs inside GitHub Actions with the repository `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, so it is the durable credential path for Cloudflare account diagnostics.

Supported manual inputs:

- `inspect`: verify the repository token and inspect Queues, billing profile, subscriptions, PayGo usage, Queue consumers, and Queue metrics without sending a Queue message.
- `kick`: resume Queue delivery and send exactly one canonical `drain_finalization_ledger` message.
- `full`: do `kick`, then inspect the durable finalization ledger.

The workflow must not print raw secret values. If it reports Cloudflare `429`, the account has hit the Queue operation allowance and the correct recovery is to wait for the UTC daily reset or raise the account plan/allowance in Cloudflare billing.

## Required Cloudflare Permissions

The production deploy token must be able to:

- deploy Workers scripts for `geneguessr-api` and `the-only-allowed-public-edge-worker-that-must-not-touch-state`
- deploy Cloudflare Pages project `brinedew-bio`
- apply D1 migrations for `geneguessr` and `iconoplasm`
- update worker routes for `brinedew.bio`, including `iconoplasm.brinedew.bio/*`

If a token refresh is needed, update the GitHub repository secrets first, then rerun the production workflow. Do not commit raw Cloudflare tokens.

## Current Sync Credential Lesson

The local shell token on 2026-05-02 could read the `geneguessr-api` worker settings but failed worker deploy/settings writes with Cloudflare auth code `10000`. That is a permission mismatch, not a sync code problem.

The correct recovery is:

1. Commit the worker/config change.
2. Push `main` so `Deploy Production (Cloudflare Pages + Worker)` runs with repository secrets.
3. Confirm the workflow reaches `Deploy the only allowed internal stateful worker (production)`.
4. Verify live Website Ops from the GUI.
