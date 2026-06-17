# Iconoplasm Deploy Credentials

This file records where deploy credentials live. It does not contain secret values.

## Canonical Production Deploy Path

Production deploys go through GitHub Actions in `Brinedew/brinedew-site`:

- Workflow: `.github/workflows/deploy-quartz.yml`
- Workflow name: `Deploy Production (Cloudflare Pages + Worker)`
- Trigger: push to `main`, or manual `workflow_dispatch`
- Required GitHub repository secrets:
  - `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

The one true Cloudflare credential is the account-owned token named `iconoplasm-admin`. In GitHub it lives as `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`. Workflows may export it as `CLOUDFLARE_API_TOKEN` because Wrangler and Cloudflare tools use that variable name, but the secret source must stay `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`.

Do not use Wrangler OAuth, local auth caches, old personal tokens, or second-choice repository secrets for Iconoplasm deploy, budget, telemetry, D1, Queue, or artifact publication work.

## Iconoplasm App Admin Token

Do not confuse the Cloudflare API token above with the app admin token:

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN` lets Wrangler and GitHub Actions manage Cloudflare resources.
- `ICONOPLASM_ADMIN_TOKEN` is the shared app credential accepted by Iconoplasm admin HTTP endpoints.

The app admin token does not expire by itself. When it appears to "expire", the usual cause is secret drift. Production has two Worker secret copies that must match:

- public edge worker: `the-only-allowed-public-edge-worker-that-must-not-touch-state`
- internal stateful worker: `geneguessr-api`

Rotate both copies together from the local operational token and verify both gates:

```powershell
pnpm exec node scripts/rotate-iconoplasm-admin-token.mjs
```

Use `--include-staging` only when intentionally aligning staging as well. The script reads `ICONOPLASM_ADMIN_TOKEN` from the environment, writes it to the relevant Worker secrets through Wrangler, and then verifies:

- stateful admin authorization with `/api/iconoplasm/admin/mutation-limiter/policy`
- public edge token acceptance with `/api/iconoplasm/site/genes/GLYAT`

Never set only one of the two production Worker secrets. Never diagnose this as a user/session problem until the script has verified both gates.

## Iconoplasm Image Edit Key Storage

B-517 stores user image-edit provider keys in D1 after encrypting them inside the internal stateful worker. The worker requires one Cloudflare Worker secret with at least 32 characters:

- Preferred secret name: `ICONOPLASM_IMAGE_EDIT_KEY_SECRET`
- Backward-compatible fallback names accepted by the worker: `ICONOPLASM_USER_KEY_ENCRYPTION_SECRET` or `ICONOPLASM_BYOK_ENCRYPTION_SECRET`

Set this as a Worker secret on `geneguessr-api` in production and staging. Do not put the value in `wrangler*.toml`, GitHub Actions logs, localStorage, or committed documentation.

## Local Cloudflare Credential

The local workstation has the same one path:

- `CLOUDFLARE_API_TOKEN` contains the `iconoplasm-admin` token value.
- `CLOUDFLARE_ACCOUNT_ID` contains `c2f308188824cbf1651a0e999e3ec931`.

`D:\Coding\Datasets\iconoplasm\logs\cloudflare_auth_cache.json` is retired. Do not read it, refresh it, or treat it as a recovery path. If `CLOUDFLARE_API_TOKEN` cannot see the account, D1, Queues, and GraphQL analytics, the environment is broken and the fix is to replace the `iconoplasm-admin` token itself.

## Cloudflare Account Admin Path

Cloudflare account permission fixes must be done in the Cloudflare dashboard, through the browser GUI:

- Dashboard: `https://dash.cloudflare.com/`
- Account: Brinedew / `c2f308188824cbf1651a0e999e3ec931`
- User/account area: Account API Tokens, billing, Workers Queues, and account members as needed.

Do not replace this with a GitHub Actions diagnostic workflow, a repository-secret control plane, or a direct Cloudflare API connector call that bypasses the dashboard. Do not replace it with Wrangler OAuth, a local cache, or a second Cloudflare token either. Those are crutches: they hide the broken `iconoplasm-admin` credential and make the next worker repeat the same mistake.

The desired token is simple: account-owned, named `iconoplasm-admin`, no expiration, broad account access for Iconoplasm operations. After a token replacement, update the local `CLOUDFLARE_API_TOKEN` value and the GitHub `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN` repository secret. Never commit raw token values.

For Iconoplasm sync specifically:

- One true finalization path: durable ledger -> Cloudflare Queue message `drain_finalization_ledger` -> Queue consumer on `geneguessr-api`.
- Forbidden paths: workstation-side finalization processing, `/api/iconoplasm/admin/finalization/process`, per-symbol Queue message formats, GitHub Actions Queue kicks, and any token/secret workaround that pretends the dashboard admin path is optional.
- If Queue sends return HTTP `429`, the correct fixes are Cloudflare Queue allowance/plan/billing in the dashboard or waiting for the UTC reset. Code must fail loud; it must not drain directly.

## Required Cloudflare Permissions

The `iconoplasm-admin` token must be able to:

- deploy Workers scripts for `geneguessr-api` and `the-only-allowed-public-edge-worker-that-must-not-touch-state`
- deploy Cloudflare Pages project `brinedew-bio`
- apply D1 migrations for `geneguessr` and `iconoplasm`
- update worker routes for `brinedew.bio`, including `iconoplasm.brinedew.bio/*`
- read Cloudflare GraphQL analytics, D1 usage, Workers usage, Durable Objects usage, Queues state, and observability data used by B-507 budget gates

If the token needs replacement, replace `iconoplasm-admin`, update `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`, update local `CLOUDFLARE_API_TOKEN`, then rerun the production workflow. Do not create a parallel token and do not commit raw Cloudflare tokens.

## Current Sync Credential Lesson

The local shell token on 2026-05-02 could read the `geneguessr-api` worker settings but failed worker deploy/settings writes with Cloudflare auth code `10000`. The Cloudflare API connector also produced `Error: Cloudflare API error: 10000: Authentication error` for the Brinedew account. That is a broken `iconoplasm-admin` credential path, not a sync code problem.

The correct deploy recovery is:

1. Commit the worker/config change.
2. Push `main` so `Deploy Production (Cloudflare Pages + Worker)` runs with repository secrets.
3. Confirm the workflow reaches `Deploy the only allowed internal stateful worker (production)`.
4. Verify live Website Ops from the GUI.

The correct Cloudflare account-admin recovery is different: use the Cloudflare dashboard GUI, replace `iconoplasm-admin` if needed, update the two secret locations, and verify the one token can read the account, D1, Queues, and analytics without falling back to anything else.
