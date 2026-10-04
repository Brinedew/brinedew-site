# Discord integration

How brinedew.bio talks to the Discord server `brinedew.bio` (guild ID
`1289484665966563438`, invite `discord.gg/danZruPf`). There is no separate bot
process — everything runs inside the one stateful Cloudflare Worker
`geneguessr-api`. The public edge Worker forwards `brinedew.bio/api/*` and
GeneGuessr `/api/*` and `/admin*` to it through a service binding.

Two features live here:

1. **Daily GeneGuessr recap** → posted to `#geneguessr`
2. **New gene-page comments** → mirrored to `#iconoplasm`

---

## 1. Daily GeneGuessr recap

**ARCHITECTURE FENCE [GG-002]:** an image is ready only when the admin renderer
has observed stable molecule pixels and storage returns the exact bytes that were
uploaded under the immutable day + UniProt + renderer identity. An attachment
node, a non-empty PNG, object metadata, or a generic 2xx response is not proof of
a visible protein: a uniform dark canvas and an unverified Bunny upload both
pass those weaker checks.

Once a day the worker posts yesterday's puzzle result to `#geneguessr`: the gene,
how many people solved it, the top guesses, and a link to play. When a
pre-rendered structure image exists it's attached; otherwise the recap posts
text-only.

### Flow

- Cron `3 0 * * *` (00:03 UTC) fires the worker's `scheduled()` handler, which
  calls `handlePostDailyRecap(env)` for "yesterday" (UTC).
  - File: [`workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js`](../workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js) (`scheduled`)
  - Logic: [`workers/discord.js`](../workers/discord.js) (`handlePostDailyRecap`)
- It reads `puzzle_actual:<day>` from KV for the answer, then `getWinnersCount`
  + `getDailyGuessAggregates` from D1 for the stats.
- It tries to load the pre-rendered PNG for the exact puzzle identity:
  `discord-recap-images/v2/<day>/<uniprot>/<render-contract>.png`. If that exact
  object is present → posts text **+ image** (multipart). If absent → posts
  **text-only**. It never substitutes an image cached for a different target or
  renderer, and never hard-fails on a missing image.
- On success it writes `discord_summary_posted:<day>` to KV (idempotency) and
  clears any `discord_summary_post_failure:<day>` marker.

### Where the recap image comes from

The daily post works with the owner's machine powered off: images are pre-rendered
in the `/admin` panel and stored, never rendered at post time.

- The recap image uses the **same Bunny CDN object storage as the Iconoplasm
  portrait pipeline**. Shared helpers live in
  [`workers/lib/discord-recap-images.js`](../workers/lib/discord-recap-images.js):
  `putDiscordRecapImage` / `loadDiscordRecapImageBytes` / `headDiscordRecapImage`.
  They prefer the `STRUCTURES_BUCKET` R2 binding when it is configured
  (it is commented out in the Wrangler configs) and otherwise read and write Bunny.
- Uploading images: the `/admin` panel ("Upload Selected Day Image" /
  "Upload Next 365 Days") posts to `POST /api/admin/discord-recap-image`, which
  writes to Bunny. Pre-render the catalog there and the daily cron attaches
  images automatically.
- **"Upload Next 365 Days" is a resumable reconciliation, not a blind loop.** It
  fails closed unless the authoritative response contains exactly 365
  consecutive day/UniProt identities from today through day 364, checks stored objects in 25-identity
  client chunks, and processes only missing identities. Missing days are grouped
  by UniProt so an explicit repeated override can reuse one molecule render, but the base64
  bitmap and Mol* viewer are released after that group. A closed tab loses only
  the active group: verified objects are the durable checkpoint for the next run.
  After processing, the admin re-reads all 365 immutable identities and may show
  success only for exact 365/365 coverage. Server-side HEAD work runs at five
  concurrent storage reads, below Cloudflare's six-connection invocation limit.
- The authoritative schedule endpoint constructs the whole horizon from one
  deterministic in-memory bag plan and bulk-loads minimal protein summaries. It
  returns HTTP 503 rather than HTTP 200 if even one day lacks an identity, and
  writes no per-day KV cache: per-day D1 reads can return silent null rows, and a
  per-day cache spends Cloudflare's daily KV write budget.
- Stored objects are immutable and keyed by day + authoritative UniProt ID +
  `DISCORD_RECAP_RENDER_CONTRACT`. A schedule override or renderer revision is
  therefore an automatic cache miss; date-only object keys are never read.
- The admin renderer samples the actual Mol* canvas until molecule pixels are
  present for three consecutive frames. It retries a fresh viewer once and
  refuses the upload if the molecular viewport remains empty. The fixed
  bottom-left orientation axes are explicitly outside the measured molecule
  region, so an axes-only frame cannot satisfy coverage.
- Bulk reconciliation probes the selected structure URL with `HEAD` before
  starting Mol*. A known 4xx/5xx structure failure is retained as a hole
  immediately instead of consuming two viewer load timeouts; ordinary
  interactive admin previews keep their existing loading behavior.
- A failed automatic mystery target is not rendered with AlphaFold. Yearly
  reconciliation records a non-AlphaFold availability replacement outside all
  UniProt IDs and normalized surnames in the 365-day horizon, then renders and
  uploads that target-bound image. Manual overrides remain authoritative and
  are never replaced automatically.
- A successful replacement is a non-AlphaFold curated structure the server chose
  and the browser rendered; no structure bytes are stored or pinned. Availability
  pins are selector-salt and pool-fingerprint bound D1 records, and are shared by the
  admin schedule, cards, pre-warm, and request-time paths. D1 ownership is a
  capacity fence: replacement decisions must remain writable after unrelated KV
  traffic reaches Cloudflare's daily write ceiling.
- Bunny upload success is the documented HTTP `201`, followed by bounded
  exact-byte read-back from the same authenticated storage identity. Read-back
  can take longer than 5 seconds, so the shared retry envelope
  (`workers/lib/bunny-storage-consistency.js`) probes for up to 15 seconds. The
  admin UI must not mark a day covered before that verification succeeds. Bunny
  can acknowledge a PUT whose bytes never become readable, so storage retries
  the same immutable key and exact bytes up to six times without another
  browser render.
- **If no image is uploaded, the recap still posts text-only.** The daily post
  can never be blocked by the image pipeline.
- A posted text-only recap is repaired in place using its durable message ID;
  repair never creates a second daily message.
- Repair first checks the immutable day + UniProt + renderer object and reuses
  its accepted bytes. It renders only when that exact object is missing. A
  second render for an existing key is not a valid refresh: nondeterministic
  canvas pixels can differ while Bunny still serves the previously accepted
  object, producing an unresolvable exact-byte comparison.
- Repair treats the existing posted marker as read-only. Discord PATCH edits
  that exact message in place and cannot change its ID, so a post-success KV
  rewrite would add no authority. This is also a capacity fence: an exhausted
  daily KV write allowance must not turn a successful Discord edit into a false
  repair failure.

### Manual trigger / backfill

`POST /api/discord/post-recap` (optional `?day=YYYY-MM-DD` or JSON `{day}`;
optional `{image_base64}` override), auth `Authorization: Bearer <BOT_CRON_TOKEN>`.
`GET /api/discord/daily-summary?day=…` returns the recap data without posting
(same auth). Never post a day whose puzzle is still active — it spoils the answer.

---

## 2. New gene-page comments → #iconoplasm

When someone leaves a comment ("suggestion") on a gene page, the worker mirrors
it into `#iconoplasm`.

- Trigger: successful `INSERT` in the `POST /api/iconoplasm/genes/:symbol/comments`
  handler, in
  [`workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`](../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js)
  (`postIconoplasmGeneCommentToDiscord`).
- Fires via `ctx.waitUntil(...)` — best-effort, out of band. A Discord failure
  never blocks or fails the comment write. **Adds zero D1 writes** and **no cron**.
- Message format: a header line `New comment on **<SYMBOL>** gene: <link>` (the
  link **wrapped in `<>`** so Discord renders no link-preview embed), a blank
  line, then the comment with the author bolded inline in front:
  `**<user>**: <body>`. `allowed_mentions: { parse: [] }` so user text can never
  ping anyone.
- **Attaches a fresh image of the gene card** (the horizontal "lit-archival"
  ACCESSION SHEET card at the top of the gene page) instead of relying on the
  link preview (which only showed the generic brinedew.bio logo).
  - `renderIconoplasmGeneCardImageBytes` drives the `ICONOPLASM_PRINT_COPY_BROWSER`
    binding to load the live gene page and screenshot the `.icono-gene-lead-card`
    element — so it's pixel-faithful and shows the **current** canonical blot
    (which changes as people vote).
  - `getIconoplasmGeneCardImageBytes` caches the PNG in KV keyed by
    `snapshot_version : canonical_asset_sha` (reusing the print-copy resolver).
    The image re-renders only when the blot actually changes; otherwise it's
    served from cache — at most one render per (gene, canonical version).
  - If the render fails, the mirror degrades to a clean text-only post.
- New comments only. Edits and deletes are not mirrored.
- The post's message id is not stored. An account erasure
  (`workers/iconoplasm/account-erasure/discord-comment-mirror.js`) finds the post again, as the
  bot's message that follows the comment row by seconds, and rewrites its author to the anonymous
  label (or deletes the post of a comment its author had removed). The message shape lives in
  [`workers/lib/iconoplasm-comment-discord-mirror.js`](../workers/lib/iconoplasm-comment-discord-mirror.js),
  used by both the poster and the erasure. The bot needs View Channel and Read Message History in
  `#iconoplasm`.
- Comment creation is already rate-limited to 20/user/hour in the handler.

---

## Secrets (on the `geneguessr-api` Worker)

Set with `wrangler secret put <NAME> --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml`.

| Secret | Purpose |
|--------|---------|
| `DISCORD_BOT_TOKEN` | Bot REST auth for posting messages |
| `DISCORD_GENEGUESSR_CHANNEL_ID` | `#geneguessr` channel (`1449749419628040315`) |
| `DISCORD_ICONOPLASM_CHANNEL_ID` | `#iconoplasm` channel (`1509977022363865110`) |
| `BOT_CRON_TOKEN` | Bearer auth for `/api/discord/post-recap` + `daily-summary`. The daily cron does **not** use it (calls the handler directly), so rotating it never affects daily posting. |
| `ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD` | Bunny AccessKey — also used to write recap images |
| `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_ID/SECRET`, `DISCORD_GUILD_ID` | OAuth login + interactions verification |
| `DISCORD_SUPPORTER_ROLE_ID` | Role snowflake (`1449712082038820906` = "Subscriber"). If set, the OAuth callback parses the user's Discord roles and upgrades `users.tier` to "supporter" when present. |

Plain vars for Bunny storage: `ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL`,
`ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST`, `ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE`.

The OAuth callback is on `geneguessr.brinedew.bio`; see `workers/DISCORD_SETUP.md`.

---

## 3. Supporter tier detection

The OAuth callback handler in `workers/auth.js` reads the user's Discord **roles** from the guild member object (returned by `GET /users/@me/guilds/{guild}/member`) during login and writes `tier: "supporter"` to both D1 and the session if the user holds the configured `DISCORD_SUPPORTER_ROLE_ID`.

Since the Boosty bot assigns/removes the "Subscriber" role asynchronously (user may already be logged into the site), **`/api/auth/me` also re-checks Discord roles** for ALL users at most once per 5 minutes. This handles both upgrades (new subscriber sees supporter status without re-login) and downgrades (lapsed subscriber loses website supporter access within minutes of role removal).

The re-check uses the stored OAuth access token (7-day lifetime) and is best-effort: if Discord is unreachable, the cached tier is served and the next page load retries. It only fires when `DISCORD_SUPPORTER_ROLE_ID` is configured.

Cost: ~1 Discord API call per 5 minutes per active user, so 100 active users make ~28,800 calls/day — well under the 50 req/s global limit.

The frontend's `formatTierLabel()` in `sidebar-shell.js` already renders tiers other than "registered"; it will display "Supporter" for users with that tier.

---

## Cost and limits

Use current provider telemetry and the actual user action when investigating
capacity.

The configured stateful Worker uses Cloudflare's five cron slots:

- `55 23 * * *`: GeneGuessr pre-warm;
- `3 0 * * *`: GeneGuessr recap and catch-up only;
- `6 12 * * *`: GeneGuessr feed;
- one recurring minute-list expression, checked against
  `workers/iconoplasm-background-schedule.js`, gives each Iconoplasm job its own
  invocation. Comment delivery uses four batches of 20/hour; supervote delivery
  uses five batches of 16/hour. Both retain 80 messages/hour;
- `56,58,59 23 * * *`: nightly archive, canon repair and gallery, each in a
  separate invocation.

### What each feature costs per day

- **Comment → #iconoplasm:** the mirror adds +0 D1 writes and +1 Discord POST
  per new comment (capped 20/user/hr). The gene-card image adds **one Browser
  Rendering pass per (gene, canonical version)**, gated by comment events and
  cached in KV thereafter, so a gene that isn't re-voted is rendered once. If
  the render fails it posts text-only.
- **Daily recap:** per run, ~2 KV reads + ~2 KV writes (posted marker + the
  `puzzle_actual` write upstream), one set of D1 reads for winners/top guesses,
  and 1–2 subrequests (Bunny image GET if present + Discord POST). 0 D1 writes.
  Text-only mode drops the Bunny GET.

Neither feature adds D1 writes.
