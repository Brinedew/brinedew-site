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

1. **External Advocate (Trade-Off & Over-Correction Defense Counsel — Google AI Studio):** NOT a hype man. Proactively hunts the same weak points, simplifications, and omissions that Devil's Advocate will likely attack, uses **Google Search + Code Execution** to separate genuine errors (which it must concede) from deliberate editorial trade-offs, and argues concretely why "fixing" defensible weak points would degrade the article, bloat scope, duplicate a sibling page, or break Wikipedia FA craft.
2. **External Alex (Devil's Advocate — Google AI Studio):** Abrasive first-principles prosecutor armed with live **Google Search** (PubPeer, retractions, replications, Bik/Sholto David forensics, omitted counter-evidence) and **Code Execution** (verifying equations, units, Data Colada / GRIM stats), reviewing section-by-section against Wikipedia Featured Article clarity and level-indexed rigor.
3. **Internal Local Judge (Local `research` Agent):** The sole role with full local access to `content/wiki/`, `content/Attachments/`, `Wiki Assessment.md`, `CLAUDE.md`, full sibling pages, local OCR/HTML excerpt PNGs, and headless Quartz renders (`desktop`, `dark`, `390px` mobile). Weighs both external AI Studio briefs against local wiki harmony, visual rendering, and tooling compliance to issue the binding `VERDICT: PROMOTE` or `VERDICT: REMAND`.

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

### Phase 2 — Run Both Counsels on Google AI Studio (`https://aistudio.google.com/`)

1. Stage both prompt files under `<Artifact Directory Path>/browser_sandbox/references/` (`advocate_prompt_ready.md` and `alex_prompt_ready.md`) so the `browser` subagent can read their exact contents verbatim.
2. Delegate to the `browser` subagent to open `https://aistudio.google.com/`:
   - If the user is not signed in, pause immediately and ask the user to log into their paid Google account in the browser pane, then resume the same subagent via `send_message`.
   - In a **fresh AI Studio chat**, configure the right-hand Run Settings panel:
     - **Model:** `Gemini Neon`
     - **Thinking level:** `Very High`
     - **Tools:** `Google Search` **ON** and `Code execution` **ON**
   - Paste the exact verbatim text of `advocate_prompt_ready.md`, submit, wait for the complete final response (after thinking/search/code finishes), and return the full verbatim Markdown response.
   - Open a **second fresh AI Studio chat** with the identical settings (`Gemini Neon`, `Very High` thinking, `Google Search` ON, `Code execution` ON), submit the exact verbatim text of `alex_prompt_ready.md`, wait for completion, and return the full verbatim Markdown response.
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
