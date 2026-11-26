---
name: wiki-court
description: >-
  Run the standardized hybrid adversarial three-role LLM Court (external Google
  AI Studio Advocate + Alex Devil's Advocate with live Google Search and Code
  Execution, followed by the local repo-aware Judge) for promoting any wiki
  article above B (GA, A, or FA). Always use this fixed workflow so the article
  name is the sole caller variable rather than improvising bespoke Court prompts.
---

# Standardized Wiki Promotion Court (AI Studio Counsels + Local Judge)

Evaluating an article with ad-hoc, hand-authored prompts introduces coordinator bias and prompt drift, while running Advocate and Devil's Advocate inside an offline sandbox cripples primary-paper forensics and quantitative verification. All `B -> GA`, `GA -> A`, and `A -> FA` promotion reviews MUST follow this single three-phase pipeline using `scripts/run_court.py`, where the article name is the sole caller variable.

## Architecture

1. **External Advocate (Trade-Off Defense Counsel — Google AI Studio):** NOT a hype man. Proactively hunts the same weak points, simplifications, and omissions that Devil's Advocate will likely attack, uses **Google Search + Code Execution + URL Context** to ground its arguments, and justifies concretely why "fixing" those apparent weak points would degrade the article, bloat scope, duplicate a sibling page, or be an unwise trade-off.
2. **External Alex (Devil's Advocate — Google AI Studio):** Abrasive first-principles prosecutor armed with live **Google Search** (PubPeer, retractions, replications, Bik/Sholto David forensics, omitted counter-evidence), **Code Execution** (verifying equations, units, Data Colada / GRIM stats), and **URL Context** (reading cited DOIs/pages directly), reviewing section-by-section against Wikipedia Featured Article clarity and level-indexed rigor.
3. **Internal Local Judge (Local `research` Agent):** The sole role with full local access to `content/wiki/`, `content/Attachments/`, `Wiki Assessment.md`, `CLAUDE.md`, full sibling pages, local OCR/HTML excerpt PNGs, and headless Quartz renders (`desktop`, `dark`, `390px` mobile — automatically unlocking `.draft-locked` so `draft: true` pages are verified identically). Treats both external briefs skeptically, ignores `draft: true/false` as a quality signal, treats neighbor article sizes as editable architectural choices (never constants of physics), and issues `VERDICT: PROMOTE` or `VERDICT: REMAND`.

## Procedure

### Phase 1 — Prepare Self-Contained Dossier (`mode="prepare"`)

1. Ensure the latest Quartz static build exists (`node ./quartz/bootstrap-cli.mjs build -d content` inside `D:\Coding\Website`) if prose, formulas, or Vega-Lite charts changed.
2. Call `run_workflow` with:
   - `ScriptPath`: `D:\Coding\Website\.agents\skills\wiki-court\scripts\run_court.py`
   - `Args`: `{"article": "<Article Name>", "mode": "prepare"}` (optional: `"target_class": "GA" | "A" | "FA" | "FL"`, default `"GA"`; use `"FL"` for `class: List` reference artifacts)
   - `Cwd`: `D:\Coding\Website`
   - `Description`: `Prepare Wiki Court dossier for <Article Name>`
3. Never inject per-article hints or author framing. The script deterministically builds the render preflight and writes self-contained external prompt packets (inlining the article Markdown, a compact standards & forensics digest, and a neighborhood digest of outbound/inbound/unlinked wiki pages):
   - `.quartz-cache/wiki-court/<slug>/advocate_prompt_ready.md`
   - `.quartz-cache/wiki-court/<slug>/alex_prompt_ready.md`

### Phase 2 — Run Both Counsels in Parallel on Google AI Studio (Deterministic Playwright MCP)

`mode="prepare"` generates two self-contained Playwright MCP scripts (`aistudio_start.js` and `aistudio_poll.js`) from [`aistudio_mcp_template.js`](file:///D:/Coding/Website/.agents/skills/wiki-court/scripts/aistudio_mcp_template.js). Execute them via **Playwright MCP** `browser_run_code_unsafe({ filename })` — reusing the already-authenticated Playwright MCP Chrome session (never an LLM browser subagent and never a hidden headless-session `run_command` Chrome):

1. **Launch both counsels in parallel (~15s):** call `playwright` MCP `browser_run_code_unsafe` with `filename: "D:\\Coding\\.playwright-mcp\\workspace\\wiki-court\\<slug>\\aistudio_start.js"`:
   - Opens **two isolated tabs in parallel** at `https://aistudio.google.com/prompts/new_chat` (never bare `https://aistudio.google.com/`, which opens the app maker).
   - Configures exact Run Settings on **each** tab: **Gemini 4 Neon** (`gemini-4-neon`), **Extra High** thinking, and **all three tools ON**: `Code execution`, `Grounding with Google Search`, and **`URL context`** (`Browse the url context`).
   - Fills the full untruncated `advocate_prompt_ready.md` and `alex_prompt_ready.md` via `.fill()` and submits both concurrently.
2. **Poll & collect verbatim Markdown in bounded ~45s slices (zero MCP timeout risk):** call `playwright` MCP `browser_run_code_unsafe` with `filename: "D:\\Coding\\.playwright-mcp\\workspace\\wiki-court\\<slug>\\aistudio_poll.js"` until `status === "done"`:
   - Ignores transient mid-stream `"Model isn't available right now"` banners while the Stop button is active or output is growing.
   - If a specific tab stalls past ~11 minutes on `Extra High` or hits a fatal error, automatically retries **only that tab** in a fresh chat downgraded to **`High`**.
   - Once finished (3 consecutive idle polls = 15s stable), hovers directly over the response body → clicks triple-dots (`Open options`) → clicks **`Copy as markdown`** (captured via per-page clipboard hook — zero textbox pasting, zero modal hacks) and returns `{ advocate_markdown, alex_markdown }`.
3. Save `advocate_markdown` and `alex_markdown` directly to:
   - `D:\Coding\Website\.quartz-cache\wiki-court\<slug>\advocate_brief.md`
   - `D:\Coding\Website\.quartz-cache\wiki-court\<slug>\alex_review.md`

### Phase 3 — Convene Local Internal Judge (`mode="judge"`)

1. Call `run_workflow` with:
   - `ScriptPath`: `D:\Coding\Website\.agents\skills\wiki-court\scripts\run_court.py`
   - `Args`: `{"article": "<Article Name>", "mode": "judge"}` (matching `"target_class"`)
   - `Cwd`: `D:\Coding\Website`
   - `Description`: `Convene local Wiki Court Judge for <Article Name>`
2. `mode="judge"` automatically archives the full ruling to `.agents/wiki-court-rulings/<slug>/<YYYY-MM-DD>-<TARGET_CLASS>-<verdict>.md` (git-tracked) AND stamps `court_status`, `court_target`, `court_date`, and `court_ruling` directly into the article's YAML frontmatter so future editors, `pnpm run lint:wiki`, and subsequent Court sessions discover past rulings automatically without relying on memory.
3. Read `.agents/wiki-court-rulings/<slug>/<YYYY-MM-DD>-<TARGET_CLASS>-<verdict>.md` (also copied to `.quartz-cache/wiki-court/<slug>/judge_ruling.md`) and act strictly on the binary verdict:
   - `VERDICT: REMAND`: fix every sustained defect without bloating overruled trade-offs (and expand stub neighbors separately where the Judge rules material canonically belongs there), rebuild Quartz, and repeat Phases 1–3 until promoted.
   - `VERDICT: PROMOTE`: update `class:` in frontmatter to `target_class` (leaving `draft:` untouched unless the user explicitly asks to publish/unpublish), then run a final Quartz build, `pnpm run lint:wiki`, `pnpm run check`, and `pnpm run test`.
