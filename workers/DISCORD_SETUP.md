# Discord OAuth Setup Guide

## Step 1: Create Discord Application

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Name it "GeneGuessr" 
4. Go to OAuth2 section

## Step 2: Configure OAuth2

**Redirect URIs:**
- Development: `http://localhost:8787/api/auth/callback`
- Production: `https://geneguessr-api.decap.workers.dev/api/auth/callback`

**Scopes needed:**
- `identify` - Get user ID, username, avatar
- `guilds.members.read` - Check server membership

## Step 3: Get Credentials

Copy these values:
- **Client ID**: Found in OAuth2 General page
- **Client Secret**: Click "Reset Secret" to generate (keep this secure)

## Step 4: Add to Cloudflare Worker

Run these commands to set secrets:

```bash
cd D:\Coding\Website
npx wrangler secret put DISCORD_CLIENT_ID
# Paste your Client ID when prompted

npx wrangler secret put DISCORD_CLIENT_SECRET
# Paste your Client Secret when prompted

npx wrangler secret put DISCORD_GUILD_ID
# Paste: 1306796644046180372 (from discord.gg/kx8FVzUrpf)
```

## Step 5: Test

After deployment, visit:
- `https://geneguessr-api.decap.workers.dev/api/auth/login`

Should redirect to Discord OAuth consent screen.
