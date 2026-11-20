---
name: wiki-court
description: >-
  Run the standardized adversarial three-role LLM Court (Advocate, Alex-style
  Devil's Advocate, and Judge) for promoting any wiki article above B (GA, A, or
  FA). Always use this fixed workflow so the article name is the sole caller
  variable rather than improvising bespoke Court prompts.
---

# Standardized Wiki Promotion Court

Evaluating an article with ad-hoc, hand-authored prompts introduces coordinator
bias, prompt drift, and missed graph collisions. All `B -> GA`, `GA -> A`, and
`A -> FA` promotion reviews MUST invoke the canonical workflow script where the
article name is the only required variable.

## Procedure

1. Ensure the latest Quartz static build exists (`node ./quartz/bootstrap-cli.mjs build -d content` inside `D:\Coding\Website`) if you edited prose, formulas, or Vega-Lite charts.
2. Call `run_workflow` with:
   - `ScriptPath`: `D:\Coding\Website\.agents\skills\wiki-court\scripts\run_court.py`
   - `Args`: `{"article": "<Article Name>"}` (optional: `"target_class": "GA" | "A" | "FA"`, default `"GA"`)
   - `Cwd`: `D:\Coding\Website`
   - `Description`: `Wiki Court promotion review for <Article Name>`
3. Never inject per-article hints, extra framing, or author notes into Court roles. The workflow script deterministically assembles the graph neighborhood, outbound/inbound wikilinks, unlinked sibling candidates, attachments, and headless Playwright render screenshots into `.quartz-cache/wiki-court/<slug>/`, launches `Advocate` and free-form first-person `Alex (Devil's Advocate)` in parallel from fixed prose prompts (`references/advocate_prompt.md`, `references/devils_advocate_prompt.md`), and submits both complete essays to `Judge` (`references/judge_prompt.md`)—keeping every agent in natural critical prose (`schema: {"type": "string"}`) rather than bureaucratic compliance forms.
4. Read the saved `.quartz-cache/wiki-court/<slug>/alex_review.md` and `judge_ruling.md` and act strictly on the Judge's binary ruling (`VERDICT: PROMOTE` vs `VERDICT: REMAND`):
   - `VERDICT: REMAND`: fix every real defect sustained by the Judge, rebuild Quartz, and re-invoke `run_court.py` with `Args: {"article": "<Article Name>"}` until promoted.
   - `VERDICT: PROMOTE`: update `class:` in frontmatter to `target_class`, then run a final Quartz build, `pnpm run check`, and `pnpm run test`.
