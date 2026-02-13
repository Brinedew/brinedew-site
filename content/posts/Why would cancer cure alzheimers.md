---
title: Why would cancer cure Alzheimer's?
tags:
  - content/post
date: 2026-02-09
draft: true
---

*This post was originally [my comment](https://www.astralcodexten.com/p/links-for-february-2026/comment/210341389) on Scott Alexander's blog. Scott [recommended the comment](https://www.astralcodexten.com/p/open-thread-420) in Open Thread 420. I reproduce it here with minimal edits.*

> **Scott Alexander:**  [Do some cancers prevent Alzheimers?](https://medicalxpress.com/news/2026-01-cancer-tumors-alzheimer-protein-clumps.html) There’s some evidence that people with cancer are less likely to develop Alzheimers (even adjusting for age/mortality/etc). Why? Some cancers produce large amounts of weird chemicals. One of those chemicals, cystatin c, appears to reverse Alzheimers in mouse models, maybe by dissolving [amyloid plaques](https://www.astralcodexten.com/p/in-defense-of-the-amyloid-hypothesis). And here’s [me asking Claude](https://claude.ai/share/2a23736a-0d49-4b0c-ac02-dda685afff7b) some of the obvious followup questions.

Trade-offs between cancer and degenerative disease crop up fairly [often](https://doi.org/10.1016/j.celrep.2014.08.069). Both of them are different manifestations of increased cheater cell load in old age.

Young bodies are very good at repairing the body through regeneration. Old bodies tend to have very weak regeneration. There are some reasons to speculate this could be adaptive - weaker old-age regeneration resulting in longer overall lifespans.

Each cell in a multicellular body has an ability to bring down the entire organism by hotwiring its "multiply right now" button to always be switched on. As a result, evolution of multicellularity resulted in all sorts of permission-slip style systems that strictly control when replication is allowed: tumor suppressors.

Young bodies have the same genome and the full set of tumor suppressors in all cells. It's a high-trust society where the risk of having a cheater cell is low. If tissue gets damaged and some cells get lost, it's pretty straightforward to tell surviving cells to proliferate to close down the gap, and expect that they will proliferate in a responsible orderly manner.

Old bodies are riddled with mutated precancerous cells - cells that have some of the locks removed. The term for this state is somatic mosaicism. Somatic evolution pushes precancerous cells to out-compete and out-multiply normal cells, so over time their number is constantly growing. Mosaicism is pervasive in proliferating tissues like skin and intestines, but is also detectable in largely post-mitotic organs like the brain.

So evolution encounters a trade-off between "being healthy" and "surviving longer":

1) The old body could give cells the permission to proliferate and repair the tissue. This keeps the body functional, but at the same time it's removing locks that prevent the precancerous cells from going "all in" and destroying the body by forming tumors.

2) The old body could enter the "coup-proof" curfew state, and prevent all cells from regenerating by triggering cell senescence or tissue inflammation. This "low trust" tissue state protects from cancer, but leads to the frailty and tissue loss common in many diseases of old age.

To massively oversimplify, if you die of cancer at 60, your body chose option 1. If you die of degenerative disease at 80, your body chose option 2. If you live to 110, you were somewhere in the middle, plus were lucky enough to avoid a cancerous cell getting all of its tumor suppressor locks mutated.

![[image-20.png|The dual fate of cells acquiring oncogenic mutations. (Wolf , 2021)]]

This "[tumor suppressor theory of aging](https://doi.org/10.1016/j.mad.2021.111583)" is rearing its head in biogerontology from time to time, usually when the new crop of anti-aging therapeutics [fails to deliver results](https://www.science.org/content/blog-post/senolytic-update). To be clear, it's far from a consensus view - but to be fair, there's almost nothing in biogerontology that's consensus.


> [!note]- Is this Antagonistic Pleiotropy?
 [Antagonistic Pleiotropy](https://en.wikipedia.org/wiki/Antagonistic_pleiotropy_hypothesis) (AP) is a concept commonly used in biogerontology to refer to all sorts of age-related tradeoffs, but its usage is [contested](https://pubmed.ncbi.nlm.nih.gov/22329645/) in the specific case of cancer-senescence relationship. 
>  
 To sum up the contention, AP-style selection involves evolution selecting for traits with "sign flipping" behavior, when the same trait is beneficial early-life and detrimental late-life. However, this "sign flipping" implies you would expect that "deleting" the AP trait in late-life would extend the organism's lifespan. 
 >
 But it's clear that deleting most tumor-suppressing senescence programs in late life would be catastrophic for the organism on account of all the accumulated precancerous cells: no matter how severe the costs of suppression get, cancer protection is worth paying for, so the "sign" never flips. From this lens, while cancer-senescence tradeoffs could be real and very important, they are not best modelled as a classic AP-style tradeoff.

One question is "Why would this regeneration-cancer trade-off apply to Alzheimer's when neurons don't proliferate anyway?". I'm not sure. I welcome any brain specialists to elaborate, but here's are mechanisms I would find plausible.

**Whole-body effects:** pro-inflammation endocrine factors clamp down on somatic mosaicism in rapidly proliferating tissues like skin, hematopoietic system, or digestive system. The detrimental effects of this endocrine state specifically on the brain are likely not adaptive, but they're adaptive elsewhere and therefore stay under selective pressure.

**Local effects:** Plaque kinetics are driven by non-neuronal tissues, so local suppression (e.g. SASP-like paracrine signaling) can be relevant too. Brain blood vessel cells and glial cells might react to increased cheater cell load by "hardening" brain extracellular matrix (ECM) to prevent metastasis, which prolongs the lifespan of the organism, with a side effect of increased susceptibility to plaques. This, too, would be adaptive and selected for.

More relevantly to Cystatin C, making ECM more rigid in old age helps encapsulate nascent tumors, but also solidifies all sorts of plaques. Tumors often win by secreting molecules that cut, loosen, or re-pattern extracellular scaffolding. In the tumor setting that helps invasion. In a plaque-heavy brain setting, the same class of matrix-remodeling factors can make aggregates less stable or open more routes for clearance. So the same biochemical signature can be pro-metastatic in one context and anti-plaque in another.

 As I hope it's clear by now, in situations like this the concepts of "damage" and "repair" are blurred to the point of being unusable. I think of it like looking at battle engineers of the invading military force repair bridges that were blown up by the country's own defenders.

> **Peter Mernyei:** Would there really be any evolutionary pressure to keep the body alive longer in old age at the cost of increased frailty? I'd have thought in an ancestral environment you're likely to die anyway if you're making either choice, and in any case you're very likely not reproducing anymore. So my naive expectation would be that evolution just programs whatever works for younger bodies that it actually "sees clearly" and it "doesn't think about" what happens to older bodies very much.

This comment is effectively describing Medawar's "Selection shadow", and generally, yes, that's right, evolution won't design an "aging program" specifically for the post-reproductive life stage. But to see cancer-frailty tradeoffs, no new "programs" need to start in old age. The tradeoff can simply be the consequence of tumor suppression strategies that work the same pre-reproduction as they do post-menopause.

What's happening here isn't evolution looking at the 80-year-old human and deciding "Let's make him frail to keep him alive until 90". What probably happened was evolution looking at the 10-year-old proto-mammals who keep dying of carcinoma and deciding "Let's give these creatures a hair-trigger tumor suppressor so that they survive until 20 more often". You can expect lifespans to rise in this way as species shift to ecological niches that reward slow life strategies: memory formation, sociality, caring for the young, predator avoidance, niche construction, basically anything where benefits to your kin compound over organismal time.

To achieve that, evolution selects for aggressive tumor suppression in response to cheater cell burden. Long-lived animals evolved to shut down replication at the slightest signal of DNA mutation. This adaptation is highly useful for a pre-reproductive organism and lets the young survive the cheater cell burden typical for their age. The "trade-off" is just that these same hyper-vigilant safety lockdowns keep happening more and more often as the number of mutated cheater cells rises steadily over the decades.

So under this lens, evolution didn't "program frailty" for the elderly. It programmed "high-security anti-cancer lockdowns" for the young, with side effects that ramp up over time until they're just as deadly as cancer itself.

(As an addition, there are some good reasons to believe post-reproductive organisms can also be visible to evolution via kin selection - see [grandmother hypothesis](https://en.wikipedia.org/wiki/Grandmother_hypothesis) - but this is not strictly necessary for the explanation.)
