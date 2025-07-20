# what i was working on - January 22, 2025

User wanted me to systematically fix Alex's complaints about the oncogene classification wiki page. Alex is a fictional but very effective LessWrong-style reviewer who tears apart technical writing that's full of jargon, hand-waving, and corporate speak. His review identified about 15 specific issues that needed fixing.

The real problem: how do you take a technical document that's readable by experts but make it accessible to smart non-specialists without dumbing it down? Alex's complaints weren't about the content being too complex - they were about poor explanations, undefined jargon, and missing conceptual frameworks.

## what actually works now

I systematically fixed Alex's first 5 major complaints by working through them in linear order:

**Files I changed:**
- `/mnt/d/Coding/Website/docs/wiki/proteins/oncogenes/oncogene-classification.md` - multiple sections improved (lines throughout)

**What got fixed:**
1. **Removed patronizing tone** (line 5): Cut the condescending "Note on evolutionary language" section down to one sentence
2. **Simplified overview** (lines 11-12): Replaced dense cell type definitions with simple "stromal cells (infrastructure/logistics), immune cells (police/military)"
3. **Explained tissue architecture differences** (lines 15-19): Added mechanistic explanation for why epithelial cancers need more security layers than hematopoietic cancers
4. **Moved evolutionary dynamics to end** (lines 487-509): Restructured so concrete mechanisms come before abstract theory
5. **Fixed TGF-β stromal co-option** (lines 70-91): Replaced jargon soup with clear explanation of how cancer breaks wound healing resolution mechanisms

**Major conceptual improvements:**
- **Emergency override framework**: Explained TGF-β hijacking as cancer exploiting the emergency override system that lets immune signals suspend tissue quality control
- **Synthetic lethality explanation**: Added clear explanation of why losing redundant pathways kills cells (mitotic catastrophe vs programmed suicide)
- **Apoptosis architecture correction**: Fixed incorrect "centralized control" claim - showed apoptosis actually has multiple independent pathways
- **Cell competition mechanisms**: Detailed the 5-step process from Myc fitness detection through corpse engulfment

**Research integration:**
- Used WebSearch extensively to get actual mechanisms instead of hand-waving
- Found papers on specialized pro-resolving mediators, TRAF6 signaling, mitotic catastrophe, cell competition
- Fixed several factual errors about how these systems actually work

## what's broken

**Current blocker:** I was in the middle of fixing Alex's complaint about "Entosis and cannibalism" being just one sentence when the user interrupted. The section at line 286 still needs expansion - Alex called it "a fascinating and horrifying mechanism" that "deserves more than a passing mention."

**Incomplete fixes:** Still about 10 more Alex complaints to work through linearly:
- Need to explain entosis mechanism properly
- Metabolic section still has unexplained "alphabet soup" (PI3K-AKT-mTOR)
- Several other jargon-heavy sections throughout

**Pattern I discovered:** Alex immediately spots when you drop technical terms without building conceptual foundation first. The fix isn't removing complexity - it's explaining WHY the complexity matters before introducing the jargon.

## where things stand

**Current approach that's working:**
1. Read Alex's review linearly, one complaint at a time
2. Don't jump around to different sections
3. Research the actual mechanisms using WebSearch
4. Explain the conceptual framework BEFORE introducing molecular players
5. Always ask "what would Alex ask next?" and preempt those questions

**Tools being used:**
- WebSearch for getting real mechanisms from papers
- Grep for finding specific text in the document
- Edit/MultiEdit for systematic fixes
- TodoWrite for tracking progress (though I should use it more)

**Working directory:** `/mnt/d/Coding/Website/docs/wiki/proteins/oncogenes/oncogene-classification.md`

## what to do next

**Most urgent:** Fix the entosis explanation (line 286). Alex wants to know: "How does it work? Is it a specific pathway?" Need to research entosis mechanisms and explain the cell-in-cell phenomenon properly.

**After that:** Continue working through Alex's review linearly. The next complaints are in the metabolic reprogramming section about PI3K-AKT-mTOR jargon.

**The pattern to follow:** Always research the actual mechanisms first, then build explanations that start with conceptual frameworks and work toward molecular details. Don't assume anything is "centralized" or make up evolutionary just-so stories.

## stuff to remember

**Alex's core insight:** Smart readers want to understand underlying system design and trade-offs, not memorize biological facts. Frame everything as "how does this coordination system work and how does it break down."

**Voice lessons learned:** 
- Avoid corporate speak like "leverage," "optimize," "systematic"
- Use "you" instead of "one" or "users"  
- Replace academic jargon with everyday words unless precision requires technical terms
- Tell the reader what something DOES before telling them what it's CALLED

**Critical debugging pattern:** When you catch yourself writing "integrated," "implemented," "enhanced," "optimized," "systematic," or "comprehensive" - stop and rewrite in normal words.

**Research approach that works:** Use WebSearch to find actual molecular mechanisms, then ask "what would Alex's next question be?" and research that too. Don't hand-wave about evolutionary purposes without solid evidence.

**The user specifically wanted:** Systems-level analysis focused on coordination failures and game theory, not clinical applications. Keep the focus on fundamental understanding rather than therapeutic implications.