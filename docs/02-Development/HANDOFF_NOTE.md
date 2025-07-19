# Development Session Handoff - January 21, 2025

## what i was working on

User wanted a major rewrite of the oncogene classification wiki page because it was written like an academic paper full of jargon that would confuse smart non-biologists. The goal was to make it readable for LessWrong readers interested in coordination problems and aging research, without dumbing it down. Plus integrate feedback from a clinician who said the framework was just "rebranded Hanahan-Weinberg" and missing key modern mechanisms.

## what actually works now

I've completely rewritten the entire oncogene classification page from 10 gates to 12 gates, addressing both Alex's brutal criticism and the clinician's systematic blind spots.

**Files I changed:**
- `/mnt/d/Coding/Website/docs/wiki/proteins/oncogenes/oncogene-classification.md` - complete rewrite from academic jargon to systems analysis (lines 1-300+)
- `/mnt/d/Coding/CLAUDE.md` - added "Alex the Abrasive LessWronger" roleplay prompt for future technical content review (lines 272-290)
- `/mnt/d/Coding/alex-oncogene-analysis-v3-final.md` - saved detailed final analysis that drove the rewrites

**What got fixed:**
1. **Removed all the academic jargon** - no more "utilize best practices to optimize" bullshit
2. **Added missing coordination mechanisms** - contact inhibition/mechanotransduction (YAP/TAZ), full metastatic cascade, phenotypic plasticity, immunoediting cycle
3. **Explained the actual design logic** - why p53 is centralized (trade-offs), why APOBEC is poorly secured (evolutionary constraints), why there are two telomere systems (stealth vs efficiency)
4. **Added concrete mechanistic examples** - SASP bystander effects with actual pathways (ATM-NBS1-CHK2 → NF-κB), p53-first vs immune-first evolutionary paths with real data
5. **Fixed all section headings** - removed Title Case sloganeering that Alex hated
6. **Added evolutionary dynamics overlay** - gates as porous, temporary, subject to selection pressure

**What the final document covers:**
- 12 gates (added spatial coordination and phenotypic plasticity)
- Real evolutionary game theory - constraint spaces, path dependence, arms race dynamics
- Concrete examples with mechanistic detail - not handwavy summaries
- Research-backed content - used WebSearch and WebFetch to get 2024 data on SASP mechanisms, p53-immune interactions, mutational signatures

## what's broken

Nothing major is broken. The document is functionally complete and addresses all the main criticisms.

**Minor issues:**
- Some citations could be cleaned up further (though most were already removed)
- Could add more concrete examples in other sections if user wants them
- Haven't tested how it renders on the actual website (just markdown)

## where things stand

**Working tools:**
- Gemini CLI working fine from `/mnt/d/Coding` with @file syntax and 10-minute timeout
- Edit/MultiEdit tools work well for systematic changes
- WebSearch and WebFetch worked for getting current research
- Alex roleplay prompt is gold for reviewing technical content - saved in CLAUDE.md for future use

**Current file state:**
- Document is ~300 lines, well-structured, internally consistent
- Title changed from "Oncogene Classification" to "Cancer's attack vectors"
- All 12 sections follow consistent format: what host enforces → why this design → how rebels break it → concrete examples
- Evolutionary dynamics section gives concrete p53-first vs immune-first paths with real mechanisms and trade-offs

## what to do next

**Most urgent:** User might want to run Alex's review process one more time to see if the latest mechanistic additions meet his standards. The updated prompt is in CLAUDE.md lines 272-290.

**For future improvements:**
1. Could add more concrete examples to other gates (I focused heavily on Gates 5, 7, 9)
2. Could expand the evolutionary dynamics section with more path-dependence examples
3. Could add more recent 2024/2025 research if user wants cutting-edge content

**If working on other wiki pages:** Use the Alex roleplay prompt approach - it's incredibly effective for spotting jargon, handwaving, and missing mechanistic explanations. The target is 90% criticism, 10% praise.

## stuff to remember

**What worked really well:**
- The clinician's systematic critique was spot-on about missing mechanisms
- Alex's harsh review was essential for killing pop-sci clichés and demanding real explanations
- WebFetch/WebSearch combo for getting current research instead of relying on memory
- Breaking down each criticism individually and fixing systematically

**Key insight:** LessWrong readers want to understand the underlying game theory and system design, not memorize biological facts. Frame everything as "how does this coordination system work and how does it break down." Explain WHY systems evolved certain ways, not just WHAT they do.

**Don't do this:** Tried to add more analogies when Alex complained about jargon - he hates analogies even more than jargon. He wants precise mechanistic explanations with clear design trade-offs.

**The user specifically wanted:** Systems-level analysis focused on coordination failures and evolutionary game theory, not clinical therapeutic implications. Keep the focus on fundamental understanding rather than drug targets.