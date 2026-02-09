---
title: Why would cancer cure Alzheimer's
tags:
  - content/post
date: 2026-02-09
draft: true
---

*This started as [a comment](https://www.astralcodexten.com/p/links-for-february-2026/comment/210341389) on Scott Alexander's [Links for February 2026](https://www.astralcodexten.com/p/links-for-february-2026), expanding on item #60 about cancer chemicals that dissolve Alzheimer's plaques. Scott [recommended it](https://www.astralcodexten.com/p/open-thread-420) in Open Thread 420.*

A weird anomaly that maybe we should pay attention to: researchers found that some cancers produce large amounts of cystatin C, a protein that appears to reverse Alzheimer's pathology in mouse models by [activating microglial clearance of amyloid plaques](https://doi.org/10.1016/j.cell.2025.12.020). 

Why would cancer also produce something that clears brain plaques?

Trade-offs between cancer and degenerative disease crop up fairly often. Both of them are different manifestations of increased cheater cell load in old age.

Young bodies are very good at repairing the body through regeneration. Old bodies tend to have very weak regeneration. There are some reasons to speculate this could be adaptive - weaker old-age regeneration resulting in longer overall lifespans.

Each cell in a multicellular body has an ability to bring down the entire organism by hotwiring its "multiply right now" button to always be switched on, so multicellular life evolved all sorts of permission-slip style systems that strictly control when replication is allowed: tumor suppressors.

Young bodies have the same genome and the full set of tumor suppressors in all cells. It's a high-trust society where the risk of having a cheater cell is low. If tissue gets damaged and some cells get lost, it's pretty straightforward to tell surviving cells to proliferate to close down the gap, and expect that they will proliferate in a responsible orderly manner.

Old bodies are full of mutated precancerous cells - cells that have some of the locks removed. The term for this is somatic mosaicism. Your body is no longer a genetically uniform population of cooperating cells, but competing lineages, each carrying different mutations.

Somatic evolution pushes precancerous cells to out-compete and out-multiply normal cells, so over time their number is constantly growing. In aged sun-exposed skin, [over a quarter](https://doi.org/10.1126/science.aaa6806) of cells carry at least one driver mutation in a known cancer gene. Not enough to form a tumor - they're missing the other four or five mutations you'd need for that - but enough that they're not fully cooperating anymore. Clonal hematopoiesis - a single mutant stem cell and its descendants gradually taking over blood production - is detectable in the majority of people over 70.

Mosaicism is pervasive in proliferating tissues like skin and intestines, but is also detectable in largely post-mitotic organs like the brain. The brain's support cells - glia, endothelial cells, microglia - do divide, and they accumulate mutations like everything else.

So evolution encounters a trade-off between "being healthy" and "surviving longer":

1) The old body could give cells the permission to proliferate and repair the tissue. This keeps the body functional, but at the same time it's removing locks that prevent the precancerous cells from going "all in" and destroying the body by forming tumors. Every time you greenlight cell division, you're also giving the cells with three out of five tumor suppressor locks already removed another chance at the mutation that completes the set.

2) The old body could enter the "coup-proof" curfew state, and prevent all cells from regenerating by triggering cell senescence or tissue inflammation. This "low trust" tissue state protects from cancer, but causes the frailty and tissue loss common in many diseases of old age - muscle wasting, brittle bones, slow healing, declining immunity.

To massively oversimplify, if you die of cancer at 60, your body chose option 1. If you die of degenerative disease at 80, your body chose option 2. If you live to 110, you were somewhere in the middle, plus were lucky enough to avoid a cancerous cell getting all of its tumor suppressor locks mutated.

This "aging as a tumor suppressor" idea rears its head in biogerontology from time to time, usually when the new crop of anti-aging therapeutics fails to deliver results. To be clear, it's far from a consensus view - but to be fair, there's almost nothing in biogerontology that's consensus.

One question is: why would this regeneration-cancer trade-off apply to Alzheimer's when neurons don't proliferate anyway? Neurons are post-mitotic. They exited the cell cycle during development and never divide again. You basically can't get brain cancer from neurons (gliomas come from glial cells). So the proliferation-vs-curfew tradeoff shouldn't directly involve them.

This is the part where I'm less certain and more speculative.

1) Brains aren't completely cut off from the circulatory system that goes full WMD on cheaters elsewhere in the body

If you buy into the "low-trust conditions" framing, the body suppresses precancerous growth in rapidly dividing tissues - skin, gut lining, hematopoietic system - through chronic low-grade inflammation. These inflammatory signals circulate in the blood and reach the whole body. The brain is very sensitive to them. Neuroinflammation driven by peripheral immune signaling is one of the less controversial mechanisms in Alzheimer's pathology. So brain degeneration could be a byproduct of pro-inflammation factors clamping down on somatic mosaicism in the gut and bone marrow. The neurons aren't being targeted - they're bystanders.

2) The tissue stiffening that helps contain a pre-malignant growth in the colon also makes it harder to clear amyloid aggregates from the brain.

Making extracellular matrix more rigid in old age helps encapsulate nascent tumors, but also solidifies plaques. When a cancer starts breaking down the ECM to metastasize, it produces matrix metalloproteinases, cathepsins, and cystatin C - enzymes that dissolve tissue barriers so the cancer can spread. 

These are pro-metastasis factors with accidental anti-plaque side effects. The tumor is dissolving its own containment. The same chemicals also loosen the rigid matrix trapping amyloid in the brain.

That's like having battle engineers of the invading military force repair bridges that were blown up by the country's own defenders.

Cystatin C is a good case study. It's the most abundant extracellular cysteine protease inhibitor in human cerebrospinal fluid - its day job is blocking cathepsins from chewing through tissue. Neurobiologists noticed in the 1990s that cystatin C accumulates around amyloid plaques in Alzheimer's brains, and [subsequent work](https://doi.org/10.3389/fnmol.2012.00079) showed it could bind amyloid-beta directly and slow its aggregation into fibrils. The canonical explanation: cystatin C physically sticks to amyloid peptides and prevents them from clumping. There's also a genetic variant, L68Q, that causes the cystatin C protein itself to misfold and deposit in brain blood vessels, producing a rare hereditary form of cerebral amyloid angiopathy. So cystatin C was, depending on the variant, either protecting against brain amyloid or causing it.

The Li et al. paper in Cell found something different from either of these. Mouse tumors secreted cystatin C into the bloodstream, and the anti-plaque effect wasn't mainly about direct amyloid-beta binding. The cystatin C was activating [TREM2](https://doi.org/10.1016/j.cell.2015.01.049) receptors on microglia - the brain's resident immune cells - giving them a signal to eat existing plaques. Microglia with functional TREM2 migrated to amyloid deposits and degraded them. Microglia without TREM2 did nothing.

TREM2 only entered the Alzheimer's picture in [2013](https://doi.org/10.1056/NEJMoa1211103), when two independent groups reported that the R47H variant roughly triples the risk of late-onset Alzheimer's disease - one of the strongest single-gene risk factors after APOE4. The variant [impairs TREM2's ability to sense lipids](https://doi.org/10.1016/j.cell.2015.01.049) and respond to damage signals. When Li et al. knocked in R47H, tumor-derived cystatin C stopped working. The microglia couldn't respond and left the plaques alone. Same result with L68Q cystatin C. Both mutations independently cut the signal chain: one breaks the receiver, the other breaks the signal.

So the mechanism runs: tumor secretes cystatin C, cystatin C crosses into the brain and hits TREM2 on microglia, microglia clear amyloid. This is completely different from the old story. The canonical mechanism was passive - cystatin C physically blocking amyloid aggregation like a chaperone. The non-canonical mechanism is active - cystatin C recruiting brain immune cells to dismantle plaques that have already formed.

Why would tumors produce cystatin C? A [2025 paper](https://doi.org/10.1038/s41392-025-02462-x) found that oligomeric cystatin C binds LILRB2 and LILRB5 - inhibitory receptors on myeloid cells - enhancing their immunosuppressive activity and dampening T-cell responses. Deleting the cystatin C gene impaired tumor growth in mice. Overexpressing it accelerated cancer. The tumor makes cystatin C to shut down the peripheral immune cells trying to kill it.

The same protein, then, does two things. In the periphery, it suppresses immune surveillance - good for the tumor. In the brain, it activates a different receptor on a different population of immune cells - good for the patient. The tumor isn't trying to cure Alzheimer's. It's trying to escape the immune system and happened to produce something that tells brain microglia to take out the trash.

The [epidemiological pattern](https://doi.org/10.1002/alz.12090) - lower Alzheimer's rates in cancer patients - has been around for years, with explanations ranging from shared genetic risk profiles to surveillance bias (cancer patients die sooner and have less time to develop dementia). A specific molecular pathway from cancer to cystatin C to TREM2 to microglial amyloid clearance turns a statistical curiosity into a mechanism. It also explains why the L68Q cystatin C mutation produces the opposite outcome: its misfolded protein can't activate TREM2, so instead of signaling plaque clearance, it deposits in brain vessels as amyloid itself.

None of this means you should want cancer to avoid Alzheimer's. The mouse models use transplanted tumors overexpressing specific proteins at levels no natural cancer reliably produces. And cystatin C is one molecule in a secretome of thousands - real tumors differ enormously in what they produce and at what stage. But the inverse correlation between cancer and neurodegeneration isn't just an accounting artifact or a survivorship effect. There's a specific molecular pathway where a body fighting cancer also clears amyloid, operating through the same receptor variant that genetic studies independently identified as a major Alzheimer's risk factor.

Alzheimer's, under this lens, is a downstream cost of the body's strategy for not dying of cancer first. The immune system's anti-tumor toolkit happens to include molecules that protect neurons - but only as a side effect the tumor never intended and the body never optimized for. When the toolkit breaks (TREM2 R47H), you lose both the intended function and the accidental one. When it works, you get a body that's slightly better at clearing plaques for exactly as long as the cancer keeps secreting the right proteins. That's a trade-off, not a cure.