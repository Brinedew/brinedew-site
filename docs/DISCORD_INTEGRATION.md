# Discord integration

How brinedew.bio talks to the Discord server `brinedew.bio` (guild ID
`1289484665966563438`, invite `discord.gg/danZruPf`). There is no separate bot
process — everything runs inside the one stateful Cloudflare Worker
`geneguessr-api`. The public edge worker just proxies to it.

Two features live here:

1. **Daily GeneGuessr recap** → posted to `#geneguessr`
2. **New gene-page comments** → mirrored to `#iconoplasm`

---

## 1. Daily GeneGuessr recap

**ARCHITECTURE FENCE [GG-002]:** an image is ready only when the admin renderer
has observed stable molecule pixels and storage returns the exact bytes that were
uploaded under the immutable day + UniProt + renderer identity. An attachment
node, a non-empty PNG, object metadata, or a generic 2xx response is not proof of
a visible protein. The July 2026 path admitted a uniform RGB `17,12,10` canvas;
the August 3 cutover then reported an unverified Bunny upload as successful.

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

History (see Linear B-356):

- Originally a GitHub Actions Playwright job rendered the structure and posted
  it. That broke on 2026-02-25 (Actions billing lock).
- It was cut over to **cloud-only**: pre-render the PNG and store it, so the
  daily post works with the owner's machine powered off. Live WebGL rendering at
  post time was tried and **deliberately abandoned** (Mol*/WebGL is unreliable
  headless).
- Images were stored in the R2 bucket `STRUCTURES_BUCKET`. **R2 was later
  disabled on the account** (see `wrangler.*.toml` — buckets commented out),
  which broke recap posting at stage `load_cached_image` with
  `STRUCTURES_BUCKET binding is not configured`.

Current design (2026-08-03):

- The recap image now uses the **same Bunny CDN object storage the Iconoplasm
  portrait pipeline already uses** — no R2 required. Shared helpers live in
  [`workers/lib/discord-recap-images.js`](../workers/lib/discord-recap-images.js):
  `putDiscordRecapImage` / `loadDiscordRecapImageBytes` / `headDiscordRecapImage`
  / `deleteDiscordRecapImage`. They prefer `STRUCTURES_BUCKET` automatically if
  R2 is ever rebound, otherwise read/write Bunny.
- Uploading images: the `/admin` panel ("Upload Selected Day Image" /
  "Upload Next 365 Days") posts to `POST /api/admin/discord-recap-image`, which
  now writes to Bunny. Pre-render the catalog there and the daily cron attaches
  images automatically.
- Stored objects are immutable and keyed by day + authoritative UniProt ID +
  `DISCORD_RECAP_RENDER_CONTRACT`. A schedule override or renderer revision is
  therefore an automatic cache miss; legacy date-only objects are never read.
- The admin renderer samples the actual Mol* canvas until molecule pixels are
  present for three consecutive frames. It retries a fresh viewer once and
  refuses the upload if the canvas remains a uniform background.
- Bunny upload success is the documented HTTP `201`, followed by bounded
  exact-byte read-back from the same authenticated storage identity. The admin
  UI must not mark a day covered before that verification succeeds.
- **If no image is uploaded, the recap still posts text-only.** This is the
  cloud-only fallback B-356 asked for: the daily post can never be blocked by the
  image pipeline.
- A posted text-only recap is repaired in place using its durable message ID;
  repair never creates a second daily message.

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

> Note: the old `workers/DISCORD_SETUP.md` referenced guild `1306796644046180372`
> and a `geneguessr-api.decap.workers.dev` callback. The live server is
> `1289484665966563438` and the OAuth callback is on `geneguessr.brinedew.bio`.

---

## 3. Supporter tier detection

The OAuth callback handler in `workers/auth.js` reads the user's Discord **roles** from the guild member object (returned by `GET /users/@me/guilds/{guild}/member`) during login and writes `tier: "supporter"` to both D1 and the session if the user holds the configured `DISCORD_SUPPORTER_ROLE_ID`.

Since the Boosty bot assigns/removes the "Subscriber" role asynchronously (user may already be logged into the site), **`/api/auth/me` also re-checks Discord roles** for ALL users at most once per 5 minutes. This handles both upgrades (new subscriber sees supporter status without re-login) and downgrades (lapsed subscriber loses website supporter access within minutes of role removal).

The re-check uses the stored OAuth access token (7-day lifetime) and is best-effort: if Discord is unreachable, the cached tier is served and the next page load retries. It only fires when `DISCORD_SUPPORTER_ROLE_ID` is configured.

Cost: ~1 Discord API call per 5 minutes per active user. At current scale (28 members, 5 online) this is ~1,440 calls/day. Worst-case with 100 active users, ~28,800 calls/day — well under the 50 req/s global limit.

The frontend's `formatTierLabel()` in `sidebar-shell.js` already renders tiers other than "registered"; it will display "Supporter" for users with that tier.

---

## Cost and limits

The former table here mixed a June 2026 paid-plan snapshot with changing
architecture and later account conditions. It is historical incident evidence,
not planning authority, and has been removed so it cannot be mistaken for a
current recommendation.

Use `docs/ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md` for action-derived
limits. Historical usage may reveal an unmodeled path, but it may not forecast a
changed runtime or justify paid capacity.

The shared stateful Worker currently uses four of Cloudflare's five cron slots:

- `55 23 * * *`: sole full Iconoplasm maintenance owner plus GeneGuessr pre-warm;
- `3 0 * * *`: GeneGuessr recap and catch-up only;
- `6 12 * * *`: GeneGuessr feed;
- `*/15 * * * *`: cheap Iconoplasm gallery publication check only.
| Queues ops | 1M/mo | untouched by Discord features | n/a |
| Browser Rendering | ~10 hr/mo (paid) | gene-card render: 1 per (gene, canonical version), cached | far under |
| Bunny CDN | usage-billed | recap = ~1 MB/day storage + ~1 MB/day egress | ~$0.01/GB |
| Discord API | 50 req/s global; ~5 msg/5s per channel | ~0/day | 4+ orders under |

**Tightest resource: D1 rows written** (proj 25.6% of self-budget; a viral day
touched 85% of the per-day fair share once).

### What each feature costs per day

- **Comment → #iconoplasm:** +0 D1 writes, +1 Discord POST per new comment
  (capped 20/user/hr). The gene-card image adds **one Browser Rendering pass per
  (gene, canonical version)** — gated by comment events and cached in KV
  thereafter, so a gene that isn't re-voted is rendered once ever. At real
  comment volumes this is a tiny fraction of the ~10 browser-hours/month
  allowance. Worst case (render fails) it posts text-only.
- **Daily recap:** the cron already exists. Per run: ~2 KV reads + ~2 KV writes
  (posted marker + the `puzzle_actual` write upstream), one set of D1 reads for
  winners/top-guesses (≤~100k rows once = ≤0.0125% of the daily fair share), and
  1–2 subrequests (Bunny image GET if present + Discord POST). 0 D1 writes.
  Text-only mode drops the Bunny GET.

Neither feature moves the needle on the tight resource (D1 writes); both add
zero D1 writes.
