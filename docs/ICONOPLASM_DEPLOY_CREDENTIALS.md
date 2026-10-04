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

There are three Cloudflare API tokens, all account-owned, with no expiry. Each one lives in exactly one place:

| Token              | Where it lives                                                           | D1                        | Used by                                                                                           |
| ------------------ | ------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `iconoplasm-ci`    | GitHub secret `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`                        | Metadata Read, Read, Edit | every GitHub Actions workflow: deploys, online migrations, catalog publication, capacity observer |
| `iconoplasm-admin` | laptop environment variable `CLOUDFLARE_API_TOKEN`                       | **none**                  | agents and the workstation: Workers, KV, Queues and GraphQL analytics reads                       |
| `d1-backup-read`   | `D:\Backups\brinedew-d1\backup-token.txt` (agents are denied reading it) | Read                      | the nightly backup (`scripts/backup-d1-rotation.mjs`), plus Account Analytics Read                |

The laptop token has no D1 permission so that no agent, script or typo on the laptop can run SQL against production (B-1002). Investigate production data on the nightly copy with `node scripts/d1-local.mjs <db> "<sql>"`; anything that must write or read D1 live runs in GitHub Actions or through a Worker route. Workflows export the GitHub secret as `CLOUDFLARE_API_TOKEN` because Wrangler and Cloudflare tools use that variable name, but its source stays `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`.

Do not use Wrangler OAuth or local auth caches for any of this work.

## Iconoplasm App Admin Token

Do not confuse the Cloudflare API token above with the app admin token:

- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN` lets Wrangler and GitHub Actions manage Cloudflare resources.
- `ICONOPLASM_ADMIN_TOKEN` is the shared app credential accepted by Iconoplasm admin HTTP endpoints.

The GitHub repository secret `ICONOPLASM_ADMIN_TOKEN` must also match the live
app credential. Migration admission uses it directly. Release preflight verifies
it with an authenticated HEAD request before pausing application work; a nonempty
but stale repository secret must fail before that pause. When synchronizing this
secret, pass the locally verified value through standard input without printing
it or putting it on the command line.

The app admin token does not expire by itself. When it appears to "expire", the usual cause is secret drift between its two copies: the GitHub secret and the internal stateful Worker `geneguessr-api`. The public edge Worker holds no admin credential (B-819); operators and the workstation call admin routes on `iconoplasm.brinedew.bio`, which the internal Worker serves.

Rotate the Worker copy from the local operational token and verify the admin gate:

```powershell
pnpm exec node scripts/rotate-iconoplasm-admin-token.mjs
```

Use `--include-staging` only when intentionally aligning staging as well. The script reads `ICONOPLASM_ADMIN_TOKEN` from the environment, writes it to the relevant Worker secrets through Wrangler, and then verifies:

- stateful admin authorization with `/api/iconoplasm/admin/mutation-limiter/policy`

Never diagnose this as a user/session problem until the script has verified the gate.

## Iconoplasm Image Edit Key Storage

B-517 stores user image-edit provider keys in D1 after encrypting them inside the internal stateful worker. The worker requires one Cloudflare Worker secret with at least 32 characters:

- Preferred secret name: `ICONOPLASM_IMAGE_EDIT_KEY_SECRET`
- Backward-compatible fallback names accepted by the worker: `ICONOPLASM_USER_KEY_ENCRYPTION_SECRET` or `ICONOPLASM_BYOK_ENCRYPTION_SECRET`

Set this as a Worker secret on `geneguessr-api` in production and staging. Do not put the value in `wrangler*.toml`, GitHub Actions logs, localStorage, or committed documentation.

## Local Cloudflare Credential

On the laptop:

- `CLOUDFLARE_API_TOKEN` contains the `iconoplasm-admin` token value. A D1 call with it answers HTTP 403, code 7403, by design.
- `CLOUDFLARE_ACCOUNT_ID` contains `c2f308188824cbf1651a0e999e3ec931`.
- The backup reads `d1-backup-read` from its token file, falling back to `CLOUDFLARE_API_TOKEN` only when the file is missing.

`D:\Coding\Datasets\iconoplasm\logs\cloudflare_auth_cache.json` is retired. Do not read it, refresh it, or treat it as a recovery path. If `CLOUDFLARE_API_TOKEN` cannot see the account, Workers, Queues and GraphQL analytics, replace `iconoplasm-admin` with the same permissions, still without D1.

## Cloudflare Account Admin Path

Cloudflare account permission fixes must be done in the Cloudflare dashboard, through the browser GUI:

- Dashboard: `https://dash.cloudflare.com/`
- Account: Brinedew / `c2f308188824cbf1651a0e999e3ec931`
- User/account area: Account API Tokens, billing, Workers Queues, and account members as needed.

Do not replace this with a GitHub Actions diagnostic workflow, a repository-secret control plane, or a direct Cloudflare API connector call that bypasses the dashboard. Do not replace it with Wrangler OAuth or a local cache. Those are crutches that hide a broken credential.

When a token is replaced, update only its one location from the table above. Never commit raw token values.

For Iconoplasm sync specifically:

- One true finalization path: durable ledger -> Cloudflare Queue message `drain_finalization_ledger` -> Queue consumer on `geneguessr-api`.
- Forbidden paths: workstation-side finalization processing, `/api/iconoplasm/admin/finalization/process`, per-symbol Queue message formats, GitHub Actions Queue kicks, and any token/secret workaround that pretends the dashboard admin path is optional.
- If Queue sends return HTTP `429`, the correct fixes are Cloudflare Queue allowance/plan/billing in the dashboard or waiting for the UTC reset. Code must fail loud; it must not drain directly.

## Required Cloudflare Permissions

The `iconoplasm-ci` token (the GitHub secret) must be able to:

- deploy Workers scripts for `geneguessr-api` and `the-only-allowed-public-edge-worker-that-must-not-touch-state`
- deploy Cloudflare Pages project `brinedew-bio`
- apply D1 migrations for the databases bound in `wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml`
- update Worker routes for `brinedew.bio`; the public edge Worker owns `brinedew.bio/api/*`, `geneguessr.brinedew.bio/api/*` and `geneguessr.brinedew.bio/admin*`, while `geneguessr-api` owns the asset-first `iconoplasm.brinedew.bio/*` route
- read Cloudflare GraphQL analytics, D1 usage, Workers usage, Durable Objects usage, Queues state, and observability data used by B-507 budget gates

`iconoplasm-admin` (the laptop) holds the same permissions minus every D1 row. If `iconoplasm-ci` needs replacement, create it in the dashboard, update `CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN`, then rerun the production workflow.

## Credential Failure Recovery

A workflow that fails with Cloudflare auth code `10000` (`Authentication error`), or with a D1 call answering 401, is a broken `iconoplasm-ci` secret, not a code problem. A D1 call from the laptop answering 403 (code 7403) is the laptop token working as designed.

The correct deploy recovery is:

1. Commit the worker/config change.
2. Push `main` so `Deploy Production (Cloudflare Pages + Worker)` runs with repository secrets.
3. Confirm the workflow reaches `Deploy the compatible stateful Worker`.
4. Verify live Website Ops from the GUI.

The correct Cloudflare account-admin recovery is different: use the Cloudflare dashboard GUI, replace the broken token, update its one location, and verify it does what its row in the table says, without falling back to anything else.
