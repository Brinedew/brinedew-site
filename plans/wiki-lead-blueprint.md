# Wiki Lead Maintenance — System Blueprint

**Process:** Each gear is discussed and DECIDED before proceeding. Blueprint updated durably on every decision.

---

## Gear 1 — Rewrite Information Source
**Status:** DECIDED
**Question:** Where does the new lead text come from?
**Answer:** NOT from summarizing the existing page body. A Wikipedia-style lead is an *introduction to the topic* — it identifies the subject, defines it, establishes context, and explains why it's notable. For gene pages with minimal body, the lead comes from understanding what the thing *is* (domain knowledge + web research + authoritative sources). Every claim needs citations with links and screenshots.
**Implication:** The rewriter needs web search, browser/screenshot capability, and citation formatting. The page body is a reference point, not the source material.

---

## Gear 2 — Page Scope
**Status:** DECIDED
**Question:** Which pages qualify for lead rewrites?
**Answer:** All 98 pages in the wiki folder. No gating or filtering by body content.
**Implication:** Gene pages with minimal body (~60 pages) will need web research to write a proper lead. The system must handle both prose-rich theory pages and metadata-heavy gene pages.

---

## Gear 3 — Lead Quality Tiering
**Status:** DECIDED
**Question:** How do we determine which lead is weakest?
**Answer:** Tier system (S/A/B/C/D/F) based on Wikipedia featured article prototypes. S = featured-article quality (DNA, Cancer, Evolution leads as templates). F = no lead section at all. The weakest lead each hour is the lowest-tier page. Done when all 98 are at least A-tier.
**Reference prototypes saved:** `/workspace/Website/plans/lead-prototypes-and-tiers.md`
**Implication:** The scorer needs the prototype examples as reference, then places each wiki lead on the tier ladder by comparison. Not a numerical score — a holistic tier judgement against real Wikipedia examples.

---

## Gear 4 — Selection Cadence
**Status:** REJECTED
**Question:** How often does the system pick a page? How does it learn from rejections?
**Answer:** Vladimir rejected this proposal as very bad. System was: hourly pick lowest tier, save rejection reasons to lesson file, compound learning across attempts. Insufficiently robust.
**Implication:** Must revisit after other gears are better defined.

---

## Gear 5 — The Rewrite Itself
**Status:** UNDECIDED
**Question:** Who/what does the rewrite? How is MOS:LEAD applied?
**Answer:**
**Implication:**

---

## Gear 6 — Preview & Approval
**Status:** UNDECIDED
**Question:** How does Vladimir see the proposed change and approve/reject?
**Answer:**
**Implication:**

---

## Gear 7 — Delivery Channel
**Status:** UNDECIDED
**Question:** What platform is used for notifications and approval?
**Answer:**
**Implication:**

---

## Gear 8 — Git Integration
**Status:** UNDECIDED
**Question:** How does an approved change get committed and synced?
**Answer:**
**Implication:**

---

## Gear 9 — Rollback
**Status:** UNDECIDED
**Question:** How does Vladimir revert a change if he doesn't like it?
**Answer:**
**Implication:**

---

## Gear 10 — Completion Condition
**Status:** UNDECIDED
**Question:** What happens when all pages have good leads?
**Answer:**
**Implication:**

---

*Last updated: 2026-06-18*
*Blueprint location: /workspace/Website/plans/wiki-lead-blueprint.md*
