# Wiki Lead Maintenance System — All Gears

**Purpose:** Hourly pick the weakest Wikipedia-style lead in the wiki, rewrite it, notify Vladimir on Telegram.

---

## GEAR 1 — Page inventory
What pages are we talking about? The 98 files under `content/wiki/`. Some are gene pages with YAML-only bodies, some are theory pages with real content. **Pages with insufficient body text to summarize cannot get a valid lead.**

## GEAR 2 — Lead quality criteria
Against what standard? Wikipedia MOS:LEAD — bolded title in first sentence, defines the subject, establishes context, summarizes body, neutral tone, appropriate length.

## GEAR 3 — Scorer
Each hour, an LLM scores all 98 leads against the criteria above. Produces a ranked list: worst → best.

## GEAR 4 — Body-content gate
Before attempting a rewrite, check if the page has enough body text to summarize. Gene pages with just frontmatter + a one-liner → skip. Only pages with ≥3 substantial paragraphs qualify.

## GEAR 5 — Selection
Pick the lowest-scoring page that also passes the body-content gate. If all remaining pages fail the gate, report "all remaining pages have insufficient body text — manual writing needed" and stop.

## GEAR 6 — Rewrite source
The new lead is written by an LLM **using only the existing page body text**. No web search, no training data memory, no fabricated facts. If the body says X, the lead says X. Nothing more.

## GEAR 7 — The rewrite itself
LLM reads the full page, applies MOS:LEAD rules, writes 2-4 sentence lead with bolded title, definition, context, and summary.

## GEAR 8 — Diff/preview
What you see: original lead vs. proposed rewrite. Side by side as Telegram text.

## GEAR 9 — Delivery
Telegram message each hour with: page name, current score, original lead, proposed rewrite, [Approve] [Edit] [Skip] options.

## GEAR 10 — Approval mechanism
You tap a reaction or button on Telegram. Options: Yes/Approve, No/Skip, Edit (you type a correction).

## GEAR 11 — Git commit (if approved)
One commit per approved rewrite. Branch: `wiki-leads`. Message: `[lead] p53-tp53.md — MOS:LEAD rewrite`. Push to GitHub.

## GEAR 12 — Git safety
Every commit is independent. Reverting one never touches another. No batch writes. No force pushes to main.

## GEAR 13 — Your Obsidian sync
You pull from GitHub (via Obsidian Git plugin or manual). The change appears in your vault like any other sync'd commit. You see the diff in Obsidian's git plugin.

## GEAR 14 — Rollback
If you don't like the result after seeing it in Obsidian: `git revert <commit-hash>` on the PC side. One command, one change reversed, nothing else touched.

## GEAR 15 — Skip handling
If you skip a page, it goes to the bottom of the queue. Next hour picks the next-worst that hasn't been skipped. Skipped pages can be revisited later.

## GEAR 16 — Empty/sparse page handling
Gene pages with no body (e.g., mostly YAML frontmatter, no prose) cannot get a Wikipedia lead. The system reports them as "needs body content first" and moves on.

## GEAR 17 — Terminal condition
When all 98 pages have acceptable leads (or are gated as body-too-sparse), the hourly cron reports "wiki leads complete" and goes dormant.

## GEAR 18 — First-run setup
One-time scoring of all 98 pages. Git init for `wiki-leads` branch if not existing. No changes to main.

## GEAR 19 — Hourly trigger
Hermes cron job, once per hour. Runs the scorer, gate, selector, and rewriter. Generates the Telegram card.

## GEAR 20 — Telegram UX format
```
🔍 Wiki Lead — Tue 14:00
Page: telomeres.md (score 33/100)
Body: 4 sections, ~200 words ✓ enough content
Lead: "Chromosomal aging timers that protect chromosome ends..."
Proposed: "**Telomeres** are protective DNA-protein structures at chromosome ends that..."
[Approve] [Edit] [Skip]
```

---

**Ready for approval.** Walk me through which gear you want to discuss first. No implementation until all 20 are approved individually.
