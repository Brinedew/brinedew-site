---
title: "Privacy Policy"
description: "How GeneGuessr handles your data"
date: 2026-02-10
draft: false
---

# Privacy Policy

**Last updated:** February 10, 2026

This Privacy Policy describes how GeneGuessr ("we", "us", or "our") collects, uses, and protects your information when you use our website at geneguessr.brinedew.bio.

## Information We Collect

### Information You Provide

**Discord Account Data** (if you sign in):
- Discord user ID
- Username
- Avatar URL
- Discord server membership status (whether you're in our Discord server)
- Leaderboard visibility preference (opt in/out)

We request the Discord OAuth scopes `identify` and `guilds.members.read`. We do not receive your email address.

### Information Collected Automatically

**Game Data:**
- Guesses you make (which proteins you guessed)
- Hints you reveal
- Game outcomes (win/loss)
- Number of guesses per game
- Timestamps (when you started and completed games)

**Technical Data:**
- IP address hash (a one-way cryptographic hash, not your actual IP address)
- Browser-stored preferences (via cookies and localStorage)

**Aggregated Analytics:**
- Which proteins are guessed across all players (aggregated by day, not per-user)
- Total guess counts per protein

### Information Stored in Your Browser

- Game statistics (games played, wins, streaks) in localStorage
- Current game state in sessionStorage
- Tutorial progress
- Leaderboard visibility preference used during sign-in
- Session cookies for authentication

## How We Use Your Information

We use collected information to:

- **Provide the game**: Track your daily game progress, calculate similarity scores, display hints
- **Sync your stats**: If signed in, save your statistics across devices
- **Run the public streak leaderboard**: If you opt in, show your Discord username, avatar, and best streak publicly
- **Prevent abuse**: Use IP hashes to limit daily game attempts per person
- **Improve the game**: Analyze aggregated guess patterns to tune puzzle difficulty
- **Authenticate you**: Manage login sessions via Discord OAuth

## Legal Basis for Processing (GDPR)

We process your data based on:

- **Legitimate interest**: Operating the game, preventing abuse, improving difficulty balance
- **Consent**: When you sign in with Discord, you consent to us receiving your Discord profile data, and if enabled, to showing your profile on the public leaderboard
- **Contract performance**: Providing the game service you've chosen to use

## Cookies and Tracking Technologies

We use the following cookies:

| Cookie | Purpose | Duration |
|--------|---------|----------|
| `session` | Keeps you logged in after Discord sign-in | 30 days |
| `geneguessr_session` | Tracks your current game session (guest players) | Session |
| `oauth_session` | Temporary cookie during Discord login flow | 10 minutes |

We do not use third-party analytics, advertising cookies, or tracking pixels.

## Data Sharing

We do not sell your data.

We share data only with:

- **Cloudflare**: Our infrastructure provider (see "Where Data Is Stored" below). Cloudflare processes data on our behalf under their [privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Public leaderboard viewers**: If you opt in, your Discord username, avatar, and best streak are visible to visitors in the in-app leaderboard.

We do not share your data with advertisers, data brokers, or other third parties.

## Where Data Is Stored

All data is processed and stored on Cloudflare infrastructure:

- **Cloudflare Workers**: Application logic
- **Cloudflare D1**: Database (user accounts, game history, statistics)
- **Cloudflare KV**: Caching layer
- **Cloudflare Durable Objects**: Session management
- **Cloudflare R2**: Protein structure files (no personal data)

Cloudflare operates data centers globally. For EU users, this may involve data transfer outside the EEA. Cloudflare maintains appropriate safeguards including Standard Contractual Clauses.

## Data Retention

- **Account data**: Retained until you request deletion
- **Game history**: Retained until you request deletion
- **Statistics**: Retained until you request deletion
- **Leaderboard visibility preference**: Retained until you change it or request deletion
- **Public leaderboard entries**: Visible only while your visibility preference is enabled
- **Session data**: Automatically expires (10 minutes for OAuth, 30 days for login sessions)
- **Aggregated analytics**: Retained indefinitely (contains no personal data)

## Your Rights

Under GDPR and similar laws, you have the right to:

- **Access**: Request a copy of your personal data
- **Rectification**: Request correction of inaccurate data
- **Erasure**: Request deletion of your data ("right to be forgotten")
- **Portability**: Request your data in a machine-readable format
- **Object**: Object to processing based on legitimate interest
- **Withdraw consent**: Revoke consent for leaderboard display by turning visibility off, or revoke Discord data sharing by logging out

To exercise these rights, email **support@brinedew.bio**. We will respond within 30 days.

## Data Security

We protect your data through:

- HTTPS encryption for all connections
- Hashed IP addresses (we never store raw IPs)
- Secure, HttpOnly cookies
- OAuth 2.0 with PKCE for Discord authentication
- No storage of Discord access tokens beyond session duration

## Children's Privacy

GeneGuessr is not directed at children under 13. We do not knowingly collect data from children under 13. If you believe we have collected such data, contact us for immediate deletion.

## Changes to This Policy

We may update this policy occasionally. Material changes will be indicated by updating the "Last updated" date. Continued use after changes constitutes acceptance.

## Contact

For privacy questions or to exercise your rights:

**Email:** support@brinedew.bio

---

*GeneGuessr is a personal project, not a commercial service. This policy reflects our commitment to handling your data responsibly.*
