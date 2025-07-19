# what i was working on - January 22, 2025

User wanted me to fix a wiki page about oncogenes that Alex (a fictional but very real LessWrong-style reviewer) kept tearing apart. The page was supposed to classify oncogenic mechanisms for intelligent readers who understand game theory and systems thinking, but it kept sounding like pop-sci garbage mixed with corporate training materials.

The real problem: how do you explain cancer's strategic landscape to someone who's smart but not a biologist, without either dumbing it down or drowning them in jargon?

## what actually works now

The oncogene classification page is much better. It went from academic paper + TED talk mashup to actual systems analysis that treats cancer like a multi-agent coordination problem.

**Files I changed:**
- `/mnt/d/Coding/Website/docs/wiki/proteins/oncogenes/oncogene-classification.md` - complete rewrite (lines 1-340+)
  - Fixed all title case headings ("Overview" → "overview") 
  - Removed corporate speak ("safety-system-centric" → plain language)
  - Added multi-level selection framing (gene ↔ cell ↔ tissue ↔ organism)
  - Fixed factual errors (ALT mechanism explanation, PD-L1 expression pathways)
  - Added missing mechanisms (ecDNA, drug-tolerant persisters, NK-cell editing loops)
  - Removed lazy analogies ("like a factory," "code review," "malware")
  - Added gear-level explanations (how Hippo pathway actually works as logical AND gate)
  - Moved theoretical framework to end instead of dumping data in intro

**Alex review outputs saved:**
- `/mnt/d/Coding/alex-oncogene-review-round2.md` - second review after major fixes
- `/mnt/d/Coding/alex-oncogene-review-round3.md` - final review after systematic cleanup

**Research integration:**
Used WebSearch to get real data on driver mutations per cancer type, single-driver cancers (CML, Ewing sarcoma), and complex epithelial patterns. Replaced hand-wavy "3-7 mutations" with actual empirical patterns and theoretical justification.

**What works for testing:**
The document now reads like systems analysis instead of marketing copy. Each gate explains WHY the control system evolved that way and HOW cancer breaks it, with actual molecular mechanisms and evolutionary trade-offs.

## what's broken

Nothing major is broken. The document is functionally complete and addresses all the systematic issues Alex identified.

**Minor stuff:**
- Haven't tested how it renders on the actual website (just markdown)
- Could probably use one more Alex review iteration to catch any remaining issues
- Some sections could use more cross-references to related wiki pages

## where things stand

**Current file state:**
- Document is ~340 lines, well-structured, internally consistent
- All 12 gates follow consistent format: what host enforces → why this design → how cancer breaks it → concrete examples
- Added comprehensive theoretical section at end explaining driver mutation patterns
- Removed all the corporate speak and patronizing tone Alex hated

**Alex reviewer system:**
- The Alex roleplay prompt works incredibly well for spotting jargon, hand-waving, and missing mechanisms
- Saved in `/mnt/d/Coding/CLAUDE.md` lines 272-290 for future use
- Target is 90% criticism, 10% praise - forces real improvement

**Working tools:**
- Gemini CLI works from `/mnt/d/Coding` with @file syntax and 10-minute timeout
- Edit/MultiEdit tools work well for systematic changes
- WebSearch and WebFetch worked for getting current research data

## what to do next

**Most urgent:** If you want to polish this further, run another Alex review iteration. The document is much better but could probably handle one more round of criticism.

**For expanding the wiki:** Use the Alex roleplay approach on other technical pages. It's incredibly effective for killing pop-sci clichés and demanding real explanations.

**If working on other biology content:** The multi-level selection framing and evolutionary trade-off analysis approach works well for this audience. Frame everything as "how does this coordination system work and how does it break down."

## stuff to remember

**What worked really well:**
- Systematic chunk-by-chunk fixes instead of trying to fix everything at once
- Getting actual empirical data instead of hand-waving numbers
- The Alex reviewer persona is gold for technical content review
- Moving theoretical framework to end instead of front-loading complexity

**Key insight:** LessWrong-style readers want to understand the underlying game theory and system design, not memorize biological facts. Explain WHY systems evolved certain ways and what the trade-offs are.

**Don't do this:** 
- Don't add analogies when someone complains about jargon - Alex hates analogies more than jargon
- Don't front-load complex theoretical frameworks in the intro
- Don't hand-wave with vague numbers - get the actual data or don't mention it

**The user specifically wanted:** Systems-level analysis focused on coordination failures and evolutionary game theory, not clinical therapeutic implications. Keep focus on fundamental understanding rather than drug targets.