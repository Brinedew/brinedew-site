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

1. **External Advocate (Trade-Off Defense Counsel — Google AI Studio):** NOT a hype man. Proactively hunts the same weak points, simplifications, and omissions that Devil's Advocate will likely attack, uses **Google Search + Code Execution** to ground its arguments, and justifies concretely why "fixing" those apparent weak points would degrade the article, bloat scope, duplicate a sibling page, or be an unwise trade-off.
2. **External Alex (Devil's Advocate — Google AI Studio):** Abrasive first-principles prosecutor armed with live **Google Search** (PubPeer, retractions, replications, Bik/Sholto David forensics, omitted counter-evidence) and **Code Execution** (verifying equations, units, Data Colada / GRIM stats), reviewing section-by-section against Wikipedia Featured Article clarity and level-indexed rigor.
3. **Internal Local Judge (Local `research` Agent):** The sole role with full local access to `content/wiki/`, `content/Attachments/`, `Wiki Assessment.md`, `CLAUDE.md`, full sibling pages, local OCR/HTML excerpt PNGs, and headless Quartz renders (`desktop`, `dark`, `390px` mobile). Treats both external briefs skeptically, checks local wiki harmony and renders directly, and uses independent judgment to issue `VERDICT: PROMOTE` or `VERDICT: REMAND`.

## Procedure

### Phase 1 — Prepare Self-Contained Dossier (`mode="prepare"`)

1. Ensure the latest Quartz static build exists (`node ./quartz/bootstrap-cli.mjs build -d content` inside `D:\Coding\Website`) if prose, formulas, or Vega-Lite charts changed.
2. Call `run_workflow` with:
   - `ScriptPath`: `D:\Coding\Website\.agents\skills\wiki-court\scripts\run_court.py`
   - `Args`: `{"article": "<Article Name>", "mode": "prepare"}` (optional: `"target_class": "GA" | "A" | "FA"`, default `"GA"`)
   - `Cwd`: `D:\Coding\Website`
   - `Description`: `Prepare Wiki Court dossier for <Article Name>`
3. Never inject per-article hints or author framing. The script deterministically builds the render preflight and writes self-contained external prompt packets (inlining the article Markdown, a compact standards & forensics digest, and a neighborhood digest of outbound/inbound/unlinked wiki pages):
   - `.quartz-cache/wiki-court/<slug>/advocate_prompt_ready.md`
   - `.quartz-cache/wiki-court/<slug>/alex_prompt_ready.md`

### Phase 2 — Run Both Counsels on Google AI Studio (`https://aistudio.google.com/prompts/new_chat`)

1. Stage both prompt files under `<Artifact Directory Path>/browser_sandbox/references/` (`advocate_prompt_ready.md` and `alex_prompt_ready.md`) so the `browser` subagent can read their exact contents verbatim.
2. Delegate to the `browser` subagent to open `https://aistudio.google.com/prompts/new_chat` (always use `/prompts/new_chat`; bare `https://aistudio.google.com/` opens the app maker):
   - If the user is not signed in, pause immediately and ask the user to log into their paid Google account in the browser pane, then resume the same subagent via `send_message`.
   - Note: both prepared prompt packets are ~65–75 KB (exceeding `read_file`'s 46,080-byte per-call cap), so explicitly instruct the browser subagent to read every chunk of each file without truncation before pasting.
   - In a **fresh AI Studio chat**, configure the right-hand Run Settings panel:
     - **Model:** `Gemini 4 Neon` (`gemini-4-neon`)
     - **Thinking level:** `Extra High`
     - **Tools:** `Grounding with Google Search` **ON** and `Code execution` **ON** (note: `Code execution` defaults to OFF on every new chat and must be toggled ON each time)
   - Paste the exact verbatim text of `advocate_prompt_ready.md`, submit, wait for the complete final response (after thinking/search/code finishes), and return the full verbatim Markdown response.
   - Navigate directly to `https://aistudio.google.com/prompts/new_chat` for a **second fresh isolated AI Studio chat** with the identical settings (`Gemini 4 Neon`, `Extra High` thinking, `Grounding with Google Search` ON, `Code execution` ON), submit the exact verbatim text of `alex_prompt_ready.md`, wait for completion, and return the full verbatim Markdown response.
3. Save the verbatim responses to:
   - `D:\Coding\Website\.quartz-cache\wiki-court\<slug>\advocate_brief.md`
   - `D:\Coding\Website\.quartz-cache\wiki-court\<slug>\alex_review.md`

### Phase 3 — Convene Local Internal Judge (`mode="judge"`)

1. Call `run_workflow` with:
   - `ScriptPath`: `D:\Coding\Website\.agents\skills\wiki-court\scripts\run_court.py`
   - `Args`: `{"article": "<Article Name>", "mode": "judge"}` (matching `"target_class"`)
   - `Cwd`: `D:\Coding\Website`
   - `Description`: `Convene local Wiki Court Judge for <Article Name>`
2. Read `.quartz-cache/wiki-court/<slug>/judge_ruling.md` and act strictly on the binary verdict:
   - `VERDICT: REMAND`: fix every sustained defect without bloating overruled trade-offs, rebuild Quartz, and repeat Phases 1–3 until promoted.
   - `VERDICT: PROMOTE`: update `class:` in frontmatter to `target_class`, then run a final Quartz build, `pnpm run lint:wiki`, `pnpm run check`, and `pnpm run test`.
