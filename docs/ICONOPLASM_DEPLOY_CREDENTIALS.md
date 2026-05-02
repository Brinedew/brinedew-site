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

These are diagnostic credentials for Website Ops telemetry. If local Wrangler or the Cloudflare API returns Cloudflare code `10000` for account Queue, billing, token, or permission work, do not build a GitHub Actions workaround and do not add another sync path. Fix the real Cloudflare account credential from the Cloudflare dashboard.

## Cloudflare Account Admin Path

Cloudflare account permission fixes must be done in the Cloudflare dashboard, through the browser GUI:

- Dashboard: `https://dash.cloudflare.com/`
- Account: Brinedew / `c2f308188824cbf1651a0e999e3ec931`
- User/account area: Profile or Account API Tokens, billing, Workers Queues, and account members as needed.

Do not replace this with a GitHub Actions diagnostic workflow, a repository-secret control plane, or a direct Cloudflare API connector call that bypasses the dashboard. Those are crutches: they hide the broken admin credential path and make the next worker repeat the same mistake.

If a dashboard step creates, updates, or deletes a persistent Cloudflare API token, pause at the final create/update/delete action for explicit user confirmation. After the dashboard action is complete, record only where the credential lives and what scopes it has. Never commit raw token values.

For Iconoplasm sync specifically:

- One true finalization path: durable ledger -> Cloudflare Queue message `drain_finalization_ledger` -> Queue consumer on `geneguessr-api`.
- Forbidden paths: workstation-side finalization processing, `/api/iconoplasm/admin/finalization/process`, per-symbol Queue message formats, GitHub Actions Queue kicks, and any token/secret workaround that pretends the dashboard admin path is optional.
- If Queue sends return HTTP `429`, the correct fixes are Cloudflare Queue allowance/plan/billing in the dashboard or waiting for the UTC reset. Code must fail loud; it must not drain directly.

## Required Cloudflare Permissions

The production deploy token must be able to:

- deploy Workers scripts for `geneguessr-api` and `the-only-allowed-public-edge-worker-that-must-not-touch-state`
- deploy Cloudflare Pages project `brinedew-bio`
- apply D1 migrations for `geneguessr` and `iconoplasm`
- update worker routes for `brinedew.bio`, including `iconoplasm.brinedew.bio/*`

If a token refresh is needed, update the GitHub repository secrets first, then rerun the production workflow. Do not commit raw Cloudflare tokens.

## Current Sync Credential Lesson

The local shell token on 2026-05-02 could read the `geneguessr-api` worker settings but failed worker deploy/settings writes with Cloudflare auth code `10000`. The Cloudflare API connector also produced `Error: Cloudflare API error: 10000: Authentication error` for the Brinedew account. That is a broken admin credential path, not a sync code problem.

The correct deploy recovery is:

1. Commit the worker/config change.
2. Push `main` so `Deploy Production (Cloudflare Pages + Worker)` runs with repository secrets.
3. Confirm the workflow reaches `Deploy the only allowed internal stateful worker (production)`.
4. Verify live Website Ops from the GUI.

The correct Cloudflare account-admin recovery is different: use the Cloudflare dashboard GUI, fix the token/scopes/billing/Queue allowance there, then document the resulting credential location and scopes without exposing secrets.
