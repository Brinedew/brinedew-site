# Discord OAuth setup

> For how the Discord *bot* works (daily recap + comment mirroring, storage,
> secrets, and cost/limits), see [`docs/DISCORD_INTEGRATION.md`](../docs/DISCORD_INTEGRATION.md).
> This file only covers the OAuth login app.

## Application

- Discord application: "GeneGuessr", OAuth2 section.
- Live server (guild): **`1289484665966563438`** (`brinedew.bio`, invite
  `discord.gg/danZruPf`).

> Historical note: earlier versions of this doc listed guild
> `1306796644046180372` and a `geneguessr-api.decap.workers.dev` callback. Both
> are stale. The live callback host is `geneguessr.brinedew.bio`.

## OAuth2 config

**Redirect URIs:**

- Production: `https://geneguessr.brinedew.bio/api/auth/callback`
- Local dev: `http://localhost:8787/api/auth/callback`

**Scopes:** `identify`, `guilds.members.read`.

## Secrets

Set on the `geneguessr-api` worker (see the secrets table in
[`docs/DISCORD_INTEGRATION.md`](../docs/DISCORD_INTEGRATION.md)):

```bash
cd D:\Coding\Website
npx wrangler secret put DISCORD_CLIENT_ID --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml
npx wrangler secret put DISCORD_GUILD_ID --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml
```

## Test

After deployment, visit `https://geneguessr.brinedew.bio/api/auth/login` — it
should redirect to the Discord OAuth consent screen.
