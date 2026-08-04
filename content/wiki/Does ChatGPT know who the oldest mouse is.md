---
title: Does ChatGPT know who the oldest mouse is?
tags:
date: 2026-08-04
draft: false
---

# Does ChatGPT know who the oldest mouse is?

AIs are in the [news](https://www.telegraph.co.uk/business/2026/08/03/unreleased-ai-model-solves-decades-old-maths-problems/) this [week](https://mashable.com/tech/anthropic-fable-5-disproves-jacobian-conjecture) for supposedly solving dozens of long-standing math questions and putting research mathematicians out of a job. If any of you are looking for a new career, I urge you to pivot to the one thing AIs still can't do - reading longevity papers.

Let's say you're interested in benchmarking lifespan extension communities against each other, based on which animal they work on. It's 2026, so for many of us the natural first step is to turn to ChatGPT, or any other AI assistant, and to ask it for a table of lifespan records by species. 

In response, AIs invariably repeat that a mouse from Andrzej Bartke's laboratory lived for **1,819 days**, the maximum mouse lifespan ever reported.

But are they right to do that?
![[image-57.png|A mundane data collation request I gave to ChatGPT]]![[image-59.png|The response - note the "high confidence", "cleanest row" claims.]]
On the surface, the inclusion seems warranted. Bartke is a well-regarded researcher known for studying dwarf mice. Dwarfism is known for being linked to longer lifespans within a species and for offering protection from age-related diseases. And Bartke's lifespan record was indeed celebrated by the [Methuselah Foundation](https://www.mfoundation.org/) in 2003 as the Methuselah Mouse Prize. 

However, a closer look reveals that the MPrize program was launched on the 8th of June 2003, five months *after* the Bartke mouse had died on the 8th of January 2003.

And while a few other people got MPrize awards, none of them were in the record-breaking "Longevity Prize" category - Bartke remains its singular recipient.

More baffling, this specific mouse was never actually recorded in any research publication! The 1,819-day number comes from **personal communication**, not from any paper. 

In the two decades since the record claim, none of Bartke's publications have come close to repeating it. The longest lifespan I could find in his published work is a 1,537-day-old mouse from Sun et al. (2013)[^1].
![[image-65.png|Each data point records day of death of the animal (x-axis) and what share of the group survived longer than that animal (y-axis). Four colors signify a control group and three treatment groups. From Sun et al., 2013. ]]
Just by eyeballing the lifespan curves here, you get a sense of the scale of the gap. The distance between two ticks is 250 days. To put the MPrize mouse on this chart, you would need to extend the x-axis by 1 full tick, and then put the marker past that tick. In fact, let me just add the circle where the record would be.

![[bartke.png]]

To be clear, I'm not challenging Bartke or MPrize here about this result - for all I know, the mouse could really have been living for nearly 5 years, the experiment it was bred for turned out to be unpublishable, so the only recognition the mouse could get was as a spark for establishing MPrize. 

Who I'm really challenging here is ChatGPT, for thinking that winning a lifespan prize in such circumstances is an acceptable level of evidentiary support for a lifespan data point to be included alongside published fruit fly and C.elegans cohorts in the same comparative table.

**Why shouldn't AI analysis just include every mouse lifespan record claimed by a researcher?** Why does it matter whether the record is featured in a publication or not?

Because we want results that are evidence-based, not word-of-scientist-based.

Relying on word alone would lose important quality control checks on data. A research paper featuring a lifespan record also provides supporting data that helps validate the record against the possibility of a catastrophic mix-up. For example, when authors provide a survival curve for all the individuals in a cohort, you can now judge: 
* Is the shape of the survival curve compatible with the ages in the text of the paper?
* Was the winning animal a suspicious outlier among its cohort mates?
* How good were the animal facility conditions based on the control group survival shape?
And so on.

**Are mouse mix-ups a realistic concern in longevity research?** 

Surprisingly, yes. Mice are my model animal of choice, and I made a fair share of mix-ups myself: unclear earmark positions, swapped project cards, and a mass pregnancy in the all-female cage (one of them turned out to be not female). With diligent record-keeping, those are all fixable.

But not everyone can be diligent all the time. Earlier this year ChatGPT helped me spot one mix-up at a longevity database.

Long story short:
1. I downloaded raw datasets from https://phenome.jax.org/studies/aging and pointed ChatGPT at the folders to analyze. 
2. ChatGPT quickly found an outlier mouse that had a recorded age of 1,644 days in the raw dataset - easily in the top 3 mouse lifespans of all time, but not remarked about anywhere. 
3. I reached out to the lab responsible for the animal, and they explained that this mouse's outstanding longevity was just a mix-up.

**How do lifespan mix-ups happen?** 

In the case above, the mouse was last seen on Nov 1, 2021, at the age of 18 months. During the next scheduled weighing, 6 months later, the mouse was gone. It wasn't anything out of the ordinary: during routine colony maintenance, dead or heavily injured mice not reserved for dissection are normally removed by animal facility technicians, not researchers. Their dates of death are not necessarily well-recorded - in this case, the researched might use a last-seen-at date instead.

What went wrong is that the researcher, when recording the mouse's uncertain-but-unimpressive lifespan, made a typo in the records table. When inputting the last-seen date, instead of typing 2021, they typed 2024 - the numbers 1 and 4 are close together on the keypad. This added 36 months to the mouse's 18-month lifespan, adding up to 1,644 days.

**Why did an outlier this large go unnoticed until dataset publication?** 

Animal longevity studies can feature a hybrid analysis structure: 
* Survival analysis (such as survival curves) use the information from all the mice.
* Longevity analysis, like median longevity and 90th-percentile age statistics are calculated only from animals with known death ages, after excluding the “removed” records.

 It's a common practice to mark mice as "removed" for fighting, technical accidents, unrelated experiments, or other aging-unrelated causes. Their removal will be treated as "last seen alive" date by the researcher, and they will be excluded from aging-specific analysis. This recording practice helps to keep a five-year longevity experiment on track even if a few mice get accidentally lost to flooding during the first year because of a compromised pipe.
![[image-61.png|From Miller et al., 2007]]
As it was explained to me, the mystery mouse was indeed marked "removed" for aging analysis purposes.

For an aging researcher, animals lost to non-aging purposes are not that interesting. These "removed" mice weren't included in the experimental summary statistics that the researcher reports on. So the removed mouse's exceptional lifespan would end up only affect one small non-crucial readout - easy to overlook.

**Getting back** to arguments for keeping a papers-only record policy, another concern entirely is deliberate fabrication. A policy of including off-journal records into lifespan tables would be very vulnerable to fabrication: it's stupid simple to fabricate a single animal's lifespan, but fabricating an entire cohort makes it possible for data sleuths to discover statistical irregularities in the dataset.

LLMs, however, fail to draw this distinction and include Bartke's mouse on equal footing with all the actual studies. But when you point out the lack of publication, they happily throw Bartke's mouse away.

Even in this case, **AIs still can't decide on a singular lifespan record.** 

If you use ChatGPT 5.6 Extra High thinking ($20 subscription), it claims the mouse lifespan record of 1,628 days.
![[image-56.png]]

This is taken from Turturro et al. (1999)[^2]:

> The oldest male mouse, B6D2F1, lived to 1,628 days.

![[image-53.png|From Turturro et al., 1999]]
But if you ask ChatGPT 5.6 Pro ($100 subscription!!! please [support](https://brinedew.bio/posts/Support-me.html) your local scientist), it will dig up Weindruch et al. (1986)[^3], with a maximum record of 54.6 months - equaling around 1,660 days, plus-minus a couple days depending on month conversion math.

> The longest-lived individual mouse was from group N/R40 that lived 54.6 mo.

![[image-55.png|From Weindruch et al., 1986]]

ChatGPT Pro also brings up Harrison-Archer study from 1987.[^4] In a later secondary work, the same authors describe the study as producing:

> “1742 days, a new record for Mus”

But I couldn't actually access the paper, and the later curve digitization efforts by Schmauck-Medina et al.[^5] didn't provide curves for this study either, despite mentioning it by name as the record-holder.

Are there perhaps even older studies I will find after getting a $200 subscription? Maybe. If I was an Anthropic employee, would Claude Mythos have shown me a lifespan record for a 10-year-old mouse from Meiji era? Who knows! At this point, it's surprising that Mendel-style long-overlooked breakthroughs aren't popping up left and right. And yes, I asked AI to look through the old Soviet lifespan papers.
![[image-63.png|They don't know about Bogdanov's rejuvenation experiments from the 1920s]]
**So is AI good for unstructured data collation and free-form meta-analysis?** 

Hank Green, a long-time pop-science youtuber, is currently [facing criticism](https://www.businessinsider.com/hank-green-youtube-ai-apology-2026-8) for relying on AI for "research purposes". Some of his fans discourage the practice for the fears of "biasing the research process", while others don't see anything wrong with it - doesn't Google or Pubmed search also bias which papers you see first?

As much as I sympathize with the second camp, I have to give it to the AI skeptics on this one. Despite all the hallucination-pruning, AI-assisted literature review is still not thorough enough to be relied on by someone outside the field.

For a longevity enthusiast, as of 2026, it seems like the answer is definitely "double-check AI's analysis with multiple experts". It's still way too easy to mislead AIs by pop-science content biasing its ability to read critically. I have seen other examples of AIs being too hesitant to discard secondary literature if it contradicts the primary source - look out for a future post on CTVT origins.

To give AI some credit back, for a researcher who knows how to formulate the right prompt, AI can plausibly assist with digging up something worth following up on. Hacker News users have [called out](https://news.ycombinator.com/item?id=49010345) this "smart get smarter" knowledge multiplier dynamic of AI after trying to read Terence Tao's ChatGPT transcripts.
![[image-62.png]]
On the other hand, somebody just disproved a long-standing conjecture by just asking ChatGPT to "[do a breakthrough](https://www.newscientist.com/article/2580932-extremely-basic-ai-prompt-cracks-decades-old-maths-problem/)", so, you know, better not get too comfortable as an expert.

[^1]: Sun LY, Spong A, Swindell WR, Fang Y, Hill C, Huber JA, Boehm JD, Westbrook R, Salvatori R, Bartke A. Growth hormone-releasing hormone disruption extends lifespan and regulates response to caloric restriction in mice. *eLife*. 2013;2:e01098. [doi:10.7554/eLife.01098](https://doi.org/10.7554/eLife.01098).

[^2]: Turturro A, Witt WW, Lewis S, Hass BS, Lipman RD, Hart RW. Growth curves and survival characteristics of the animals used in the Biomarkers of Aging Program. *Journal of Gerontology: Biological Sciences*. 1999;54(11):B492–B501. [doi:10.1093/gerona/54.11.B492](https://doi.org/10.1093/gerona/54.11.B492).

[^3]: Weindruch R, Walford RL, Fligiel S, Guthrie D. The retardation of aging in mice by dietary restriction: longevity, cancer, immunity and lifetime energy intake. *Journal of Nutrition*. 1986;116(4):641–654. [doi:10.1093/jn/116.4.641](https://doi.org/10.1093/jn/116.4.641).

[^4]: Harrison DE, Archer JR. Genetic differences in effects of food restriction on aging in mice. *Journal of Nutrition*. 1987;117(2):376–382. [doi:10.1093/jn/117.2.376](https://doi.org/10.1093/jn/117.2.376).

[^5]: Schmauck-Medina T, et al. Dietary restriction in aging and longevity. *Nature Aging*. 2026;6:485–505. [doi:10.1038/s43587-026-01091-5](https://doi.org/10.1038/s43587-026-01091-5).
