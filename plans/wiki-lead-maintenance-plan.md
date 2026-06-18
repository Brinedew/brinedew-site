# Wiki Lead Section Maintenance Plan

**Status:** Draft proposal — not implementing yet.
**Scope:** `/workspace/Website/content/wiki/` (98 pages, aging biology wiki)
**Goal:** Each hour, identify and rewrite the weakest lead section per Wikipedia MOS:LEAD.

---

## 1. How it picks the weakest page each hour

Not random. Each page gets a **lead quality score** on every pass:

| Criterion | Weight | How it's scored (by LLM) |
|-----------|--------|--------------------------|
| First sentence identifies the subject | 30% | Does it start with the article title (bolded) defining what the topic is? |
| First sentence establishes context | 15% | Does it say what field, discipline, or broader topic this belongs to? |
| Lead summarizes key points | 25% | Does the first paragraph cover what the article is actually about? |
| Length appropriate | 10% | Too short (1 line) or too long? |
| Neutral/encyclopedic tone | 10% | No "peacock terms", no news-style lede |
| Links to broader context | 10% | Does it link to relevant broader concepts? |

After scoring all pages, the **lowest-scoring page** is selected for rewrite each hour.

If the lowest-scoring page is the same as last hour's (means our rewrite didn't help), the scorer gets feedback and retries with a different approach.

---

## 2. Info source for rewrites

**Primary source: the existing page body.** Per MOS:LEAD, the lead should summarize content already in the article — not introduce new info.

The rewrite uses:
1. **The page's own body text** (required — this is what the lead must summarize)
2. **Frontmatter fields** (title, aliases, draft status, tags — for context)
3. **No web search by default** (unless you explicitly want it to supplement very short pages)

The LLM (me) reads the body, understands the key points, and writes a lead that follows MOS:LEAD rules.

---

## 3. What's in the wiki (concepts I've actually seen)

The wiki folder contains **98 pages** across these categories:

| Type | Examples | Count |
|------|----------|-------|
| **Gene/protein pages** | p53, KRAS, MDM2, MTOR, BCL-2, SIRT1, telomerase… | ~50 |
| **Theory pages** | antagonistic pleiotropy, disposable soma, selection shadow, death pact, defensive degeneration… | ~15 |
| **Process/cell-biology** | cellular senescence, immune surveillance, telomeres, eutely… | ~10 |
| **Cancer-related** | Armitage-Doll, Tomasetti-Vogelstein, oncogene classification, tumor suppressor theory… | ~8 |
| **Reference/meta** | Glossary, Labs, Research gaps, FAQ, Patch Notes, Tutorial… | ~10 |
| **Other** | HeLa, DFTD (devil facial tumor), Weismann barrier, atavistic theory… | ~5 |

The **gene pages** are mostly auto-generated (YAML frontmatter with Uniprot metadata + very short body), so they typically lack leads. Theory pages are more likely to have usable body text to summarize.

---

## 4. Architecture: single agent, not multi-agent

**Single agent (me), in a cron job.** No sub-agent parallelism needed for one lead per hour.

The cron job runs every 60 minutes:
1. **Score phase** (lightweight): Read each page's lead section, score it against MOS:LEAD
2. **Select phase**: Pick worst-scoring page
3. **Rewrite phase**: Read the full page body, write a compliant lead using LLM
4. **Preview phase**: Send the diff (original → new lead) to Telegram
5. **Wait phase**: You approve/reject/edit on Telegram

If we wanted parallel analysis of all 98 pages, that's a one-time bulk audit — separate from the hourly clock.

---

## 5. Git syncing & edit safety (YOUR KEY CONCERN — designed carefully)

Currently the website folder has **no Git** (I checked). This is the critical problem.

**Three options, you choose:**

### Option A: Git branch per change (most conservative)
- Website content gets initialized as a Git repo
- Each rewrite creates a commit on a `wiki-leads` branch
- You get the diff on Telegram with a link
- You merge to `main` when you're happy
- Revert = just revert that commit, nothing else lost
- **Downside:** You need to interact with Git

### Option B: Staging directory + manual apply
- Changed leads go into `/workspace/Website/content/wiki/_rewrites/` with `.diff` files
- You review the plain diff on Telegram
- You manually copy-paste approved changes (via Obsidian)
- No auto-writes to the actual wiki files
- **Downside:** Manual labor

### Option C: One-at-a-time auto-apply with rollback
- Writes directly to the wiki file
- But keeps a `.lead-backups/pagename.md` snapshot before each change
- Send diff to Telegram with **accept/reject buttons**
- If rejected: restore from backup
- If accepted: keep the change
- **Downside:** Need the Kanban or Telegram reaction system for approve/reject

I'd recommend **Option A** (Git) — it's the industry standard for a reason. One commit per change, you can cherry-pick, revert, squash, whatever. No risk of "revert one, lose twenty."

---

## 6. Your UX (Telegram + Obsidian on PC)

Here's what you actually see:

**Every hour in Telegram:**
```
🔍 Wiki Lead Check — Hour N

Weakest page: death-pact.md (score: 23/100)

Original lead:
"A death pact is a cooperation strategy..."

Proposed rewrite:
"A **death pact** is a cooperation strategy in evolutionary biology and game theory where... [bold, defines, establishes context, links to principal-agent problem]"

[Apply] [Edit & Apply] [Skip] [See Diff]
```

- **Apply** = the change is written (safely, with backup/git)
- **Edit & Apply** = you type a correction, it incorporates it
- **Skip** = skip this page, pick the next weakest next hour
- **See Diff** = shows the full original vs new first 1-2 paragraphs

If you want to review in Obsidian: the Telegram message includes the filename so you can open it directly.

---

## 7. What info is used and what stays local

- **Page body text** = already on disk here
- **MOS:LEAD rules** = from Wikipedia (already fetched)
- **Scoring and rewriting** = done entirely by me (LLM) in the cron session
- **No data leaves your machine** (except Telegram notifications, which are just text diffs)
- **Web search** = only if you opt in for very short pages

---

## Next steps — what I need from you

1. **Git or no Git?** Option A/B/C above — or another approach you prefer
2. **Do you want a one-time bulk audit** of all 98 leads first (to see the full state), or go straight to hourly?
3. **Review format** — reactions on Telegram, or Kanban cards, or something else?
4. **Path/UX** — is this the right location (`/workspace/Website/content/wiki/`)?
