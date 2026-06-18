# Brinedew Wiki Factory (BWF)

**What it is:** An autonomous machine that maintains Wikipedia-style lead sections on all 98 wiki pages.
**Who operates it:** No one. Runs on its own. 
**Who steps in when it breaks:** Brinedew (only for errors, stuck cards, escalations).
**When it's done:** All 98 pages ranked at least A-tier against Wikipedia featured-article prototypes.

---

## Architecture

BWF has five workers. Each is a Hermes sub-agent with specific skills. Workers pick cards from a shared Kanban queue — no orchestrator routing between them.

### 1. Planner
**Skills:** Reads tier map file.
**Job:** Every hour on cron, reads the stored tier map. Picks the lowest-tier page that hasn't been rejected this cycle. If all 98 are A-tier or above: shuts down and reports completion.
**Output:** Creates a Kanban card: `[BWF] Rewrite lead on [page].md` with current tier, current lead text, and page body.
**Runs:** Cron job, once per hour.

### 2. Researcher  
**Skills:** Deep Research Pro (web search + cited reports), bioinformatics (domain sources).
**Trigger:** Picks up any card in the `research` column.
**Job:** Takes the page name and current body. Searches the web for authoritative sources — review papers, Wikipedia, textbooks. Extracts key facts. Saves source text + URLs + screenshot paths to the card. Does NOT write the lead.
**Output:** Card updated with `sources:` block — extracted source text, source URLs, screenshot paths.
**Fails if:** No sources found after 5 searches → escalate to Brinedew with `reason: no_sources_found`.

### 3. Writer
**Skills:** MOS:LEAD rubric + S-tier prototypes (loaded as context).
**Trigger:** Picks up any card in the `writing` column.
**Job:** Reads the Researcher's sources + page frontmatter. Writes 2-4 sentence lead following MOS:LEAD. Each factual claim maps to a `[1]` `[2]` footnote. No self-assessment. No extra rules beyond MOS:LEAD. The S-tier prototypes (DNA, Cancer, Evolution, Gene, Telomere) are the bar.
**Output:** Card updated with `proposed_lead:` + `footnotes:` block.
**Fails if:** Can't produce a coherent lead after 3 attempts → escalate with `reason: writer_failure`.

### 4. Critic
**Skills:** Source verification checklist (concrete pass/fail triggers only).
**Trigger:** Picks up any card in the `review` column.
**Checklist (pass/fail, no opinions):**
- Each claim maps to a source that actually contains that claim → fail if mismatch
- Source URL is reachable (200 OK or accessible) → fail if dead
- Title is bolded in first sentence → fail if not
- Lead defines the topic → fail if no definition
- No peacock/slop phrasing → fail if present (MOS:LEAD prohibits this)
**Pass condition:** Zero failures on the checklist. 
**Fail condition:** Card goes back to `writing` column with specific failures listed and Writer re-triggers. Max 3 loops. On 4th: escalate to Brinedew with both the card and the full failure history.
**Runs:** Sub-agent, auto-triggered when card enters `review`.

### 5. Committer
**Skills:** Git, GitHub push.
**Trigger:** Card enters `committing` column (Vladimir approved on Telegram).
**Job:** Commit the new lead to the `wiki-leads` branch. One commit per change. Push to GitHub. Update the tier map (new page tier = A minimum). Record in reliability tracker.
**Output:** Commit hash and updated tier map file.
**Fails if:** Git conflict or push error → escalate to Brinedew with error details.

---

## Autonomous workflow (hourly tick)

No Brinedew involvement in the happy path. Brinedew only enters for escalations, errors, or Vladimir requests.

```
Planner (cron:00) → card lands in [research] column
  → Researcher picks card → adds sources → moves to [writing]
    → Writer picks card → writes lead → moves to [review]
      → Critic picks card → passes → moves to [approval]
        → Telegram: "BWF proposes rewrite on [page]. Diff: [old → new]. [Approve] [Edit] [Reject]"
          → Vladimir approves → card moves to [committing]
            → Committer picks card → git commit+push → done
          → Vladimir rejects → card archived with reason → Planner picks different page next hour
          → Vladimir edits → Writer re-triggers with edit → back to [review]
```

**Failure modes (Brinedew enters):**
- Researcher can't find sources → escalate. Brinedew reviews the page, may add manual sources.
- Critic can't pass after 3 Writer iterations → escalate. Brinedew examines the card and failure history, resolves or discards.
- Sub-agent errors → escalate. Brinedew diagnoses and restarts.
- Card stuck >1 hour in any column → escalate. Brinedew unblocks.

---

## Gears decided so far

| Gear | Status | Decision |
|------|--------|----------|
| 1 — Source | DECIDED | Web research with citations, not body summary |
| 2 — Scope | DECIDED | All 98 wiki pages |
| 3 — Tiering | DECIDED | S/A/B/C/D/F against Featured Article prototypes |
| 4 — Cadence | REJECTED | Revisit after others are solid |
| 5 — Writer | DECIDED | Hermes sub-agent, MOS:LEAD only, prototypes as reference |
| 6 — Preview | OPEN | Telegram diff with approve/edit/reject |
| 7 — Delivery | OPEN | Telegram |
| 8 — Git | OPEN | Branch-per-change, one commit each |
| 9 — Rollback | OPEN | `git revert <commit>` |
| 10 — Completion | OPEN | All 98 ≥ A-tier, shutdown |

---

## Column lifecycle (Kanban)

```
Planner → [research] → Researcher → [writing] → Writer → [review] → Critic → [approval] → Telegram → [committing] → Committer → done
                                                    ↑                                    ↑
                                                    └──── Writer ← Critic (fail) ────────┘
                                                                                                  ↑ escalate (4th fail)
                                                                                                  Brinedew
```

---

## Skills each worker loads

| Worker | Skills | Model |
|--------|--------|-------|
| Planner | None (reads file) | Cheap (flash) |
| Researcher | Deep Research Pro, bioinformatics | Medium |
| Writer | MOS:LEAD rubric + prototypes (prompt context) | Strong (best) |
| Critic | Source verification checklist (prompt context) | Strong (best) |
| Committer | Terminal (git) | Cheap (flash) |
